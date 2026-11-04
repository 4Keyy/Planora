# READ-034. Сервисы Auth и запуск Category API

Полностью рассмотрены **25 файлов и 1953 строки**. Снимок `6948710db8eb5d11f76529f0b13fb17d3fd6df7d`.

## Наблюдения

- **CONT034001 / P2. Загрузка аватара удаляет прежнюю ревизию до сохранения нового URL.** В БД остаётся прежний URL, файлы прежней ревизии уже удалены. Конкурентные загрузки тоже не синхронизируют порядок prune и commit. Сохранить аватар A, вызвать загрузку B с инъекцией ошибки SaveChangesAsync после PutAsync, проверить сохранённый URL и существование файлов A. Конкурентный вариант требует отдельного теста.
- **CONT034002 / P2. Category startup создаёт БД с фиксированным именем вместо настроенной.** Startup сначала проверяет или создаёт planora_category. Затем соединяется с исходной настроенной БД, которую первый шаг не создал. При отсутствии прав возможен отказ на попытке создать постороннее имя. В разрешённом отдельном PostgreSQL fixture задать уникальную отсутствующую CategoryDatabase, запустить обычный startup и проверить фактический create target и исход соединения.

Путь потребления recovery code сопоставлен с BE-011. Записи о гонках refresh и device session остаются в BE-003 и BE-004.

## Полнота чтения

