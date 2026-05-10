// System
// Grpc

// Health Checks
global using Planora.Auth.Application.Common.DTOs;
// Auth Domain

// Auth Application
global using Planora.Auth.Application.Common.Interfaces;
global using Planora.Auth.Application.Features.Authentication.Commands.Login;
global using Planora.Auth.Application.Features.Authentication.Commands.Logout;
global using Planora.Auth.Application.Features.Authentication.Commands.RefreshToken;
global using Planora.Auth.Application.Features.Authentication.Commands.Register;
global using Planora.Auth.Application.Features.Authentication.Queries.ValidateToken;
// Auth Infrastructure
global using Planora.Auth.Infrastructure;
// BuildingBlocks
global using Planora.BuildingBlocks.Infrastructure.Middleware;
// MediatR
global using MediatR;
// Authentication & Authorization
global using Microsoft.AspNetCore.Authentication.JwtBearer;
global using Microsoft.AspNetCore.Authorization;
global using Microsoft.AspNetCore.Diagnostics.HealthChecks;
// ASP.NET Core
global using Microsoft.AspNetCore.Mvc;
// OpenTelemetry
global using OpenTelemetry;
global using OpenTelemetry.Resources;
global using OpenTelemetry.Trace;
// FluentValidation

// Swagger

// Configuration & DI

// Serilog
global using Serilog;
global using Serilog.Events;
global using System.Text;
