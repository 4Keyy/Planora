# READ-045. Todo persistence, retention и внешние lookup services

Полностью рассмотрены **14 файлов и 1620 строк**. Это весь READ-045 manifest: 14, а не 25 путей. Снимок `b7cb659d95750b97577cf23168ea984051e187de`.

После проверки root назначен стабильный ID CONT045001 → BE-034.
Ожидаемое provider-поведение остаётся NOT_VERIFIED до настоящего RED.

## Наблюдения

- **CONT045001 / P2. CategoryDeleted изменяет detached Todo без сохранённого shadow xmin.** GetByCategoryIdAsync возвращает AsNoTracking сущности. xmin задан shadow concurrency property, без CLR-поля. Consumer меняет detached Todo, а inherited BaseRepository.Update прикрепляет его без исходного xmin. По причине, уже описанной в tracked SoftDeleteByUserId:28-35, ожидается UPDATE с default xmin и DbUpdateConcurrencyException вместо очистки CategoryId. Consumer rethrow повторяет тот же путь. Mock-тест проверяет вызовы и не воспроизводит provider concurrency. Это отдельная причина неочистки task refs, помимо BE-030 о нетронутых viewer preferences. Фактические SQL и ошибка ещё NOT_VERIFIED.

Todo Skip arithmetic расширяет BE-008, set-based viewer retention — BE-010. AreFriends и GetFriendships обходят friend-ID cache. T08/T09 сохраняют прежний локальный масштаб и не являются новым runtime PASS.

## Полнота чтения

| № | Файл | Строки | SHA-256 |
|---|---|---|---|
| 1 | [CategoryApiOptions.cs](../../../../../Services/TodoApi/Planora.Todo.Infrastructure/Options/CategoryApiOptions.cs) | 1–4 | `e12a57b11f4c51f9c6edd4e17376ac55938541f43219df0604806b00a7646017` |
| 2 | [OutboxMessageConfiguration.cs](../../../../../Services/TodoApi/Planora.Todo.Infrastructure/Persistence/Configurations/OutboxMessageConfiguration.cs) | 1–40 | `2fb0df2a7b5e56a707bb0ad47e8461895dd880384c3fae93ec1adad09d6a7c4d` |
| 3 | [TodoItemRepository.cs](../../../../../Services/TodoApi/Planora.Todo.Infrastructure/Persistence/Repositories/TodoItemRepository.cs) | 1–9 | `6df04a1c15b4d0f00f80b387159457970fba77a8cb6bd5da752e425bb7417b53` |
| 4 | [TodoRepository.cs](../../../../../Services/TodoApi/Planora.Todo.Infrastructure/Persistence/Repositories/TodoRepository.cs) | 1–439 | `da79c3754c2483f31b71ca95e1ecb91b5ed413eec488dd114b9007eef30736b8` |
| 5 | [TodoUnitOfWork.cs](../../../../../Services/TodoApi/Planora.Todo.Infrastructure/Persistence/Repositories/TodoUnitOfWork.cs) | 1–70 | `a77d02ef1e1e6eca08ceea94b71518efc332c66ed01ca62093b02bc6cd38ff4e` |
| 6 | [UserTodoViewPreferenceRepository.cs](../../../../../Services/TodoApi/Planora.Todo.Infrastructure/Persistence/Repositories/UserTodoViewPreferenceRepository.cs) | 1–151 | `ba5e6ce9d6a434069f531758ad7aac3de15a45b305bdc9b95676e2d2a963de66` |
| 7 | [TodoSchemaCompatibility.cs](../../../../../Services/TodoApi/Planora.Todo.Infrastructure/Persistence/TodoSchemaCompatibility.cs) | 1–160 | `34f501fc296c295de9b41bb7cd63538e1b4aedee459865bb4f3c04df619fca24` |
| 8 | [Planora.Todo.Infrastructure.csproj](../../../../../Services/TodoApi/Planora.Todo.Infrastructure/Planora.Todo.Infrastructure.csproj) | 1–31 | `3bfd245a438b6e79a38153584af661e6aa636a8499701b2e8091c494f5af0d48` |
| 9 | [CompletedTodoRetentionPolicies.cs](../../../../../Services/TodoApi/Planora.Todo.Infrastructure/Retention/CompletedTodoRetentionPolicies.cs) | 1–216 | `70bfe03d57aaee7cc06aa467a1547a95f889f59d2972724d8eb1f0c3cf63b2b5` |
| 10 | [TodoSoftDeletePurgePolicy.cs](../../../../../Services/TodoApi/Planora.Todo.Infrastructure/Retention/TodoSoftDeletePurgePolicy.cs) | 1–83 | `aeb4756f290f7b50eede46ef413f49b244e70baed19a09ccdb85d81d050ff4e0` |
| 11 | [AllFriendsSnapshotBackfillService.cs](../../../../../Services/TodoApi/Planora.Todo.Infrastructure/Services/AllFriendsSnapshotBackfillService.cs) | 1–118 | `107d1c2204cbdc91e2154347e5e69da0baf3b47666bbc6a3fd7a8755150cdec6` |
| 12 | [CachingFriendshipService.cs](../../../../../Services/TodoApi/Planora.Todo.Infrastructure/Services/CachingFriendshipService.cs) | 1–72 | `330b8603be9213321402714c14e8e15b95c8bcb7bf47fcbd37b31794e95e6d60` |
| 13 | [FriendshipGrpcService.cs](../../../../../Services/TodoApi/Planora.Todo.Infrastructure/Services/FriendshipGrpcService.cs) | 1–160 | `66776098e32d1e83fca8fcc1ebca85f2e12840122d7be36e9ed7ded15555c5eb` |
| 14 | [UserProfileGrpcService.cs](../../../../../Services/TodoApi/Planora.Todo.Infrastructure/Services/UserProfileGrpcService.cs) | 1–67 | `f830f1e537f993ed43b3121a2640b006647340e126ba1bdef2e446708cf0520d` |

По каждому файлу [JSON](read-045-review.json) содержит назначение, callers, trust/state/concurrency, test pointers, finding и ограничения. Все finding/observation references проверены на существование и допустимую конечную строку.

## Границы

- READ-045 manifest фактически содержит 14 путей, а не 25 из задания. Все 14 файлов и 1620 строк прочитаны полностью; следующая пачка не включена.
- Source scope равен b7cb659d95750b97577cf23168ea984051e187de с нормализацией CRLF; SHA-256 по исходным байтам, ranges 1-N. Эти хеши фиксируют состояние до возможной последующей root реализации.
- Supplemental code/tests/docs не увеличивают manifest coverage. Существующие BE-002/005/006/028-033 и OPS/DIST IDs не дублируются.
- T08/T09 прочитаны как предыдущие локальные результаты, не новый прогон. Рабочие схемы/Redis policy/key ring/deployment/operational restore не исследованы.
- Build, тесты, сервисы, БД, migrations, Redis, RabbitMQ, browser и нагрузка не запускались. Новый finding имеет source proof и ожидаемый provider effect; RED/SQL/E2E ещё NOT_VERIFIED.
- Неуникальный completed/public page order и двухшаговый preference/Todo purge отмечены как границы без выдуманного runtime failure или нового finding ID.
- Не читались .env/OAuth/credentials/user secrets. Не менялись source, registry, index, manifest, PROGRESS или чужие файлы; только собственные read-045-review.md/.json.
