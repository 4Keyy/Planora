using System.Reflection;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.OpenApi.Models;
using Swashbuckle.AspNetCore.SwaggerUI;

namespace Planora.BuildingBlocks.Infrastructure.Configuration;

/// <summary>
/// Shared Swagger / OpenAPI wiring for every Planora HTTP service. The single
/// <see cref="AddPlanoraSwaggerGen"/> entry point registers the document, the
/// JWT bearer security scheme, XML doc inclusion (when an XML file ships
/// next to the assembly), and stable schema ids. <see cref="UsePlanoraSwagger"/>
/// mounts the middleware in non-production environments.
/// </summary>
/// <remarks>
/// Conventions:
/// <list type="bullet">
/// <item><description>Every service publishes a single v1 document at
/// <c>/swagger/v1/swagger.json</c>. CI extracts that document offline through
/// the <c>Swashbuckle.AspNetCore.Cli</c> tool, so the URL is the artifact key
/// across the entire fleet.</description></item>
/// <item><description>JWT bearer is the only declared security scheme; the
/// shared interceptor headers (<c>x-service-key</c>) are NOT documented
/// because they are an internal backplane concern, not part of the public
/// OpenAPI surface.</description></item>
/// <item><description>The middleware (<c>UseSwagger</c> / <c>UseSwaggerUI</c>)
/// is registered only when the environment is <c>Development</c> or
/// <c>Staging</c>; production never exposes interactive Swagger UI.
/// CI still extracts <c>swagger.json</c> offline via the CLI without
/// touching the middleware.</description></item>
/// </list>
/// </remarks>
public static class PlanoraSwaggerExtensions
{
    /// <summary>
    /// Registers the OpenAPI document generator with the conventions used by
    /// every Planora HTTP service. Safe to call multiple times on the same
    /// service collection — Swashbuckle deduplicates internally.
    /// </summary>
    /// <param name="services">The service collection being augmented.</param>
    /// <param name="title">User-facing title of the API document (e.g. "Planora Auth API").</param>
    /// <param name="description">Short description shown in the Swagger UI banner.</param>
    /// <param name="documentVersion">Route key for the document — appears in the
    /// <c>/swagger/{documentVersion}/swagger.json</c> URL. Defaults to <c>v1</c>.</param>
    /// <param name="infoVersion">Value of the OpenAPI <c>info.version</c> field. When
    /// <see langword="null"/> the document version is reused — but services that ship a
    /// semantic info version (e.g. <c>"v1.0.0"</c>) should pass it explicitly.</param>
    public static IServiceCollection AddPlanoraSwaggerGen(
        this IServiceCollection services,
        string title,
        string description,
        string documentVersion = "v1",
        string? infoVersion = null)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentException.ThrowIfNullOrWhiteSpace(title);
        ArgumentException.ThrowIfNullOrWhiteSpace(description);
        ArgumentException.ThrowIfNullOrWhiteSpace(documentVersion);

