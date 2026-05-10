// System

// MediatR

// EntityFrameworkCore
// BuildingBlocks
global using Planora.BuildingBlocks.Domain.Interfaces;
// Category Domain & Application
global using Planora.Todo.Domain.Entities;
global using Planora.Todo.Domain.Repositories;
// Category Infrastructure
global using Planora.Todo.Infrastructure.Persistence;
global using Planora.Todo.Infrastructure.Persistence.Repositories;
global using Microsoft.EntityFrameworkCore;
global using Microsoft.EntityFrameworkCore.Design;
global using Microsoft.EntityFrameworkCore.Metadata.Builders;
global using Microsoft.EntityFrameworkCore.Storage;
// PostgreSQL

// MassTransit

// Redis

// Grpc
global using Planora.GrpcContracts;

// Logging
global using Microsoft.Extensions.Logging;

// Configuration & DI
global using Microsoft.Extensions.Configuration;
global using Microsoft.Extensions.DependencyInjection;
