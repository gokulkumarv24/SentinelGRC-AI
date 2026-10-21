#!/bin/sh
# SentinelGRC restore into a SEPARATE, EMPTY database and storage directory. See docs/BACKUP_RESTORE.md.
#
#   restore.sh <backup folder>
#   TARGET_DATABASE_URL     empty database to restore into (never the live database)
#   STORAGE_TARGET_DIR      directory to unpack evidence/report storage into (default /restore-storage)
#   AGE_IDENTITY_FILE       age private key file, required for encrypted backups
#   SOURCE_DATABASE_URL     optional: the live database; restore refuses if it equals the target
set -eu

SRC=${1:?usage: restore.sh <backup folder>}
: "${TARGET_DATABASE_URL:?TARGET_DATABASE_URL is required}"
STORAGE_TARGET_DIR=${STORAGE_TARGET_DIR:-/restore-storage}

if [ -n "${SOURCE_DATABASE_URL:-}" ] && [ "$SOURCE_DATABASE_URL" = "$TARGET_DATABASE_URL" ]; then
  echo "Refusing: the target is the live database. Restore into a separate database, verify, then cut over deliberately." >&2
  exit 2
fi

echo "1/4 Checking archive integrity"
(cd "$SRC" && sha256sum -c SHA256SUMS)

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
for f in database.dump storage.tar.gz; do
  if [ -f "$SRC/$f.age" ]; then
    : "${AGE_IDENTITY_FILE:?the backup is encrypted; set AGE_IDENTITY_FILE}"
    age --decrypt --identity "$AGE_IDENTITY_FILE" --output "$WORK/$f" "$SRC/$f.age"
  elif [ -f "$SRC/$f" ]; then
    cp "$SRC/$f" "$WORK/$f"
  fi
done

echo "2/4 Checking the target database is empty"
TABLES=$(psql "$TARGET_DATABASE_URL" --no-psqlrc -At -c "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")
if [ "$TABLES" != "0" ]; then
  echo "Refusing: the target database already has $TABLES tables. Create an empty database for the restore." >&2
  exit 2
fi

echo "3/4 Restoring the database"
pg_restore --no-owner --no-privileges --exit-on-error --dbname "$TARGET_DATABASE_URL" "$WORK/database.dump"

echo "4/4 Restoring storage"
if [ -f "$WORK/storage.tar.gz" ]; then
  mkdir -p "$STORAGE_TARGET_DIR"
  tar -xzf "$WORK/storage.tar.gz" -C "$STORAGE_TARGET_DIR"
fi

echo "Restore finished. Now verify it (docs/BACKUP_RESTORE.md, step 'Verify'):"
echo "  DATABASE_URL=<target> LOCAL_STORAGE_PATH=<restored storage> npm run restore:verify -w services/api -- --manifest $SRC/manifest.json"
