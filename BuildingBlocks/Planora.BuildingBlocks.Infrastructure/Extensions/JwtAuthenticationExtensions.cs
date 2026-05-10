using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;

namespace Planora.BuildingBlocks.Infrastructure.Extensions;

/// <summary>
/// Unified JWT authentication configuration for all microservices.
/// Use this in services that CONSUME JWT tokens (Todo, Category, Messaging).
/// Auth service uses its own implementation with token generation logic.
/// </summary>
public static class JwtAuthenticationExtensions
{
    public static IServiceCollection AddJwtAuthenticationForConsumer(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        var jwtSecret = configuration["JwtSettings:Secret"] 
            ?? throw new InvalidOperationException("JwtSettings:Secret is not configured");
        var jwtIssuer = configuration["JwtSettings:Issuer"] 
            ?? throw new InvalidOperationException("JwtSettings:Issuer is not configured");
        var jwtAudience = configuration["JwtSettings:Audience"] 
            ?? throw new InvalidOperationException("JwtSettings:Audience is not configured");

        services.AddAuthentication(options =>
        {
            options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
            options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
            options.DefaultScheme = JwtBearerDefaults.AuthenticationScheme;
        })
        .AddJwtBearer(options =>
        {
            options.SaveToken = true;
            options.RequireHttpsMetadata = !configuration.GetValue<bool>("IsDevelopment", false);
            options.TokenValidationParameters = new TokenValidationParameters
            {
                ValidateIssuer = true,
                ValidateAudience = true,
                ValidateLifetime = true,
                ValidateIssuerSigningKey = true,
                ValidIssuer = jwtIssuer,
                ValidAudience = jwtAudience,
                IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret)),
                // SECURITY: Reduce clock skew to 30 seconds. A 5-minute window allows an attacker
                // to replay a just-expired token for up to 5 minutes after it should be invalid.
                ClockSkew = TimeSpan.FromSeconds(30)
            };

            options.Events = new JwtBearerEvents
            {
                OnTokenValidated = context =>
                {
                    // JWT claims are automatically mapped to HttpContext.User
                    return Task.CompletedTask;
                },
                OnAuthenticationFailed = context =>
                {
                    // SECURITY: Do not leak whether the failure was expiry vs invalid signature.
                    // Clients should silently attempt a refresh on any 401 response.
                    return Task.CompletedTask;
                }
            };
        });

        services.AddAuthorization();

        return services;
    }
}
