# Backup and restore

The tooling is in `ops/backup` (image `sentinelgrc-backup`: PostgreSQL 18 client tools plus `age`), and the verifier is `npm run restore:verify`. The targets below are **configurable goals for your deployment, not guarantees** made by the software.

| Target | Suggested default | Depends on |
|---|---|---|
| Recovery point objective (RPO) | 24 hours (daily backups) | Backup frequency. Use your provider's point-in-time recovery for minutes. |
| Recovery time objective (RTO) | 4 hours | Database size, restore drill practice, DNS/TLS readiness |
| Retention | 30 daily backups (`BACKUP_RETENTION_DAYS`), plus monthly copies kept per your policy | Storage budget, legal hold |

## What a backup contains

Each run writes a timestamped folder:

| File | Content |
|---|---|
| `database.dump(.age)` | `pg_dump --format=custom --no-owner --no-privileges` of the whole database |
| `storage.tar.gz(.age)` | Local evidence and report storage (when `STORAGE_DIR` exists) |
| `manifest.json` | Creation time, PostgreSQL version, latest migration, and row counts for 22 key tables. The counts come from **the same snapshot** as the dump. |
| `SHA256SUMS` | Checksums of every file in the folder |

How the script works:
- The dump and the counts share one read-only snapshot (`pg_export_snapshot` + `pg_dump --snapshot`), so they always agree.
- The script checks that the archive is readable (`pg_restore --list`) before reporting success.
- With `BACKUP_AGE_RECIPIENT` set, archives are encrypted and the plaintext is removed.
- Production sets `BACKUP_REQUIRE_ENCRYPTION=1`, so a missing key fails the backup instead of writing plaintext.

**Object storage (S3):** evidence in a bucket is protected by **bucket versioning and lifecycle rules**, not by this script. Enable versioning, keep noncurrent versions at least as long as database backups, block public access, and replicate to a second region or account if your RPO needs it.

## Running backups

```bash
# Local Compose stack (writes to ./var/backups)
docker compose --profile ops run --rm backup

# Production (writes to BACKUP_HOST_DIR, encrypted)
cd deploy && docker compose -f docker-compose.prod.yml --env-file production.env run --rm backup
```

Schedule the production command daily (cron or a systemd timer), and alert when the newest backup is older than 26 hours.

**Access control:**
- Run backups as the read-only `sentinel_backup` role.
- Store archives on storage separate from the application host, synced off-site.
- Keep the age private key offline, available only to the people who perform restores.

## Restore (always into a separate, empty database first)

```bash
# 1. Create an empty database (e.g. sentinelgrc_restore) and an empty storage directory.
# 2. Restore. The script checks SHA256SUMS, decrypts, refuses non-empty targets
#    and refuses a target equal to SOURCE_DATABASE_URL.
docker run --rm -v /srv/sentinelgrc-backups:/backups:ro -v /srv/restore-storage:/restore-storage \
  -v /secure/age-key.txt:/key.txt:ro \
  -e TARGET_DATABASE_URL=postgresql://sentinel_owner:…@db.internal:5432/sentinelgrc_restore \
  -e SOURCE_DATABASE_URL=postgresql://sentinel_owner:…@db.internal:5432/sentinelgrc \
  -e AGE_IDENTITY_FILE=/key.txt -e STORAGE_TARGET_DIR=/restore-storage \
  $REGISTRY/sentinelgrc-backup:$VERSION restore.sh /backups/20261021T020000Z
```

## Verify

Run the verifier against the **restored** database and storage. It never touches the live system unless you point it there.

```bash
DATABASE_URL=postgresql://…/sentinelgrc_restore LOCAL_STORAGE_PATH=/srv/restore-storage \
  npm run restore:verify -w services/api -- --manifest /srv/sentinelgrc-backups/20261021T020000Z/manifest.json
# or, from the API image:
docker run --rm -e DATABASE_URL=… -e LOCAL_STORAGE_PATH=/restore-storage -v /srv/restore-storage:/restore-storage \
  -v /srv/sentinelgrc-backups/20261021T020000Z:/b:ro $REGISTRY/sentinelgrc-api:$VERSION \
  node dist/cli/verify-restore.js --manifest /b/manifest.json
```

It checks:
- every repository migration is applied and none failed;
- the append-only triggers on audit, risk-history and finding-event tables exist;
- row counts equal the manifest;
- every stored evidence file and generated report exists and matches its recorded SHA-256.

It prints PASS or FAIL per check and exits 1 on any failure.

After it passes, sign in to an instance pointed at the restored database (a staging stack) and spot-check a few records and downloads.

## Cutting over (real recovery)

1. Stop the API and worker (`up -d` with zero replicas, or `stop api worker`).
2. Point `DATABASE_URL` (and `MIGRATION_DATABASE_URL`) at the verified restored database, and storage at the restored files or bucket version.
3. Run `release` (a no-op if the schema is current), start the services, and run the post-deployment checks.
4. Revoke all sessions if the incident involved credential exposure (`sessions:revoke --all`).
5. Record what was restored, from which backup, the data-loss window, and who approved it.

## Failed migration recovery

- If `release` fails, the old containers keep serving; nothing switches over.
- If a migration is applied but breaks the application, **do not** hand-edit `_prisma_migrations` on the live database:
  1. Restore the pre-release backup into a new database.
  2. Verify it.
  3. Cut over with the previous application version.
  4. Ship a corrected migration in the next release.

## Restore drills

- Run a full drill (backup → restore into a scratch database → `restore:verify` → spot checks) **monthly** and after any change to the backup tooling or schema.
- Record the date, the backup used, the time taken (against your RTO) and the result.
- The verifier's failure detection was itself tested: it reports missing files, tampered files (checksum mismatch) and count differences.
