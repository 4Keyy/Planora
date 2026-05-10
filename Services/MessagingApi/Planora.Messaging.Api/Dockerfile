FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS base
WORKDIR /app
EXPOSE 80

FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src

COPY ["Directory.Packages.props", "."]
COPY ["BuildingBlocks/Planora.BuildingBlocks.Application/Planora.BuildingBlocks.Application.csproj", "BuildingBlocks/Planora.BuildingBlocks.Application/"]
COPY ["BuildingBlocks/Planora.BuildingBlocks.Domain/Planora.BuildingBlocks.Domain.csproj", "BuildingBlocks/Planora.BuildingBlocks.Domain/"]
COPY ["BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Planora.BuildingBlocks.Infrastructure.csproj", "BuildingBlocks/Planora.BuildingBlocks.Infrastructure/"]
COPY ["GrpcContracts/GrpcContracts.csproj", "GrpcContracts/"]
COPY ["Services/MessagingApi/Planora.Messaging.Api/Planora.Messaging.Api.csproj", "Services/MessagingApi/Planora.Messaging.Api/"]
COPY ["Services/MessagingApi/Planora.Messaging.Application/Planora.Messaging.Application.csproj", "Services/MessagingApi/Planora.Messaging.Application/"]
COPY ["Services/MessagingApi/Planora.Messaging.Domain/Planora.Messaging.Domain.csproj", "Services/MessagingApi/Planora.Messaging.Domain/"]
COPY ["Services/MessagingApi/Planora.Messaging.Infrastructure/Planora.Messaging.Infrastructure.csproj", "Services/MessagingApi/Planora.Messaging.Infrastructure/"]
COPY ["Services/AuthApi/Planora.Auth.Application/Planora.Auth.Application.csproj", "Services/AuthApi/Planora.Auth.Application/"]
COPY ["Services/AuthApi/Planora.Auth.Domain/Planora.Auth.Domain.csproj", "Services/AuthApi/Planora.Auth.Domain/"]

RUN dotnet restore "Services/MessagingApi/Planora.Messaging.Api/Planora.Messaging.Api.csproj"

COPY BuildingBlocks/ BuildingBlocks/
COPY GrpcContracts/ GrpcContracts/
COPY Services/MessagingApi/ Services/MessagingApi/
COPY Services/AuthApi/Planora.Auth.Application/ Services/AuthApi/Planora.Auth.Application/
COPY Services/AuthApi/Planora.Auth.Domain/ Services/AuthApi/Planora.Auth.Domain/

WORKDIR "/src/Services/MessagingApi/Planora.Messaging.Api"
RUN dotnet build "Planora.Messaging.Api.csproj" -c Release -o /app/build --no-restore

FROM build AS publish
RUN dotnet publish "Planora.Messaging.Api.csproj" -c Release -o /app/publish --no-restore

FROM base AS final
WORKDIR /app
COPY --from=publish /app/publish .

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

RUN groupadd -r appuser && useradd -r -g appuser appuser
RUN chown -R appuser:appuser /app
USER appuser

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:80/health || exit 1

ENTRYPOINT ["dotnet", "Planora.Messaging.Api.dll"]
