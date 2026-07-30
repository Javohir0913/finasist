#!/usr/bin/env bash
# Резервная копия базы. Кладём рядом с проектом, храним 14 дней.
#
# Разово:   ./backup.sh
# По крону: 0 3 * * * /opt/finasist/backup.sh >> /var/log/finasist-backup.log 2>&1
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$DIR/backups"
KEEP_DAYS=14

cd "$DIR"

# .env читаем разбором, а НЕ `source`: значения вида `SUPERADMIN_NAME=Super Admin`
# оболочка попыталась бы выполнить как команду.
env_get() { sed -n "s/^$1=//p" .env | tail -1 | tr -d '"'\''\r'; }
POSTGRES_USER="$(env_get POSTGRES_USER)"
POSTGRES_DB="$(env_get POSTGRES_DB)"
: "${POSTGRES_USER:?в .env нет POSTGRES_USER}" "${POSTGRES_DB:?в .env нет POSTGRES_DB}"

mkdir -p "$OUT"
FILE="$OUT/finasist-$(date +%Y%m%d-%H%M%S).sql.gz"

# pg_dump внутри контейнера — снаружи порт базы закрыт
docker compose -f docker-compose.prod.yml exec -T db \
    pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" | gzip -9 > "$FILE"

# пустой дамп означает, что что-то пошло не так — такой файл не храним
if [ ! -s "$FILE" ]; then
    rm -f "$FILE"
    echo "$(date '+%F %T')  ОШИБКА: дамп пустой, копия не создана" >&2
    exit 1
fi

echo "$(date '+%F %T')  готово: $FILE ($(du -h "$FILE" | cut -f1))"
find "$OUT" -name 'finasist-*.sql.gz' -mtime +$KEEP_DAYS -delete

# Восстановление:
#   gunzip -c backups/finasist-ГГГГММДД-ЧЧММСС.sql.gz | \
#     docker compose -f docker-compose.prod.yml exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
