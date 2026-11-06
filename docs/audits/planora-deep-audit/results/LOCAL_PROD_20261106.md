# Локальный Production от 2026-11-06

**Работает и оставлен запущенным:** <http://localhost:3000/auth/login>.
Полный аудит отложен по просьбе владельца; его checkpoint сохранён в
[PROGRESS.json](PROGRESS.json) и [T03](T03.md).

## Запуск и восстановление

Выполнен настоящий `Start-Planora-Local.ps1 -Prod -NoBrowser`: Release-сборка
backend и Next production build/start. Docker Desktop и три инфраструктурных
контейнера подняты. Первоначально четыре API остановились на строгой проверке
существующей схемы; защита сохранена. После отдельного разрешения владельца
применён [проверенный SQL-план](evidence/local-prod-reconcile-20261106/README.md).
Четыре API перезапущены функциями того же launcher без повторной сборки
работающего frontend. Штатный startup проверил эквивалентность схем и принял
reviewed migration history. Ручного штампования истории не было.

До старта сохранены шесть custom-format backup БД. Четыре копии восстановлены
в disposable PostgreSQL, проверены RED/GREEN schema guard, повтор SQL/startup
и сохранность строк. После применения на рабочих БД агрегированные row digests
и количество строк всех 18 существующих таблиц также совпали; новая таблица
UserRecoveryCodes пуста. Никакие строки не удалены и значения не обрезаны.

## Проверки

| Проверка | Результат |
| --- | --- |
| Auth, Category, Todo, Collaboration, Messaging, Realtime, Gateway ready | 7 ответов 200 |
| Aggregate health тех же компонентов | 7 ответов 200 / Healthy |
| Production sign-in HTML и опубликованный JS asset | 200 |
| CSRF через frontend и gateway | 200, token/cookie присутствуют, SameSite Strict |
| Refresh без пользовательской сессии с CSRF | 204 |
| Todos, Categories, Comments, Messages, Friendships без авторизации через frontend | Ожидаемые 401, без 404/500 |
| Realtime proxy health | 200 |
| Браузер | Landing и sign-in отображаются; console warnings/errors 0 |
| Сохранность frontend файлов | Исходные next-env.d.ts и tsconfig.json восстановлены byte-for-byte после известных generated изменений Next |

Итого 24/24 HTTP-проверки. Два первых запуска временного smoke-helper были
исправлены: health возвращает plain-text Healthy, а Fetch запрещает service
port 5060. Финальный helper использует обычный HTTP-клиент. Это исправления
проверочного инструмента; логи первых попыток сохранены.

## Состояние и границы

- Controller и сервисы работают фоном. Runtime metadata, логи, backups и
  проверки находятся в `.buildcheck/local-prod-20261106/` и `logs/`.
- Frontend использует `.next-local-prod-20261106`; исходная чужая правка
  next-env.d.ts сохранена. Обычный launcher и постоянные env-файлы не изменены.
- `Retention__Enabled=false` действует только для текущего запуска, чтобы
  фоновая очистка не затронула старые данные во время работы владельца.
- Cookie HTTPS исключение соответствует штатному локальному `-Prod` по HTTP;
  публичное развёртывание и удалённая инфраструктура не менялись.
- Вход под пользовательским аккаунтом, CRUD и полноценный SignalR-сеанс
  в этом smoke не выполнялись. Полный аудит/production certification не заявляются.
- Последняя проверенная единица T03 — BE-005, commit `fc2929af`.
  BE-006 остаётся без изменений контракта/схемы и без выполненного RED;
  его незавершённый тест сохранён вне активного test tree.