        services.AddEndpointsApiExplorer();
        services.AddSwaggerGen(options =>
        {
            options.SwaggerDoc(documentVersion, new OpenApiInfo
            {
                Title = title,
                Version = string.IsNullOrWhiteSpace(infoVersion) ? documentVersion : infoVersion,
                Description = description,
            });

            options.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
            {
                Description = "JWT Authorization header using the Bearer scheme. Example: \"Bearer {token}\"",
                Name = "Authorization",
                In = ParameterLocation.Header,
                Type = SecuritySchemeType.ApiKey,
                Scheme = "Bearer",
                BearerFormat = "JWT",
            });

            options.AddSecurityRequirement(new OpenApiSecurityRequirement
            {
                {
                    new OpenApiSecurityScheme
                    {
                        Reference = new OpenApiReference
                        {
                            Type = ReferenceType.SecurityScheme,
                            Id = "Bearer",
                        },
                    },
                    Array.Empty<string>()
                },
            });

            var assemblyName = Assembly.GetEntryAssembly()?.GetName().Name;
            if (!string.IsNullOrEmpty(assemblyName))
            {
                var xmlPath = Path.Combine(AppContext.BaseDirectory, $"{assemblyName}.xml");
                if (File.Exists(xmlPath))
                {
                    options.IncludeXmlComments(xmlPath);
                }
            }

            options.EnableAnnotations();
            // FullName keeps schema ids stable across services even when two services
            // define a type with the same short name (e.g. `Result<TodoDto>` vs
            // `Result<CategoryDto>`). Generated TS clients rely on this stability.
            //
            // The raw FullName contains generic-argument brackets and commas
            // (`PagedResult<TodoDto>` and `Dictionary<string,int>`), which are not
            // valid URI-reference characters; OpenAPI's $ref grammar (RFC 3986)
            // rejects them. The replacements below preserve readability while
            // keeping every $ref a valid URI fragment for Spectral / openapi-typescript
            // / oasdiff consumers. Round-trip: identical reflection input always
            // produces the same id; no two distinct types collide.
            options.CustomSchemaIds(type => SanitizeSchemaId(type.FullName));
        });

        return services;
    }

    /// <summary>
    /// Sanitizes a CLR <see cref="Type.FullName"/> into an OpenAPI <c>$ref</c>-valid
    /// schema id. Replaces only the three characters that are illegal in URI-reference
    /// fragments — <c>&lt;</c>, <c>&gt;</c>, <c>,</c> — with readable text tokens, plus
    /// the assembly-separator <c>+</c> used for nested types. Every other character
    /// is left untouched so the FullName remains recognizable in the generated TS
    /// client and on disk.
    /// </summary>
    /// <remarks>
    /// Determinism: the mapping is a fixed character-class replacement, so identical
    /// reflection input always yields the same id and two distinct types can never
    /// collide. Verified by <c>PlanoraSwaggerSchemaIdTests</c>.
    /// </remarks>
    // Lazy-init regex that matches every character that is NOT a URI-reference-safe
    // schema-id letter (ASCII letter, digit, or dot). Includes the runs of noise
    // Swashbuckle hands the delegate for closed generics:
    //
    //   typeof(PagedResult<FriendDto>).FullName ==
    //     "Planora.BuildingBlocks.Application.Pagination.PagedResult`1[[
    //        Planora.Auth.Application.Features.Friendships.Queries.GetFriends.FriendDto,
    //        Planora.Auth.Application, Version=1.0.0.0, Culture=neutral,
    //        PublicKeyToken=null]]"
    //
    // Backticks, square brackets, commas, spaces, equals signs, and angle brackets
    // are all collapsed into a single "_" so the resulting id is a valid OpenAPI
    // URI-reference fragment (RFC 3986).
    private static readonly Regex IllegalSchemaIdChars =
        new("[^A-Za-z0-9.]+", RegexOptions.Compiled);

    internal static string SanitizeSchemaId(string? fullName)
    {
        if (string.IsNullOrEmpty(fullName))
        {
            return string.Empty;
        }

        // Step 1: collapse the nested-type separator into a dot, matching the
        // human reading convention (`Outer.Inner` rather than `Outer_Inner`).
        var normalised = fullName.Replace('+', '.');

        // Step 2: collapse every other illegal run into a single underscore.
        // The pattern is single-pass and produces a deterministic id; distinct
        // FullName inputs cannot collapse to the same output because the
        // illegal-character runs encode the very part of the type that
        // distinguishes them (assembly name, version, type arguments).
        var sanitised = IllegalSchemaIdChars.Replace(normalised, "_");

        // Step 3: drop trailing underscores produced by reflection's trailing `]]`.
        return sanitised.TrimEnd('_');
    }

    /// <summary>
    /// Mounts <c>UseSwagger</c> + <c>UseSwaggerUI</c> when the environment is
    /// Development or Staging. Production never exposes the interactive UI
    /// (information-disclosure concern); CI extracts the OpenAPI document
    /// offline through the CLI without invoking this middleware.
    /// </summary>
    public static IApplicationBuilder UsePlanoraSwagger(
        this IApplicationBuilder app,
        IWebHostEnvironment env,
        string documentTitle,
        string documentVersion = "v1")
    {
        ArgumentNullException.ThrowIfNull(app);
        ArgumentNullException.ThrowIfNull(env);

        if (!(env.IsDevelopment() || env.IsStaging()))
        {
            return app;
        }

        app.UseSwagger();
        app.UseSwaggerUI(options =>
        {
            options.SwaggerEndpoint($"/swagger/{documentVersion}/swagger.json", $"{documentTitle} {documentVersion}");
            options.DocumentTitle = $"{documentTitle} Documentation";
            options.DisplayRequestDuration();
            options.EnableDeepLinking();
            options.EnableFilter();
            options.ShowExtensions();
            options.EnableValidator();
            options.DocExpansion(DocExpansion.None);
        });

        return app;
    }
}
