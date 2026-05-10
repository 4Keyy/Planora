using AutoMapper;
using FluentValidation;
using Grpc.AspNetCore.Server;
using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Application.Common.Options;
using Planora.Auth.Application.Features.Authentication.Commands.ResetPassword;
using Planora.Auth.Application.Features.Authentication.Validators.ResetPassword;
using Planora.Auth.Infrastructure;
using Planora.Auth.Infrastructure.Persistence;
using Planora.Auth.Infrastructure.Persistence.Repositories;
using Planora.Auth.Infrastructure.Services.Authentication;
using Planora.Auth.Infrastructure.Services.Common;
using Planora.Auth.Infrastructure.Services.Messaging;
using Planora.Auth.Infrastructure.Services.Security;
using Planora.Auth.Infrastructure.Security;
using Planora.Auth.Domain.Repositories;
using Planora.BuildingBlocks.Application.Behaviors;
using Planora.BuildingBlocks.Application.Services;
using Planora.BuildingBlocks.Infrastructure.Context;
using Planora.BuildingBlocks.Infrastructure.Messaging;
using Planora.BuildingBlocks.Infrastructure.Outbox;
using Planora.BuildingBlocks.Infrastructure.Persistence;
using Planora.BuildingBlocks.Infrastructure.Services;
using Planora.Category.Domain.Repositories;
using Planora.Category.Infrastructure;
using Planora.Category.Infrastructure.Persistence;
using Planora.Category.Infrastructure.Persistence.Repositories;
using Planora.Realtime.Application.Interfaces;
using Planora.Realtime.Infrastructure.Services;
using Planora.Todo.Application.Interfaces;
using Planora.Todo.Application.Services;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Domain.Repositories;
using Planora.Todo.Infrastructure;
using Planora.Todo.Infrastructure.Persistence;
using Planora.Todo.Infrastructure.Persistence.Repositories;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Caching.StackExchangeRedis;
using Microsoft.Extensions.Options;
using StackExchange.Redis;
using AuthCurrentUserService = Planora.Auth.Application.Common.Interfaces.ICurrentUserService;
using AuthCurrentUserServiceImpl = Planora.Auth.Infrastructure.Services.Common.CurrentUserService;
using AuthDateTimeService = Planora.Auth.Application.Common.Interfaces.IDateTime;
using AuthDomainEventDispatcher = Planora.BuildingBlocks.Infrastructure.Messaging.IDomainEventDispatcher;
using AuthUnitOfWork = Planora.Auth.Domain.Repositories.IAuthUnitOfWork;
using AuthUnitOfWorkImpl = Planora.Auth.Infrastructure.Persistence.AuthUnitOfWork;
using CategoryEntity = Planora.Category.Domain.Entities.Category;
using CategoryUserDeletedEventConsumer = Planora.Category.Application.Features.IntegrationEvents.UserDeletedEventConsumer;
using CategoryCurrentUserServiceImpl = Planora.BuildingBlocks.Infrastructure.Persistence.CurrentUserService;
using CategoryOutboxRepository = Planora.Category.Infrastructure.Persistence.Repositories.OutboxRepository;
using CategoryRepositoryInterface = Planora.BuildingBlocks.Domain.Interfaces.IRepository<Planora.Category.Domain.Entities.Category>;
using GenericTodoRepository = Planora.BuildingBlocks.Domain.Interfaces.IRepository<Planora.Todo.Domain.Entities.TodoItem>;
using MediatR;
using Moq;
using RealtimeDependencyInjection = Planora.Realtime.Infrastructure.DependencyInjection;
using TodoCurrentUserContext = Planora.BuildingBlocks.Infrastructure.Context.ICurrentUserContext;
using TodoCurrentUserContextImpl = Planora.BuildingBlocks.Infrastructure.Context.CurrentUserContext;
using TodoCategoryDeletedEventHandler = Planora.Todo.Application.Features.Todos.Events.CategoryDeletedEventHandler;
using TodoUnitOfWork = Planora.BuildingBlocks.Domain.Interfaces.IUnitOfWork;
using TodoUnitOfWorkImpl = Planora.Todo.Infrastructure.Persistence.Repositories.TodoUnitOfWork;
using TodoUserDeletedEventConsumer = Planora.Todo.Application.Features.IntegrationEvents.UserDeletedEventConsumer;

