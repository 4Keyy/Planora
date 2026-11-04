# READ-039. Messaging retention и контракты Realtime

Полностью рассмотрены **25 файлов и 713 строк**. Снимок `9c250a2538b876bed51f8ed1853437ef26b83ab9`.

## Наблюдения

- **CONT039001 / P2. Повтор NotificationEvent восстанавливает удалённое уведомление.** Hard-delete по задаче или получателю удаляет `SourceEventId` из дедуплицирующей таблицы. Повтор того же события может создать новую durable row и вызвать push. Отдельные подписки также допускают первое получение после cleanup. Это отдельный Realtime сценарий для lifecycle-инварианта DIST-012.
- **CONT039002 / P2. Ограниченная unread-сводка оставляет старое уведомление непрочитанным.** Сервер считает общий unread без ограничения, но берёт только 1000 свежих строк для `perTask`. Если задача отсутствует в `perTask`, открытие карточки или ветки пропускает POST отметки о прочтении.
- **CONT039003 / P3. Realtime RPC записывает тело уведомления в log record.** Оба gRPC метода передают полный `Message` в logger уровня Information до dispatch. Проверка с безопасным тестовым текстом и capture sink должна установить фактический вывод. Production caller для RPC в checkout не найден.

Messaging retention остаётся opt-in и наследует ворота BE-010. REST читает и отмечает уведомления по JWT subject. Cursor по timestamp остаётся DIST-006. T08 установил схему Realtime для изолированной проверки, а T05 зафиксировал отдельные очереди cleanup и delivery. Отдельная приёмка нужна для runtime scope и replay.

## Полнота чтения

