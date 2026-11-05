# READ-044. Todo infrastructure и история миграций

Полностью рассмотрены **25 файлов и 4278 строк**. Снимок `a693ab0f1b7582667cbcea0a7bfb90afff7caeb9`.

## Результат

Новых подтверждённых находок нет. Проверены девять исторических migration pairs, текущий model snapshot, DI, design-time factory и Category RPC wrapper.

Подозрение на безусловную потерю непустых legacy comments в штатном запуске опровергнуто для прослеженных entrypoints: TodoDatabaseStartup останавливает destructive pending migration; reviewed Migrator вызывает тот же helper. Это не разрешает direct EF apply или автоматический Down. Исторические default/EF annotations и xmin descriptor не объявлены runtime-ошибкой без provider proof. Предыдущие результаты T08 сохраняют свой локальный масштаб и дату; заново они не запускались.

Design-time Todo factory имеет legacy local fallback. Этот batch его не вызывает и не считает выбранную по умолчанию БД безопасной. Авторизованные проверки сохраняют явную disposable connection и проверку её ownership.

## Полнота чтения

| № | Файл | Строки | SHA-256 |
|---|---|---|---|
| 1 | [TodoFriendShareKey.cs](../../../../../Services/TodoApi/Planora.Todo.Domain/Repositories/TodoFriendShareKey.cs) | 1–5 | `a2f43e486d78ed42da8599d767facfae133238e514719b2d2f14b520d0803aa0` |
| 2 | [TodoStatusExtensions.cs](../../../../../Services/TodoApi/Planora.Todo.Domain/ValueObjects/TodoStatusExtensions.cs) | 1–25 | `d44ca3b99caa2442650b8b18c3724f390fa3687d9328b5141504ba9334bb5c39` |
| 3 | [DependencyInjection.cs](../../../../../Services/TodoApi/Planora.Todo.Infrastructure/DependencyInjection.cs) | 1–109 | `cd33a78c12f5e4108bf2ab106b9fd6038a4b0e70c2802f519b4ce633b1b83656` |
| 4 | [TodoDbContextFactory.cs](../../../../../Services/TodoApi/Planora.Todo.Infrastructure/DesignTime/TodoDbContextFactory.cs) | 1–24 | `c4359c5af77f11878df669ed4ddfd5eec0ec37c52beb9b04939d92b757a91856` |
| 5 | [GlobalUsings.cs](../../../../../Services/TodoApi/Planora.Todo.Infrastructure/GlobalUsings.cs) | 1–31 | `52fa5b0e6cfbc5908e43133cb0454a02f46b4cd3e1b964ed6fb3ac1f5e600c98` |
| 6 | [CategoryGrpcClient.cs](../../../../../Services/TodoApi/Planora.Todo.Infrastructure/Grpc/CategoryGrpcClient.cs) | 1–141 | `230b57187b385f8d44f66db1e3ffac952a26860d4bde68cb739c0af03e0d3a3c` |
| 7 | [20260510211105_AddWorkersAndComments.Designer.cs](../../../../../Services/TodoApi/Planora.Todo.Infrastructure/Migrations/20260510211105_AddWorkersAndComments.Designer.cs) | 1–305 | `bf48082984e325fca75f3fb2725f75203b3a78e59d3fe4409c43e75ba262f275` |
| 8 | [20260510211105_AddWorkersAndComments.cs](../../../../../Services/TodoApi/Planora.Todo.Infrastructure/Migrations/20260510211105_AddWorkersAndComments.cs) | 1–257 | `5c1a858d77b56e390beb93bdd6523262b75663ef0c43048a34a80800d4dd85f0` |
| 9 | [20260511105105_AddViewerCompletion.Designer.cs](../../../../../Services/TodoApi/Planora.Todo.Infrastructure/Migrations/20260511105105_AddViewerCompletion.Designer.cs) | 1–313 | `0053e367332d8a9e74b5361757c56fd5b9138689fc4d9b15e15814054382052b` |
| 10 | [20260511105105_AddViewerCompletion.cs](../../../../../Services/TodoApi/Planora.Todo.Infrastructure/Migrations/20260511105105_AddViewerCompletion.cs) | 1–44 | `1605ea94c435ae283f45a56f2c6394bf1940f67cc641b6f40de652c45bb05ead` |
| 11 | [20260517225900_AddSystemComment.Designer.cs](../../../../../Services/TodoApi/Planora.Todo.Infrastructure/Migrations/20260517225900_AddSystemComment.Designer.cs) | 1–318 | `d65ef709e0e85c663e539e8b42d4edbcb7cbea7d94fc855a45f86af7b6f56762` |
| 12 | [20260517225900_AddSystemComment.cs](../../../../../Services/TodoApi/Planora.Todo.Infrastructure/Migrations/20260517225900_AddSystemComment.cs) | 1–31 | `53a998be691d7f05f325e91ed049ebf0a5f296205de7c4eeff70fb0624f4d0b0` |
| 13 | [20260518222758_AddGenesisComment.Designer.cs](../../../../../Services/TodoApi/Planora.Todo.Infrastructure/Migrations/20260518222758_AddGenesisComment.Designer.cs) | 1–323 | `8fa30117ba1fd219f89271887269563ee7f3b08828941bec754db440ddb318d5` |
| 14 | [20260518222758_AddGenesisComment.cs](../../../../../Services/TodoApi/Planora.Todo.Infrastructure/Migrations/20260518222758_AddGenesisComment.cs) | 1–53 | `38a07dc96c561fe7edc60695f495d7c4fe944b4acb365ca6fc09d7af227f17d7` |
| 15 | [20260525143832_AddCommentAvatarUrl.Designer.cs](../../../../../Services/TodoApi/Planora.Todo.Infrastructure/Migrations/20260525143832_AddCommentAvatarUrl.Designer.cs) | 1–333 | `0fb8642f94ea18934eea0ae40e09e8fc27285d6e7a6746e47b783b401c62e98e` |
| 16 | [20260525143832_AddCommentAvatarUrl.cs](../../../../../Services/TodoApi/Planora.Todo.Infrastructure/Migrations/20260525143832_AddCommentAvatarUrl.cs) | 1–45 | `dc21c9000264f8059c6607f2a8034c13b8e15fd7802bf6a884123983b6144ab0` |
| 17 | [20260526201043_RemoveCommentAvatarSnapshot.Designer.cs](../../../../../Services/TodoApi/Planora.Todo.Infrastructure/Migrations/20260526201043_RemoveCommentAvatarSnapshot.Designer.cs) | 1–329 | `aed6deba4be6833be759dc732299111719e09680981a2ad78739d7df48546ee4` |
| 18 | [20260526201043_RemoveCommentAvatarSnapshot.cs](../../../../../Services/TodoApi/Planora.Todo.Infrastructure/Migrations/20260526201043_RemoveCommentAvatarSnapshot.cs) | 1–35 | `6b232dedeffb2e1ee3d23ac8d1c8e8919eb5dab0afa84dee42e23acc505b7450` |
| 19 | [20260529120000_RemoveCommentsAddOutbox.Designer.cs](../../../../../Services/TodoApi/Planora.Todo.Infrastructure/Migrations/20260529120000_RemoveCommentsAddOutbox.Designer.cs) | 1–324 | `2ca6ef7d4771d5494ba99283df934edf630defe3f7b55eea639f701f243f98ed` |
| 20 | [20260529120000_RemoveCommentsAddOutbox.cs](../../../../../Services/TodoApi/Planora.Todo.Infrastructure/Migrations/20260529120000_RemoveCommentsAddOutbox.cs) | 1–107 | `cd477cfcf6fe930bbd7c4125a631aba85682b1bf9bdc3c1ab6a5b90483f59b53` |
| 21 | [20260602111500_AddSubtaskParentTodoId.Designer.cs](../../../../../Services/TodoApi/Planora.Todo.Infrastructure/Migrations/20260602111500_AddSubtaskParentTodoId.Designer.cs) | 1–336 | `2c803cd151f092b4fd2e671d37fb75eb21993e51feafd653339cafb3269f08b8` |
| 22 | [20260602111500_AddSubtaskParentTodoId.cs](../../../../../Services/TodoApi/Planora.Todo.Infrastructure/Migrations/20260602111500_AddSubtaskParentTodoId.cs) | 1–56 | `609d608083b1794c52ca0502a8bacd18dde09fc9a6e30ffbf1ccc8ee37e52756` |
| 23 | [20261007205138_AddAllFriendsSnapshot.Designer.cs](../../../../../Services/TodoApi/Planora.Todo.Infrastructure/Migrations/20261007205138_AddAllFriendsSnapshot.Designer.cs) | 1–354 | `bc322de0ed9015471580c01e0b78b7dff493dafce65cefc77adf3ff6157d1b89` |
| 24 | [20261007205138_AddAllFriendsSnapshot.cs](../../../../../Services/TodoApi/Planora.Todo.Infrastructure/Migrations/20261007205138_AddAllFriendsSnapshot.cs) | 1–29 | `b7b4b55188150916a51bca72ab863335fb4a430429cdd329e416c1d300897316` |
| 25 | [TodoDbContextModelSnapshot.cs](../../../../../Services/TodoApi/Planora.Todo.Infrastructure/Migrations/TodoDbContextModelSnapshot.cs) | 1–351 | `a2735326ca685fffaeef01bd099480c641d84dd7813cf9c84f72128c3e2a4707` |

