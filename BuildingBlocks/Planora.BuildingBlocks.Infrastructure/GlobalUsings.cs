// System
// MediatR

// EntityFrameworkCore

// PostgreSQL

// Caching

// Logging

// Configuration

// Serilog

// MassTransit & RabbitMQ

// OpenTelemetry

// Polly

// BuildingBlocks
global using Planora.BuildingBlocks.Domain.Interfaces;
global using Planora.BuildingBlocks.Infrastructure.Inbox;
global using Planora.BuildingBlocks.Infrastructure.Messaging;
global using System.Linq.Expressions;
global using System.Text;
global using System.Text.Json;
// Microsoft / ASP.NET
global using Microsoft.AspNetCore.Http;
global using Microsoft.AspNetCore.Builder;
global using MediatR;
global using Microsoft.Extensions.Logging;
global using Microsoft.Extensions.DependencyInjection;
global using Microsoft.Extensions.Configuration;
global using Microsoft.Extensions.Hosting;
global using Microsoft.Extensions.Caching.Distributed;
global using Microsoft.Extensions.Caching.Memory;
global using Microsoft.Extensions.Options;
global using Microsoft.Extensions.Diagnostics.HealthChecks;
global using Microsoft.EntityFrameworkCore;
global using Microsoft.Extensions.Resilience;

// RabbitMQ
global using RabbitMQ.Client;
global using RabbitMQ.Client.Events;