| № | Файл | Строки | SHA-256 |
|---|---|---|---|
| 1 | [UnitOfWork.cs](../../../../../Services/MessagingApi/Planora.Messaging.Infrastructure/Persistence/UnitOfWork.cs) | 1–52 | `c740badb9ea1e5d167ee96cf0dee657d91bf0044e9392690c68dfc4b9317f4dc` |
| 2 | [Planora.Messaging.Infrastructure.csproj](../../../../../Services/MessagingApi/Planora.Messaging.Infrastructure/Planora.Messaging.Infrastructure.csproj) | 1–30 | `418160399734c9b6648b8b6c3b2afa1d36ff2b740a67bda3574be6982acbc898` |
| 3 | [MessageRetentionPurgePolicy.cs](../../../../../Services/MessagingApi/Planora.Messaging.Infrastructure/Retention/MessageRetentionPurgePolicy.cs) | 1–43 | `6e02d46bb40583cda3d2d15660b018bd236b358d93a019eb1a43f4e2ae74a747` |
| 4 | [Dockerfile](../../../../../Services/RealtimeApi/Planora.Realtime.Api/Dockerfile) | 1–45 | `da9f75ae53de643bd269992f5f7007f6ff297e24c0b3aeecb4bbc175ad6f51d6` |
| 5 | [GlobalUsings.cs](../../../../../Services/RealtimeApi/Planora.Realtime.Api/GlobalUsings.cs) | 1–25 | `fc327f6fed3e95cfe7c10d27bdc7e56da79de189192c47bb1d213d1bc41ee754` |
| 6 | [RealtimeGrpcService.cs](../../../../../Services/RealtimeApi/Planora.Realtime.Api/Grpc/RealtimeGrpcService.cs) | 1–42 | `56fc3da5b53c17fc58059c2c1ab61d342018cbcb41c75afc0a3139b9be0818d9` |
| 7 | [Planora.Realtime.Api.csproj](../../../../../Services/RealtimeApi/Planora.Realtime.Api/Planora.Realtime.Api.csproj) | 1–42 | `e989a932bef27596762bc21a5dba2ed33b47b0877816c435580fca99d37aad88` |
| 8 | [launchSettings.json](../../../../../Services/RealtimeApi/Planora.Realtime.Api/Properties/launchSettings.json) | 1–57 | `6cf5ec275fbb21d64b146ba890d46dbc0f101594863e75b8b67cdf261a8d516a` |
| 9 | [appsettings.Docker.json](../../../../../Services/RealtimeApi/Planora.Realtime.Api/appsettings.Docker.json) | 1–32 | `cc4d2904ad5941787fdbe233c4e703501ad303b1df8223794d48a687ed000f61` |
| 10 | [appsettings.json](../../../../../Services/RealtimeApi/Planora.Realtime.Api/appsettings.json) | 1–40 | `912cc8f527f9ede43fba0ad1ea5c3d7580710bb7543095e033f386aad0dd3550` |
| 11 | [TaskDeletedNotificationCleanupHandler.cs](../../../../../Services/RealtimeApi/Planora.Realtime.Application/Features/IntegrationEvents/TaskDeletedNotificationCleanupHandler.cs) | 1–32 | `44c480048bf52d0743213b3f0888a1d43332de8486d0b223cf0f6e94a89b317f` |
| 12 | [UserDeletedNotificationCleanupHandler.cs](../../../../../Services/RealtimeApi/Planora.Realtime.Application/Features/IntegrationEvents/UserDeletedNotificationCleanupHandler.cs) | 1–31 | `f68e0f9345bc7176cda9636d1aef0b1fed78f7a714905c859b95a8bc2c1ee094` |
| 13 | [GlobalUsings.cs](../../../../../Services/RealtimeApi/Planora.Realtime.Application/GlobalUsings.cs) | 1–17 | `21d2f570b3dd493e7d35e5985c581e71059586e269bed1c02fe14959522c254f` |
| 14 | [INotificationReadStore.cs](../../../../../Services/RealtimeApi/Planora.Realtime.Application/Interfaces/INotificationReadStore.cs) | 1–34 | `5e7a7d9a658972ea77b8b7c2683c0957be2def7a499707444dc575728cf03327` |
| 15 | [INotificationService.cs](../../../../../Services/RealtimeApi/Planora.Realtime.Application/Interfaces/INotificationService.cs) | 1–21 | `614b59774b4754901452f30d8a83843dadc081120194057380d590134767ea4d` |
| 16 | [INotificationStore.cs](../../../../../Services/RealtimeApi/Planora.Realtime.Application/Interfaces/INotificationStore.cs) | 1–36 | `34037646d9cf1efd7abe15569de15fb3843470ba3d47472968cdc64fef8206b7` |
| 17 | [IRealtimeBroadcaster.cs](../../../../../Services/RealtimeApi/Planora.Realtime.Application/Interfaces/IRealtimeBroadcaster.cs) | 1–33 | `3753b85f97968a02c63b48d3ec37941ac64d923658c0e98c29e621cfbab29a51` |
| 18 | [ITaskBranchAuthorizer.cs](../../../../../Services/RealtimeApi/Planora.Realtime.Application/Interfaces/ITaskBranchAuthorizer.cs) | 1–13 | `2c21854fccc2de342ceffa893c1f49e246a8762743b21ff07b04d5a70d895452` |
| 19 | [Planora.Realtime.Application.csproj](../../../../../Services/RealtimeApi/Planora.Realtime.Application/Planora.Realtime.Application.csproj) | 1–28 | `7bd790e3d6251eef96225bc1d29db9d8c09bb2549b2451e55d9a5bd82e5e5c92` |
| 20 | [BroadcastNotificationRequest.cs](../../../../../Services/RealtimeApi/Planora.Realtime.Application/Requests/BroadcastNotificationRequest.cs) | 1–8 | `6c64113fd5ff51f040cd4b7b072f3fd13e27a88bd6dc4eb8894b319afb32aacb` |
| 21 | [MarkNotificationsReadRequest.cs](../../../../../Services/RealtimeApi/Planora.Realtime.Application/Requests/MarkNotificationsReadRequest.cs) | 1–19 | `2956759188eb632b4aa711d61174f3af7503d07bbff887a73b815dc5d777e83c` |
| 22 | [SendNotificationRequest.cs](../../../../../Services/RealtimeApi/Planora.Realtime.Application/Requests/SendNotificationRequest.cs) | 1–8 | `b5c0f11c8a2e39d51cfb6b8b01b409b2f201493f10ca624ca6ec6a1bdc4345dc` |
| 23 | [ActiveConnectionsResponse.cs](../../../../../Services/RealtimeApi/Planora.Realtime.Application/Response/ActiveConnectionsResponse.cs) | 1–9 | `c2fd040007fdb11a836f0c71319f85cea4f749b598fcd296aa131c9aa7700f19` |
| 24 | [ConnectionInfo.cs](../../../../../Services/RealtimeApi/Planora.Realtime.Application/Response/ConnectionInfo.cs) | 1–8 | `614cbe1dad96354554162eb84c0e72e71f656fe3cf2f9002900f5cec334e86f5` |
| 25 | [ConnectionStatsResponse.cs](../../../../../Services/RealtimeApi/Planora.Realtime.Application/Response/ConnectionStatsResponse.cs) | 1–8 | `c7cd4bfe519b309f95e4dd2c453aa6d0bc6185aae381fa98fd872cd44ccfe8d5` |

По каждому файлу [JSON](read-039-review.json) содержит назначение, точки вызова, границы доверия и тестовые ограничения.

## Границы

- Охват включает только 25 manifest paths. Дополнительные пути вызова, тесты и документы в счётчик не входят.
- SHA-256 вычислены по байтам рабочего дерева. Diff по READ-039 к снимку пуст.
- Конфигурационные строковые значения в выводе скрыты, за исключением безвредных локальных адресов и названий компонентов. Рабочие env-файлы, user secrets и auth/credentials не загружались.
- Build, provider tests, Docker image, host, RabbitMQ, PostgreSQL, Redis, SignalR и браузер не запускались.
- T03/DIST-012 и CONT039001 пересекаются по порядку событий, но требуют разных доказательств. T08 подтверждает versioned schema, но не сохранение дедупликации после hard-delete. T05 устанавливает отдельные subscription IDs и at-least-once, без порядка между подписками.
- BE-010, BE-015, DIST-003/004/005/006, OPS-014 и FE-002 уже ведутся отдельно. Effective deployment, ports и authorization runtime остаются воротами T06/T07/T14.
