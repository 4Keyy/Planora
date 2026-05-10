using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Grpc.Core;
using Planora.BuildingBlocks.Infrastructure.Messaging;
using Planora.Todo.Api;
using Planora.Todo.Application.Interfaces;
using Planora.Todo.Application.Services;
using Planora.Todo.Infrastructure.Persistence;
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;

namespace Planora.ErrorHandlingTests.Integration;

/// <summary>
/// Test factory for TodoApi integration tests with support for:
/// - In-memory database for isolated tests
/// - Mocked external dependencies (gRPC, RabbitMQ, Redis)
/// - Simulation of infrastructure failures
/// - Test authentication tokens
/// - Gateway client creation
/// </summary>
public class TodoApiTestFactory : WebApplicationFactory<Program>
{
    private const string JwtSecret = "test_jwt_secret_value_which_is_long_enough_for_validation_123456";
    private const string JwtIssuer = "planora-test";
    private const string JwtAudience = "planora-test";
    private static readonly Guid TestUserId = Guid.Parse("11111111-1111-1111-1111-111111111111");

    private bool _databaseFailure;
    private bool _grpcTimeout;
    private bool _unhandledException;
    private bool _grpcNotFound;
    private bool _grpcValidationError;
    private bool _circuitBreakerOpen;

    public TodoApiTestFactory()
    {
        Environment.SetEnvironmentVariable("JwtSettings__Secret", JwtSecret);
        Environment.SetEnvironmentVariable("JwtSettings__Issuer", JwtIssuer);
        Environment.SetEnvironmentVariable("JwtSettings__Audience", JwtAudience);
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.ConfigureAppConfiguration((_, config) =>
        {
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["JwtSettings:Secret"] = JwtSecret,
                ["JwtSettings:Issuer"] = JwtIssuer,
                ["JwtSettings:Audience"] = JwtAudience,
            });
        });

        builder.ConfigureTestServices(services =>
        {
            services.PostConfigure<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme, options =>
            {
                options.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuer = true,
                    ValidateAudience = true,
                    ValidateLifetime = true,
                    ValidateIssuerSigningKey = true,
                    ValidIssuer = JwtIssuer,
                    ValidAudience = JwtAudience,
                    IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(JwtSecret)),
                    ClockSkew = TimeSpan.FromSeconds(30),
                };
            });

            // Replace production DbContext with in-memory database
            services.RemoveAll<DbContextOptions<TodoDbContext>>();
            services.RemoveAll<IDbContextOptionsConfiguration<TodoDbContext>>();

            services.AddDbContext<TodoDbContext>(options =>
            {
                options.UseInMemoryDatabase("TodoApiTestDb");
            });

            // Mock external gRPC clients
            services.AddScoped<ICategoryGrpcClient, MockCategoryGrpcClient>(sp =>
            {
                return new MockCategoryGrpcClient
                {
                    SimulateNotFound = _grpcNotFound,
                    SimulateValidationError = _grpcValidationError,
                    SimulateTimeout = _grpcTimeout
                };
            });
            services.RemoveAll<IFriendshipService>();
            services.AddScoped<IFriendshipService, MockFriendshipService>();

            // Mock RabbitMQ event bus
            services.AddScoped<IEventBus, MockEventBus>();

            // Mock Redis cache
            services.AddSingleton<IDistributedCache, MemoryDistributedCache>();

            // Add middleware for simulating failures
            if (_databaseFailure)
            {
                services.AddTransient<SimulateDatabaseFailureMiddleware>();
            }

            if (_unhandledException)
            {
                services.AddTransient<SimulateUnhandledExceptionMiddleware>();
            }
        });

        builder.ConfigureLogging(logging =>
        {
            logging.ClearProviders(); // Suppress logs in tests
        });

        builder.UseEnvironment("Testing");
    }

    /// <summary>
    /// Simulates database connection failure.
    /// </summary>
    public void SimulateDatabaseFailure(bool enable)
    {
        _databaseFailure = enable;
    }

    /// <summary>
    /// Simulates gRPC call timeout.
    /// </summary>
    public void SimulateGrpcTimeout(bool enable)
    {
        _grpcTimeout = enable;
    }

    /// <summary>
    /// Simulates unhandled exception in application code.
    /// </summary>
    public void SimulateUnhandledException(bool enable)
    {
        _unhandledException = enable;
    }

    /// <summary>
    /// Simulates gRPC NOT_FOUND error from CategoryService.
    /// </summary>
    public void SimulateGrpcNotFound(bool enable)
    {
        _grpcNotFound = enable;
    }

    /// <summary>
    /// Simulates gRPC INVALID_ARGUMENT (validation) error.
    /// </summary>
    public void SimulateGrpcValidationError(bool enable)
    {
        _grpcValidationError = enable;
    }

    /// <summary>
    /// Simulates circuit breaker opening (gateway).
    /// </summary>
    public void SimulateCircuitBreakerOpen(bool enable)
    {
        _circuitBreakerOpen = enable;
    }

    /// <summary>
    /// Creates HttpClient for direct TodoApi calls (bypassing gateway).
    /// </summary>
    public new HttpClient CreateClient()
    {
        var client = base.CreateClient();
        
        // Add default test authentication token
        client.DefaultRequestHeaders.Add("Authorization", $"Bearer {CreateTestJwt()}");
        
        return client;
    }

    /// <summary>
    /// Creates HttpClient configured to call through API Gateway.
    /// </summary>
    public HttpClient CreateGatewayClient()
    {
        // In real integration tests, this would point to actual gateway instance
        // For now, we simulate gateway behavior
        var client = CreateClient();
        client.BaseAddress = new Uri("http://localhost:5000/");
        
        return client;
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            try
            {
                using var scope = Services.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<TodoDbContext>();
                db.Database.EnsureDeleted();
            }
            catch (ObjectDisposedException)
            {
                // The WebApplicationFactory host can already be disposed during failed startup cleanup.
            }
        }

        base.Dispose(disposing);
    }

    private static string CreateTestJwt()
    {
        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, TestUserId.ToString()),
            new Claim(ClaimTypes.NameIdentifier, TestUserId.ToString()),
            new Claim(JwtRegisteredClaimNames.Email, "test@example.com"),
        };

        var credentials = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(JwtSecret)),
            SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            issuer: JwtIssuer,
            audience: JwtAudience,
            claims: claims,
            expires: DateTime.UtcNow.AddHours(1),
            signingCredentials: credentials);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}

