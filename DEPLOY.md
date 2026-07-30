# Установка на сервер

Схема как у соседних проектов на этой машине: контейнеры слушают только
`127.0.0.1`, а наружу их выводит **системный nginx** сервера — он же держит
80/443 и сертификаты. Свой Caddy/traefik поднимать нельзя: порты заняты,
и это сломало бы уже работающие сайты.

```
интернет ──► nginx (80/443, сертификат certbot)
                └─► 127.0.0.1:5181 ─► контейнер frontend (nginx в образе)
                                        ├─► /       статика SPA
                                        ├─► /api/   ─► backend:8000
                                        └─► /ws     ─► backend:8000
                                                       └─► db:5432
```

Порт базы и бэкенда наружу **не публикуются** — снаружи к ним не подключиться.

---

## 1. Код

```bash
mkdir -p /opt/finasist && cd /opt/finasist
git clone https://github.com/Javohir0913/finasist.git .
```

Обновление потом: `git pull`.

## 2. Секреты

```bash
cd /opt/finasist
cp .env.example .env
```

Сгенерировать значения и вписать в `.env`:

```bash
openssl rand -base64 32   # SECRET_KEY
openssl rand -base64 18   # POSTGRES_PASSWORD
openssl rand -base64 12   # SUPERADMIN_PASSWORD
```

Заполнить обязательно: `POSTGRES_PASSWORD`, `SECRET_KEY`,
`SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD`. Ещё `WEB_PORT` — свободный порт
на localhost (проверить: `ss -tlnp | grep 5181`).

`chmod 600 .env` — пароли не должны читаться кем угодно.

> `POSTGRES_PASSWORD` задаётся только при первом старте, когда том `pgdata`
> ещё пустой. Менять его потом бесполезно — Postgres перестанет пускать.

## 3. Запуск

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
curl -s localhost:5181/api/health
```

Ответ `{"status":"ok",...}` означает, что цепочка frontend → backend → db жива.

## 4. Домен в системном nginx

Отдельный файл — существующие сайты не трогаем:

```bash
cat > /etc/nginx/sites-available/profit.coffee-nap.uz <<'CONF'
server {
    listen 80;
    server_name profit.coffee-nap.uz;
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl http2;
    server_name profit.coffee-nap.uz;

    ssl_certificate     /etc/letsencrypt/live/profit.coffee-nap.uz/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/profit.coffee-nap.uz/privkey.pem;

    # выгрузка в Excel бывает крупной
    client_max_body_size 64m;

    location / {
        proxy_pass http://127.0.0.1:5181;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # real-time обновления
    location /ws {
        proxy_pass http://127.0.0.1:5181;
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host       $host;
        proxy_read_timeout 3600s;
    }
}
CONF

ln -sf /etc/nginx/sites-available/profit.coffee-nap.uz /etc/nginx/sites-enabled/
```

## 5. Сертификат

A-запись домена уже должна указывать на сервер.

```bash
certbot certonly --nginx -d profit.coffee-nap.uz --agree-tos -m ПОЧТА --non-interactive
nginx -t && systemctl reload nginx
```

`nginx -t` перед reload обязателен: он проверяет конфиг ВСЕХ сайтов, и
ошибка в новом файле иначе положила бы остальные. Обновление сертификата
делает системный таймер certbot, вручную ничего не нужно.

## 6. Резервные копии

```bash
chmod +x /opt/finasist/backup.sh
/opt/finasist/backup.sh            # проверить, что дамп создаётся
crontab -e
```

```
0 3 * * * /opt/finasist/backup.sh >> /var/log/finasist-backup.log 2>&1
```

Хранятся 14 дней в `/opt/finasist/backups`. Восстановление — в конце `backup.sh`.

---

## Обслуживание

| Задача | Команда |
|---|---|
| Обновить код | `cd /opt/finasist && git pull && docker compose -f docker-compose.prod.yml up -d --build` |
| Логи бэкенда | `docker compose -f docker-compose.prod.yml logs -f backend` |
| Перезапуск | `docker compose -f docker-compose.prod.yml restart` |
| Состояние | `docker compose -f docker-compose.prod.yml ps` |
| Копия базы | `/opt/finasist/backup.sh` |

## После первого входа

1. Войти под `SUPERADMIN_EMAIL` из `.env`.
2. «Пользователи» → создать по учётной записи на каждого сотрудника и выдать
   роль. Один общий аккаунт обесценивает «Журнал»: не видно, кто что сделал.
3. «Настройки» → ставки налогов и дата начала учёта.
4. «Справочники» → подразделения, кассы, банковские счета.
