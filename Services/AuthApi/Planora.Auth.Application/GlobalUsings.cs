// System

// MediatR
// AutoMapper
global using AutoMapper;
// FluentValidation
global using FluentValidation;
global using Planora.Auth.Application.Common.DTOs;
// Auth Application
global using Planora.Auth.Application.Common.Interfaces;
// Auth Domain
global using Planora.Auth.Domain.Entities;
global using Planora.Auth.Domain.Repositories;
global using Planora.Auth.Domain.ValueObjects;
global using Planora.BuildingBlocks.Application.Behaviors;
// BuildingBlocks
global using Planora.BuildingBlocks.Application.CQRS;
global using Planora.BuildingBlocks.Application.Models;
global using MediatR;
// Dependency Injection
global using Microsoft.Extensions.DependencyInjection;
// Logging
global using Microsoft.Extensions.Logging;
// JWT & Security
global using System.Security.Claims;
