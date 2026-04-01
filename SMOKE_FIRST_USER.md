# Smoke test: first user BotAPI flow

Документ для ручной проверки веб-морды и базового сценария первого пользователя.

## 1) Подготовка

1. Убедиться, что `.env` заполнен.
2. Применить миграции.
3. Запустить сервис `tgmax-sync-web`.
4. Открыть `http://localhost:3030`.

## 2) Проверка bootstrap пользователя

1. На экране `Login` должна быть подсказка:
   - `No users found...`, если база пустая.
2. Нажать `Register first user`:
   - ожидается успешный ответ.
3. Повторно нажать `Register first user`:
   - ожидается ошибка, так как bootstrap разрешен только один раз.

## 3) Проверка login

1. Ввести email/password первого пользователя.
2. Нажать `Login`.
3. Ожидается переход в рабочую часть UI (`Telegram Bot onboarding`, `My channels`, `Logs`).

## 4) Проверка подключения Telegram-бота

1. В блоке `Telegram Bot onboarding` нажать refresh.
2. Проверить, что выводится username бота (например `@your_sync_bot`).
3. В Telegram добавить этого бота в канал как администратора.

## 5) Проверка My Channels

1. Добавить канал (`@source_channel`) и target chat id (`-123...`).
2. Убедиться, что новая связка появилась в списке.
3. Нажать `Validate bot access`, убедиться в `Bot status: connected`.
4. Проверить кнопки `Start`, `Pause`, `Disable`, `Delete`.

## 6) Проверка Logs & Status

1. Нажать `Refresh logs`.
2. Убедиться, что отображаются последние строки логов.
3. Проверить фильтр `Filter by channel`:
   - выбрать конкретную связку и сверить, что отображаются только ее логи.
4. Нажать `Show status` в карточке канала и проверить:
   - `pendingQueueDepth`
   - `webhookErrors`
   - `averageProcessingLatencyMs`
   - `recentWebhookUpdates`

## 7) API quick checks (опционально)

```bash
curl -i http://127.0.0.1:3030/api/auth/bootstrap-status
```

После login с bearer token:

```bash
curl -i http://127.0.0.1:3030/api/channels -H "Authorization: Bearer <TOKEN>"
```

```bash
curl -i "http://127.0.0.1:3030/api/logs?limit=20" -H "Authorization: Bearer <TOKEN>"
```

Webhook check:

```bash
curl -i http://127.0.0.1:3030/api/webhooks/telegram \
  -H "Content-Type: application/json" \
  -H "X-Telegram-Bot-Api-Secret-Token: <TG_BOT_WEBHOOK_SECRET>" \
  -d '{"update_id":123,"channel_post":{"message_id":1,"date":1710000000,"chat":{"id":-1001234567890,"username":"source_channel"},"text":"hello"}}'
```
