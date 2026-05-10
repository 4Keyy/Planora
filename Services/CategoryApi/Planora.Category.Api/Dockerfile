FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS base
WORKDIR /app
EXPOSE 80
EXPOSE 81

FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src

COPY ["Directory.Packages.props", "."]
COPY ["BuildingBlocks/Planora.BuildingBlocks.Application/Planora.BuildingBlocks.Application.csproj", "BuildingBlocks/Planora.BuildingBlocks.Application/"]
COPY ["BuildingBlocks/Planora.BuildingBlocks.Domain/Planora.BuildingBlocks.Domain.csproj", "BuildingBlocks/Planora.BuildingBlocks.Domain/"]
COPY ["BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Planora.BuildingBlocks.Infrastructure.csproj", "BuildingBlocks/Planora.BuildingBlocks.Infrastructure/"]
COPY ["GrpcContracts/GrpcContracts.csproj", "GrpcContracts/"]
COPY ["Services/CategoryApi/Planora.Category.Api/Planora.Category.Api.csproj", "Services/CategoryApi/Planora.Category.Api/"]
COPY ["Services/CategoryApi/Planora.Category.Application/Planora.Category.Application.csproj", "Services/CategoryApi/Planora.Category.Application/"]
COPY ["Services/CategoryApi/Planora.Category.Domain/Planora.Category.Domain.csproj", "Services/CategoryApi/Planora.Category.Domain/"]
COPY ["Services/CategoryApi/Planora.Category.Infrastructure/Planora.Category.Infrastructure.csproj", "Services/CategoryApi/Planora.Category.Infrastructure/"]

RUN dotnet restore "Services/CategoryApi/Planora.Category.Api/Planora.Category.Api.csproj"

COPY BuildingBlocks/ BuildingBlocks/
COPY GrpcContracts/ GrpcContracts/
COPY Services/CategoryApi/ Services/CategoryApi/

WORKDIR "/src/Services/CategoryApi/Planora.Category.Api"
RUN dotnet build "Planora.Category.Api.csproj" -c Release -o /app/build --no-restore

FROM build AS publish
RUN dotnet publish "Planora.Category.Api.csproj" -c Release -o /app/publish --no-restore

FROM base AS final
WORKDIR /app
COPY --from=publish /app/publish .

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
RUN groupadd -r appuser && useradd -r -g appuser appuser
RUN chown -R appuser:appuser /app
USER appuser

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:80/health || exit 1

ENTRYPOINT ["dotnet", "Planora.Category.Api.dll"]
