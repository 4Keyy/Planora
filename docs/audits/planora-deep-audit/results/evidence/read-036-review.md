# READ-036. Инфраструктура Category и входные пути Collaboration

Полностью рассмотрены **25 файлов и 1067 строк**. Снимок `6feea16f939affdaf14ab533bebd35f247645512`.

## Наблюдения

- **CONT036001 / P2. Startup Collaboration и runtime могут обращаться к разным Redis.** При заданном только `Redis:Configuration` shared DI использует это значение для cache и security stamp, а обязательный startup waiter проверяет fallback endpoint. Проверка требует изолированной матрицы двух endpoint. Аналогичный fallback найден в Auth, Category, Todo и Messaging.
- **CONT036002 / P2. Удаление аккаунта оставляет цитаты в ответах других авторов.** `UserDeleted` скрывает сообщения удалённого автора, а живой reply сохраняет ID, имя и фрагмент цитаты. GET возвращает сохранённый snapshot после исчезновения исходной строки. Ворота T02/T03 должны отдельно проверить производные копии и согласовать политику erasure, сохранив обычное поведение удаления одного сообщения.
- **CONT036003 / P2. Счётчик с заметкой автора скрывает последний комментарий.** Для заметки и 101 обычного комментария при `pageSize=50` первая страница возвращает `totalCount=102`, вторая `101`. Оба клиента удерживают заметку и вычитают её из нового числа, поэтому после 100 элементов кнопка третьей страницы исчезает.

Помощник outbox сохраняет каждое событие после commit комментария, как описано в BE-002. Consumer удаления подзадачи выбирает системные строки по заголовку, как описано в BE-006. Startup Collaboration применяет цепочку T08 после ожидания БД, но передаёт waiter фиксированное имя. Это дополнительный путь BE-017. Подписки используют пять стабильных идентификаторов T05. Параметры реального развёртывания остаются воротами T14.

## Полнота чтения

