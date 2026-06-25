# План реализации по итогам аудита — 2026-06-23

> Документ-задание для инженера. Каждый пункт самодостаточен: корневая причина → что
> менять (бэкенд + фронтенд) → крайние случаи → тесты → документация → критерии приёмки.
> Все ссылки на код кликабельны (`файл:строка`).

## 0. Общие правила выполнения

- **Стек:** .NET 10 / C# (CQRS на MediatR, Result-паттерн, EF Core, Serilog), Next.js 14 (App Router,
  TS strict, Zustand, Framer Motion, Tailwind), PostgreSQL, Redis, RabbitMQ. ОС: Windows + PowerShell.
- **Рабочий процесс (обязателен):** для каждого пункта идём по `dev-workflow`:
  понять → план → **tdd-loop** (сначала падающий тест) → реализация → **doc-sync** → **pre-commit-gate**.
- **EF-миграции не нужны ни для одного пункта.** Все колонки (`CompletedByViewer`,
  `CompletedByViewerAt`) уже существуют; группировка уведомлений (п.4) считается из существующей
  таблицы `Notifications`. Если по ходу появится новая колонка — подключить навык `ef-migration`.
- **Коммиты:** один логический юнит — один коммит, формат `type(scope): …` (см. CLAUDE.md).
  Рекомендуемая разбивка: п.1 (fix), п.2 (style/fix), п.3 — 2–3 коммита (backend-домен/правила,
  затем frontend-поверхности), п.4 — 2 коммита (backend summary, затем frontend store+UI).
- **Порядок:** п.2 → п.1 → п.4 → п.3 (от простого/изолированного к сложному/сквозному).
- **Проверка перед коммитом:** `dotnet build` + `dotnet test` (бэкенд), `npm run build` + `npm test`
  (фронт, покрытие ≥85% не уронить). Сборка при запущенных сервисах — через `-p:OutDir` (см. память).

### Глоссарий состояний (важно для п.3)

- **Глобальный статус задачи** (`TodoStatus`): `Todo=0`, `InProgress=1`, `Done=2`
  ([TodoStatus.cs](../../Services/TodoApi/Planora.Todo.Domain/Enums/TodoStatus.cs)).
- **«В работе» владельца** = глобальный статус `InProgress`.
- **«В работе» не-владельца** (публичная/расшаренная задача) = наличие строки-воркера
  `TodoItemWorker` (`AddWorker`/`RemoveWorker` в [TodoItem.cs](../../Services/TodoApi/Planora.Todo.Domain/Entities/TodoItem.cs)).
- **«Выполнено» не-владельцем** = пер-вьюер флаг `UserTodoViewPreference.CompletedByViewer`
  ([UserTodoViewPreference.cs](../../Services/TodoApi/Planora.Todo.Domain/Entities/UserTodoViewPreference.cs)).

---

## Проблема 1 — Редактирование ответа превращает его в обычное сообщение

### Корневая причина (найдена)

При редактировании комментария бэкенд возвращает DTO **без блока ответа**. В
[UpdateCommentCommandHandler.cs:84-96](../../Services/CollaborationApi/Planora.Collaboration.Application/Features/Comments/Commands/UpdateComment/UpdateCommentCommandHandler.cs)
`CommentDto` создаётся без полей `ReplyToType / ReplyToId / ReplyToAuthorId / ReplyToAuthorName /
ReplyToAuthorAvatarUrl / ReplyToPreview / ReplyToDeleted` — а они в
[CommentDto.cs:26-38](../../Services/CollaborationApi/Planora.Collaboration.Application/DTOs/CommentDto.cs)
имеют значения по умолчанию `null/false`. Сущность в БД при этом сохраняет ссылку на ответ
(`UpdateContent` меняет только `Content`, см. [Comment.cs:166-177](../../Services/CollaborationApi/Planora.Collaboration.Domain/Entities/Comment.cs)).