namespace Planora.UnitTests.Services.Infrastructure;

public class DependencyInjectionContractTests
{
    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Security")]
    public void AddAuthInfrastructure_ShouldRegisterSecurityPersistenceMessagingAndHealthServices()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton(Mock.Of<AuthDomainEventDispatcher>());

        services.AddAuthInfrastructure(CreateConfiguration(new Dictionary<string, string?>
        {
            ["ConnectionStrings:AuthDatabase"] = "Host=postgres;Port=5432;Database=auth;Username=postgres;Password=secret",
            ["ConnectionStrings:Redis"] = "redis:6379,password=secret,abortConnect=false",
            ["JwtSettings:Secret"] = new string('a', 48),
            ["JwtSettings:Issuer"] = "Planora.Auth",
            ["JwtSettings:Audience"] = "Planora.Clients",
            ["Grpc:EnableDetailedErrors"] = "true",
            ["IsDevelopment"] = "true",
            ["Frontend:BaseUrl"] = "http://localhost:3000",
            ["RabbitMq:HostName"] = "rabbitmq",
            ["RabbitMq:UserName"] = "guest",
            ["RabbitMq:Password"] = "guest"
        }));

        Assert.Contains(services, descriptor => descriptor.ServiceType == typeof(AuthDbContext));
        AssertScoped<AuthUnitOfWork, AuthUnitOfWorkImpl>(services);
        AssertScoped<IUserRepository, UserRepository>(services);
        AssertScoped<IFriendshipRepository, FriendshipRepository>(services);
        AssertScoped<IRefreshTokenRepository, RefreshTokenRepository>(services);
        AssertScoped<ILoginHistoryRepository, LoginHistoryRepository>(services);
        AssertScoped<IPasswordHistoryRepository, PasswordHistoryRepository>(services);
        AssertScoped<ITokenService, TokenService>(services);
        AssertScoped<IPasswordHasher, PasswordHasher>(services);
        AssertScoped<IPasswordValidator, PasswordValidator>(services);
        AssertScoped<ITwoFactorService, TwoFactorService>(services);
        AssertScoped<ITokenBlacklistService, TokenBlacklistService>(services);
        AssertScoped<AuthCurrentUserService, AuthCurrentUserServiceImpl>(services);
        AssertScoped<AuthDateTimeService, DateTimeService>(services);
        AssertScoped<IEmailService, EmailService>(services);
        AssertScoped<IEmailMessageSender, SmtpEmailMessageSender>(services);
        Assert.Contains(services, descriptor => descriptor.ServiceType == typeof(IConnectionMultiplexer)
            && descriptor.Lifetime == ServiceLifetime.Singleton);
        Assert.Contains(services, descriptor => descriptor.ServiceType == typeof(IHostedService)
            && descriptor.ImplementationType == typeof(RabbitMqStartupHostedService));

        using var provider = services.BuildServiceProvider();
        var frontendOptions = provider.GetRequiredService<Microsoft.Extensions.Options.IOptions<FrontendOptions>>().Value;
        Assert.Equal("http://localhost:3000", frontendOptions.BaseUrl);
        var emailOptions = provider.GetRequiredService<IOptions<EmailOptions>>().Value;
        Assert.Equal(EmailOptions.LogProvider, emailOptions.Provider);
        Assert.Equal("smtp.gmail.com", emailOptions.SmtpHost);
        Assert.Same(
            provider.GetRequiredService<AuthDbContext>(),
            provider.GetRequiredService<IApplicationDbContext>());

        var redisOptions = provider.GetRequiredService<IOptions<RedisCacheOptions>>().Value;
        Assert.Equal("redis:6379,password=secret,abortConnect=false", redisOptions.Configuration);
        Assert.Equal("PlanoraAuth:TokenBlacklist:", redisOptions.InstanceName);

