# READ-042. Todo viewer preferences, обновление и списки

Полностью рассмотрены **25 файлов и 1991 строка**. Снимок `620c9a8bbb496941e51698e4566b7c7b18e69dc1`.

После проверки root назначены стабильные IDs: CONT042001 → BE-030,
CONT042002 → BE-031, CONT042003 → BE-032. Provider-проверки открыты.

## Наблюдения

- **CONT042001 / P2. Удаление категории не очищает личные ViewerCategoryId назначений задач.** Consumer меняет только TodoItem.CategoryId; ViewerCategoryId=C остаётся. Main list продолжает относить shared task к удалённой категории, а category-counts возвращает C. Category RPC уже возвращает null metadata. Это постоянное расхождение личной классификации после успешной доставки, независимо от BE-001 доставки самого события. UI-проявление не воспроизводилось.
- **CONT042002 / P2. Конкурентные частичные изменения viewer preferences перезаписывают независимые поля.** Upsert устанавливает EntityState.Modified либо Update для всей строки. B пишет своё старое значение поля A, хотя request B это поле не менял. Preference не имеет concurrency token; TodoItem xmin не защищает категорию/hidden PATCH, где aggregate не изменён. Последний commit молча теряет другое изменение, включая completion timestamp. Точное SQL/provider-поведение требует RED.
- **CONT042003 / P2. Штатное личное завершение задачи не публикует события completion и review milestone.** PATCH сохраняет personal completion и удаляет worker, но не имеет outbox/notification dependency. В отличие от UpdateTodo status path отсутствуют Completed activity, BranchActivity sync, task.completed и author review/participants_done milestone. Persisted state расходится с timeline/notifications, открытые клиенты не получают этот completion signal. Живой browser/broker сценарий не выполнялся.

Save-through fanout и owner-reopen bulk SQL расширяют BE-002; priority validation UpdateTodo — BE-029. Проверки current friendship, category-owner и server-side hidden redaction прослежены по callers; выполнение runtime не заявляется.

## Полнота чтения