На фронте [branch-feed.tsx:834-835](../../frontend/src/components/todos/edit-todo-modal/branch-feed.tsx)
подменяет элемент списка возвращённым DTO:
```ts
const updated = await updateComment(todoId, id, content)
setComments((prev) => prev.map((c) => (c.id === id ? updated : c)))
```
`updated.replyToType === undefined` → `resolveThreads`/`buildFeed` считают комментарий корневым → ответ
«выпадает» из треда. Поллинг 9с **не лечит**: `mergeLatest` обновляет элемент только при изменении
`content`/`updatedAt` ([branch-feed.tsx:521](../../frontend/src/components/todos/edit-todo-modal/branch-feed.tsx)),
а они уже совпадают. Поэтому баг выглядит «постоянным» до перезагрузки/переоткрытия ветки.

### Что менять — бэкенд (основной фикс)

В `UpdateCommentCommandHandler.Handle` после `comment.UpdateContent(...)` и сохранения **восстановить
блок ответа в ответном DTO**, точно повторив логику чтения из
[GetCommentsQueryHandler.cs:121-179](../../Services/CollaborationApi/Planora.Collaboration.Application/Features/Comments/Queries/GetComments/GetCommentsQueryHandler.cs):

1. если `comment.IsReply`:
   - резолвить автора цитаты «вживую» через `_userService.GetUserProfilesAsync([comment.ReplyToAuthorId])`
     (имя/аватар; снапшот `comment.ReplyToAuthorName` — фолбэк);
   - для **target = comment**: подтянуть актуальный текст цели (`ICommentRepository.GetByIdAsync` или
     `GetLiveByIdsAsync`) → `ReplyToPreview = Comment.TruncatePreview(live.Content)`; если цель не найдена
     → `ReplyToPreview = comment.ReplyToPreview`, `ReplyToDeleted = true`;
   - для **target = subtask**: использовать снапшот `comment.ReplyToPreview` + `comment.ReplyToDeleted`;
   - смаппить `ReplyTargetType` → строку (`"comment"`/`"subtask"`).
2. передать все `ReplyTo*` в возвращаемый `CommentDto`.

### Чистый код (обязательно — устраняет причину навсегда)

Дублирование маппинга reply-блока в трёх местах (Add/Update/GetComments) и породило баг. Вынести
**общий хелпер** `CommentReplyResolver`/`CommentDtoFactory` в
`Services/CollaborationApi/Planora.Collaboration.Application/Common/`, который принимает `Comment` +
словарь профилей + словарь «живых» целей и собирает reply-часть DTO. Переиспользовать в
[GetCommentsQueryHandler](../../Services/CollaborationApi/Planora.Collaboration.Application/Features/Comments/Queries/GetComments/GetCommentsQueryHandler.cs),
[AddCommentCommandHandler](../../Services/CollaborationApi/Planora.Collaboration.Application/Features/Comments/Commands/AddComment/AddCommentCommandHandler.cs),
`UpdateCommentCommandHandler`.

### Что менять — фронтенд (защита в глубину, рекомендуется)

В [branch-feed.tsx:834-835](../../frontend/src/components/todos/edit-todo-modal/branch-feed.tsx)
делать merge, сохраняющий reply-поля, если сервер их вдруг не прислал:
```ts
setComments((prev) => prev.map((c) => c.id === id
  ? { ...c, ...updated,
      replyToType: updated.replyToType ?? c.replyToType,
      replyToId: updated.replyToId ?? c.replyToId,
      replyToAuthorId: updated.replyToAuthorId ?? c.replyToAuthorId,
      replyToAuthorName: updated.replyToAuthorName ?? c.replyToAuthorName,
      replyToAuthorAvatarUrl: updated.replyToAuthorAvatarUrl ?? c.replyToAuthorAvatarUrl,
      replyToPreview: updated.replyToPreview ?? c.replyToPreview,
      replyToDeleted: updated.replyToDeleted ?? c.replyToDeleted }
  : c))
```

