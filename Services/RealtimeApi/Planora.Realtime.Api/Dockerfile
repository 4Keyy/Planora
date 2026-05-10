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
COPY ["Services/RealtimeApi/Planora.Realtime.Api/Planora.Realtime.Api.csproj", "Services/RealtimeApi/Planora.Realtime.Api/"]
COPY ["Services/RealtimeApi/Planora.Realtime.Application/Planora.Realtime.Application.csproj", "Services/RealtimeApi/Planora.Realtime.Application/"]
COPY ["Services/RealtimeApi/Planora.Realtime.Domain/Planora.Realtime.Domain.csproj", "Services/RealtimeApi/Planora.Realtime.Domain/"]
COPY ["Services/RealtimeApi/Planora.Realtime.Infrastructure/Planora.Realtime.Infrastructure.csproj", "Services/RealtimeApi/Planora.Realtime.Infrastructure/"]
COPY ["Services/MessagingApi/Planora.Messaging.Domain/Planora.Messaging.Domain.csproj", "Services/MessagingApi/Planora.Messaging.Domain/"]

RUN dotnet restore "Services/RealtimeApi/Planora.Realtime.Api/Planora.Realtime.Api.csproj"

COPY BuildingBlocks/ BuildingBlocks/
COPY GrpcContracts/ GrpcContracts/
COPY Services/RealtimeApi/ Services/RealtimeApi/
COPY Services/MessagingApi/Planora.Messaging.Domain/ Services/MessagingApi/Planora.Messaging.Domain/

WORKDIR "/src/Services/RealtimeApi/Planora.Realtime.Api"
RUN dotnet build "Planora.Realtime.Api.csproj" -c Release -o /app/build --no-restore

FROM build AS publish
RUN dotnet publish "Planora.Realtime.Api.csproj" -c Release -o /app/publish --no-restore

FROM base AS final
WORKDIR /app
COPY --from=publish /app/publish .

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

RUN groupadd -r appuser && useradd -r -g appuser appuser
RUN chown -R appuser:appuser /app
USER appuser

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:80/health || exit 1

ENTRYPOINT ["dotnet", "Planora.Realtime.Api.dll"]
