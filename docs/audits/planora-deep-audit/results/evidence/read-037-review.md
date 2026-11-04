# READ-037. Модель, подписки и интеграции Collaboration

Полностью рассмотрены **25 файлов и 1291 строк**. Снимок `2f2352fda2f402d959a203dfb93ba574d822bd73`.

## Наблюдения

- **CONT037001 / P2. Запоздалое событие оставляет активный комментарий после удаления задачи.** Раздельные подписки допускают `TaskDeleted` раньше `TaskCreated` или `TaskActivity`. Cascade скрывает существующие строки. Поздний consumer добавляет новую строку, которая проходит мимо soft-delete retention. Обычный GET по удалённой задаче закрывает проверка Todo.
- **CONT037002 / P2. Валидное имя Auth выходит за границы полей Collaboration.** Два допустимых значения по 100 букв и разделитель дают 201 знак. `AuthorName` и `ReplyToAuthorName` в миграционной цепочке имеют ширину 200. Сценарии обычного POST и reply требуют проверки с PostgreSQL.
- **CONT037003 / P3. Обрезка цитаты может разрезать emoji.** Граница среза 299 может пройти внутри surrogate pair, после которой добавляется многоточие. Проверка должна установить результат сохранения и выдачи такого preview.

Inbox сохраняет receipt после вызова consumer. INV-COMM-4 и T05 уже отражают зазор между обработкой и записью receipt. Отдельно проверены источники старых BE-002, BE-006, BE-008, BE-021 и BE-022 без добавления дублей.

## Полнота чтения

