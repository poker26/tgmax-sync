# tgmax-sync

Multi-tenant сервис синхронизации `Telegram (master) -> Max (mirror)` с веб-интерфейсом.

## Что уже реализовано в этой версии

- simple auth: `email/password` + сессии `Bearer` токеном;
- строгая tenant-изоляция на уровне API и repository (`user_id` в каждом запросе);
- per-user Telegram session (`telegram_accounts`);
- web UI: Login, My Channels, Logs/Status;
- shared queue архитектура: `sync_jobs` + единый scheduler + pooled workers;
- защита от смешения каналов: job содержит только `channel_sync_config_id`, конфиг перечитывается из БД с проверкой владельца.

## Миграции и таблицы

Новая migration `004_multi_tenant_core.sql` добавляет:

- `users`
- `user_sessions`
- `telegram_accounts`
- `channel_sync_configs`
- `sync_jobs`
- `sync_job_logs`
- `channel_sync_state`
- `channel_message_map`

## Быстрый старт (dev/prod шаги)

1. Скопировать `.env.example` в `.env` и заполнить.
2. Установить зависимости: `npm install`.
3. Прогнать миграции: `npm run migrate`.
4. Запустить web+engine: `npm run web`.
5. Открыть UI: `http://localhost:3030`.

## Основные env-переменные

- `WEB_PORT=3030`
- `WEB_SESSION_TTL_HOURS=72`
- `SYNC_SCHEDULER_INTERVAL_MS=10000`
- `SYNC_WORKER_CONCURRENCY=2`
- `SYNC_MAX_ATTEMPTS=8`

## Принцип tenant-safety

- все защищенные API endpoint используют `TenantGuard` через bearer auth;
- в `sync_jobs` маршрутизация идет через `channel_sync_config_id`, не через "свободные" channel ids;
- worker перед исполнением проверяет связку `job.user_id == config.user_id == telegram_account.user_id`;
- логи и джобы в UI фильтруются только по `auth.user_id`.

## PM2

Для прод-запуска используйте `ecosystem.config.cjs` и процесс `tgmax-sync-web`.

Подробные команды и проверки: `RUNBOOK.md`.
Проверки tenant-изоляции: `MULTI_TENANT_VALIDATION.md`.
Сценарий проверки первого пользователя: `SMOKE_FIRST_USER.md`.
