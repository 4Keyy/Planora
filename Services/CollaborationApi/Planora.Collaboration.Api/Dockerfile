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
COPY ["Services/CollaborationApi/Planora.Collaboration.Api/Planora.Collaboration.Api.csproj", "Services/CollaborationApi/Planora.Collaboration.Api/"]
COPY ["Services/CollaborationApi/Planora.Collaboration.Application/Planora.Collaboration.Application.csproj", "Services/CollaborationApi/Planora.Collaboration.Application/"]
COPY ["Services/CollaborationApi/Planora.Collaboration.Domain/Planora.Collaboration.Domain.csproj", "Services/CollaborationApi/Planora.Collaboration.Domain/"]
COPY ["Services/CollaborationApi/Planora.Collaboration.Infrastructure/Planora.Collaboration.Infrastructure.csproj", "Services/CollaborationApi/Planora.Collaboration.Infrastructure/"]

RUN dotnet restore "Services/CollaborationApi/Planora.Collaboration.Api/Planora.Collaboration.Api.csproj"

COPY BuildingBlocks/ BuildingBlocks/
COPY GrpcContracts/ GrpcContracts/
COPY Services/CollaborationApi/ Services/CollaborationApi/

WORKDIR "/src/Services/CollaborationApi/Planora.Collaboration.Api"
RUN dotnet build "Planora.Collaboration.Api.csproj" -c Release -o /app/build --no-restore

FROM build AS publish
RUN dotnet publish "Planora.Collaboration.Api.csproj" -c Release -o /app/publish --no-restore

FROM base AS final
WORKDIR /app
COPY --from=publish /app/publish .

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
RUN groupadd -r appuser && useradd -r -g appuser appuser
RUN chown -R appuser:appuser /app
USER appuser

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:80/health || exit 1

ENTRYPOINT ["dotnet", "Planora.Collaboration.Api.dll"]
