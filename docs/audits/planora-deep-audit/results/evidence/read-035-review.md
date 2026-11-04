# READ-035. Команды, модель и зависимости Category API

Полностью рассмотрены **25 файлов и 699 строк**. Снимок `2e8fc53dad4223fdf9b1f1eef15d2ef04281d4fc`.

## Наблюдения

- **CONT035001 / P2. gRPC CreateCategory теряет проверенный ID владельца.** Вызов с корректным service key и валидным `userId` без JWT доходит до домена с `Guid.Empty`, завершается `CREATE_FAILED` и преобразуется в gRPC `Internal`. Тест адаптера с подменённым MediatR не проходит до обработчика. Production caller для этого RPC не найден. Проверка требует временного Category host с реальными MediatR и PostgreSQL.
- **CONT035002 / P2. PUT с одним цветом очищает иконку.** Опущенный `icon` становится `null` и записывается через `UpdateAppearance`. Автосейв передаёт оба поля. Регрессия должна проверить цвет и сохранение иконки через реальный PUT и повторный GET, а также контракт явной очистки.

`GetCategoryById` передаёт проверенный owner ID в read-only owner-scoped lookup. Три Category RPC вызывают MediatR без токена вызова. Это дополнительный путь для DIST-011. HTTP DELETE сохраняет разграничение 403/404. Порядок commit и записи outbox уже отражён в BE-001. Untagged `category-dbcontext` относится к T04.3. Общая проверка Database уже получила тег readiness в T01.

## Полнота чтения

