# READ-041. Todo startup, аудитории и создание задач

Полностью рассмотрены **25 файлов и 1392 строки**. Снимок `a5dde5e8d0d5b4ea6fb057eae53424295af5a769`.

## Наблюдения

- **CONT041001 / P3. Создание подзадачи участником использует неверного владельца категории.** Дочерняя запись наследует категорию владельца родителя, а create handler запрашивает её как категорию участника. CategoryApi сохраняет owner filter и не возвращает метаданные. Последующий GET использует владельца родителя и может вернуть их. Видимое UI-проявление не проверялось.
- **CONT041002 / P2. Неподдерживаемый числовой приоритет проходит create validation.** CreateTodo и CreateSubtask не проверяют enum domain. Домен присваивает значение, EF хранит int, DTO отдаёт числовую строку. Frontend fallback показывает Medium, а сервер сортирует числовое значение. HTTP/provider-проверка значений за диапазоном остаётся открытой.

Сохранение mutation и fanout остаётся BE-002. Фиксированное имя БД и различный Redis fallback в Program расширяют BE-017 и OPS-014. NotificationFanout.TitlePreview повторяет UTF-16 boundary из BE-024. Материализованные аудитории по-прежнему требуют текущей дружбы для content access. XML-комментарии контроллера owner-only расходятся с participant behavior, уже описанным в документации. Launch profiles используют плоские legacy env names, тогда как текущий DI читает section keys. Эффективный запуск остаётся воротами T14/OPS-009.

## Полнота чтения

