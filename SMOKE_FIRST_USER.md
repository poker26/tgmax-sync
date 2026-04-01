# Smoke test: first user flow

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
3. Ожидается переход в рабочую часть UI (`Telegram session`, `My channels`, `Logs`).

## 4) Проверка My Channels

1. Добавить канал (`@source_channel`) и target chat id (`-123...`).
2. Убедиться, что новая связка появилась в списке.
3. Проверить кнопки `Start`, `Pause`, `Disable`, `Delete`.

## 5) Проверка Logs & Status

1. Нажать `Refresh logs`.
2. Убедиться, что отображаются последние строки логов.
3. Проверить фильтр `Filter by channel`:
   - выбрать конкретную связку и сверить, что отображаются только ее логи.

## 6) API quick checks (опционально)

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