### Крайние случаи
- Ответ на удалённую цель: `ReplyToDeleted=true`, превью из снапшота — рендер «удалённой» цитаты.
- Ответ на под-задачу: снапшот сохраняется, чинить нечего.
- Редактирование обычного (не-reply) сообщения: блок reply пустой — поведение прежнее.
- Живой пуш `CommentUpdated` другим участникам уже тянет полный DTO через GetComments — там всё ок.

### Тесты
- **Backend (xUnit):** `UpdateCommentCommandHandler` — отредактированный reply сохраняет `ReplyToType/Id/
  AuthorId/Preview`; превью обновляется на «живой» текст цели; удалённая цель → `ReplyToDeleted=true`.
- **Frontend (Vitest/RTL):** правка ответа в `branch-feed` — он остаётся в своём треде (не становится корневым).

### Документация
- [docs/API.md](../API.md): пример ответа `PUT /collaboration/api/v1/comments/{taskId}/{commentId}` с reply-блоком.
- [docs/features.md](../features.md): раздел веток/ответов — «редактирование сохраняет статус ответа».
- `CHANGELOG.md`: запись `fix`.

### Критерии приёмки
- [ ] Правка ответа на сообщение/ответ/под-задачу не меняет его на обычное сообщение (сразу, без перезагрузки).
- [ ] Цитата корректна (актуальный текст; «удалено», если цель удалена).
- [ ] Маппинг reply-блока вынесен в общий хелпер и переиспользован.

---

## Проблема 2 — Меню аватара сделать непрозрачным, как панель уведомлений

### Эталон (панель уведомлений)
[notification-bell.tsx:109](../../frontend/src/components/notifications/notification-bell.tsx):
`bg-white` (сплошной), `border-gray-200/90`, `shadow-[0_12px_40px_rgba(0,0,0,0.12)]`, **без** `backdrop-blur`.

### Что менять — фронтенд
1. **Десктоп-дропдаун аватара** —
   [navbar.tsx:371](../../frontend/src/components/layout/navbar.tsx):
   было `bg-white/96 backdrop-blur-xl border-gray-100 shadow-[0_8px_32px_rgba(0,0,0,0.10)]`
   → стало `bg-white border-gray-200/90 shadow-[0_12px_40px_rgba(0,0,0,0.12)]` (убрать `backdrop-blur-xl`).
   Скругление `rounded-2xl` сохранить. Для паритета можно добавить `z-[1100]` (как у панели уведомлений).
2. **Мобильный sheet аккаунта** —
   [navbar.tsx:486](../../frontend/src/components/layout/navbar.tsx):
   `bg-white/97 backdrop-blur-xl` → `bg-white` (убрать blur), бордер/тень привести к эталону.

### Чего НЕ трогать
Сама «таблетка» навбара ([navbar.tsx:204](../../frontend/src/components/layout/navbar.tsx)) и кнопка-колокол —
это панель-бар, а не меню. Их полупрозрачность остаётся.

### Крайние случаи / качество
- Контраст текста на сплошном белом сохраняется (серые токены ок).
- Анимация появления (`opacity/scale/y`) не меняется — без дёрганий.
- Проверить светлую/тёмную тему и мобильный вид (390px) — меню не растягивается, помещается.

### Тесты / документация
- Лёгкий тест классов (опционально) в `frontend/src/test/components`.
- [docs/features.md](../features.md): упоминание про навбар (если есть раздел). `CHANGELOG.md`: `style/fix`.

### Критерии приёмки
- [ ] Меню аватара (десктоп и мобайл) визуально непрозрачно и идентично панели уведомлений.
- [ ] Анимации плавные; нет просвечивания контента под меню.

---

## Проблема 3 — Выполнение/восстановление публичных и приватных задач с учётом «В работе»