        var grpcOptions = provider.GetRequiredService<IOptions<GrpcServiceOptions>>().Value;
        Assert.True(grpcOptions.EnableDetailedErrors);
        Assert.Equal(4 * 1024 * 1024, grpcOptions.MaxReceiveMessageSize);
        Assert.Equal(4 * 1024 * 1024, grpcOptions.MaxSendMessageSize);

        var authenticationOptions = provider.GetRequiredService<IOptions<AuthenticationOptions>>().Value;
        Assert.Equal(JwtBearerDefaults.AuthenticationScheme, authenticationOptions.DefaultAuthenticateScheme);
        Assert.Equal(JwtBearerDefaults.AuthenticationScheme, authenticationOptions.DefaultChallengeScheme);

        var jwtOptions = provider.GetRequiredService<IOptionsMonitor<JwtBearerOptions>>()
            .Get(JwtBearerDefaults.AuthenticationScheme);
        Assert.True(jwtOptions.SaveToken);
        Assert.False(jwtOptions.RequireHttpsMetadata);
        Assert.True(jwtOptions.TokenValidationParameters.ValidateIssuerSigningKey);
        Assert.Equal("Planora.Auth", jwtOptions.TokenValidationParameters.ValidIssuer);
        Assert.Equal("Planora.Clients", jwtOptions.TokenValidationParameters.ValidAudience);
        Assert.Equal(TimeSpan.FromMinutes(5), jwtOptions.TokenValidationParameters.ClockSkew);
        Assert.IsType<RabbitMqConnectionManager>(provider.GetRequiredService<IRabbitMqConnectionManager>());
    }

    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public void AddAuthInfrastructure_ShouldFailFastWhenAuthDatabaseConnectionIsMissing()
    {
        var services = new ServiceCollection();

        var exception = Assert.Throws<InvalidOperationException>(() =>
            services.AddAuthInfrastructure(CreateConfiguration(new Dictionary<string, string?>
            {
                ["ConnectionStrings:Redis"] = "redis:6379,password=secret,abortConnect=false",
                ["JwtSettings:Secret"] = new string('a', 48),
                ["JwtSettings:Issuer"] = "Planora.Auth",
                ["JwtSettings:Audience"] = "Planora.Clients"
            })));

        Assert.Contains("AuthDatabase", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Resilience")]
    [Trait("TestType", "Regression")]
    public void AddAuthInfrastructure_RedisFactory_ShouldReturnDisconnectedMultiplexer_WhenLoopbackRedisIsUnavailable()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton(Mock.Of<AuthDomainEventDispatcher>());

        services.AddAuthInfrastructure(CreateConfiguration(new Dictionary<string, string?>
        {
            ["ConnectionStrings:AuthDatabase"] = "Host=postgres;Port=5432;Database=auth;Username=postgres;Password=secret",
            ["ConnectionStrings:Redis"] = "127.0.0.1:1,abortConnect=false,connectRetry=0,connectTimeout=250,syncTimeout=250",
            ["JwtSettings:Secret"] = new string('a', 48),
            ["JwtSettings:Issuer"] = "Planora.Auth",
            ["JwtSettings:Audience"] = "Planora.Clients",
            ["RabbitMq:HostName"] = "rabbitmq",
            ["RabbitMq:UserName"] = "guest",
            ["RabbitMq:Password"] = "guest"
        }));

        using var provider = services.BuildServiceProvider();
        var elapsed = System.Diagnostics.Stopwatch.StartNew();
        var multiplexer = provider.GetRequiredService<IConnectionMultiplexer>();

        Assert.False(multiplexer.IsConnected);
        Assert.True(elapsed.Elapsed < TimeSpan.FromSeconds(10));
    }

    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Module")]
    public void AddTodoInfrastructure_ShouldRegisterRepositoriesCurrentUserAndGrpcClients()
    {
        var services = new ServiceCollection();

        services.AddTodoInfrastructure(CreateConfiguration(new Dictionary<string, string?>
        {
            ["ConnectionStrings:TodoDatabase"] = "Host=postgres;Port=5432;Database=todo;Username=postgres;Password=secret",
            ["GrpcServices:AuthApi"] = "http://auth-api:80",
            ["GrpcServices:CategoryApi"] = "http://category-api:81"
        }));

        Assert.Contains(services, descriptor => descriptor.ServiceType == typeof(TodoDbContext));
        AssertScoped<TodoUnitOfWork, TodoUnitOfWorkImpl>(services);
        AssertScoped<ITodoRepository, TodoRepository>(services);
        AssertScoped<GenericTodoRepository, TodoRepository>(services);
        AssertScoped<IUserTodoViewPreferenceRepository, UserTodoViewPreferenceRepository>(services);
        AssertScoped<TodoCurrentUserContext, TodoCurrentUserContextImpl>(services);
        AssertScoped<IFriendshipService, Planora.Todo.Infrastructure.Services.FriendshipGrpcService>(services);
        AssertScoped<ICategoryGrpcClient, Planora.Todo.Infrastructure.Grpc.CategoryGrpcClient>(services);

        using var provider = services.BuildServiceProvider();
        Assert.NotNull(provider.GetRequiredService<DbContextOptions<TodoDbContext>>());
        var context = provider.GetRequiredService<TodoDbContext>();
        Assert.NotNull(context);
        Assert.NotNull(context.TodoItemShares);
    }

    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Module")]
    public void AddCategoryInfrastructure_ShouldRegisterRepositoryUnitOfWorkOutboxAndCurrentUser()
    {
        var services = new ServiceCollection();
        services.AddSingleton(Mock.Of<Planora.BuildingBlocks.Infrastructure.IDomainEventDispatcher>());

        services.AddCategoryInfrastructure(CreateConfiguration(new Dictionary<string, string?>
        {
            ["ConnectionStrings:CategoryDatabase"] = "Host=postgres;Port=5432;Database=category;Username=postgres;Password=secret"
        }));

        Assert.Contains(services, descriptor => descriptor.ServiceType == typeof(CategoryDbContext));
        Assert.Contains(services, descriptor => descriptor.ServiceType == typeof(DbContext)
            && descriptor.Lifetime == ServiceLifetime.Scoped);
        AssertScoped<ICategoryRepository, CategoryRepository>(services);
        AssertScoped<CategoryRepositoryInterface, CategoryRepository>(services);
        AssertScoped<Planora.BuildingBlocks.Domain.Interfaces.IUnitOfWork, UnitOfWork>(services);
        AssertScoped<IOutboxRepository, CategoryOutboxRepository>(services);
        AssertScoped<Planora.BuildingBlocks.Infrastructure.Persistence.ICurrentUserService, CategoryCurrentUserServiceImpl>(services);
        Assert.Contains(services, descriptor => descriptor.ServiceType == typeof(IHostedService)
            && descriptor.ImplementationType == typeof(OutboxProcessor));

        using var provider = services.BuildServiceProvider();
        Assert.NotNull(provider.GetRequiredService<DbContextOptions<CategoryDbContext>>());
        Assert.NotNull(provider.GetRequiredService<CategoryDbContext>());
    }

    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Module")]
    public void ApplicationDependencyInjection_ShouldRegisterMediatRPipelinesValidatorsMapperAndBusinessServices()
    {
        var authServices = new ServiceCollection();
        Planora.Auth.Application.DependencyInjection.AddAuthApplication(authServices);
        AssertApplicationPipeline(authServices);
        AssertScoped<IBusinessEventLogger, BusinessEventLogger>(authServices);
        Assert.Contains(authServices, descriptor => descriptor.ServiceType == typeof(IValidator<ResetPasswordCommand>)
            && descriptor.ImplementationType == typeof(ResetPasswordCommandValidator));
        Assert.Contains(authServices, descriptor => descriptor.ServiceType == typeof(IMapper));

        var todoServices = new ServiceCollection();
        Planora.Todo.Application.DependencyInjection.AddTodoApplication(todoServices);
        AssertApplicationPipeline(todoServices);
        AssertScoped<TodoCategoryDeletedEventHandler, TodoCategoryDeletedEventHandler>(todoServices);
        AssertScoped<TodoUserDeletedEventConsumer, TodoUserDeletedEventConsumer>(todoServices);
        AssertScoped<IBusinessEventLogger, BusinessEventLogger>(todoServices);
        Assert.Contains(todoServices, descriptor => descriptor.ServiceType == typeof(IMapper));

        var categoryServices = new ServiceCollection();
        Planora.Category.Application.DependencyInjection.AddCategoryApplication(categoryServices);
        AssertApplicationPipeline(categoryServices);
        AssertScoped<CategoryUserDeletedEventConsumer, CategoryUserDeletedEventConsumer>(categoryServices);
        AssertScoped<IBusinessEventLogger, BusinessEventLogger>(categoryServices);
        Assert.Contains(categoryServices, descriptor => descriptor.ServiceType == typeof(IMapper));

        var messagingServices = new ServiceCollection();
        Planora.Messaging.Application.DependencyInjection.AddMessagingApplication(messagingServices);
        AssertApplicationPipeline(messagingServices);
        AssertScoped<IBusinessEventLogger, BusinessEventLogger>(messagingServices);
        Assert.Contains(messagingServices, descriptor => descriptor.ServiceType == typeof(IMapper));
    }

    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Module")]
    public void AddRealtimeInfrastructure_ShouldRegisterConnectionNotificationAndEventBusSingletons()
    {
        var services = new ServiceCollection();
        services.AddLogging();

        RealtimeDependencyInjection.AddRealtimeInfrastructure(
            services,
            CreateConfiguration(new Dictionary<string, string?>
            {
                ["RabbitMq:HostName"] = "rabbitmq",
                ["RabbitMq:UserName"] = "guest",
                ["RabbitMq:Password"] = "guest"
            }));

        AssertSingleton<IConnectionManager, ConnectionManager>(services);
        AssertSingleton<INotificationService, NotificationService>(services);
        Assert.Contains(services, descriptor => descriptor.ServiceType == typeof(IRabbitMqConnectionManager)
            && descriptor.Lifetime == ServiceLifetime.Singleton);
        Assert.Contains(services, descriptor => descriptor.ServiceType == typeof(IEventBus)
            && descriptor.Lifetime == ServiceLifetime.Singleton);

        using var provider = services.BuildServiceProvider();
        Assert.IsType<RabbitMqConnectionManager>(provider.GetRequiredService<IRabbitMqConnectionManager>());
        Assert.IsType<RabbitMqEventBus>(provider.GetRequiredService<IEventBus>());
    }

    private static IConfiguration CreateConfiguration(Dictionary<string, string?> values)
    {
        return new ConfigurationBuilder()
            .AddInMemoryCollection(values)
            .Build();
    }

    private static void AssertScoped<TService, TImplementation>(IServiceCollection services)
    {
        Assert.Contains(services, descriptor => descriptor.ServiceType == typeof(TService)
            && descriptor.ImplementationType == typeof(TImplementation)
            && descriptor.Lifetime == ServiceLifetime.Scoped);
    }

    private static void AssertSingleton<TService, TImplementation>(IServiceCollection services)
    {
        Assert.Contains(services, descriptor => descriptor.ServiceType == typeof(TService)
            && descriptor.ImplementationType == typeof(TImplementation)
            && descriptor.Lifetime == ServiceLifetime.Singleton);
    }

    private static void AssertApplicationPipeline(IServiceCollection services)
    {
        Assert.Contains(services, descriptor => descriptor.ServiceType == typeof(IPipelineBehavior<,>)
            && descriptor.ImplementationType == typeof(UnhandledExceptionBehavior<,>));
        Assert.Contains(services, descriptor => descriptor.ServiceType == typeof(IPipelineBehavior<,>)
            && descriptor.ImplementationType == typeof(LoggingBehavior<,>));
        Assert.Contains(services, descriptor => descriptor.ServiceType == typeof(IPipelineBehavior<,>)
            && descriptor.ImplementationType == typeof(ValidationBehavior<,>));
        Assert.Contains(services, descriptor => descriptor.ServiceType == typeof(IPipelineBehavior<,>)
            && descriptor.ImplementationType == typeof(PerformanceBehavior<,>));
    }
}
