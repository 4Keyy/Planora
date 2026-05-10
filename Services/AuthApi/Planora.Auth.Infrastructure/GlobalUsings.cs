// System
// Grpc
global using Grpc.Core;
// Auth Application
global using Planora.Auth.Application.Common.Interfaces;
// Auth Domain
global using Planora.Auth.Domain.Entities;
global using Planora.Auth.Domain.Repositories;
global using Planora.Auth.Domain.ValueObjects;
// Auth Infrastructure
global using Planora.Auth.Infrastructure.Persistence;
global using Planora.Auth.Infrastructure.Persistence.Repositories;
// BuildingBlocks
global using Planora.BuildingBlocks.Domain.Interfaces;
global using Planora.BuildingBlocks.Infrastructure.Messaging;
global using Planora.BuildingBlocks.Infrastructure.Outbox;
// PostgreSQL

// MassTransit & RabbitMQ
global using MassTransit;
// ASP.NET Core
global using Microsoft.AspNetCore.Http;
// MediatR

// EntityFrameworkCore
global using Microsoft.EntityFrameworkCore;
global using Microsoft.EntityFrameworkCore.Design;
global using Microsoft.EntityFrameworkCore.Metadata.Builders;
global using Microsoft.EntityFrameworkCore.Storage;
// Redis
global using Microsoft.Extensions.Caching.Distributed;
// Configuration & DI
global using Microsoft.Extensions.Configuration;
global using Microsoft.Extensions.DependencyInjection;
global using Microsoft.Extensions.Logging;
global using Microsoft.Extensions.Options;
global using Microsoft.IdentityModel.Tokens;
global using StackExchange.Redis;
// JWT
global using System.IdentityModel.Tokens.Jwt;
global using System.Linq.Expressions;
global using System.Reflection;
global using System.Security.Claims;
global using System.Security.Cryptography;
global using System.Text;
