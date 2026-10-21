#!/bin/sh
# SentinelGRC backup: database dump + evidence/report storage + manifest + checksums, optionally encrypted.
# Runs in the ops/backup image (PostgreSQL 18 client tools + age). See docs/BACKUP_RESTORE.md.
#
#   DATABASE_URL            source database (least-privilege backup role recommended)
#   BACKUP_DIR              destination directory (default /backups) — keep it off the application host
#   STORAGE_DIR             local evidence/report storage to include (default /storage; skipped if absent)
#   BACKUP_AGE_RECIPIENT    age public key; when set, archives are encrypted and plaintext removed
#   BACKUP_REQUIRE_ENCRYPTION=1   refuse to write unencrypted backups (set in production)
#   BACKUP_RETENTION_DAYS   delete backup folders older than this (default 30)
set -eu
umask 077

: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR=${BACKUP_DIR:-/backups}
STORAGE_DIR=${STORAGE_DIR:-/storage}
RETENTION_DAYS=${BACKUP_RETENTION_DAYS:-30}

if [ "${BACKUP_REQUIRE_ENCRYPTION:-0}" = "1" ] && [ -z "${BACKUP_AGE_RECIPIENT:-}" ]; then
  echo "Refusing: BACKUP_REQUIRE_ENCRYPTION=1 but BACKUP_AGE_RECIPIENT is not set." >&2
  exit 2
fi

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$BACKUP_DIR/$STAMP"
mkdir -p "$OUT"
export OUT

# One read-only snapshot for both the dump and the row counts, so the manifest matches the dump exactly.
# Keep this table list in sync with COUNTED_TABLES in services/api/src/cli/verify-restore.ts.
psql "$DATABASE_URL" --no-psqlrc --quiet --tuples-only --no-align <<'SQL'
\set ON_ERROR_STOP on
\getenv out OUT
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT pg_export_snapshot() AS snap \gset
\setenv SNAPSHOT :snap
\! pg_dump --format=custom --no-owner --no-privileges --snapshot="$SNAPSHOT" --file "$OUT/database.dump" "$DATABASE_URL" || touch "$OUT/DUMP_FAILED"
\o :out/manifest.json
SELECT json_build_object(
  'createdAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'postgres', current_setting('server_version'),
  'latestMigration', (SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC, migration_name DESC LIMIT 1),
  'counts', json_build_object(
    'organizations', (SELECT count(*) FROM organizations), 'users', (SELECT count(*) FROM users),
    'memberships', (SELECT count(*) FROM memberships), 'controls', (SELECT count(*) FROM controls),
    'control_tests', (SELECT count(*) FROM control_tests), 'evidence', (SELECT count(*) FROM evidence),
    'evidence_links', (SELECT count(*) FROM evidence_links), 'risks', (SELECT count(*) FROM risks),
    'risk_history', (SELECT count(*) FROM risk_history), 'findings', (SELECT count(*) FROM findings),
    'finding_events', (SELECT count(*) FROM finding_events), 'remediation_tasks', (SELECT count(*) FROM remediation_tasks),
    'vendors', (SELECT count(*) FROM vendors), 'vendor_assessments', (SELECT count(*) FROM vendor_assessments),
    'question_responses', (SELECT count(*) FROM question_responses), 'ai_systems', (SELECT count(*) FROM ai_systems),
    'ai_assessments', (SELECT count(*) FROM ai_assessments), 'workflow_runs', (SELECT count(*) FROM workflow_runs),
    'notifications', (SELECT count(*) FROM notifications), 'audit_events', (SELECT count(*) FROM audit_events),
    'report_runs', (SELECT count(*) FROM report_runs), 'ai_artifacts', (SELECT count(*) FROM ai_artifacts)
  )
);
\o
COMMIT;
SQL

if [ -f "$OUT/DUMP_FAILED" ] || [ ! -s "$OUT/database.dump" ]; then
  echo "Backup FAILED: pg_dump did not produce an archive." >&2
  exit 1
fi
# The archive must be readable before we call it a backup.
pg_restore --list "$OUT/database.dump" > /dev/null

FILES="database.dump manifest.json"
if [ -d "$STORAGE_DIR" ]; then
  tar -C "$STORAGE_DIR" -czf "$OUT/storage.tar.gz" .
  FILES="$FILES storage.tar.gz"
else
  echo "Note: $STORAGE_DIR not found; storage not included (object storage relies on bucket versioning)."
fi

if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then
  for f in database.dump storage.tar.gz; do
    [ -f "$OUT/$f" ] || continue
    age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" --output "$OUT/$f.age" "$OUT/$f"
    rm -f "$OUT/$f"
    FILES=$(echo "$FILES" | sed "s/\b$f\b/$f.age/")
  done
fi

(cd "$OUT" && sha256sum $FILES > SHA256SUMS)
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime +"$RETENTION_DAYS" -exec rm -rf {} +
echo "Backup complete: $OUT ($FILES)"
