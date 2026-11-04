# READ-040. Realtime persistence, connection registry и Todo API

Полностью рассмотрены **25 файлов и 2259 строк** из manifest. HEAD `05dab9c6ca72f2e85cc6d3c4b49989d60ca9a58d`. Все пути совпали с рабочим деревом HEAD.

## Наблюдения

- **CONT040001 / P2. Три Todo RPC не передают токен запроса в MediatR.** Query и удаление могут продолжаться после отмены RPC. Handler удаления прокидывает полученный token до repository/outbox/UoW, поэтому default token отключает этот канал отмены на всём пути. Вызвать каждую RPC с distinct ServerCallContext token, захватить token в IMediator. Для проверки поведения задержать repository до отмены и проверить, доходит ли операция до записи. Сценарий исполнения не запускался.
- **CONT040002 / P2. Realtime legacy schema gate принимает расхождение default у mapped column.** Для Notifications.IsDeleted и IsRead модель задаёт false. Legacy verifier для mapped столбцов сравнивает только тип и nullability. Совместимая по этим признакам БД с IsDeleted DEFAULT true проходит catalog check. Скрытие вставленной строки при omitted column требует provider проверки. В изолированной legacy Realtime БД изменить только default IsDeleted, оставить shape и unique неизменными, вызвать EnsureReadyAsync и обычный NotificationStore.TryAddAsync. Проверить startup verdict и значения IsDeleted через scoped query и raw row. Сценарий исполнения не запускался.

Миграция Realtime создаёт три таблицы и 11 индексов. Snapshot совпадает с target model миграции. Down удаляет все три таблицы. ConnectionManager защищает lifecycle bucket общим lock; читаемые counts остаются локальными.

## Полнота чтения