| № | Файл | Строки | SHA-256 |
|---|---|---|---|
| 1 | [LeaveTodoCommand.cs](../../../../../Services/TodoApi/Planora.Todo.Application/Features/Todos/Commands/LeaveTodo/LeaveTodoCommand.cs) | 1–6 | `e9556aff16d84c63b35df3729a6a2f80b300759a54f3d87b77588e7fbe409486` |
| 2 | [LeaveTodoCommandHandler.cs](../../../../../Services/TodoApi/Planora.Todo.Application/Features/Todos/Commands/LeaveTodo/LeaveTodoCommandHandler.cs) | 1–91 | `db8288c4599511aaec9030e69a944befb44360d17e4f11d86071d30fbc9b33cb` |
| 3 | [SetTodoHiddenCommand.cs](../../../../../Services/TodoApi/Planora.Todo.Application/Features/Todos/Commands/SetTodoHidden/SetTodoHiddenCommand.cs) | 1–8 | `2e2755eba8c4a165a2b87672f95006b9d8cd7762dafc73d7bc7535d05eac58be` |
| 4 | [SetTodoHiddenCommandHandler.cs](../../../../../Services/TodoApi/Planora.Todo.Application/Features/Todos/Commands/SetTodoHidden/SetTodoHiddenCommandHandler.cs) | 1–112 | `112f7e5210b1b09be4544af22f28a080fd5d6bc4a4e2542d130415d301494bf7` |
| 5 | [SetViewerPreferenceCommand.cs](../../../../../Services/TodoApi/Planora.Todo.Application/Features/Todos/Commands/SetViewerPreference/SetViewerPreferenceCommand.cs) | 1–13 | `85b40db8d9adeb50773efe7fd401db047583e1b475befae2b39cfe6effee9178` |
| 6 | [SetViewerPreferenceCommandHandler.cs](../../../../../Services/TodoApi/Planora.Todo.Application/Features/Todos/Commands/SetViewerPreference/SetViewerPreferenceCommandHandler.cs) | 1–162 | `db89e083ea77e361f154076322b144dbee813e16f17f5059a8297aa0514249de` |
| 7 | [UpdateTodoCommand.cs](../../../../../Services/TodoApi/Planora.Todo.Application/Features/Todos/Commands/UpdateTodo/UpdateTodoCommand.cs) | 1–27 | `4f2ef1b76f34a0d5d366b41d80e1d7e40ea34e511efec5315c234506bcbc146c` |
| 8 | [UpdateTodoCommandHandler.cs](../../../../../Services/TodoApi/Planora.Todo.Application/Features/Todos/Commands/UpdateTodo/UpdateTodoCommandHandler.cs) | 1–626 | `f8c1ac0b37a5a7679dc0efe59ba27ebbbd9f45ca5627e7df5c278f07e1d2a496` |
| 9 | [UpdateTodoCommandValidator.cs](../../../../../Services/TodoApi/Planora.Todo.Application/Features/Todos/Commands/UpdateTodo/UpdateTodoCommandValidator.cs) | 1–60 | `f20d1ec669704b9aba3b15eab77c91e04848c74e3498aade7467eaa32a40887b` |
| 10 | [CategoryDeletedEventHandler.cs](../../../../../Services/TodoApi/Planora.Todo.Application/Features/Todos/Events/CategoryDeletedEventHandler.cs) | 1–63 | `8007477ff434df638c432c472ff6a20b5b995166e52871d551b8bbe90359414f` |
| 11 | [HiddenTodoDtoFactory.cs](../../../../../Services/TodoApi/Planora.Todo.Application/Features/Todos/HiddenTodoDtoFactory.cs) | 1–41 | `c092b33b3c71b586bc559e036e7917b475869f5fff5989081f2325770a8c16a5` |
| 12 | [GetCategoryTaskCountsQuery.cs](../../../../../Services/TodoApi/Planora.Todo.Application/Features/Todos/Queries/GetCategoryTaskCounts/GetCategoryTaskCountsQuery.cs) | 1–10 | `b78295d11edf66dad76adfbb7ae6b337f71a189802c8fa390996fa527e1b61bd` |
| 13 | [GetCategoryTaskCountsQueryHandler.cs](../../../../../Services/TodoApi/Planora.Todo.Application/Features/Todos/Queries/GetCategoryTaskCounts/GetCategoryTaskCountsQueryHandler.cs) | 1–104 | `4c2c16ab5c087dcf282531af09b8377c14eb884b3c4d23c4af5a17e002bdfdc0` |
| 14 | [GetFriendAffinityQuery.cs](../../../../../Services/TodoApi/Planora.Todo.Application/Features/Todos/Queries/GetFriendAffinity/GetFriendAffinityQuery.cs) | 1–6 | `00d22d0b0bc58c141a02524f89f85fb6c4d7cf09efbe868cea518ecd4e869f74` |
| 15 | [GetFriendAffinityQueryHandler.cs](../../../../../Services/TodoApi/Planora.Todo.Application/Features/Todos/Queries/GetFriendAffinity/GetFriendAffinityQueryHandler.cs) | 1–80 | `dfe71759b22f3b76738706cc227c53dded5d45f1bea687b3856da2c4f912fd0e` |
| 16 | [GetPublicTodosQuery.cs](../../../../../Services/TodoApi/Planora.Todo.Application/Features/Todos/Queries/GetPublicTodos/GetPublicTodosQuery.cs) | 1–12 | `aadeda4052c799f97ab72d08ab3da47be1411bda4602ed79b94e3557117f55e0` |
| 17 | [GetSubtasksQuery.cs](../../../../../Services/TodoApi/Planora.Todo.Application/Features/Todos/Queries/GetSubtasks/GetSubtasksQuery.cs) | 1–11 | `bf6cec4c00de6a2b8641b17cd345d7bb37c9cc274753d473ed6623ebb46a23e3` |
| 18 | [GetTodoByIdQuery.cs](../../../../../Services/TodoApi/Planora.Todo.Application/Features/Todos/Queries/GetTodoById/GetTodoByIdQuery.cs) | 1–6 | `e436cf0699c32d3f6f92805b7b8fb655619686e142868b8ed91d417f5349f8fa` |
| 19 | [GetTodosByCategoryQuery.cs](../../../../../Services/TodoApi/Planora.Todo.Application/Features/Todos/Queries/GetTodosByCategory/GetTodosByCategoryQuery.cs) | 1–12 | `6b8f34ee9e4e9458f791a081da4fe2a92a0bf9fcd388f096247e60df90f97116` |
| 20 | [GetTodosByCategoryQueryHandler.cs](../../../../../Services/TodoApi/Planora.Todo.Application/Features/Todos/Queries/GetTodosByCategory/GetTodosByCategoryQueryHandler.cs) | 1–55 | `5319812039125ced15800cb108c16c27ef7035260c701bac2ab3b6eccd74400b` |
| 21 | [GetUserTodosQuery.cs](../../../../../Services/TodoApi/Planora.Todo.Application/Features/Todos/Queries/GetUserTodos/GetUserTodosQuery.cs) | 1–26 | `534f7994c90fd030ea9ea6c55b53b9b98fd502a8fc3eaa7855b4ca1560811e53` |
| 22 | [GetUserTodosQueryHandler.cs](../../../../../Services/TodoApi/Planora.Todo.Application/Features/Todos/Queries/GetUserTodos/GetUserTodosQueryHandler.cs) | 1–366 | `9a2cdcb2d633f3bf8b369e007d2e714b7e09064e5fe1193456f2b4f0d50d5548` |
| 23 | [TodoViewerStateResolver.cs](../../../../../Services/TodoApi/Planora.Todo.Application/Features/Todos/TodoViewerStateResolver.cs) | 1–59 | `c96558bb98f650089d5034952d101b6da7173a45f88839abbfd4da2863b5b21d` |
| 24 | [GlobalUsings.cs](../../../../../Services/TodoApi/Planora.Todo.Application/GlobalUsings.cs) | 1–17 | `99aa78420c32a21519aded0a78e79d4ae3ff8dc92d4db3f7ef3b03ef144fc83d` |
| 25 | [ICategoryGrpcClient.cs](../../../../../Services/TodoApi/Planora.Todo.Application/Interfaces/ICategoryGrpcClient.cs) | 1–18 | `0a4f1fc431174d723084b4a5e5a1a6cdb6ac32bab53ed7acbd56b09f95422d76` |

