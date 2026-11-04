# READ-012. Общие доменные контракты и инфраструктура

Прочитаны все **25 файлов, 1418 строк**. HEAD `24c9b070faea68685e0616692b76ab8cf03cfb8b`.
Снимок ICacheService включает комментарий о контракте T09. В остальных файлах текст
совпадает с HEAD после нормализации концов строк. [Диапазоны и хеши](read-012-review.json)

Трассировка связала кэш с DI и CacheInvalidator, репозитории с конкретными EF
реализациями, claims с контекстом текущего пользователя, Swagger с режимом
хоста и Result с преобразованием в HTTP. Отдельные runtime проверки приведены
в отчёте T09. Новых подтверждённых дефектов в этой пачке не зарегистрировано.

| Файл | Строки |
| --- | --- |
| `EntityNotFoundException.cs` | 1–20 |
| `ErrorCode.cs` | 1–89 |
| `ForbiddenException.cs` | 1–16 |
| `InvalidValueObjectException.cs` | 1–12 |
| `MappedDomainException.cs` | 1–16 |
| `ProblemDetailsContext.cs` | 1–96 |
| `GlobalUsings.cs` | 1–10 |
| `IAggregateRoot.cs` | 1–8 |
| `IDomainEvent.cs` | 1–8 |
| `IRepository.cs` | 1–39 |
| `IUnitOfWork.cs` | 1–10 |
| `Planora.BuildingBlocks.Domain.csproj` | 1–10 |
| `Result.cs` | 1–141 |
| `BaseSpecification.cs` | 1–66 |
| `ISpecification.cs` | 1–16 |
| `ValueObject.cs` | 1–58 |
| `ValueObjects.cs` | 1–52 |
| `ICacheInvalidator.cs` | 1–10 |
| `ICacheService.cs` | 1–19 |
| `CompatibilityStubs.cs` | 1–2 |
| `ConfigurationValidator.cs` | 1–79 |
| `PlanoraSwaggerExtensions.cs` | 1–212 |
| `SecurityConstants.cs` | 1–206 |
| `CurrentUserContext.cs` | 1–62 |
| `ResultExtensions.cs` | 1–161 |