/// <summary>
/// Middleware that simulates database failure.
/// </summary>
public class SimulateDatabaseFailureMiddleware : IMiddleware
{
    public async Task InvokeAsync(HttpContext context, RequestDelegate next)
    {
        throw new InvalidOperationException("Database connection failed");
    }
}

/// <summary>
/// Middleware that simulates unhandled exception.
/// </summary>
public class SimulateUnhandledExceptionMiddleware : IMiddleware
{
    public async Task InvokeAsync(HttpContext context, RequestDelegate next)
    {
        throw new InvalidOperationException("Unexpected system error");
    }
}

/// <summary>
/// Mock implementation of ICategoryGrpcClient for testing.
/// </summary>
public class MockCategoryGrpcClient : ICategoryGrpcClient
{
    public bool SimulateNotFound { get; set; }
    public bool SimulateValidationError { get; set; }
    public bool SimulateTimeout { get; set; }

    public Task<CategoryInfo?> GetCategoryInfoAsync(
        Guid categoryId,
        Guid userId,
        CancellationToken cancellationToken)
    {
        if (SimulateTimeout)
            throw new TimeoutException("gRPC call timed out");

        if (SimulateNotFound)
            throw new RpcException(new Status(StatusCode.NotFound, "Category not found"));

        if (SimulateValidationError)
            throw new RpcException(new Status(StatusCode.InvalidArgument, "Invalid category data"));

        // Return mock category
        return Task.FromResult<CategoryInfo?>(new CategoryInfo(
            categoryId,
            userId,
            "Test Category",
            "#3b82f6",
            "folder"));
    }
}

/// <summary>
/// Mock implementation of IFriendshipService for isolated TodoApi integration tests.
/// </summary>
public class MockFriendshipService : IFriendshipService
{
    public Task<IReadOnlyList<Guid>> GetFriendIdsAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        return Task.FromResult<IReadOnlyList<Guid>>(Array.Empty<Guid>());
    }

    public Task<bool> AreFriendsAsync(Guid userId1, Guid userId2, CancellationToken cancellationToken = default)
    {
        return Task.FromResult(false);
    }
}

/// <summary>
/// Mock implementation of IEventBus for testing.
/// </summary>
public class MockEventBus : IEventBus
{
    private readonly List<object> _publishedEvents = new();

    public Task PublishAsync<TEvent>(TEvent @event, CancellationToken cancellationToken = default)
        where TEvent : IntegrationEvent
    {
        _publishedEvents.Add(@event);
        return Task.CompletedTask;
    }

    public Task SubscribeAsync<TEvent, THandler>(CancellationToken cancellationToken = default)
        where TEvent : IntegrationEvent
        where THandler : IIntegrationEventHandler<TEvent>
    {
        return Task.CompletedTask;
    }

    public Task UnsubscribeAsync<TEvent, THandler>()
        where TEvent : IntegrationEvent
        where THandler : IIntegrationEventHandler<TEvent>
    {
        return Task.CompletedTask;
    }

    public IReadOnlyList<object> PublishedEvents => _publishedEvents.AsReadOnly();
}
