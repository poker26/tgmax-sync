# TG master -> MAX mirror: Runbook

Документ для прод-эксплуатации `sync-worker` в репозитории `tgmax-sync`.

## 1) Цель и SLA

- Синхронизация: `Telegram (master)` -> `MAX (mirror)`.
- Режим: near-realtime polling.
- Целевые SLA:
  - новые посты в MAX: до 60 сек;
  - обновления постов: до 120 сек;
  - удаления постов: до 120 сек;
  - отсутствие зависших `pending/processing` дольше 10 минут.

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

- `sync_cursor`
- `message_map`
- `sync_events`
- `sync_locks`

## 3) Настройка `.env` для sync-worker

Минимальный блок:

```env
MAX_BOT_TOKEN=...
MAX_API_BASE_URL=https://platform-api.max.ru

SYNC_POLL_INTERVAL_MS=30000
SYNC_POLL_LIMIT=200
SYNC_EVENT_BATCH_SIZE=50
SYNC_LOCK_TTL_MS=120000
SYNC_LOCK_NAME=tg_master_to_max_worker
SYNC_STALE_PROCESSING_MS=600000
SYNC_MAX_ATTEMPTS=8
SYNC_RETRY_BASE_DELAY_MS=2000
SYNC_DELETE_FALLBACK_MODE=tombstone
```

Каналы source/target не задаются в `.env`.
Передаются явно аргументами запуска:

```bash
npm run sync:worker -- --source-channel @your_channel --max-chat-id -123456789
```

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
pm2 logs tgmax-sync-worker --lines 100
```

## 5) Smoke test

1. Новый пост в Telegram -> появляется в MAX.
2. Редактирование поста в Telegram -> отражается в MAX.
3. Удаление поста в Telegram -> удаляется/замещается в MAX.

## 6) Операционные SQL проверки

Глубина очереди:

```sql
select status, count(*) as count
from sync_events
group by status
order by status;
```

Зависшие `processing`:

```sql
select id, source_channel_id, source_message_id, event_type, processing_started_at, attempt_count
from sync_events
where status = 'processing'
  and processing_started_at < now() - interval '10 minutes'
order by processing_started_at asc;
```

Ошибки:

```sql
select id, source_message_id, event_type, attempt_count, last_error, updated_at
from sync_events
where status = 'error'
order by updated_at desc
limit 100;
```

## 7) Rollback

Остановить воркер:

```bash
pm2 stop tgmax-sync-worker
```

После стабилизации — вернуть запуск и мониторинг.
