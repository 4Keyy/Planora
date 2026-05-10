// System
global using System.Net;

// ASP.NET Core
global using Microsoft.AspNetCore.Http;
global using Microsoft.AspNetCore.Mvc;

// Authentication & Authorization
global using Microsoft.AspNetCore.Authorization;

// Configuration & DI
global using Microsoft.Extensions.Configuration;
global using Microsoft.Extensions.DependencyInjection;
global using Microsoft.Extensions.Hosting;
global using Microsoft.Extensions.Logging;

// Ocelot
global using Ocelot.DependencyInjection;
global using Ocelot.Middleware;

// Grpc
global using Grpc.Net.Client;
global using Grpc.Core;

// Health Checks
global using Microsoft.AspNetCore.Diagnostics.HealthChecks;

// OpenTelemetry
global using OpenTelemetry;

// Serilog
global using Serilog;
global using Serilog.Events;

// BuildingBlocks
global using Planora.BuildingBlocks.Infrastructure.Middleware;
