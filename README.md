# tgmax-sync

Сервис непрерывной синхронизации `Telegram (master) -> Max (mirror)` в near-realtime режиме.

## Что делает

- опрашивает Telegram-канал с заданным интервалом;
- обнаруживает create/update/delete изменения;
- ставит события в очередь `sync_events`;
- применяет изменения в Max-канал через Bot API;
- ведет карту соответствий `message_map` и курсор `sync_cursor`;
- автоматически подбирает зависшие `processing` события и повторяет retryable ошибки.

## Быстрый старт

1. Скопировать `.env.example` в `.env` и заполнить переменные.
2. Установить зависимости:
   - `npm install`
3. Прогнать миграции:
   - `npm run migrate`
4. Запустить воркер:
   - `npm run sync:worker`

## Основные переменные

- `SYNC_SOURCE_CHANNEL=@yourchannel`
- `MAX_TARGET_CHAT_ID=-123456789`
- `SYNC_POLL_INTERVAL_MS=30000`
- `SYNC_POLL_LIMIT=200`
- `SYNC_EVENT_BATCH_SIZE=50`

## PM2

Используйте `ecosystem.config.cjs`:

- `pm2 start ecosystem.config.cjs`
- `pm2 save`
- `pm2 startup`

Проверка:

- `pm2 status`
- `pm2 logs tgmax-sync-worker --lines 100`

## Схема таблиц

Миграции создают/обновляют:

- `channel_posts`
- `media_uploads`
- `crosspost_log`
- `sync_cursor`
- `message_map`
- `sync_events`
- `sync_locks`

Подробный операционный документ: `RUNBOOK.md`.