| № | Файл | Строки | SHA-256 |
|---|---|---|---|
| 1 | [CategoryDbContextFactory.cs](../../../../../Services/CategoryApi/Planora.Category.Infrastructure/DesignTime/CategoryDbContextFactory.cs) | 1–38 | `cb0a751edf495b0566094548ec0a680745bf681c343f1b29a593e528c0490cdd` |
| 2 | [GlobalUsings.cs](../../../../../Services/CategoryApi/Planora.Category.Infrastructure/GlobalUsings.cs) | 1–27 | `6c4d88cf52d17a499e17aa0b1d94ac178fa4d3c40c11f9928e0cec64bf7c516f` |
| 3 | [CategoryUnitOfWork.cs](../../../../../Services/CategoryApi/Planora.Category.Infrastructure/Persistence/CategoryUnitOfWork.cs) | 1–70 | `c65f4edfb797d22afb6a8e4fa4e18ef52592c297355afdcf5f4e2f7b01cff942` |
| 4 | [OutboxMessageConfiguration.cs](../../../../../Services/CategoryApi/Planora.Category.Infrastructure/Persistence/Configurations/OutboxMessageConfiguration.cs) | 1–52 | `d33cbb511001132504c184e86d0c47e35da68aa699cb9c97c8b590d6680a5c3b` |
| 5 | [UnitOfWork.cs](../../../../../Services/CategoryApi/Planora.Category.Infrastructure/Persistence/UnitOfWork.cs) | 1–49 | `657aed093dd2ffe4dfb2e143ac935aba8aed48728fab25bdb87052607361b4a7` |
| 6 | [Planora.Category.Infrastructure.csproj](../../../../../Services/CategoryApi/Planora.Category.Infrastructure/Planora.Category.Infrastructure.csproj) | 1–29 | `9e4e5364f745926adfe78922e7ec8ffdbd6b2875f1f06221ceb7bcb7b0fe446a` |
| 7 | [CurrentUserService.cs](../../../../../Services/CategoryApi/Planora.Category.Infrastructure/Services/CurrentUserService.cs) | 1–41 | `a03ef76edc4328511350be17112864597433909b06af92c19c23db1fe4f10538` |
| 8 | [CommentsController.cs](../../../../../Services/CollaborationApi/Planora.Collaboration.Api/Controllers/CommentsController.cs) | 1–104 | `e69b1e9f4620306851546ea54c646d689d0457129a6de445afa699a94aa34c8c` |
| 9 | [Dockerfile](../../../../../Services/CollaborationApi/Planora.Collaboration.Api/Dockerfile) | 1–42 | `1cfa7b8d6ee98264f8415bcfb55e56f3a37c2593621612dcdd337470ac6de95c` |
| 10 | [GlobalUsings.cs](../../../../../Services/CollaborationApi/Planora.Collaboration.Api/GlobalUsings.cs) | 1–10 | `1e19babb5dc227d22995e30b6876a3d99db7b1b83621a0f3ea6f2568e90bbff5` |
| 11 | [Planora.Collaboration.Api.csproj](../../../../../Services/CollaborationApi/Planora.Collaboration.Api/Planora.Collaboration.Api.csproj) | 1–39 | `2d8f7395a4bfb0c1493f266315f9c4abf3be98d7ebf342c20ce456b9fa6821ec` |
| 12 | [Program.cs](../../../../../Services/CollaborationApi/Planora.Collaboration.Api/Program.cs) | 1–227 | `b723619450fa8dd22d4a22f5f1829557477da5b49240923270f9ad1da3f177cc` |
| 13 | [launchSettings.json](../../../../../Services/CollaborationApi/Planora.Collaboration.Api/Properties/launchSettings.json) | 1–24 | `3ac9eec57aac80616c67202202721863a416f3d36a514ece31f7aeeba8832901` |
| 14 | [appsettings.Docker.json](../../../../../Services/CollaborationApi/Planora.Collaboration.Api/appsettings.Docker.json) | 1–36 | `864944726221221102c816f5ebaec3221dbde58757be2eab0c71d850570b556a` |
| 15 | [appsettings.json](../../../../../Services/CollaborationApi/Planora.Collaboration.Api/appsettings.json) | 1–53 | `68e7d806950beaf8ad96da546aec932ec89e00a7e19687de4b7788f0af1216e4` |
| 16 | [OutboxExtensions.cs](../../../../../Services/CollaborationApi/Planora.Collaboration.Application/Common/OutboxExtensions.cs) | 1–28 | `001a149dd727f275d29cf4fca8b9d6bba1a76dd7581da82f132617f4d49269d5` |
| 17 | [CommentDto.cs](../../../../../Services/CollaborationApi/Planora.Collaboration.Application/DTOs/CommentDto.cs) | 1–40 | `0c3cf504d297d607ee7233c0601cca96ad09d877d19dee7d1b5b045cc41f26ae` |
| 18 | [DependencyInjection.cs](../../../../../Services/CollaborationApi/Planora.Collaboration.Application/DependencyInjection.cs) | 1–41 | `3dc854dbbfc36bde33a7d143060b58d27ad6ef3b618aa5aa06504d389cc2ab94` |
| 19 | [ExternalServiceUnavailableException.cs](../../../../../Services/CollaborationApi/Planora.Collaboration.Application/Exceptions/ExternalServiceUnavailableException.cs) | 1–25 | `2a5ff8014d6859841fb9e28561ade30f2d6c9c0b4eb42d9c9812ac6c64b0fd2d` |
| 20 | [AddCommentCommand.cs](../../../../../Services/CollaborationApi/Planora.Collaboration.Application/Features/Comments/Commands/AddComment/AddCommentCommand.cs) | 1–18 | `a98563b5b2f9f7e9004c46aaff12a5bda8e07999cef94a9d6e584ab8984b4cee` |
| 21 | [AddCommentCommandValidator.cs](../../../../../Services/CollaborationApi/Planora.Collaboration.Application/Features/Comments/Commands/AddComment/AddCommentCommandValidator.cs) | 1–31 | `9fe866ac1ad67253db06baa39803562d67d3b6234deb72ef343ed617615a7d2f` |
| 22 | [DeleteCommentCommand.cs](../../../../../Services/CollaborationApi/Planora.Collaboration.Application/Features/Comments/Commands/DeleteComment/DeleteCommentCommand.cs) | 1–7 | `f8f9f263649578f69e45c19b0df3620fbc35bc5cfb8711ed814c89cecf3e3dc6` |
| 23 | [UpdateCommentCommand.cs](../../../../../Services/CollaborationApi/Planora.Collaboration.Application/Features/Comments/Commands/UpdateComment/UpdateCommentCommand.cs) | 1–8 | `25cce0333308ee828e2eaafe83df5ec933c86a88a0375493082ddea8dc9d7b3e` |
| 24 | [UpdateCommentCommandValidator.cs](../../../../../Services/CollaborationApi/Planora.Collaboration.Application/Features/Comments/Commands/UpdateComment/UpdateCommentCommandValidator.cs) | 1–16 | `870c608a7c40a89b23cad6c05a0e4f37ae5580b2f98ba298ebd4f1d5d769f918` |
| 25 | [GetCommentsQuery.cs](../../../../../Services/CollaborationApi/Planora.Collaboration.Application/Features/Comments/Queries/GetComments/GetCommentsQuery.cs) | 1–12 | `8bdd2db10f954d26dbe56a72b4f127a5e69707076282e4ce482b4e3ef7c4acb5` |

По каждому файлу [JSON](read-036-review.json) содержит назначение, точки вызова, границы доверия и тестовые ограничения.

## Границы

- Охват включает только 25 manifest paths. Дополнительные пути вызова, тесты и документы в счётчик не входят.
- SHA-256 вычислены по байтам рабочего дерева. Diff по READ-036 к снимку пуст.
- Строковые значения конфигурации и резервная строка подключения скрыты. Рабочие env-файлы, user secrets и auth/credentials не загружались.
- Build, unit/provider tests, Docker image, Collaboration host, RabbitMQ, PostgreSQL, Redis и браузер не запускались.
- BE-002 и BE-006 подтверждены на прежних путях. Фиксированный DB target Collaboration расширяет BE-017. CommentRepository:19–39 использует тот же Int32 offset, что BE-008. AZ-03 уже описывает удаление автором после отзыва доступа.
- Проверенные отдельно T05 stable subscriptions и T08 миграции не подтверждают production rollout. Эффективные listener, health, Redis и drainer topology остаются воротами T14.
