# Multi-tenant validation checklist

## Цель

Подтвердить, что пользователь A не видит и не управляет сущностями пользователя B.

## Сценарий A/B (интеграционный)

1. Создать пользователя A и залогиниться, получить `tokenA`.
2. Создать канал A через `POST /api/channels` под `tokenA`.
3. Создать пользователя B (через SQL insert или отдельный bootstrap env), залогиниться, получить `tokenB`.
4. Под `tokenB` выполнить:
   - `GET /api/channels` -> канал A не должен появиться.
   - `PATCH /api/channels/:idA/status` -> ожидается `404` или `500` без изменения канала A.
   - `GET /api/logs?channelId=idA` -> пустой набор.
5. Под `tokenA` убедиться, что канал A остается управляемым и его статус изменился только от действий A.

## SQL проверки изоляции

```sql
select user_id, count(*) as channel_count
from tg_channel_sync_configs
group by user_id
order by user_id;
```

```sql
select j.id, j.user_id as job_user_id, c.user_id as config_user_id
from tg_sync_jobs j
join tg_channel_sync_configs c on c.id = j.channel_sync_config_id
where j.user_id <> c.user_id;
```

Ожидается: второй запрос возвращает `0` строк.

## Проверка owner match в runtime

В `src/sync/engine.js` встроены жесткие runtime-проверки:

- `job.user_id == channel_sync_config.user_id`
- `job.user_id == telegram_account.user_id`

При нарушении воркер переводит job в `error` и пишет запись в `tg_sync_job_logs`.
