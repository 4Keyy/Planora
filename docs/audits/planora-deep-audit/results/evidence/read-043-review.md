# READ-043. Todo domain, события и repository contracts

Полностью рассмотрены **25 файлов и 935 строк**. Снимок `11982882a452d1dc603ae67930d00d9b4774f91f`.

После проверки root назначен стабильный ID CONT043001 → BE-033.
Provider и browser regression остаются открытыми.

## Наблюдения

- **CONT043001 / P2. Завершение через ActualDate обходит определение completion transition и его события.** UpdateActualDate вызывает MarkAsDone до bool ownerJustCompleted=false и обработки status в handler. Поэтому ownerJustCompleted остаётся false, сохранённая задача Done получает TaskUpdated вместо TaskCompleted и не получает Completed activity или task.completed notification. Для подзадачи остаётся только SubtaskChanged, без SubtaskCompleted activity/notifications. Domain completion fact не спасает путь: TodoUnitOfWork/DbContext не dispatch domain events, а notify interceptor только пробуждает уже сохранённый outbox. Живой provider/broker/browser путь не запускался.

Существующие находки не дублируются. В частности, числовой enum domain остаётся BE-029, preference races/cleanup — BE-030/031, viewer completion propagation — BE-032. Domain events в этом пакете являются in-memory фактами; actual Todo UoW не публикует их автоматически.

## Полнота чтения

| № | Файл | Строки | SHA-256 |
|---|---|---|---|
| 1 | [Planora.Todo.Application.csproj](../../../../../Services/TodoApi/Planora.Todo.Application/Planora.Todo.Application.csproj) | 1–28 | `aa5b03abc978a2959b0cd12c2d2cbdfbd2922018d83379b46c2ff825ff262ea8` |
| 2 | [FriendshipInfo.cs](../../../../../Services/TodoApi/Planora.Todo.Application/Services/FriendshipInfo.cs) | 1–4 | `49873b7ee32d5b13bff6703966113878fc0b75c24ad222a1399b7b2d1e806089` |
| 3 | [IFriendshipService.cs](../../../../../Services/TodoApi/Planora.Todo.Application/Services/IFriendshipService.cs) | 1–11 | `8efa3517e80b1e33006b009c4f8a6533273cc2d7a6ebf0970fb5dc3587271d8d` |
| 4 | [IUserProfileService.cs](../../../../../Services/TodoApi/Planora.Todo.Application/Services/IUserProfileService.cs) | 1–21 | `3010f06bb19730c02b49edb0641bb951fdaab656bcb0c9b000da6eabe142707a` |
| 5 | [TodoItem.cs](../../../../../Services/TodoApi/Planora.Todo.Domain/Entities/TodoItem.cs) | 1–520 | `f272c7de7450f61bf8962123b44ef812dd54fbf1caa6174f077e7cc9079132e2` |
| 6 | [TodoItemShare.cs](../../../../../Services/TodoApi/Planora.Todo.Domain/Entities/TodoItemShare.cs) | 1–8 | `ed80c2f57b265b3437ae73937a3c426007b63e8b0b347a3a0d69c9bc955d7a3d` |
| 7 | [TodoItemTag.cs](../../../../../Services/TodoApi/Planora.Todo.Domain/Entities/TodoItemTag.cs) | 1–8 | `8c47063b4a98ac30dd70448277949714cab81e17cd8644f57e18be52c029e56d` |
| 8 | [TodoItemWorker.cs](../../../../../Services/TodoApi/Planora.Todo.Domain/Entities/TodoItemWorker.cs) | 1–9 | `9302ff68675ac1fff3fa2a47a4bea53250da5d0c0dcc1d0cb90191f73c81a357` |
| 9 | [UserTodoViewPreference.cs](../../../../../Services/TodoApi/Planora.Todo.Domain/Entities/UserTodoViewPreference.cs) | 1–12 | `07203b65e192c103e5524e45a3da008b2ef0214c1e63b33faf1f687622e252e3` |
| 10 | [TodoPriority.cs](../../../../../Services/TodoApi/Planora.Todo.Domain/Enums/TodoPriority.cs) | 1–12 | `27d7f5e8826e74e53d3b3b26aa958c504d15b2032247b62796d59ea14d9b317b` |
| 11 | [TodoPriorityExtensions.cs](../../../../../Services/TodoApi/Planora.Todo.Domain/Enums/TodoPriorityExtensions.cs) | 1–26 | `5b489e8b256d93f2de0077b5c1ed587c358d881ff9ae6135b47c7c73c603c004` |
| 12 | [TodoStatus.cs](../../../../../Services/TodoApi/Planora.Todo.Domain/Enums/TodoStatus.cs) | 1–9 | `4b518f5ac68db7a75fbe260c09cc4d5fe420d32d9066dde2bef1eaa9186add66` |
| 13 | [TodoItemCategoryChangedDomainEvent.cs](../../../../../Services/TodoApi/Planora.Todo.Domain/Events/TodoItemCategoryChangedDomainEvent.cs) | 1–9 | `497b3551e11c9713038123e2930642e0ba9c65bd423ff18846b1e28ff5dbb324` |
| 14 | [TodoItemCompletedDomainEvent.cs](../../../../../Services/TodoApi/Planora.Todo.Domain/Events/TodoItemCompletedDomainEvent.cs) | 1–8 | `1a912863d3ffbe2fe7d02a28b2e0e28f2afca9ff4abc2aa8642463ddc774060a` |
| 15 | [TodoItemCreatedDomainEvent.cs](../../../../../Services/TodoApi/Planora.Todo.Domain/Events/TodoItemCreatedDomainEvent.cs) | 1–10 | `94688bb898296298fc3af5445c8545e2670e4da6884b59e5eea061f6b70242d8` |
| 16 | [TodoItemUpdatedDomainEvent.cs](../../../../../Services/TodoApi/Planora.Todo.Domain/Events/TodoItemUpdatedDomainEvent.cs) | 1–9 | `ce4b9052b6b577ba32523a4895ce4d80101e889b0918443f30e892a7df191a44` |
| 17 | [TodoWorkerJoinedDomainEvent.cs](../../../../../Services/TodoApi/Planora.Todo.Domain/Events/TodoWorkerJoinedDomainEvent.cs) | 1–8 | `11a8998d514ac7ebfdd2a88295ed5f317b600651b58f5e87454197d64b24c092` |
| 18 | [TodoWorkerLeftDomainEvent.cs](../../../../../Services/TodoApi/Planora.Todo.Domain/Events/TodoWorkerLeftDomainEvent.cs) | 1–8 | `235c5c11ee1381c40f3d8c76a3a9a95b23e1b4e8d8fbb8dda9fbac289b85e576` |
| 19 | [TodoWorkerRemovedDomainEvent.cs](../../../../../Services/TodoApi/Planora.Todo.Domain/Events/TodoWorkerRemovedDomainEvent.cs) | 1–8 | `5a1d635e6129a9f6136cc5ecc820e9a7293528461eec7a608fc01e78adc4dc80` |
| 20 | [TodoItemNotFoundDomainException.cs](../../../../../Services/TodoApi/Planora.Todo.Domain/Exceptions/TodoItemNotFoundDomainException.cs) | 1–13 | `144c511366fd1754955e8fc1cb3c2363c75d6883c432654adee4f6996eba3dc8` |
| 21 | [GlobalUsings.cs](../../../../../Services/TodoApi/Planora.Todo.Domain/GlobalUsings.cs) | 1–4 | `fd280a2dc1e8c252f00f9b4d602ed41a8dd748c5daa0621b1f7ff3a13d3fce26` |
| 22 | [Planora.Todo.Domain.csproj](../../../../../Services/TodoApi/Planora.Todo.Domain/Planora.Todo.Domain.csproj) | 1–14 | `82a83660daabb920bd816c2ce6d6291fafdb0c657a587e75e43ab1fff6948d53` |
| 23 | [ITodoRepository.cs](../../../../../Services/TodoApi/Planora.Todo.Domain/Repositories/ITodoRepository.cs) | 1–117 | `d9a4eec342cabe329f56a52a061501b45d8a2bb72b74d8656895d4aeaf81992b` |
| 24 | [IUserTodoViewPreferenceRepository.cs](../../../../../Services/TodoApi/Planora.Todo.Domain/Repositories/IUserTodoViewPreferenceRepository.cs) | 1–51 | `2ab7d3dd8cb154a6762bbd660484a840353c89d93c980b1023308d3a72aaced2` |
| 25 | [TodoCategoryKey.cs](../../../../../Services/TodoApi/Planora.Todo.Domain/Repositories/TodoCategoryKey.cs) | 1–8 | `e388abbd43ebda78d096592e26968eb14c965193b31102a9cdab58ffc3416ec7` |

