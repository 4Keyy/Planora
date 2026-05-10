using Planora.ApiGateway.Services;
using Planora.ApiGateway.DelegatingHandlers;
using Microsoft.Extensions.Http;
using Polly;
using Polly.Extensions.Http;
using Grpc.Net.Client;
using Grpc.Net.ClientFactory;

namespace Planora.ApiGateway.Extensions;

public static class ServiceCollectionExtensions
{
    private static IAsyncPolicy<HttpResponseMessage> GetCircuitBreakerPolicy()
    {
        return HttpPolicyExtensions
            .HandleTransientHttpError()
            .CircuitBreakerAsync(5, TimeSpan.FromSeconds(30));
    }

    public static IServiceCollection AddApiGatewayServices(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        // HTTP Context Accessor for correlation ID propagation
        services.AddHttpContextAccessor();

        // Register CircuitBreakerDelegatingHandler for handling circuit breaker exceptions
        services.AddTransient<CircuitBreakerDelegatingHandler>();

        // HTTP Client factory (correlation ID handler will be added per-client as needed)
        services.AddHttpClient();

        // gRPC Client with retry and timeout policies
        services.AddGrpcClient<GrpcContracts.AuthService.AuthServiceClient>(options =>
        {
            var authUrl = configuration["Services:Auth:Url"] ?? "http://auth-api:5006";
            options.Address = new Uri(authUrl);
        })
        .AddHttpMessageHandler<CircuitBreakerDelegatingHandler>()
        .AddPolicyHandler(GetCircuitBreakerPolicy())
        .AddCallCredentials((context, metadata, serviceProvider) =>
        {
            // Add correlation ID to metadata
            var httpContextAccessor = serviceProvider.GetRequiredService<IHttpContextAccessor>();
            var httpContext = httpContextAccessor.HttpContext;
            if (httpContext != null)
            {
                var correlationId = httpContext.Items["X-Correlation-ID"]?.ToString() ??
                                   httpContext.Request.Headers["X-Correlation-ID"].ToString();
                if (!string.IsNullOrWhiteSpace(correlationId))
                {
                    metadata.Add("X-Correlation-ID", correlationId);
                }
            }
            return Task.CompletedTask;
        })
        .ConfigureChannel(options =>
        {
            options.MaxReceiveMessageSize = 4 * 1024 * 1024; // 4 MB
            options.MaxSendMessageSize = 4 * 1024 * 1024; // 4 MB
            options.ServiceConfig = new Grpc.Net.Client.Configuration.ServiceConfig
            {
                MethodConfigs =
                {
                    new Grpc.Net.Client.Configuration.MethodConfig
                    {
                        Names = { Grpc.Net.Client.Configuration.MethodName.Default },
                        RetryPolicy = new Grpc.Net.Client.Configuration.RetryPolicy
                        {
                            MaxAttempts = 5,
                            InitialBackoff = TimeSpan.FromSeconds(1),
                            MaxBackoff = TimeSpan.FromSeconds(5),
                            BackoffMultiplier = 1.5,
                            RetryableStatusCodes = { Grpc.Core.StatusCode.Unavailable, Grpc.Core.StatusCode.DeadlineExceeded }
                        }
                    }
                }
            };
        });

        // Add Category Service Client
        services.AddGrpcClient<GrpcContracts.CategoryService.CategoryServiceClient>(options =>
        {
            var categoryUrl = configuration["Services:Category:Url"] ?? "http://category-api:5281";
            options.Address = new Uri(categoryUrl);
        })
        .AddHttpMessageHandler<CircuitBreakerDelegatingHandler>()
        .AddPolicyHandler(GetCircuitBreakerPolicy())
        .ConfigureChannel(options =>
        {
            options.ServiceConfig = new Grpc.Net.Client.Configuration.ServiceConfig
            {
                MethodConfigs =
                 {
                     new Grpc.Net.Client.Configuration.MethodConfig
                     {
                         Names = { Grpc.Net.Client.Configuration.MethodName.Default },
                         RetryPolicy = new Grpc.Net.Client.Configuration.RetryPolicy
                         {
                             MaxAttempts = 5,
                             InitialBackoff = TimeSpan.FromSeconds(1),
                             MaxBackoff = TimeSpan.FromSeconds(5),
                             BackoffMultiplier = 1.5,
                             RetryableStatusCodes = { Grpc.Core.StatusCode.Unavailable, Grpc.Core.StatusCode.DeadlineExceeded }
                         }
                     }
                 }
            };
        });

        // Add Todo Service Client
        services.AddGrpcClient<GrpcContracts.TodoService.TodoServiceClient>(options =>
        {
            var todoUrl = configuration["Services:Todo:Url"] ?? "http://todo-api:5100";
            options.Address = new Uri(todoUrl);
        })
        .AddHttpMessageHandler<CircuitBreakerDelegatingHandler>()
        .AddPolicyHandler(GetCircuitBreakerPolicy())
        .ConfigureChannel(options =>
        {
            options.ServiceConfig = new Grpc.Net.Client.Configuration.ServiceConfig
            {
                MethodConfigs =
                 {
                     new Grpc.Net.Client.Configuration.MethodConfig
                     {
                         Names = { Grpc.Net.Client.Configuration.MethodName.Default },
                         RetryPolicy = new Grpc.Net.Client.Configuration.RetryPolicy
                         {
                             MaxAttempts = 5,
                             InitialBackoff = TimeSpan.FromSeconds(1),
                             MaxBackoff = TimeSpan.FromSeconds(5),
                             BackoffMultiplier = 1.5,
                             RetryableStatusCodes = { Grpc.Core.StatusCode.Unavailable, Grpc.Core.StatusCode.DeadlineExceeded }
                         }
                     }
                 }
            };
        });

        // Add Messaging Service Client
        services.AddGrpcClient<GrpcContracts.MessagingService.MessagingServiceClient>(options =>
        {
            var messagingUrl = configuration["Services:Messaging:Url"] ?? "http://messaging-api:5058";
            options.Address = new Uri(messagingUrl);
        })
        .AddHttpMessageHandler<CircuitBreakerDelegatingHandler>()
        .AddPolicyHandler(GetCircuitBreakerPolicy())
        .ConfigureChannel(options =>
        {
            options.ServiceConfig = new Grpc.Net.Client.Configuration.ServiceConfig
            {
                MethodConfigs =
                 {
                     new Grpc.Net.Client.Configuration.MethodConfig
                     {
                         Names = { Grpc.Net.Client.Configuration.MethodName.Default },
                         RetryPolicy = new Grpc.Net.Client.Configuration.RetryPolicy
                         {
                             MaxAttempts = 5,
                             InitialBackoff = TimeSpan.FromSeconds(1),
                             MaxBackoff = TimeSpan.FromSeconds(5),
                             BackoffMultiplier = 1.5,
                             RetryableStatusCodes = { Grpc.Core.StatusCode.Unavailable, Grpc.Core.StatusCode.DeadlineExceeded }
                         }
                     }
                 }
            };
        });

        // Add Realtime Service Client
        services.AddGrpcClient<GrpcContracts.RealtimeService.RealtimeServiceClient>(options =>
        {
            var realtimeUrl = configuration["Services:Realtime:Url"] ?? "http://realtime-api:5032";
            options.Address = new Uri(realtimeUrl);
        })
        .AddHttpMessageHandler<CircuitBreakerDelegatingHandler>()
        .AddPolicyHandler(GetCircuitBreakerPolicy())
        .ConfigureChannel(options =>
        {
            options.ServiceConfig = new Grpc.Net.Client.Configuration.ServiceConfig
            {
                MethodConfigs =
                 {
                     new Grpc.Net.Client.Configuration.MethodConfig
                     {
                         Names = { Grpc.Net.Client.Configuration.MethodName.Default },
                         RetryPolicy = new Grpc.Net.Client.Configuration.RetryPolicy
                         {
                             MaxAttempts = 5,
                             InitialBackoff = TimeSpan.FromSeconds(1),
                             MaxBackoff = TimeSpan.FromSeconds(5),
                             BackoffMultiplier = 1.5,
                             RetryableStatusCodes = { Grpc.Core.StatusCode.Unavailable, Grpc.Core.StatusCode.DeadlineExceeded }
                         }
                     }
                 }
            };
        });

        services.AddScoped<IAuthGrpcClient, AuthGrpcClient>();

        return services;
    }
}
