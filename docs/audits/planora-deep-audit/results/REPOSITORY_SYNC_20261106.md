# Синхронизация репозитория и продолжение аудита — 2026-11-06

**IN_PROGRESS, 2026-11-14.** Первичная синхронизация Git завершена 6 ноября.
После неё завершён [перенос на Cloud.ru](CLOUDRU_20261106.md), публичный HTTPS
открыт 14 ноября. Полный аудит продолжается.

## Git и сохранность работы

- Начало: `main`, `e96f97e27cdb1f084f21c069b913ddcee8878c30`, 40 коммитов
  впереди `origin/main` (`dc6b1781a24d43d967c418de30acda10fcafb8f9`). Все 40 отправлены.
- PR [#144](https://github.com/4Keyy/Planora/pull/144) рассмотрен независимо и
  интегрирован разрешённым в репозитории squash как `31dc9211`.
- На первичной контрольной точке единственной веткой была `main`. Report-only commit
  `be62fb578869178e589558b18b888840debde521` сохранён и проверен на сервере
  тегом `archive/nuget-vuln-tracking-20261106` до удаления устаревшей ветки.
  Архивный тег не соответствует release-шаблону `v*` и не запускает CD.
- Чужой `frontend/next-env.d.ts` сохранён. У начального dirty
  `read-011-review.md` содержательный diff отсутствовал; он не присваивался.
- Состояние локального `-Prod` вошло в резервную копию. Писатели остановлены
  для согласованного переноса, исходные тома сохранены.
- Dependabot открыл PR #145–#150 после контрольной точки. CI-коммит `2f74570b`
  включает проверенные upstream-пины из #145–#148, обновляя все три действия
  CodeQL вместе. #149 и #150 закрыты без интеграции. Группа обновлений #149
  имеет красный E2E, обновление jsdom в #150 также провалило unit coverage.
  После закрытия осталась одна ветка `main`, открытых PR нет. Проверенные
  версии PR доступны по `refs/pull/149/head` и `refs/pull/150/head`.

## Реально выполненные проверки

Логи и TRX находятся в `.buildcheck/sync-20261106/`. Disposable PostgreSQL
проверен по container ID, label, loopback binding и tmpfs; тесты создают и
удаляют только собственные БД. Для RabbitMQ использован отдельный контейнер
с собственным volume, необходимым для сохранности данных после рестарта.

| Проверка | Результат и граница |
| --- | --- |
| Git integrity / whitespace | `git fsck --no-reflogs` exit 0; dangling objects не удалялись; diff check exit 0 |
| Исходный frontend | lint/typecheck/coverage exit 0; 173 файла, 2270 тестов |
| Frontend после PR144 | Чистый `git archive` snapshot, отдельный `npm ci`, lint/typecheck/coverage/build exit 0; 2270 тестов; live `.next`/next-env не изменялись |
| Backend после identity fix | Release build exit 0; 12 существующих разрешённых obsolete warnings; Unit 1535 passed/2 restart-only skips; Errors 94 passed |
| RabbitMQ restart | Seed 1 passed; restart; verify 1 passed с durable message/header identity |
| BE-006 backend | RED 6 failed/2 passed; targeted GREEN 60 passed, без skips; независимый review без блокеров |
| Documentation tooling | 6 тестов passed; ссылки и lint без ошибок |
| Прочие tooling tests | 34 passed; scanner policy regression 1 test/20 synthetic scenarios passed |
| Полный локальный history scan | Exit 1, 122 совпадения на `145eeea5`. Значения не включены в [метаданные](evidence/repository-sync-gitleaks-metadata.json). Нужна классификация совпадений |
| Production npm audit | На31dc GitHub job128070339966: 0 vulnerabilities; полный dependency install сообщает8 moderate. Локальный повтор после merge получил audit endpoint400 и не засчитан как PASS |

Первый повтор backend после рестарта имел 5 connection failures: Docker сменил
случайный host port, а fixture сохраняла прежний адрес. Отдельная verify попытка
также получила отказ соединения. После проверки нового endpoint оба необходимых
прогона завершились успешно. Эти FAIL сохранены в локальных логах и не скрываются.
Локальный Node22.18.0 ниже engine requirement некоторых dev packages; install дал
EBADENGINE warnings. Реальные проверки прошли, CI использует актуальную Node22.

## CI и продолжение

На31dc [CI](https://github.com/4Keyy/Planora/actions/runs/42269553538) и
[Security](https://github.com/4Keyy/Planora/actions/runs/42269553535) успешны.
Это не доказывает чистую полную Git history: push scanner проверяет свой диапазон,
а локальный полный scan остаётся красным.
[E2E](https://github.com/4Keyy/Planora/actions/runs/42269553627) shard6 остановился
на unhealthy Category API до Playwright. Причина приложения в прежних логах
не раскрыта; новые failure diagnostics должны дать проверяемое доказательство.
Исторические motion failures не приписываются этому новому startup failure.

После исправлений авторизации и RabbitMQ проверены 1 627 unit/provider и 95 HTTP
тестов. Два теста, требующие отдельного перезапуска брокера, прошли в протоколе
seed/restart/verify. На `040d3837` прошли push-запуски
[CI](https://github.com/4Keyy/Planora/actions/runs/42303827879) и
[Security Scan](https://github.com/4Keyy/Planora/actions/runs/42303827918).
[E2E](https://github.com/4Keyy/Planora/actions/runs/42303827928) прошёл пять
шардов из шести. Шестой дошёл до Playwright и упал в проверке движения карточек.
`90d53b70` исправляет фазу замера и восстановление фикстуры, `2099a23d` устраняет
зависший hover lift; после этого были ещё исправления, см. итоговый прогон ниже.

[Плановый скан](https://github.com/4Keyy/Planora/actions/runs/42591334776)
на `040d3837` завершился ошибкой Gitleaks и нашёл 128 совпадений в истории.
SARIF хранится в локальном каталоге доказательств. Среди путей есть шаблоны
конфигурации, CI и тестовые фикстуры. Полная классификация и проверка отзыва
исторических секретов остаются открытыми.

Новый scan выявил уязвимости пакетов SignalR Redis и AutoMapper. `443acfbb`
обновляет ASP.NET Core runtime и backplane до `10.0.15`. `09a3b2db` обновляет
AutoMapper до `15.1.4`. Полный локальный NuGet scan прошёл без совпадений.
На `09a3b2db` прошли все задания [CI](https://github.com/4Keyy/Planora/actions/runs/43520677320)
и [Security Scan](https://github.com/4Keyy/Planora/actions/runs/43520677370).
По итогам новой проверки анимаций добавлены ограничения шага пейджера и
фокусного скролла. На [E2E `3e7c078b`](https://github.com/4Keyy/Planora/actions/runs/43522320351)
пять шардов прошли. Шестой дошёл до конца motion matrix и остановился в отдельном
тесте live height из-за замера соседней карточки при пересортировке.
`82e755a` переносит монтаж портала в фазу до отрисовки, `0cd90376` исправляет
замер live height. На этой версии [CI](https://github.com/4Keyy/Planora/actions/runs/43596665482)
и [Security Scan](https://github.com/4Keyy/Planora/actions/runs/43596665446)
прошли. [Повтор E2E](https://github.com/4Keyy/Planora/actions/runs/43596665386):
6 успешных заданий, 92 теста прошли, 1 пропущен, 0 падений и 0 повторов.
Ранее падавший шард №6 прошёл все 10 тестов, включая motion matrix и замер
на 60 карточках. Замеры задержки и FPS на общей ВМ остаются отдельным
ограничением при оценке производительности.
Шард №5 по правилам распределения Playwright не получил spec-файлов;
локальный `playwright test --list --shard=5/6` подтверждает это. Шард №4
условно пропустил исследование ошибки `500` при загрузке JS для Categories.
Срабатывание этого сценария не подтверждено.

Дополнительное сравнение охватило 6741 уникальный Git blob и 12 фактических
значений конфигурации Cloud.ru. Прямых совпадений нет. Проверка не охватывает
кодированные формы и не закрывает исторические совпадения Gitleaks.

BE-006 backend и клиентское исправление идентичности активности подзадач
сохранены отдельно, клиентский коммит `145eeea5`. DIST-012 late activity/tombstone
остаётся открытым.

Полный аудит остаётся открытым. В `PROGRESS.json` учтены 647 из 1558 файлов
исходного перечня и 61 непроверенная пачка. Новый код и тесты не увеличивают
этот исторический охват.
Следующий шаг — воспроизвести на отдельном PostgreSQL оставшиеся сценарии
DIST-012 и продолжить проверку исторических совпадений Gitleaks.