### Что УЖЕ работает (только покрыть тестами, код не трогать)
- **Владелец выполняет** (PUT `status=done`) → `MarkAsDone` → `InProgress→Done`: «в работе» = 0, «выполнено» = 1
  ([TodoItem.cs:309-324](../../Services/TodoApi/Planora.Todo.Domain/Entities/TodoItem.cs)).
- **Не-владелец выполняет чужую публичную** → `CompletedByViewer=true` **и снимается строка-воркер**
  («в работе» = 0) + уведомления
  ([UpdateTodoCommandHandler.cs:183-190](../../Services/TodoApi/Planora.Todo.Application/Features/Todos/Commands/UpdateTodo/UpdateTodoCommandHandler.cs)).
- **Владелец возвращает** (PUT `status=todo`) → `MarkAsTodo` → статус `Todo` (а не `InProgress`): «в работе»
  НЕ ставится ([TodoItem.cs:336-341](../../Services/TodoApi/Planora.Todo.Domain/Entities/TodoItem.cs)) — ровно как требуется.

### Что НУЖНО сделать (восстановление для не-владельца + распространение от автора)

#### 3.1 Бэкенд — разрешить не-владельцу возврат, кроме случая «автор завершил глобально»

Текущее жёсткое правило запрещает не-владельцу возврат **всегда**:
[SetViewerPreferenceCommandHandler.cs:114-116](../../Services/TodoApi/Planora.Todo.Application/Features/Todos/Commands/SetViewerPreference/SetViewerPreferenceCommandHandler.cs).
Заменить на правило «нельзя вернуть, только если **автор завершил задачу глобально**»:

