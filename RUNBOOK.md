# TG master -> MAX mirror: Runbook

Документ для прод-эксплуатации multi-tenant `web + shared worker` в `tgmax-sync`.

## 1) Цель и SLA

- Синхронизация: `Telegram Bot API (channel updates)` -> `MAX (mirror)`.
- Режим: near-realtime webhook, управление через web UI.
- Целевые SLA:
  - новые/обновленные посты в MAX: до 60 сек;
  - отсутствие зависших `pending/processing` джоб дольше 10 минут.

## 2) Обновление кода и миграции

```bash
cd /path/to/tgmax-sync
```

```bash
git pull
```

```bash
npm install
```

```bash
npm run migrate
```

После миграции должны существовать таблицы:

- `tg_users`
- `tg_user_sessions`
- `tg_channel_sync_configs`
- `tg_sync_jobs`
- `tg_sync_job_logs`
- `tg_channel_sync_state`
- `tg_channel_message_map`
- `tg_bot_updates_log`

## 3) Настройка `.env` для web+engine

Минимальный блок:

```env
MAX_BOT_TOKEN=...
MAX_API_BASE_URL=https://platform-api.max.ru
TG_BOT_TOKEN=...
TG_BOT_WEBHOOK_SECRET=...

WEB_PORT=3030
WEB_SESSION_TTL_HOURS=72

SYNC_SCHEDULER_INTERVAL_MS=10000
SYNC_WORKER_CONCURRENCY=2
SYNC_MAX_ATTEMPTS=8
```

Каналы source/target не задаются в `.env`, добавляются пользователем через UI.
В Telegram пользователь добавляет вашего бота в канал как администратора.

## 4) Запуск в PM2

```bash
pm2 start ecosystem.config.cjs
```

```bash
pm2 save
```

Проверка:

```bash
pm2 status
```

```bash
pm2 logs tgmax-sync-web --lines 100
```

## 5) Smoke test

1. Через UI создать bootstrap user и login.
2. Проверить Telegram bot username в UI.
3. Добавить бота в канал Telegram администратором.
4. В UI добавить связку `source_channel -> target_chat`.
5. Нажать `Validate bot access` и дождаться статуса `connected`.
6. Новый пост в Telegram появляется в MAX.

## 6) Операционные SQL проверки

Глубина очереди `tg_sync_jobs`:

```sql
select status, count(*) as count
from tg_sync_jobs
group by status
order by status;
```

Зависшие `processing`:

```sql
select id, user_id, channel_sync_config_id, started_at, attempt_count
from tg_sync_jobs
where status = 'processing'
  and started_at < now() - interval '10 minutes'
order by started_at asc;
```

Ошибки:

```sql
select id, user_id, channel_sync_config_id, attempt_count, error_message, updated_at
from tg_sync_jobs
where status = 'error'
order by updated_at desc
limit 100;
```

Ошибки webhook ingestion:

```sql
select channel_sync_config_id, update_id, event_type, status, error_message, created_at
from tg_bot_updates_log
where status = 'error'
order by created_at desc
limit 100;
```

## 7) Rollback

Остановить сервис:

```bash
pm2 stop tgmax-sync-web
```

После стабилизации — вернуть запуск и мониторинг.