| № | Файл | Строки | SHA-256 |
|---|---|---|---|
| 1 | [Program.cs](../../../../../Services/TodoApi/Planora.Todo.Api/Program.cs) | 1–250 | `3382fa4bed972258a0330d609c9c29045e07257d456429ca57265f0ce7e32abe` |
| 2 | [launchSettings.json](../../../../../Services/TodoApi/Planora.Todo.Api/Properties/launchSettings.json) | 1–60 | `62b16f21de4b054677887f29837d86785c33e01bf2deac2bf9543bdde311b562` |
| 3 | [appsettings.Docker.json](../../../../../Services/TodoApi/Planora.Todo.Api/appsettings.Docker.json) | 1–42 | `268c42f4b2ac9f42430975c63d86d8380ca630d17330c6d203b183e1865d7a8c` |
| 4 | [appsettings.json](../../../../../Services/TodoApi/Planora.Todo.Api/appsettings.json) | 1–59 | `6481304ad35055383df19305624e95e73f87e1193f12a2909c5ccd66785431bb` |
| 5 | [AllFriendsSnapshotAudience.cs](../../../../../Services/TodoApi/Planora.Todo.Application/Common/AllFriendsSnapshotAudience.cs) | 1–17 | `09c99ddd65069b4c09193482102af437b260f2349663bcd902b959a52942b0a4` |
| 6 | [DirectSharingLimit.cs](../../../../../Services/TodoApi/Planora.Todo.Application/Common/DirectSharingLimit.cs) | 1–12 | `dbeaa14d2f6f13820d332df43f886deb378207f876f90e5f8e7e163a9eb5f926` |
| 7 | [NotificationFanout.cs](../../../../../Services/TodoApi/Planora.Todo.Application/Common/NotificationFanout.cs) | 1–49 | `cf6c7a63fc3a4c801a7cabbbd9dc7370cf351663a284a2110cfc967f60696ead` |
| 8 | [RealtimeAudience.cs](../../../../../Services/TodoApi/Planora.Todo.Application/Common/RealtimeAudience.cs) | 1–127 | `1a41f826d38e5b26102c8f4720ee0b18c8b9b9fbf74f8a727e29a54ad3da44c7` |
| 9 | [ViewerCalendar.cs](../../../../../Services/TodoApi/Planora.Todo.Application/Common/ViewerCalendar.cs) | 1–71 | `490ab6d7dbb35c0dd7dc033b3f87be2a719106eeeacd688b5ad5bbda16b98c15` |
| 10 | [CategoryTaskCountDto.cs](../../../../../Services/TodoApi/Planora.Todo.Application/DTOs/CategoryTaskCountDto.cs) | 1–9 | `6e856b92bb4118dc7a4ccf99c978115f8eff7373c95d80fb743570767a1916a7` |
| 11 | [FriendAffinityDto.cs](../../../../../Services/TodoApi/Planora.Todo.Application/DTOs/FriendAffinityDto.cs) | 1–10 | `ba21c10c9608c41bfbee163459fb33bbe8d060292510e38fb36d43adad6acfa5` |
| 12 | [TodoHiddenResponseDto.cs](../../../../../Services/TodoApi/Planora.Todo.Application/DTOs/TodoHiddenResponseDto.cs) | 1–10 | `8f52488f6c78cb69548fe51849242ec00cb730ef4f5305356d681d42a0ecf6d9` |
| 13 | [TodoItemDto.cs](../../../../../Services/TodoApi/Planora.Todo.Application/DTOs/TodoItemDto.cs) | 1–145 | `b6bf9a5657f6169ccfca274c5fe08516daa70fd52c9b599e4ee4740909918a94` |
| 14 | [ViewerPreferenceResponseDto.cs](../../../../../Services/TodoApi/Planora.Todo.Application/DTOs/ViewerPreferenceResponseDto.cs) | 1–15 | `2b9ac5c8fe031617724939d3287d91604bca72dafb9c042123f7253d4b893030` |
| 15 | [DependencyInjection.cs](../../../../../Services/TodoApi/Planora.Todo.Application/DependencyInjection.cs) | 1–44 | `be9293b88c272062a01cb1341f290de68d96da4a1948404f6fe3729efd4286b5` |
| 16 | [ExternalServiceUnavailableException.cs](../../../../../Services/TodoApi/Planora.Todo.Application/Exceptions/ExternalServiceUnavailableException.cs) | 1–19 | `62564dce6b037ab4106a7224df6202450d2a4931da2684a4190cd904c8dcda43` |
| 17 | [CreateSubtaskCommand.cs](../../../../../Services/TodoApi/Planora.Todo.Application/Features/Todos/Commands/CreateSubtask/CreateSubtaskCommand.cs) | 1–18 | `4356e1c5427e173ea56015b742d95656c3226d578aa39b60a95b2425f0076772` |
| 18 | [CreateSubtaskCommandHandler.cs](../../../../../Services/TodoApi/Planora.Todo.Application/Features/Todos/Commands/CreateSubtask/CreateSubtaskCommandHandler.cs) | 1–144 | `7b59447871a8e03d312fb84eb579bae54c4b0d77b8a3fe2fbea8bcfac1ea4872` |
| 19 | [CreateSubtaskCommandValidator.cs](../../../../../Services/TodoApi/Planora.Todo.Application/Features/Todos/Commands/CreateSubtask/CreateSubtaskCommandValidator.cs) | 1–22 | `56ef2f6e6afc592cc45183c07e8eeb09c5d1658712f03e67af12e616a0ec70c3` |
| 20 | [CreateTodoCommand.cs](../../../../../Services/TodoApi/Planora.Todo.Application/Features/Todos/Commands/CreateTodo/CreateTodoCommand.cs) | 1–21 | `ad582296a5a767eae0ad2274e03edc4b984397b1cc0c20ee4e7f2fe73b4b4240` |
| 21 | [CreateTodoCommandValidator.cs](../../../../../Services/TodoApi/Planora.Todo.Application/Features/Todos/Commands/CreateTodo/CreateTodoCommandValidator.cs) | 1–52 | `36261d3da441f78fa618b8e915b7fe04aa2919560d32388778ff677779697d8e` |
| 22 | [DeleteTodoCommand.cs](../../../../../Services/TodoApi/Planora.Todo.Application/Features/Todos/Commands/DeleteTodo/DeleteTodoCommand.cs) | 1–6 | `9ab7d6c315f41b30f83f824b37e73171e24c62a31e8d09e4abc24a04e855ac39` |
| 23 | [DuplicateTodoCommand.cs](../../../../../Services/TodoApi/Planora.Todo.Application/Features/Todos/Commands/DuplicateTodo/DuplicateTodoCommand.cs) | 1–14 | `f5190ddf441c4a79d671e8ef0def4ae2d08ff4c72315620e264212c9f2e33c07` |
| 24 | [DuplicateTodoCommandHandler.cs](../../../../../Services/TodoApi/Planora.Todo.Application/Features/Todos/Commands/DuplicateTodo/DuplicateTodoCommandHandler.cs) | 1–169 | `e64a2ac1a5a27b94d1cea7f813483d9b2a91a9e28318872b6006ed159d44d018` |
| 25 | [JoinTodoCommand.cs](../../../../../Services/TodoApi/Planora.Todo.Application/Features/Todos/Commands/JoinTodo/JoinTodoCommand.cs) | 1–7 | `6087d2b09ee7010be422039e8159d128c48251db8440e667379579f996a68fd8` |

По каждому файлу [JSON](read-041-review.json) содержит назначение, точки вызова, границы доверия и тестовые ограничения.

## Границы

- Охват включает только 25 manifest paths. Supplemental callers, тесты и документы не входят в счётчик.
- SHA-256 вычислены по байтам рабочего дерева, full source scope совпадает со снимком. Внешний T02 diff другого агента сохранён.
- Конфигурационные значения редактированы при чтении. Активные .env, OAuth, credentials и user secrets не загружались.
- Build, tests, services, Compose, database, broker, Redis, browser и нагрузочные проверки в этом batch не запускались.
- BE-002 распространяется на CreateSubtask/DuplicateTodo save-through fanout. BE-017 и OPS-014 включают Program Todo. TitlePreview расширяет UTF-16 boundary BE-024. T15 должен учесть устаревшие XML owner-only комментарии контроллера при фактическом participant behavior.
- Новые finding IDs локальны для READ-041. Канонические IDs назначает root. Все runtime gates остаются NOT_VERIFIED.
- Todo launch profiles set legacy flat environment names that the current section-based configuration reads do not consume. This extends T14/OPS-009 configuration parity; no direct profile launch was attempted.