| № | Файл | Строки | SHA-256 |
|---|---|---|---|
| 1 | [GetCommentsQueryHandler.cs](../../../../../Services/CollaborationApi/Planora.Collaboration.Application/Features/Comments/Queries/GetComments/GetCommentsQueryHandler.cs) | 1–187 | `5adc0e8be70ccb3b8b1154ba3f5d9fb02e56b42985844c1da95745cf913d31cd` |
| 2 | [TaskCreatedEventConsumer.cs](../../../../../Services/CollaborationApi/Planora.Collaboration.Application/Features/IntegrationEvents/TaskCreatedEventConsumer.cs) | 1–48 | `22bad6af1ec5af57ffa1bd0a8ac962fbd03a58d2553d259a06822950a0572579` |
| 3 | [TaskDeletedEventConsumer.cs](../../../../../Services/CollaborationApi/Planora.Collaboration.Application/Features/IntegrationEvents/TaskDeletedEventConsumer.cs) | 1–39 | `f24ef2ba577fe65e827351a5ec79f1292f3eb4ff225233023a14d883b9572f50` |
| 4 | [GlobalUsings.cs](../../../../../Services/CollaborationApi/Planora.Collaboration.Application/GlobalUsings.cs) | 1–16 | `ceae28af3877fc9c17848e8efad6d10a3464ccff1ff43af5cd097f475c44f12d` |
| 5 | [Planora.Collaboration.Application.csproj](../../../../../Services/CollaborationApi/Planora.Collaboration.Application/Planora.Collaboration.Application.csproj) | 1–28 | `51200e830c4735cb68027fe74abd452041cabdd39c60dcdc102f19506b489f37` |
| 6 | [ITaskAccessService.cs](../../../../../Services/CollaborationApi/Planora.Collaboration.Application/Services/ITaskAccessService.cs) | 1–45 | `d2898ae3b593e293830af5eb7d63f10e0f6073fadd55ea9487d8a41c47b08226` |
| 7 | [IUserService.cs](../../../../../Services/CollaborationApi/Planora.Collaboration.Application/Services/IUserService.cs) | 1–26 | `117561a098944cef06f63f17baaa6c037cdab686f9b0817dc1450ee22ceb1d07` |
| 8 | [Comment.cs](../../../../../Services/CollaborationApi/Planora.Collaboration.Domain/Entities/Comment.cs) | 1–179 | `0c38131e562becd61fea49c68fd1b00aa4beaf1c26240f0afea63899b1b509fa` |
| 9 | [ReplyTargetType.cs](../../../../../Services/CollaborationApi/Planora.Collaboration.Domain/Enums/ReplyTargetType.cs) | 1–16 | `8a24a53e3fcf9b2fbcc859a2ecceaa075a2b0a5f505650eef9001459cd7a70c1` |
| 10 | [CommentAddedDomainEvent.cs](../../../../../Services/CollaborationApi/Planora.Collaboration.Domain/Events/CommentAddedDomainEvent.cs) | 1–9 | `57b30d85f33aeea7f3a86ea41ac40ca48add1faf838c0b070a6d202a12a2ced0` |
| 11 | [GlobalUsings.cs](../../../../../Services/CollaborationApi/Planora.Collaboration.Domain/GlobalUsings.cs) | 1–2 | `b428fe5c0148dd6b8a0ee2b4d27b24e86a9e9eed484f9d7bdd02005645eff7db` |
| 12 | [Planora.Collaboration.Domain.csproj](../../../../../Services/CollaborationApi/Planora.Collaboration.Domain/Planora.Collaboration.Domain.csproj) | 1–14 | `635ab8756a41d810b5b406914f24da4016aad661b46cf86e72b6036d84b5e15f` |
| 13 | [ICommentRepository.cs](../../../../../Services/CollaborationApi/Planora.Collaboration.Domain/Repositories/ICommentRepository.cs) | 1–44 | `06c7980ebebb7f84d440509de4111afda62d628137d032f7a4b9f489b8f08887` |
| 14 | [DependencyInjection.cs](../../../../../Services/CollaborationApi/Planora.Collaboration.Infrastructure/DependencyInjection.cs) | 1–88 | `78e906397ac7e7f7a8c9fcd4c0c15b7601d01ce8a64abd1c466186d55803e77d` |
| 15 | [CollaborationDbContextFactory.cs](../../../../../Services/CollaborationApi/Planora.Collaboration.Infrastructure/DesignTime/CollaborationDbContextFactory.cs) | 1–26 | `d642095936adef494317b52fafa555a2786b9a3e1becb22fe6aae5b3cbff9f2b` |
| 16 | [GlobalUsings.cs](../../../../../Services/CollaborationApi/Planora.Collaboration.Infrastructure/GlobalUsings.cs) | 1–19 | `7ff0fc7c97484bf4a44ef74db1ff3550fc8a7a12e73aac81120d3ab48b24e313` |
| 17 | [CachingUserService.cs](../../../../../Services/CollaborationApi/Planora.Collaboration.Infrastructure/Grpc/CachingUserService.cs) | 1–88 | `716cc065db1f550e4b7091a35bf800475ce27ee222323a7c896f90411f4c1f08` |
| 18 | [TaskAccessGrpcClient.cs](../../../../../Services/CollaborationApi/Planora.Collaboration.Infrastructure/Grpc/TaskAccessGrpcClient.cs) | 1–113 | `e0135c7a8bf198aee567cc5c3e43204d05f49697f5f6a2de9940e61b06f4a113` |
| 19 | [UserGrpcService.cs](../../../../../Services/CollaborationApi/Planora.Collaboration.Infrastructure/Grpc/UserGrpcService.cs) | 1–67 | `f34e0540f94d173a5821a4c45514f94ebf2b31ac4cd16e81a866d1348e3164e0` |
| 20 | [InboxMessageConfiguration.cs](../../../../../Services/CollaborationApi/Planora.Collaboration.Infrastructure/Persistence/Configurations/InboxMessageConfiguration.cs) | 1–45 | `358a08d0273b6f96d1bb7238644f87fad11d8f072202ae04a32abdfda0a0f8d0` |
| 21 | [OutboxMessageConfiguration.cs](../../../../../Services/CollaborationApi/Planora.Collaboration.Infrastructure/Persistence/Configurations/OutboxMessageConfiguration.cs) | 1–40 | `d08076ff8f372f5de6919c7946da1d8692f04c5e1df972daea7826022679f032` |
| 22 | [InboxRepository.cs](../../../../../Services/CollaborationApi/Planora.Collaboration.Infrastructure/Persistence/Repositories/InboxRepository.cs) | 1–48 | `18ba6c7c022a34d45947cfb8213d7d49595f3fb03d3d91541c9e93f6bb0f3cb9` |
| 23 | [Planora.Collaboration.Infrastructure.csproj](../../../../../Services/CollaborationApi/Planora.Collaboration.Infrastructure/Planora.Collaboration.Infrastructure.csproj) | 1–31 | `9e47fd5495b3132a4cb2dbbff4561ac77514ef413ceaab87bc658890f3d88c9a` |
| 24 | [Dockerfile](../../../../../Services/MessagingApi/Planora.Messaging.Api/Dockerfile) | 1–47 | `287e9b551baf115b31e155afbc5d4fc9afb5ec97bbcb026d41b1310f8653e626` |
| 25 | [GlobalUsings.cs](../../../../../Services/MessagingApi/Planora.Messaging.Api/GlobalUsings.cs) | 1–26 | `2ee5961dd41df3cb87fe53bc492f9fee79069ffc42749aec93a48eb55038396f` |

По каждому файлу [JSON](read-037-review.json) содержит назначение, точки вызова, границы доверия и тестовые ограничения.

## Границы

- Охват включает только 25 manifest paths. Дополнительные пути вызова, тесты и документы в счётчик не входят.
- SHA-256 вычислены по байтам рабочего дерева. Diff по READ-037 к снимку пуст.
- Резервная строка подключения скрыта. Рабочие env-файлы, user secrets и auth/credentials не загружались.
- Build, unit/provider tests, Docker image, host, RabbitMQ, PostgreSQL и браузер не запускались.
- BE-002, BE-006, BE-008, BE-021 и BE-022 связаны с текущими путями без новых ID. Best-effort inbox уже описан в INV-COMM-4 и T05. CONT037001 использует разные события жизненного цикла задачи, отдельные от BE-006 и от duplicate delivery.
- Эффективные probes, deployment и ownership drainers относятся к T14. Уязвимость по внешней доступности gRPC не исследовалась.
