# tgmax-sync

Multi-tenant сервис синхронизации `Telegram channel -> Max channel` через Telegram Bot API.

## Что уже реализовано в этой версии

- simple auth: `email/password` + сессии `Bearer` токеном;
- строгая tenant-изоляция на уровне API и repository (`user_id` в каждом запросе);
- web UI: Login, My Channels, Logs/Status + Telegram Bot onboarding;
- webhook ingestion: `POST /api/webhooks/telegram` с idempotency по `update_id`;
- shared queue архитектура: `tg_sync_jobs` + pooled workers;
- `create/edit` синхронизация в Max near-realtime, `delete` best-effort;
- защита от смешения каналов: job содержит только `channel_sync_config_id`, конфиг перечитывается из БД с проверкой владельца.

## Миграции и таблицы

Миграции `004_multi_tenant_core.sql` и `005_botapi_v1.sql` добавляют:

- `tg_users`
- `tg_user_sessions`
- `tg_channel_sync_configs`
- `tg_sync_jobs`
- `tg_sync_job_logs`
- `tg_channel_sync_state`
- `tg_channel_message_map`
- `tg_bot_updates_log`

## Быстрый старт (dev/prod шаги)

1. Скопировать `.env.example` в `.env` и заполнить.
2. Установить зависимости: `npm install`.
3. Прогнать миграции: `npm run migrate`.
4. Запустить web+engine: `npm run web`.
5. Открыть UI: `http://localhost:3030`.

## Основные env-переменные

- `TG_BOT_TOKEN=...`
- `TG_BOT_WEBHOOK_SECRET=...` (рекомендуется)
- `WEB_PORT=3030`
- `WEB_SESSION_TTL_HOURS=72`
- `SYNC_SCHEDULER_INTERVAL_MS=10000`
- `SYNC_WORKER_CONCURRENCY=2`
- `SYNC_MAX_ATTEMPTS=8`

## Принцип tenant-safety

- все защищенные API endpoint используют `TenantGuard` через bearer auth;
- в `tg_sync_jobs` маршрутизация идет через `channel_sync_config_id`, не через "свободные" channel ids;
- worker перед исполнением проверяет связку `job.user_id == config.user_id`;
- логи и джобы в UI фильтруются только по `auth.user_id`.
- webhook route ищет канал только среди `active` BotAPI-конфигов.

## PM2

Для прод-запуска используйте `ecosystem.config.cjs` и процесс `tgmax-sync-web`.

Подробные команды и проверки: `RUNBOOK.md`.
Проверки tenant-изоляции: `MULTI_TENANT_VALIDATION.md`.
Сценарий проверки первого пользователя: `SMOKE_FIRST_USER.md`.