| № | Файл | Строки | SHA-256 |
|---|---|---|---|
| 1 | [ConnectionsResponse.cs](../../../../../Services/RealtimeApi/Planora.Realtime.Application/Response/ConnectionsResponse.cs) | 1–8 | `bd80644e1a71ce5cf860fba69568988208d9d2109a644750ee4fb0343566aa98` |
| 2 | [NotificationPayload.cs](../../../../../Services/RealtimeApi/Planora.Realtime.Application/Response/NotificationPayload.cs) | 1–32 | `bd4a5867bf6026396f73bad990e121b548681db3e529387d0ee26c68bc2a3380` |
| 3 | [NotificationSummary.cs](../../../../../Services/RealtimeApi/Planora.Realtime.Application/Response/NotificationSummary.cs) | 1–25 | `3a4db3904242858d1353a06b6df9b49186727da1ee0e153681a9aab1783c959a` |
| 4 | [Notification.cs](../../../../../Services/RealtimeApi/Planora.Realtime.Domain/Entities/Notification.cs) | 1–79 | `2081db451259227bfc684a88811780e51e786ca097555ee0fe4ef2b4c0b7166f` |
| 5 | [NotificationDelivery.cs](../../../../../Services/RealtimeApi/Planora.Realtime.Domain/Entities/NotificationDelivery.cs) | 1–62 | `506168ce41362187345d6484570edda5da752d9b8160e8c3358eac97421631c1` |
| 6 | [NotificationDeliveryStatus.cs](../../../../../Services/RealtimeApi/Planora.Realtime.Domain/Enums/NotificationDeliveryStatus.cs) | 1–19 | `776b553bfad3a30492a0e0281c3bea93a8927ccfa0220f64f3bf37983682269d` |
| 7 | [Planora.Realtime.Domain.csproj](../../../../../Services/RealtimeApi/Planora.Realtime.Domain/Planora.Realtime.Domain.csproj) | 1–14 | `82a83660daabb920bd816c2ce6d6291fafdb0c657a587e75e43ab1fff6948d53` |
| 8 | [RealtimeDbContextFactory.cs](../../../../../Services/RealtimeApi/Planora.Realtime.Infrastructure/DesignTime/RealtimeDbContextFactory.cs) | 1–54 | `3e1a97ce1cfca904bc90a15310c879a09664e6830de71e1bd75f81c1a4c2c5e6` |
| 9 | [GlobalUsings.cs](../../../../../Services/RealtimeApi/Planora.Realtime.Infrastructure/GlobalUsings.cs) | 1–17 | `3d6313fad2708f21c7b5cbbd38ba06c5ceed8edc7fb7540e605fb3ccfa47e70b` |
| 10 | [20260615211750_InitialRealtimeNotifications.Designer.cs](../../../../../Services/RealtimeApi/Planora.Realtime.Infrastructure/Migrations/20260615211750_InitialRealtimeNotifications.Designer.cs) | 1–246 | `e99e45875495a10e536011686c9e2465df54a785ac383040b238c2f80b92098c` |
| 11 | [20260615211750_InitialRealtimeNotifications.cs](../../../../../Services/RealtimeApi/Planora.Realtime.Infrastructure/Migrations/20260615211750_InitialRealtimeNotifications.cs) | 1–164 | `30b4446b54e977cccbb003429ed5497e265a7bd2e0cc8862a521b4696021935b` |
| 12 | [RealtimeDbContextModelSnapshot.cs](../../../../../Services/RealtimeApi/Planora.Realtime.Infrastructure/Migrations/RealtimeDbContextModelSnapshot.cs) | 1–243 | `d674e9a170d1161b71dc6af37ebe9761cb4dc0853eb52b03426e956102846afb` |
| 13 | [NotificationConfiguration.cs](../../../../../Services/RealtimeApi/Planora.Realtime.Infrastructure/Persistence/Configurations/NotificationConfiguration.cs) | 1–71 | `9a2d91e76966cc4cdb6d60f120df741df6a36b712fb25ba139a45fd7d7dbf292` |
| 14 | [NotificationDeliveryConfiguration.cs](../../../../../Services/RealtimeApi/Planora.Realtime.Infrastructure/Persistence/Configurations/NotificationDeliveryConfiguration.cs) | 1–45 | `c4e4f48b9db01d2eeae5156fe6cbd4fb5f22a0f27d6cf849b99c0d72219ee401` |
| 15 | [OutboxMessageConfiguration.cs](../../../../../Services/RealtimeApi/Planora.Realtime.Infrastructure/Persistence/Configurations/OutboxMessageConfiguration.cs) | 1–50 | `e70dce926e3c5b3100a4a375e6ef072f5b518c173d3684398d4a546ff576d035` |
| 16 | [RealtimeDatabaseStartup.cs](../../../../../Services/RealtimeApi/Planora.Realtime.Infrastructure/Persistence/RealtimeDatabaseStartup.cs) | 1–228 | `f47eb5e6633960e7c83f2062f05f0a8a89bc94f091aa8c06044242d94994373d` |
| 17 | [RealtimeDbContext.cs](../../../../../Services/RealtimeApi/Planora.Realtime.Infrastructure/Persistence/RealtimeDbContext.cs) | 1–61 | `b8d057f108d6238a0a584b849f45b76b5ff7775679e56e501de1c7215e472018` |
| 18 | [Planora.Realtime.Infrastructure.csproj](../../../../../Services/RealtimeApi/Planora.Realtime.Infrastructure/Planora.Realtime.Infrastructure.csproj) | 1–38 | `27bd386c56dc670ba27ce38daae793a9cc09d738a4b04323b8244e7c07400de4` |
| 19 | [ConnectionManager.cs](../../../../../Services/RealtimeApi/Planora.Realtime.Infrastructure/Services/ConnectionManager.cs) | 1–89 | `a55b0c8011f0c60f736c5b0098a68ec6ed7a9373241b9b0c4d751abc11134bde` |
| 20 | [IConnectionManager.cs](../../../../../Services/RealtimeApi/Planora.Realtime.Infrastructure/Services/IConnectionManager.cs) | 1–10 | `bc2ad2518b14ab8025a9de473e155e03a8f71ed48a0c8605ccb7654794bdcea4` |
| 21 | [TodosController.cs](../../../../../Services/TodoApi/Planora.Todo.Api/Controllers/TodosController.cs) | 1–314 | `68cf33aaff250a2dbd79ef2b6e5fc11354000c215275f1fcd724d751b0dd7724` |
| 22 | [Dockerfile](../../../../../Services/TodoApi/Planora.Todo.Api/Dockerfile) | 1–42 | `2c61c6391ac342271c8885c65da373c9c978343ee87d536177109293411691a9` |
| 23 | [GlobalUsings.cs](../../../../../Services/TodoApi/Planora.Todo.Api/GlobalUsings.cs) | 1–25 | `3cc6b7e08f4f0cf37fcc8f545e68b53ca36347963f66bcf7979a8bedce16f9a3` |
| 24 | [TodoGrpcService.cs](../../../../../Services/TodoApi/Planora.Todo.Api/Grpc/TodoGrpcService.cs) | 1–282 | `4c4a0bedfd07222ddc3cb1a222ddd00b37ec77bb30b643bfa8e45c27f8756077` |
| 25 | [Planora.Todo.Api.csproj](../../../../../Services/TodoApi/Planora.Todo.Api/Planora.Todo.Api.csproj) | 1–41 | `9d5d9bdde4adda3ec5eac5b2b8039ba573f31a0730fa8a6e81de371983e0e9f3` |

По каждому файлу в [JSON](read-040-review.json) указаны роль, callers, границы доверия, состояние и тестовые ограничения.

## Границы

- Все 25 файлов из manifest, в порядке READ-040. Supplemental traces и поиск тестов исключены из счётчика.
- Snapshot прочитан через полный normalized diff с Designer. Тело и завершающие строки совпали полностью, wrapper прочитан из diff.
- Build, Docker, PostgreSQL, gRPC и SignalR не запускались. Конфигурационные секреты не загружались. Исторические provider tests указаны только как исходники.
- CONT040001/002 provisional и требуют сценарного запуска. DIST-005/006 и BE-008 остаются ссылками на предыдущие находки.
