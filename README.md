# PROFIT DIVIDER — Financial Platform

Профессиональная финансовая веб-платформа для производственного предприятия
ООО «PROFIT DIVIDER», построенная на базе бухгалтерского Excel-отчёта (48 листов).

**Fintech-minimalism · dark premium UI · real-time · RBAC**

## Стек

| Слой | Технологии |
|------|-----------|
| Backend | FastAPI · async SQLAlchemy 2 · PostgreSQL · JWT · WebSocket |
| Frontend | React + TypeScript · Vite · TailwindCSS · Recharts |
| Инфраструктура | Docker Compose (db + backend + frontend/nginx) |

## Запуск (одна команда)

```bash
docker compose up --build
```

- Frontend:  http://localhost:3000
- Backend API / Swagger:  http://localhost:8000/docs
- PostgreSQL:  localhost:5433 (finasist / finasist)

Супер-администратор создаётся автоматически:

```
Email:  admin@profitdivider.uz
Пароль: Admin12345!
```

## Возможности

- **Дашборд** — KPI (поступления/расходы/прибыль/дебиторка-кредиторка), графики Cash Flow
  и структуры расходов, живая лента событий.
- **Банк и Касса (Cash Flow)** — операции прихода/расхода в UZS/USD с авто-конвертацией по курсу.
- **Реестр организаций** — поставщики, заказчики, прочие; ИНН, НДС, балансы Дт-Кт.
- **Готовая продукция / Сырьё и запчасти** — складские остатки и стоимость.
- **Налоги · Займы · Курс доллара** — вспомогательные финансовые справочники.
- **Real-time** — любое изменение мгновенно рассылается всем клиентам через WebSocket
  (тосты + автообновление таблиц и дашборда).

## Управление доступом (RBAC)

Всё контролирует **супер-администратор**:

- Создаёт роли и вручную назначает **гранулярные права** (модуль × действие: просмотр,
  создание, изменение, удаление, экспорт) через матрицу доступа.
- Новые роли и пользователи **не имеют прав по умолчанию** — доступ выдаётся явно.
- Пользователь-**поставщик** или **заказчик** привязывается к своей организации и видит
  только свои операции.
- Пользователей и роли можно включать/отключать, редактировать и удалять.

Готовые примеры ролей: Администратор, Бухгалтер, Поставщик, Заказчик, Наблюдатель, Без доступа.

## Структура

```
finasist/
├── docker-compose.yml
├── backend/            # FastAPI приложение
│   └── app/
│       ├── main.py         # приложение + WebSocket + старт/сид
│       ├── models.py       # SQLAlchemy модели
│       ├── security.py     # JWT + проверка прав (require)
│       ├── permissions.py  # каталог прав
│       ├── seed.py         # супер-админ + демо-данные из Excel
│       └── routers/        # auth, users, roles, organizations, transactions, ...
└── frontend/           # React + Vite + Tailwind
    └── src/
        ├── pages/          # Dashboard, Transactions, Organizations, Users, Roles, ...
        ├── components/     # Layout, ui-kit
        └── store/          # auth + realtime
```

## Разработка без Docker

```bash
# backend
cd backend && pip install -r requirements.txt
uvicorn app.main:app --reload   # нужен PostgreSQL, задайте DATABASE_URL

# frontend
cd frontend && npm install && npm run dev   # http://localhost:5173
```