По каждому файлу [JSON](read-044-review.json) содержит назначение, callers, trust/state/concurrency, тестовые указатели и ограничения. Все observation references проверены на существование и допустимые диапазоны.

## Границы

- Полностью прочитаны 25 manifest paths и 4278 строк, включая все 9 migration pairs и snapshot. Supplemental code/tests/docs не включены в счётчик.
- SHA-256 рассчитаны по исходным байтам рабочего дерева; ranges 1-N. Source scope совпадает с a693ab0f1b7582667cbcea0a7bfb90afff7caeb9 с нормализацией CRLF. Текущий root Join/Leave diff не затронут.
- Новые finding IDs не созданы: new_findings пуст. Проверенные исходные гипотезы и границы сохранены отдельными observations, а не представлены как runtime PASS.
- T08.md прочитан как предыдущий проверочный отчёт. Его исторические counts не выданы за новый прогон, текущую рабочую схему, restore всего стека или разрешение на production apply.
- Build, services, migration SQL generation/apply/rollback, базы, Redis, RabbitMQ, browser и нагрузка не запускались. Все новые runtime gates NOT_VERIFIED.
- Legacy Down может удалять сохранённые данные/backlog или сужать колонки; последний privacy snapshot Down намеренно запрещён. Ни один rollback не выполнялся.
- Активные .env/OAuth/credentials/user secrets не читались. Публичный код design-time fallback рассмотрен без использования подключения; значения не перенесены в evidence.
- Изменены только read-044-review.md/.json; source, registry, index, manifest, PROGRESS и чужие файлы не редактировались. Следующая пачка не запускалась.
