using Planora.Auth.Api.Configuration;
using Planora.Auth.Infrastructure.Security;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using Moq;
using OpenTelemetry.Instrumentation.AspNetCore;
using Swashbuckle.AspNetCore.Swagger;
using System.Text;

namespace Planora.UnitTests.Services.AuthApi.Configuration;

public sealed class AuthApiConfigurationTests
{
    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Regression")]
    public void AddSwaggerDocumentation_ShouldRegisterOpenApiDocumentAndBearerSecurity()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddRouting();
        services.AddTestHostingEnvironment(Environments.Development);
        var xmlPath = Path.Combine(AppContext.BaseDirectory, "Planora.Auth.Api.xml");
        var hadExistingXml = File.Exists(xmlPath);
        var existingXml = hadExistingXml ? File.ReadAllText(xmlPath) : null;
        File.WriteAllText(
            xmlPath,
            "<?xml version=\"1.0\"?><doc><assembly><name>Planora.Auth.Api</name></assembly><members /></doc>");

        try
        {
            var returned = services.AddSwaggerDocumentation();

            using var provider = services.BuildServiceProvider();
            var swaggerProvider = provider.GetRequiredService<ISwaggerProvider>();
            var document = swaggerProvider.GetSwagger("v1");

            Assert.Same(services, returned);
            Assert.Equal("Planora Auth API", document.Info.Title);
            Assert.Equal("v1.0.0", document.Info.Version);
            Assert.True(document.Components.SecuritySchemes.ContainsKey("Bearer"));
            Assert.Single(document.SecurityRequirements);
        }
        finally
        {
            if (hadExistingXml)
                File.WriteAllText(xmlPath, existingXml!);
            else
                File.Delete(xmlPath);
        }
    }

    [Theory]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Regression")]
    [InlineData("Development")]
    [InlineData("Staging")]
    [InlineData("Production")]
    public void UseSwaggerDocumentation_ShouldReturnSameApplicationBuilder_ForSupportedEnvironments(string environment)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddRouting();
        services.AddTestHostingEnvironment(environment);
        services.AddSwaggerDocumentation();
        using var provider = services.BuildServiceProvider();
        var app = new ApplicationBuilder(provider);
        var env = new Mock<IWebHostEnvironment>();
        env.SetupGet(x => x.EnvironmentName).Returns(environment);

        var returned = app.UseSwaggerDocumentation(env.Object);

        Assert.Same(app, returned);
    }

    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Regression")]
    public void AddOpenTelemetryConfiguration_ShouldRegisterTracingMetricsWithConfiguredServiceName()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["OpenTelemetry:ServiceName"] = "AuthApi.Tests",
                ["OpenTelemetry:ServiceVersion"] = "9.9.9"
            })
            .Build();

        var returned = services.AddOpenTelemetryConfiguration(configuration);

        Assert.Same(services, returned);
        Assert.Contains(services, descriptor =>
            descriptor.ServiceType.FullName == "OpenTelemetry.Trace.TracerProvider");
        Assert.Contains(services, descriptor =>
            descriptor.ServiceType.FullName == "OpenTelemetry.Metrics.MeterProvider");

        using var provider = services.BuildServiceProvider();
        var aspNetCoreOptions = provider.GetRequiredService<IOptions<AspNetCoreTraceInstrumentationOptions>>().Value;
        var healthContext = new DefaultHttpContext();
        healthContext.Request.Path = "/health";
        var apiContext = new DefaultHttpContext();
        apiContext.Request.Path = "/api/auth";

        Assert.False(aspNetCoreOptions.Filter!(healthContext));
        Assert.True(aspNetCoreOptions.Filter(apiContext));
    }

    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Regression")]
    public void AddOpenTelemetryConfiguration_ShouldUseDefaults_WhenConfigurationIsMissing()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        var configuration = new ConfigurationBuilder().Build();

        var returned = services.AddOpenTelemetryConfiguration(configuration);

        Assert.Same(services, returned);
        Assert.NotEmpty(services);
    }

    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public void ConfigureJwtAuthentication_ShouldRejectMissingOrShortSecrets()
    {
        var missingSecret = new ServiceCollection();
        var missingConfig = new ConfigurationBuilder().Build();

        var missingError = Assert.Throws<InvalidOperationException>(() =>
            missingSecret.ConfigureJwtAuthentication(missingConfig));
        Assert.Contains("JWT Secret must be at least 32 characters", missingError.Message);

        var shortSecret = new ServiceCollection();
        var shortConfig = CreateJwtConfiguration(secret: "short-secret");

        var shortError = Assert.Throws<InvalidOperationException>(() =>
            shortSecret.ConfigureJwtAuthentication(shortConfig));
        Assert.Contains("JWT Secret must be at least 32 characters", shortError.Message);
    }

    [Theory]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    [InlineData(true, false)]
    [InlineData(false, true)]
    public void ConfigureJwtAuthentication_ShouldRegisterBearerAuthOptionsAndPolicies(bool isDevelopment, bool requireHttps)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        var configuration = CreateJwtConfiguration(isDevelopment: isDevelopment);

        var returned = services.ConfigureJwtAuthentication(configuration);

        using var provider = services.BuildServiceProvider();
        var settings = provider.GetRequiredService<IOptions<JwtSettings>>().Value;
        var authOptions = provider.GetRequiredService<IOptions<AuthenticationOptions>>().Value;
        var bearerOptions = provider.GetRequiredService<IOptionsMonitor<JwtBearerOptions>>()
            .Get(JwtBearerDefaults.AuthenticationScheme);
        var authorization = provider.GetRequiredService<IOptions<AuthorizationOptions>>().Value;

        Assert.Same(services, returned);
        Assert.Equal(JwtBearerDefaults.AuthenticationScheme, authOptions.DefaultAuthenticateScheme);
        Assert.Equal(JwtBearerDefaults.AuthenticationScheme, authOptions.DefaultChallengeScheme);
        Assert.Equal(JwtBearerDefaults.AuthenticationScheme, authOptions.DefaultScheme);
        Assert.Equal("test-issuer", settings.Issuer);
        Assert.Equal("test-audience", settings.Audience);
        Assert.Equal(CreateJwtSecret(), settings.Secret);
        Assert.True(bearerOptions.SaveToken);
        Assert.Equal(requireHttps, bearerOptions.RequireHttpsMetadata);
        Assert.True(bearerOptions.TokenValidationParameters.ValidateIssuer);
        Assert.True(bearerOptions.TokenValidationParameters.ValidateAudience);
        Assert.True(bearerOptions.TokenValidationParameters.ValidateLifetime);
        Assert.True(bearerOptions.TokenValidationParameters.ValidateIssuerSigningKey);
        Assert.True(bearerOptions.TokenValidationParameters.RequireExpirationTime);
        Assert.Equal("test-issuer", bearerOptions.TokenValidationParameters.ValidIssuer);
        Assert.Equal("test-audience", bearerOptions.TokenValidationParameters.ValidAudience);
        Assert.Equal(TimeSpan.Zero, bearerOptions.TokenValidationParameters.ClockSkew);
        var signingKey = Assert.IsType<SymmetricSecurityKey>(bearerOptions.TokenValidationParameters.IssuerSigningKey);
        Assert.Equal(CreateJwtSecret(), Encoding.UTF8.GetString(signingKey.Key));
        Assert.NotNull(authorization.GetPolicy("RequireAdminRole"));
        Assert.NotNull(authorization.GetPolicy("RequireEmailVerified"));
    }

    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public async Task ConfigureJwtAuthentication_ShouldHandleSignalRQueryTokensAndGenericChallenge()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.ConfigureJwtAuthentication(CreateJwtConfiguration());
        using var provider = services.BuildServiceProvider();
        var options = provider.GetRequiredService<IOptionsMonitor<JwtBearerOptions>>()
            .Get(JwtBearerDefaults.AuthenticationScheme);
        var scheme = new AuthenticationScheme(
            JwtBearerDefaults.AuthenticationScheme,
            JwtBearerDefaults.AuthenticationScheme,
            typeof(JwtBearerHandler));

        var hubContext = new DefaultHttpContext();
        hubContext.Request.Path = "/hubs/notifications";
        hubContext.Request.QueryString = new QueryString("?access_token=hub-token");
        var hubMessage = new MessageReceivedContext(hubContext, scheme, options);
        await options.Events.OnMessageReceived(hubMessage);
        Assert.Equal("hub-token", hubMessage.Token);

        var apiContext = new DefaultHttpContext();
        apiContext.Request.Path = "/api/users";
        apiContext.Request.QueryString = new QueryString("?access_token=api-token");
        var apiMessage = new MessageReceivedContext(apiContext, scheme, options);
        await options.Events.OnMessageReceived(apiMessage);
        Assert.Null(apiMessage.Token);

        var failedContext = new AuthenticationFailedContext(hubContext, scheme, options)
        {
            Exception = new SecurityTokenException("invalid")
        };
        await options.Events.OnAuthenticationFailed(failedContext);

        var challengeHttpContext = new DefaultHttpContext();
        await using var body = new MemoryStream();
        challengeHttpContext.Response.Body = body;
        var challengeContext = new JwtBearerChallengeContext(
            challengeHttpContext,
            scheme,
            options,
            new AuthenticationProperties());

        await options.Events.OnChallenge(challengeContext);

        body.Position = 0;
        var payload = await new StreamReader(body).ReadToEndAsync();
        Assert.True(challengeContext.Handled);
        Assert.Equal(StatusCodes.Status401Unauthorized, challengeContext.Response.StatusCode);
        Assert.Equal("application/json", challengeContext.Response.ContentType);
        Assert.Contains("UNAUTHORIZED", payload);
        Assert.Contains("Authentication is required", payload);
    }

    private static IConfiguration CreateJwtConfiguration(string? secret = null, bool isDevelopment = true)
    {
        return new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["JwtSettings:Secret"] = secret ?? CreateJwtSecret(),
                ["JwtSettings:Issuer"] = "test-issuer",
                ["JwtSettings:Audience"] = "test-audience",
                ["IsDevelopment"] = isDevelopment.ToString()
            })
            .Build();
    }

    private static string CreateJwtSecret() => "abcdefghijklmnopqrstuvwxyz123456";
}

internal static class ServiceCollectionHostingTestExtensions
{
    public static IServiceCollection AddTestHostingEnvironment(this IServiceCollection services, string environment)
    {
        var hostEnvironment = AuthApiConfigurationTestsAccessor.CreateEnvironment(environment);
        services.AddSingleton(hostEnvironment);
        services.AddSingleton<IHostEnvironment>(hostEnvironment);
        return services;
    }
}

internal static class AuthApiConfigurationTestsAccessor
{
    public static IWebHostEnvironment CreateEnvironment(string environment)
    {
        var env = new Mock<IWebHostEnvironment>();
        env.SetupGet(x => x.EnvironmentName).Returns(environment);
        env.SetupGet(x => x.ApplicationName).Returns("Planora.Auth.Api");
        env.SetupGet(x => x.ContentRootPath).Returns(AppContext.BaseDirectory);
        return env.Object;
    }
}