| № | Файл | Строки | SHA-256 |
|---|---|---|---|
| 1 | [PasswordValidator.cs](../../../../../Services/AuthApi/Planora.Auth.Infrastructure/Services/Authentication/PasswordValidator.cs) | 1–208 | `12836aa06830c06b70f4e9f89890d158e9bb7c604c1f5ac97e929a45b29b5e1f` |
| 2 | [TokenService.cs](../../../../../Services/AuthApi/Planora.Auth.Infrastructure/Services/Authentication/TokenService.cs) | 1–99 | `3d836acfd3a07016d0078688749067872e995f56f8b6cd58b6b66d487db9581a` |
| 3 | [TwoFactorService.cs](../../../../../Services/AuthApi/Planora.Auth.Infrastructure/Services/Authentication/TwoFactorService.cs) | 1–86 | `f470a605e44b913c0dae430f451760a71ffd149f5e894815df0d93cd730793e3` |
| 4 | [AuditService.cs](../../../../../Services/AuthApi/Planora.Auth.Infrastructure/Services/Common/AuditService.cs) | 1–62 | `0944f0047a11e80fbf92bf4c7b62982600a08d34b2ddeb643487951487f5faf7` |
| 5 | [AvatarMetrics.cs](../../../../../Services/AuthApi/Planora.Auth.Infrastructure/Services/Common/AvatarMetrics.cs) | 1–17 | `8930fc44b91173899ac7c255352cea7b8187d4e434d28bc019d98c6752c8bf22` |
| 6 | [CurrentUserService.cs](../../../../../Services/AuthApi/Planora.Auth.Infrastructure/Services/Common/CurrentUserService.cs) | 1–40 | `13ee78fcd916ba5ae310fc08cf9ef71d01a6dfd684b76a871a63e2dac8e1552a` |
| 7 | [DateTimeService.cs](../../../../../Services/AuthApi/Planora.Auth.Infrastructure/Services/Common/DateTimeService.cs) | 1–7 | `5408df56641f521675e7a32fba2979ea592a43d437ea1790f99bd95577ad1bb7` |
| 8 | [LocalAvatarStorage.cs](../../../../../Services/AuthApi/Planora.Auth.Infrastructure/Services/Common/LocalAvatarStorage.cs) | 1–125 | `a9272d3a2f61242320c7b5ec606c09adfc95c41e1afbd08058231be9d23f986f` |
| 9 | [LocalFileStorageService.cs](../../../../../Services/AuthApi/Planora.Auth.Infrastructure/Services/Common/LocalFileStorageService.cs) | 1–147 | `5932316bc1dccb6afb3bdbd7f3eb0d955cdbc282d7840eb2ac8da12e00204e63` |
| 10 | [SkiaImageProcessor.cs](../../../../../Services/AuthApi/Planora.Auth.Infrastructure/Services/Common/SkiaImageProcessor.cs) | 1–81 | `540dd6d09a691f6582cc40eb42473c2e129fb7601db33422b856514d78545bc1` |
| 11 | [EmailMessage.cs](../../../../../Services/AuthApi/Planora.Auth.Infrastructure/Services/Messaging/EmailMessage.cs) | 1–8 | `3e5702d1ffe5b42e09cacbcc3d449bccb1c0ee5f4f044e10362a1bfb4f8bef4e` |
| 12 | [EmailOptions.cs](../../../../../Services/AuthApi/Planora.Auth.Infrastructure/Services/Messaging/EmailOptions.cs) | 1–37 | `3cea5fa619a8d48dc1fe2cea35d7648b4da6b554acb86462672d9cf142671693` |
| 13 | [EmailService.cs](../../../../../Services/AuthApi/Planora.Auth.Infrastructure/Services/Messaging/EmailService.cs) | 1–263 | `f4e0f64578fe20e75d4c4f3bd7e1a5e2980a789e6e5d85b228a80902b6851430` |
| 14 | [IEmailMessageSender.cs](../../../../../Services/AuthApi/Planora.Auth.Infrastructure/Services/Messaging/IEmailMessageSender.cs) | 1–6 | `de94fbf5aa2a4174dea9e9cf2c0c439ba6b36cf55574e64e19272822d6082cef` |
| 15 | [RabbitMqStartupHostedService.cs](../../../../../Services/AuthApi/Planora.Auth.Infrastructure/Services/Messaging/RabbitMqStartupHostedService.cs) | 1–65 | `186cd7710c1a6c3840bd6d38b7dfa071d10d8b0f90b8836411ca3583cbc7462f` |
| 16 | [SmtpEmailMessageSender.cs](../../../../../Services/AuthApi/Planora.Auth.Infrastructure/Services/Messaging/SmtpEmailMessageSender.cs) | 1–46 | `85401a690d81c5ab381c3140fa1c0290bb179589e7e65e0f3d4ecd1b89009e76` |
| 17 | [RecoveryCodeService.cs](../../../../../Services/AuthApi/Planora.Auth.Infrastructure/Services/Security/RecoveryCodeService.cs) | 1–86 | `abd72e3f1772995060f19a7d084e606da3893478d5bfdace957266bfd7b813f8` |
| 18 | [TokenBlacklistService.cs](../../../../../Services/AuthApi/Planora.Auth.Infrastructure/Services/Security/TokenBlacklistService.cs) | 1–84 | `f29cc41c6acc7126b555c152f1c8824a72a2a1ed9cfeb5a50c3cac79fb9ea5dc` |
| 19 | [Dockerfile](../../../../../Services/CategoryApi/Planora.Category.Api/Dockerfile) | 1–43 | `de58bfb265ea163e8d35231863cca49f83508357abd7ca21ffc18884b74b9bba` |
| 20 | [GlobalUsings.cs](../../../../../Services/CategoryApi/Planora.Category.Api/GlobalUsings.cs) | 1–25 | `a248f9b1017108d6edc07d912dc00708b2e55137912b8e26e61f88c82d9f70cf` |
| 21 | [Planora.Category.Api.csproj](../../../../../Services/CategoryApi/Planora.Category.Api/Planora.Category.Api.csproj) | 1–41 | `32e79bfe4e0c9f855a0805c6dddd9ad07ad5696ab651527e44c625219f1a0e3a` |
| 22 | [Program.cs](../../../../../Services/CategoryApi/Planora.Category.Api/Program.cs) | 1–226 | `eb28084e86d82215b4d0857b45c29ae4718d94752b65b4a509177a7f1abde7ce` |
| 23 | [launchSettings.json](../../../../../Services/CategoryApi/Planora.Category.Api/Properties/launchSettings.json) | 1–60 | `0c3a21a88740fdc9ec0e182623e4b9862665bf19c524d649cfe37afd80eadccb` |
| 24 | [appsettings.Docker.json](../../../../../Services/CategoryApi/Planora.Category.Api/appsettings.Docker.json) | 1–38 | `e7a181feb8c4cbdf82019f9b796cbb3f18711dd53a23965b60aa5fda6c34157d` |
| 25 | [appsettings.json](../../../../../Services/CategoryApi/Planora.Category.Api/appsettings.json) | 1–53 | `bf97952231c946806bb8e0d00e033fb9a6e9a5c1f8568aef63bb44684f227646` |

По каждому файлу [JSON](read-034-review.json) содержит назначение, точки вызова, границы доверия и тестовые ограничения.

## Границы

- Охват включает только 25 manifest paths. Supplemental caller/test traces в счётчик не входят.
- Чтение относится к указанному HEAD. SHA-256 вычислены по байтам рабочего дерева, diff по scope к HEAD пуст.
- В конфигурационных файлах чувствительные значения скрыты. Активные env-файлы, secret stores и auth/credentials не загружались.
- Build, unit/provider tests, Auth/Category hosts, Docker, PostgreSQL, Redis, SMTP и HIBP не запускались.
- Новые находки предварительные. BE-003, BE-004, BE-011, OPS-003, OPS-007 и OPS-010 уже ведутся отдельно.
