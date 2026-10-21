# Backup/restore tool image: PostgreSQL 18 client tools (pg_dump, pg_restore, psql) plus age for encryption.
FROM postgres:18.4-bookworm
RUN apt-get update \
 && apt-get install -y --no-install-recommends age \
 && rm -rf /var/lib/apt/lists/*
COPY --chmod=0755 backup.sh restore.sh /usr/local/bin/
USER postgres
ENTRYPOINT []
CMD ["backup.sh"]
