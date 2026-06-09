# Planora.Migrator — one-shot EF Core migration runner.
# Built as a minimal .NET runtime image; no ASP.NET, no curl, no shell.

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY ["Directory.Packages.props", "."]
COPY ["Directory.Build.props", "."]
COPY ["BuildingBlocks/Planora.BuildingBlocks.Application/Planora.BuildingBlocks.Application.csproj", "BuildingBlocks/Planora.BuildingBlocks.Application/"]
COPY ["BuildingBlocks/Planora.BuildingBlocks.Domain/Planora.BuildingBlocks.Domain.csproj", "BuildingBlocks/Planora.BuildingBlocks.Domain/"]
COPY ["BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Planora.BuildingBlocks.Infrastructure.csproj", "BuildingBlocks/Planora.BuildingBlocks.Infrastructure/"]
COPY ["GrpcContracts/GrpcContracts.csproj", "GrpcContracts/"]

COPY ["Services/AuthApi/Planora.Auth.Domain/Planora.Auth.Domain.csproj", "Services/AuthApi/Planora.Auth.Domain/"]
COPY ["Services/AuthApi/Planora.Auth.Application/Planora.Auth.Application.csproj", "Services/AuthApi/Planora.Auth.Application/"]
COPY ["Services/AuthApi/Planora.Auth.Infrastructure/Planora.Auth.Infrastructure.csproj", "Services/AuthApi/Planora.Auth.Infrastructure/"]
COPY ["Services/CategoryApi/Planora.Category.Domain/Planora.Category.Domain.csproj", "Services/CategoryApi/Planora.Category.Domain/"]
COPY ["Services/CategoryApi/Planora.Category.Application/Planora.Category.Application.csproj", "Services/CategoryApi/Planora.Category.Application/"]
COPY ["Services/CategoryApi/Planora.Category.Infrastructure/Planora.Category.Infrastructure.csproj", "Services/CategoryApi/Planora.Category.Infrastructure/"]
COPY ["Services/TodoApi/Planora.Todo.Domain/Planora.Todo.Domain.csproj", "Services/TodoApi/Planora.Todo.Domain/"]
COPY ["Services/TodoApi/Planora.Todo.Application/Planora.Todo.Application.csproj", "Services/TodoApi/Planora.Todo.Application/"]
COPY ["Services/TodoApi/Planora.Todo.Infrastructure/Planora.Todo.Infrastructure.csproj", "Services/TodoApi/Planora.Todo.Infrastructure/"]
COPY ["Services/MessagingApi/Planora.Messaging.Domain/Planora.Messaging.Domain.csproj", "Services/MessagingApi/Planora.Messaging.Domain/"]
COPY ["Services/MessagingApi/Planora.Messaging.Application/Planora.Messaging.Application.csproj", "Services/MessagingApi/Planora.Messaging.Application/"]
COPY ["Services/MessagingApi/Planora.Messaging.Infrastructure/Planora.Messaging.Infrastructure.csproj", "Services/MessagingApi/Planora.Messaging.Infrastructure/"]
COPY ["tools/Planora.Migrator/Planora.Migrator.csproj", "tools/Planora.Migrator/"]

RUN dotnet restore "tools/Planora.Migrator/Planora.Migrator.csproj"

COPY BuildingBlocks/ BuildingBlocks/
COPY GrpcContracts/ GrpcContracts/
COPY Services/AuthApi/ Services/AuthApi/
COPY Services/CategoryApi/ Services/CategoryApi/
COPY Services/TodoApi/ Services/TodoApi/
COPY Services/MessagingApi/ Services/MessagingApi/
COPY tools/Planora.Migrator/ tools/Planora.Migrator/

WORKDIR /src/tools/Planora.Migrator
RUN dotnet publish "Planora.Migrator.csproj" -c Release -o /app/publish --no-restore

# Minimal runtime — pure .NET runtime, no ASP.NET; this CLI never serves HTTP.
FROM mcr.microsoft.com/dotnet/runtime:10.0 AS final
WORKDIR /app
COPY --from=build /app/publish .

RUN groupadd -r appuser && useradd -r -g appuser appuser
RUN chown -R appuser:appuser /app
USER appuser

# This is a one-shot job container: it applies pending migrations and exits. A liveness
# HEALTHCHECK is meaningless for a process expected to terminate, so declare its absence
# explicitly (satisfies scanner DS-0026 and documents the intent for operators).
HEALTHCHECK NONE

ENTRYPOINT ["dotnet", "Planora.Migrator.dll"]
CMD ["--all"]
