using Planora.Auth.Infrastructure.Security;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using System.Text;
using Microsoft.AspNetCore.Http;

namespace Planora.Auth.Api.Configuration
{
    public static class JwtConfiguration
    {
        public static IServiceCollection ConfigureJwtAuthentication(
            this IServiceCollection services,
            IConfiguration configuration)
        {
            var jwtSettings = new JwtSettings();
            configuration.GetSection("JwtSettings").Bind(jwtSettings);

            services.Configure<JwtSettings>(configuration.GetSection("JwtSettings"));

            if (string.IsNullOrEmpty(jwtSettings.Secret) || jwtSettings.Secret.Length < 32)
            {
                throw new InvalidOperationException(
                    "JWT Secret must be at least 32 characters. Configure JwtSettings:Secret in appsettings.json");
            }

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
                    ValidIssuer = jwtSettings.Issuer,
                    ValidAudience = jwtSettings.Audience,
                    IssuerSigningKey = new SymmetricSecurityKey(
                        Encoding.UTF8.GetBytes(jwtSettings.Secret)),
                    ClockSkew = TimeSpan.Zero,
                    RequireExpirationTime = true
                };

                options.Events = new JwtBearerEvents
                {
                    OnMessageReceived = context =>
                    {
                        // Allow SignalR hubs to pass token via query string (WebSocket limitation)
                        var accessToken = context.Request.Query["access_token"];
                        var path = context.HttpContext.Request.Path;

                        if (!string.IsNullOrEmpty(accessToken) && path.StartsWithSegments("/hubs"))
                        {
                            context.Token = accessToken;
                        }
                        return Task.CompletedTask;
                    },
                    OnAuthenticationFailed = context =>
                    {
                        // SECURITY: Do NOT add a Token-Expired header.
                        // Leaking whether a token is expired vs invalid helps attackers
                        // distinguish valid-but-expired tokens from forged ones.
                        // The frontend should attempt a silent refresh on any 401.
                        return Task.CompletedTask;
                    },
                    OnChallenge = context =>
                    {
                        context.HandleResponse();
                        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                        context.Response.ContentType = "application/json";

                        // SECURITY: Return a generic 401 body — do not reveal whether the token
                        // was expired, invalid, or missing. The frontend handles all 401s uniformly.
                        var result = System.Text.Json.JsonSerializer.Serialize(new
                        {
                            error = "UNAUTHORIZED",
                            message = "Authentication is required to access this resource"
                        });

                        return context.Response.WriteAsync(result);
                    }
                };
            });

            services.AddAuthorization(options =>
            {
                options.AddPolicy("RequireAdminRole", policy =>
                    policy.RequireRole("Admin"));

                options.AddPolicy("RequireEmailVerified", policy =>
                    policy.RequireClaim("email_verified", "true"));
            });

            return services;
        }
    }
}