```csharp
if (request.CompletedByViewer.HasValue && !request.CompletedByViewer.Value && preference.CompletedByViewer)
{
    if (todoItem.IsCompleted) // автор пометил всю задачу выполненной (Status == Done)
        return Result<...>.Failure(new Error(
            "AUTHOR_ALREADY_COMPLETED",
            "Автор уже отметил задачу выполненной — вернуть её в работу нельзя. Сделайте копию."));
    // иначе — возврат разрешён (вьюер просто снимает свою галочку)
}
```
То же правило **добавить в ветку не-владельца** в
[UpdateTodoCommandHandler.cs:166-187](../../Services/TodoApi/Planora.Todo.Application/Features/Todos/Commands/UpdateTodo/UpdateTodoCommandHandler.cs)
(сейчас guard'а там нет — путь `PUT /todos/{id}` обходит правило): если `targetStatus != Done`,
`preference.CompletedByViewer == true` и `todoItem.IsCompleted` → та же ошибка `AUTHOR_ALREADY_COMPLETED`.

> Возврат **только снимает** `CompletedByViewer` (+ `CompletedByViewerAt=null`). Строку-воркер НЕ
> восстанавливаем — «в работе» не ставится; пользователь сам нажмёт «взять в работу» при желании.

#### 3.2 Бэкенд — автор возвращает публичную/расшаренную задачу → активна у всех

Когда **владелец** делает reopen (`Done→Todo`) задачи с аудиторией
(`IsPublic || SharedWith.Any()`), очистить `CompletedByViewer` у **всех** вьюеров, чтобы задача снова
стала активной для каждого:
- новый метод репозитория `ClearCompletedByViewerForTodoAsync(Guid todoItemId, CancellationToken)`
  в [IUserTodoViewPreferenceRepository.cs](../../Services/TodoApi/Planora.Todo.Domain/Repositories/IUserTodoViewPreferenceRepository.cs)
  и [UserTodoViewPreferenceRepository.cs](../../Services/TodoApi/Planora.Todo.Infrastructure/Persistence/Repositories/UserTodoViewPreferenceRepository.cs)
  (bulk `ExecuteUpdate`: `CompletedByViewer=false`, `CompletedByViewerAt=null` по `TodoItemId`);
- вызвать его в [UpdateTodoCommandHandler.cs:404-413](../../Services/TodoApi/Planora.Todo.Application/Features/Todos/Commands/UpdateTodo/UpdateTodoCommandHandler.cs)
  в ветке владельца, когда `wasCompleted && status == Todo` и задача имеет аудиторию;
- событие `TaskReopened` аудитории уже эмитится
  ([UpdateTodoCommandHandler.cs:503-515](../../Services/TodoApi/Planora.Todo.Application/Features/Todos/Commands/UpdateTodo/UpdateTodoCommandHandler.cs)) — фид у друзей сам обновится.

Приватная задача (без аудитории) — очищать нечего, поведение прежнее.

#### 3.3 Бэкенд — различать «автор завершил глобально» vs «вьюер завершил для себя»

Сейчас для не-владельца `Status="Done"` и `IsCompleted=true` в **обоих** случаях
([GetUserTodosQueryHandler.cs:240-242](../../Services/TodoApi/Planora.Todo.Application/Features/Todos/Queries/GetUserTodos/GetUserTodosQueryHandler.cs)) —
по ним нельзя отличить ситуации. Добавить в
[TodoItemDto.cs](../../Services/TodoApi/Planora.Todo.Application/DTOs/TodoItemDto.cs) поле
`public bool OwnerCompleted { get; init; }` (= реальное `item.IsCompleted` сущности) и заполнять его в:
[GetUserTodosQueryHandler](../../Services/TodoApi/Planora.Todo.Application/Features/Todos/Queries/GetUserTodos/GetUserTodosQueryHandler.cs),
[GetPublicTodosQueryHandler](../../Services/TodoApi/Planora.Todo.Application/Features/Todos/Queries/GetPublicTodos/GetPublicTodosQueryHandler.cs),
ответах Update/SetViewerPreference. Сервер остаётся источником истины (ошибка из 3.1); поле нужно фронту
для проактивного UI (не слать заведомо отклоняемый запрос и показать корректную кнопку/тост).

#### 3.4 Фронтенд — снять хардкод «Only the author can reopen» на всех поверхностях

Везде заменить безусловный блок на правило: **reopen разрешён, если** `isCompletedByViewer === true &&
ownerCompleted !== true`; иначе — тост «Нельзя восстановить — автор уже отметил задачу выполненной».
Файлы:
- [dashboard/page.tsx:438-447](../../frontend/src/app/dashboard/page.tsx)
- [tasks/page.tsx:360-366](../../frontend/src/app/tasks/page.tsx)
- [tasks/completed/page.tsx:250-251](../../frontend/src/app/tasks/completed/page.tsx)
- [branch/[id]/page.tsx:123-137](../../frontend/src/app/branch/[id]/page.tsx)
- [edit-todo-modal/modal.tsx:159](../../frontend/src/components/todos/edit-todo-modal/modal.tsx)
- [todo-card.tsx:208-243](../../frontend/src/components/todos/todo-card.tsx): сейчас не-владельцу reopen
  отдаётся родителю без анимации (строка 213). Разрешить анимацию reopen не-владельцу, когда возврат
  допустим (`!ownerCompleted`); если `ownerCompleted` — без анимации, просто показать тост из обработчика.
- Добавить `ownerCompleted?: boolean | null` в тип [Todo](../../frontend/src/types/todo.ts) и в маппинг
  ответа `setViewerPreference` ([api.ts:367-383](../../frontend/src/lib/api.ts)).

При возврате не-владельца: вызвать `setViewerPreference(id, { completedByViewer: false })`, перенести
карточку из «выполненных» в активные (без «в работе»). При ошибке `AUTHOR_ALREADY_COMPLETED` —
тост-предупреждение (текст с бэка/локализованный).

### Крайние случаи
- Друг завершил для себя ДО глобального завершения автором → автор завершает глобально → друг возврат не
  может (`OwnerCompleted=true`) → тост.
- Автор возвращает → 3.2 очищает все `CompletedByViewer` → активна у всех; «в работе» ни у кого не стоит.
- Приватная задача: возврат/очистка касаются только владельца.
- Идемпотентность: повторный возврат уже-активной задачи — no-op без ошибки.
- Под-задачи завершаются глобально (другой путь, [UpdateTodoCommandHandler.cs:97-164](../../Services/TodoApi/Planora.Todo.Application/Features/Todos/Commands/UpdateTodo/UpdateTodoCommandHandler.cs)) — НЕ затрагиваем.

### Тесты
- **Backend:** не-владелец возврат разрешён при `Status != Done`; запрещён (`AUTHOR_ALREADY_COMPLETED`) при
  `Status == Done` — для **обоих** путей (SetViewerPreference и UpdateTodo). Автор-reopen публичной задачи
  очищает `CompletedByViewer` всех вьюеров. Регресс: владелец complete→reopen даёт `Todo` (не `InProgress`);
  не-владелец complete снимает воркера. `OwnerCompleted` корректен в обоих сценариях.
- **Frontend:** на каждой поверхности — друг возвращает свою задачу (успех, без «в работе»); друг не может
  вернуть завершённую автором (тост). Партиции активные/выполненные пересобираются.

### Документация
- [docs/features.md](../features.md): полные правила выполнения/восстановления + взаимодействие с «В работе».
- [docs/API.md](../API.md): семантика `PUT /todos/{id}` (status) и `PATCH /todos/{id}/viewer-preferences`,
  новое поле `ownerCompleted`, код ошибки `AUTHOR_ALREADY_COMPLETED`.
- `CHANGELOG.md`: `feat` (новая механика восстановления). EF-миграция не требуется.

### Критерии приёмки
- [ ] Выполнение своей/чужой задачи снимает «в работе» (0) и ставит «выполнено» (1).
- [ ] Любой участник может вернуть свою задачу в активные (без «в работе»), пока автор не завершил глобально.
- [ ] Автор-возврат публичной задачи делает её активной у всех; не-автор — только у себя.
- [ ] Если автор уже завершил задачу — друзья получают уведомление и не могут вернуть.
- [ ] Возвращённую задачу можно снова взять в работу и выполнить любым обычным способом.

---

## Проблема 4 — Группа значков уведомлений на карточке («кольца Audi»)

### Текущее состояние
Модель `TaskUnread(TaskId, Count, LatestType)`
([NotificationSummary.cs:4](../../Services/RealtimeApi/Planora.Realtime.Application/Response/NotificationSummary.cs))
несёт только общий счётчик и тип последнего события. Карточка рисует **один** pill
([todo-card.tsx:407-420](../../frontend/src/components/todos/todo-card.tsx)).

### Что менять — бэкенд (разбивка по типам)
В [NotificationReadStore.GetSummaryAsync:35-47](../../Services/RealtimeApi/Planora.Realtime.Infrastructure/Services/NotificationReadStore.cs):
- добавить `n.OccurredOnUtc` в проекцию (сортировка по нему уже есть);
- для каждой задачи дополнительно сгруппировать по `Type`: `Groups = [{ Type, Count,
  LatestOccurredOnUtc }]`, отсортированные по `LatestOccurredOnUtc` **по убыванию** (новейшее — первым).

Модель ответа ([NotificationSummary.cs](../../Services/RealtimeApi/Planora.Realtime.Application/Response/NotificationSummary.cs)):
```csharp
public sealed record TaskUnreadGroup(string Type, int Count, DateTime LatestOccurredOnUtc);
public sealed record TaskUnread(Guid TaskId, int Count, string LatestType, IReadOnlyList<TaskUnreadGroup> Groups);
```
`Count`/`LatestType` оставить для обратной совместимости (`LatestType == Groups[0].Type`).

### Что менять — фронтенд store
[store/notifications.ts](../../frontend/src/store/notifications.ts):
- расширить `TaskUnread` полем `groups: Array<{ type: string; count: number; latestOccurredOn: string }>`;
- `toPerTask` — мапить `groups`;
- `ingest` ([:122-153](../../frontend/src/store/notifications.ts)) — инкремент счётчика нужной type-группы
  (или создать группу), обновить её `latestOccurredOn`, **пересортировать** группы по убыванию даты;
- `markRead([ids])` ([:180-208](../../frontend/src/store/notifications.ts)) — пересчитать группы задачи из
  оставшихся непрочитанных `items` (там есть `type` и `occurredOn`);
- `markTaskRead` ([:156-177](../../frontend/src/store/notifications.ts)) — уже удаляет запись задачи, ок;
- селектор `useTaskUnread` возвращает тот же объект (ссылочная стабильность сохраняется).

### Что менять — фронтенд UI (компонент-кластер)
Новый `NotificationBadgeCluster` рядом с
[notification-badge.tsx](../../frontend/src/components/notifications/notification-badge.tsx):
- вход: `groups` (уже новейшие-первыми);
- **1 тип** → текущий labeled `pill` (сохранить красивый вид);
- **≥2 типов** → перекрывающиеся диски варианта `mark`, слева-направо: новейший слева и сверху
  (наибольший `z-index`), каждый следующий со сдвигом `margin-left: -8…-10px`, лёгким `scale` (1 → 0.92 →
  0.86…) и `opacity`-фолл-оффом для глубины («кольца Audi»); цвет диска — `tint` его типа;
- общий счётчик — бабл на переднем диске; лимит ~4 видимых + индикатор `+N`;
- вход стаггер-анимацией (spring), `useReducedMotion` — без движения; ничего не растягивается/дёргается.

Подключить в карточке вместо одиночного бейджа
([todo-card.tsx:407-420](../../frontend/src/components/todos/todo-card.tsx)), сохранив позицию
`absolute -top-2 right-2` и `pulse` для активных карточек.

### Крайние случаи
- Все непрочитанные одного типа → один pill (как сейчас).
- Много типов (макс. 8 по [types.ts](../../frontend/src/lib/notifications/types.ts)) → 4 диска + «+N».
- `markTaskRead` при открытии карточки/ветки очищает кластер целиком.
- Неизвестный тип → дефолтный «колокол» (`getNotificationKind`).

### Тесты
- **Backend:** `GetSummaryAsync` отдаёт `Groups`, отсортированные по `LatestOccurredOnUtc` desc, с верными счётчиками.
- **Frontend:** `ingest` корректно добавляет/инкрементит/пересортирует группы; `markRead` пересчитывает их;
  рендер кластера: порядок (новейший слева), лимит+`+N`, reduced-motion.

### Документация
- [docs/API.md](../API.md): новая форма `GET /realtime/api/v1/notifications/summary` (поле `groups`).
- [docs/features.md](../features.md): кластер уведомлений на карточке. `CHANGELOG.md`: `feat`.

### Критерии приёмки
- [ ] Карточка показывает все типы событий группой значков, новейший — слева/спереди.
- [ ] Порядок строго по времени события; счётчики верны; есть `+N` при переполнении.
- [ ] Анимации плавные; элементы не растягиваются и помещаются (десктоп/мобайл).

---

## Сводная проверка перед сдачей
- [ ] `dotnet build` + `dotnet test` зелёные (бэкенд).
- [ ] `npm run build` + `npm test` зелёные, покрытие ≥85% (фронт).
- [ ] Документация обновлена (API.md / features.md / CHANGELOG.md) синхронно с кодом.
- [ ] EF-миграции не добавлялись (подтвердить — их быть не должно).
- [ ] `.gitignore` проверен; секретов в стейдже нет; коммиты по одному логическому юниту.
