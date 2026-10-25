# Backup Strategy

All production data lives in MySQL and the Laravel `storage/` directory. Back up both.

---

## What to back up

| Data | Location | Criticality |
|------|----------|-------------|
| Application database | `mysql_data` Docker volume | Critical |
| User-uploaded files | `storage/app/` | High |
| Laravel logs | `storage/logs/` | Low (recreatable) |
| n8n workflows | `n8n_data` Docker volume | Medium |
| n8n database | `n8n_postgres_data` Docker volume | Medium |

---

## MySQL backup

### Daily dump via cron (on the host)

Add to the host crontab (`crontab -e`):

```cron
0 2 * * * docker exec ultron-mysql-1 mysqldump \
  -u ultron -p"${DB_PASSWORD}" \
  --single-transaction --routines --triggers \
  ultron | gzip > /srv/backups/ultron-$(date +\%Y-\%m-\%d).sql.gz
```

- `--single-transaction` ensures a consistent snapshot without table locks.
- Adjust the container name (`ultron-mysql-1`) to match `docker compose ps`.

### Retention policy

Keep 7 daily backups. Add to the crontab:

```cron
0 3 * * * find /srv/backups -name "ultron-*.sql.gz" -mtime +7 -delete
```

### Off-site copy

After the dump, sync to an off-site location:

```bash
# Example: rsync to a remote server
rsync -az /srv/backups/ backup-user@remote-host:/backups/ultron/

# Example: upload to S3-compatible storage
aws s3 sync /srv/backups/ s3://your-bucket/ultron-backups/
```

---

## Storage backup

Laravel file uploads live in the `storage/app/` directory (bind-mounted from the host in development; inside the container in production).

```bash
# Snapshot the storage volume
tar -czf /srv/backups/storage-$(date +%Y-%m-%d).tar.gz \
  /srv/ultron/storage/app/
```

Or, if using a named volume, dump it:

```bash
docker run --rm \
  -v ultron_storage:/data \
  -v /srv/backups:/backup \
  alpine tar czf /backup/storage-$(date +%Y-%m-%d).tar.gz /data
```

---

## n8n backup

n8n workflows are stored in the `n8n_data` volume and the `n8n_postgres_data` volume.

```bash
# n8n Postgres dump
docker exec ultron-n8n-postgres-1 pg_dump \
  -U n8n n8n | gzip > /srv/backups/n8n-$(date +%Y-%m-%d).sql.gz
```

Alternatively, export workflows from the n8n UI: **Settings → Export all workflows**.

---

## Restoration procedure

### Restore MySQL

```bash
# 1. Decompress
gunzip /srv/backups/ultron-2026-06-11.sql.gz

# 2. Drop and recreate the database
docker exec -i ultron-mysql-1 mysql \
  -u root -p"${DB_ROOT_PASSWORD}" \
  -e "DROP DATABASE IF EXISTS ultron; CREATE DATABASE ultron;"

# 3. Import
docker exec -i ultron-mysql-1 mysql \
  -u ultron -p"${DB_PASSWORD}" ultron \
  < /srv/backups/ultron-2026-06-11.sql

# 4. Run any pending migrations
docker compose exec ultron-app php artisan migrate --force
```

### Restore storage

```bash
tar -xzf /srv/backups/storage-2026-06-11.tar.gz -C /
```

---

## Backup verification

Test the restore procedure on a staging server at least once a quarter:

```bash
# Verify dump is readable
gunzip -t /srv/backups/ultron-$(date +%Y-%m-%d).sql.gz && echo "OK"

# Verify row count after restore
docker exec ultron-mysql-1 mysql \
  -u ultron -p"${DB_PASSWORD}" ultron \
  -e "SELECT COUNT(*) FROM organizations;"
```

---

## Managed database option

For reduced operational overhead, consider a managed MySQL service (PlanetScale, AWS RDS, DigitalOcean Managed MySQL). Update `DB_HOST` to point to the managed endpoint and remove the `ultron-mysql` service from `docker-compose.yml`. Most managed services include automated daily backups with point-in-time recovery.
