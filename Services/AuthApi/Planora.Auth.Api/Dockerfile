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

COPY ["Services/AuthApi/Planora.Auth.Api/Planora.Auth.Api.csproj", "Services/AuthApi/Planora.Auth.Api/"]
COPY ["Services/AuthApi/Planora.Auth.Application/Planora.Auth.Application.csproj", "Services/AuthApi/Planora.Auth.Application/"]
COPY ["Services/AuthApi/Planora.Auth.Domain/Planora.Auth.Domain.csproj", "Services/AuthApi/Planora.Auth.Domain/"]
COPY ["Services/AuthApi/Planora.Auth.Infrastructure/Planora.Auth.Infrastructure.csproj", "Services/AuthApi/Planora.Auth.Infrastructure/"]

RUN dotnet restore "Services/AuthApi/Planora.Auth.Api/Planora.Auth.Api.csproj"

COPY BuildingBlocks/ BuildingBlocks/
COPY GrpcContracts/ GrpcContracts/
COPY Services/AuthApi/ Services/AuthApi/

WORKDIR "/src/Services/AuthApi/Planora.Auth.Api"

RUN dotnet build "Planora.Auth.Api.csproj" -c Release -o /app/build --no-restore

FROM build AS publish
RUN dotnet publish "Planora.Auth.Api.csproj" -c Release -o /app/publish --no-restore

FROM base AS final
WORKDIR /app
COPY --from=publish /app/publish .

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

RUN groupadd -r appuser && useradd -r -g appuser appuser
RUN chown -R appuser:appuser /app
USER appuser

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
  CMD curl -f http://localhost:80/health || exit 1

ENTRYPOINT ["dotnet", "Planora.Auth.Api.dll"]