По каждому файлу [JSON](read-042-review.json) содержит назначение, callers, границы доверия, проверенные по исходникам tests и ограничения.

## Границы

- Полностью прочитаны только 25 manifest paths; supplemental callers, persistence, tests и docs не входят в 1991 строку/счётчик охвата.
- Source scope совпадает с HEAD по содержимому с учётом CRLF; SHA-256 записаны по исходным байтам рабочего дерева. Параллельные изменения DuplicateTodo/tests принадлежат root и не затронуты.
- Runtime tests, build, services, Compose, database, RabbitMQ, Redis, browser и load checks не выполнялись. Статический вывод не является provider/E2E сертификацией.
- Активные .env/OAuth/credentials/user secrets не читались; никакие внешние сообщения или remote mutations не выполнялись.
- BE-002 дополнительно включает owner-reopen ExecuteUpdate до final Save и post-commit count query в LeaveTodo. BE-029 включает UpdateTodo enum validation. Новые IDs локальны; стабильные IDs назначает root.
- LeaveTodo не принимает чужой workerId: TodoItem.RemoveWorker бросает для отсутствующего actor worker. Отсутствие полного CanAccess в self-leave не объявлено новым IDOR.
- SetViewerPreference для subtasks и mixed status filters требуют отдельного договорённого regression контракта; неподтверждённая гипотеза не включена как новая находка.