| № | Файл | Строки | SHA-256 |
|---|---|---|---|
| 1 | [ICurrentUserService.cs](../../../../../Services/CategoryApi/Planora.Category.Application/Common/Interfaces/ICurrentUserService.cs) | 1–9 | `468b851d88b8d7491ba0a812b9a578690f1f3b7126b0a4bd96c460cb2ac36d17` |
| 2 | [CategoryDto.cs](../../../../../Services/CategoryApi/Planora.Category.Application/DTOs/CategoryDto.cs) | 1–15 | `cdb9721a602b1b3c787bf89a290faeb026dfa605a1bd2440247fc6186bc0c66a` |
| 3 | [DependencyInjection.cs](../../../../../Services/CategoryApi/Planora.Category.Application/DependencyInjection.cs) | 1–41 | `606244add75c4063e567b6a3870e99ced4fb515572dedd6beb44db7e875dd15d` |
| 4 | [CreateCategoryCommand.cs](../../../../../Services/CategoryApi/Planora.Category.Application/Features/Categories/Commands/CreateCategory/CreateCategoryCommand.cs) | 1–12 | `a4cb9e99d4189852951967242d80b74cebe1d95e27fa86f372ffe02147bc6626` |
| 5 | [CreateCategoryCommandHandler.cs](../../../../../Services/CategoryApi/Planora.Category.Application/Features/Categories/Commands/CreateCategory/CreateCategoryCommandHandler.cs) | 1–89 | `2e9a4b99cb75baf3d660a34b07b5a1e2613220d947dafebbd2c7be34ea781eed` |
| 6 | [CreateCategoryCommandValidator.cs](../../../../../Services/CategoryApi/Planora.Category.Application/Features/Categories/Commands/CreateCategory/CreateCategoryCommandValidator.cs) | 1–27 | `c7b0e57bfe6faf9185fdbee453341acc56572a94e873e862c24ba23c3e56bb1d` |
| 7 | [DeleteCategoryCommand.cs](../../../../../Services/CategoryApi/Planora.Category.Application/Features/Categories/Commands/DeleteCategory/DeleteCategoryCommand.cs) | 1–4 | `385153f8d948091f7d65b1b9dd49ce3bfbc3d7b237b5e3f9e4d93975580fb2db` |
| 8 | [UpdateCategoryCommand.cs](../../../../../Services/CategoryApi/Planora.Category.Application/Features/Categories/Commands/UpdateCategory/UpdateCategoryCommand.cs) | 1–12 | `c5e0d1ca273f9ebbfffdb0e7688b81cf40066c01097cd231e4bb3f9557a583b4` |
| 9 | [UpdateCategoryCommandValidator.cs](../../../../../Services/CategoryApi/Planora.Category.Application/Features/Categories/Commands/UpdateCategory/UpdateCategoryCommandValidator.cs) | 1–33 | `6e6fa4601f3ad024cfe6ae3b26431a184588bcc205cf8cf6165c449dad78861f` |
| 10 | [CategoryMappingProfile.cs](../../../../../Services/CategoryApi/Planora.Category.Application/Features/Categories/Mappings/CategoryMappingProfile.cs) | 1–18 | `640ff79882668db2466fc9adef00d97bd8261c1d5e1beb8cc9de6ecffd9e417a` |
| 11 | [GetCategoryByIdQuery.cs](../../../../../Services/CategoryApi/Planora.Category.Application/Features/Categories/Queries/GetCategoryById/GetCategoryByIdQuery.cs) | 1–6 | `9448681f118c96747246ae34773558250587de2afe3cb1bf383de468c01810ff` |
| 12 | [GetUserCategoriesQuery.cs](../../../../../Services/CategoryApi/Planora.Category.Application/Features/Categories/Queries/GetUserCategories/GetUserCategoriesQuery.cs) | 1–6 | `efa803e09bab0c2766561e52257e4d2bd3015a7b83892b8d14135ee63548fccf` |
| 13 | [GlobalUsings.cs](../../../../../Services/CategoryApi/Planora.Category.Application/GlobalUsings.cs) | 1–18 | `8050d93b5a8360ebf4c987ea2951c12d91f2d606da9c814f3590e95e1ab3aa3e` |
| 14 | [Planora.Category.Application.csproj](../../../../../Services/CategoryApi/Planora.Category.Application/Planora.Category.Application.csproj) | 1–24 | `84e07efb0bf91b2c6f4a5bec0e6ea235aa07c4fc0749dd86bd6b682d31f3f0d6` |
| 15 | [Category.cs](../../../../../Services/CategoryApi/Planora.Category.Domain/Entities/Category.cs) | 1–139 | `10c6a9d304b285d86f0fb16b30b6fea71bacefa7454dec584385104153e967a9` |
| 16 | [CategoryColors.cs](../../../../../Services/CategoryApi/Planora.Category.Domain/Enums/CategoryColors.cs) | 1–32 | `0336f431525132516806953aa3dbfde750002491a296113fea5b12ba95bf1e88` |
| 17 | [CategoryCreatedDomainEvent.cs](../../../../../Services/CategoryApi/Planora.Category.Domain/Events/CategoryCreatedDomainEvent.cs) | 1–10 | `0af2c855196df176cba95352a9d02a120fd1a2b19c01a858da8c05b9f789fbb8` |
| 18 | [CategoryDeletedDomainEvent.cs](../../../../../Services/CategoryApi/Planora.Category.Domain/Events/CategoryDeletedDomainEvent.cs) | 1–9 | `84406d9b13fa658a5034e46ae13213b34d9599f11348116a358f63c1dbc05cfd` |
| 19 | [CategorySetAsDefaultDomainEvent.cs](../../../../../Services/CategoryApi/Planora.Category.Domain/Events/CategorySetAsDefaultDomainEvent.cs) | 1–8 | `a08cf06441291f1c6b75d1028944a53a91ee30381a82498155dbbfe8bd807cb2` |
| 20 | [GlobalUsings.cs](../../../../../Services/CategoryApi/Planora.Category.Domain/GlobalUsings.cs) | 1–4 | `fd280a2dc1e8c252f00f9b4d602ed41a8dd748c5daa0621b1f7ff3a13d3fce26` |
| 21 | [Planora.Category.Domain.csproj](../../../../../Services/CategoryApi/Planora.Category.Domain/Planora.Category.Domain.csproj) | 1–19 | `440f3ea8dc00e56434f9c9f1fb1bbba7021a2dac7de4fcbbd48a7c4a434ce022` |
| 22 | [ICategoryRepository.cs](../../../../../Services/CategoryApi/Planora.Category.Domain/Repositories/ICategoryRepository.cs) | 1–17 | `fa7bc4bfc09a6820e7ad1b1051d084c5c622bacc35eca6c220f4d23806ca6a9c` |
| 23 | [CategoryDescription.cs](../../../../../Services/CategoryApi/Planora.Category.Domain/ValueObjects/CategoryDescription.cs) | 1–42 | `1b6051c1b3a17a4ac3b9579301c27cc6acca4cc49d7198db6b79f96ecad15174` |
| 24 | [CategoryName.cs](../../../../../Services/CategoryApi/Planora.Category.Domain/ValueObjects/CategoryName.cs) | 1–41 | `04d72061ab27d2cdc47c237e95846eaf3e7d574ef6293fe8224964f9a0a4cd9a` |
| 25 | [DependencyInjection.cs](../../../../../Services/CategoryApi/Planora.Category.Infrastructure/DependencyInjection.cs) | 1–64 | `28c81984292c54e2f19801e457ff556ccd0fb314519823ebe05d1259ad440959` |

По каждому файлу [JSON](read-035-review.json) содержит назначение, точки вызова, границы доверия и тестовые ограничения.

## Границы

- Охват включает только 25 manifest paths. Контекстные caller, test и docs traces в счётчик не входят.
- SHA-256 вычислены по байтам рабочего дерева. Diff по области READ-035 к указанному снимку пуст.
- Значение резервной строки подключения скрыто. Активные env-файлы, secret stores и auth/credentials не загружались.
- Build, unit/provider tests, Category host, PostgreSQL, RabbitMQ, Redis и реальный gRPC transport не запускались.
- BE-001, BE-017, T04.3 и DIST-001 уже ведутся отдельно. Три вызова MediatR без cancellation token в CategoryGrpcService.cs:29,68,127 относятся к тому же классу ошибок, что DIST-011, с отдельным провайдерным воротом. Реальное время реакции на отмену не измерялось.