По каждому файлу [JSON](read-043-review.json) содержит назначение, callers, trust/state/concurrency, тестовые указатели и ограничения. Каждый finding reference проверен на существование файла и допустимую конечную строку.

## Границы

- Полностью прочитаны 25 manifest paths, 935 source lines. Supplemental callers, infrastructure, tests и docs не включены в счётчик.
- Source scope равен заданному 11982882a452d1dc603ae67930d00d9b4774f91f по содержимому с нормализацией CRLF. SHA-256 рассчитаны по исходным байтам рабочего дерева; диапазоны записаны 1-N.
- Build, runtime tests, database, Redis, RabbitMQ, services, browser и нагрузка не запускались. Все новые runtime gates NOT_VERIFIED.
- Изменены только два собственных evidence файла. Параллельный root DeleteTodo diff и прочие чужие файлы не затронуты. Registry/index/manifest/PROGRESS не редактировались.
- Активные .env, OAuth, credentials, user secrets и рабочие конфигурационные значения не читались; remote операций не было.
- BE-002/005/006/028-032 не дублировались. Numeric priority guards остаются BE-029; preference concurrency/cleanup/completion имеют прежние IDs. Новый CONT043001 относится к owner ActualDate transition, а не к штатному viewer PATCH из BE-032.
- Предположение о безусловно кэшированной авторизации опровергнуто: CachingFriendshipService делегирует AreFriends/GetFriendships без кэша. DomainEvent record не принят за durable integration event.
- Create разрешает историческую ExpectedDate, UpdateExpectedDate отвергает прошлую дату; существующий доменный тест фиксирует этот контракт. Без подтверждённого конфликтующего caller сценария отдельный дефект не заявлен.
