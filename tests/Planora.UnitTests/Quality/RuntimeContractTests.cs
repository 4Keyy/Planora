using System.Text.Json;

namespace Planora.UnitTests.Quality;

public class RuntimeContractTests
{
    private static readonly JsonDocumentOptions JsonDocumentOptions = new()
    {
        CommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true
    };

    [Fact]
    [Trait("TestType", "System")]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Security")]
    public void DockerComposeAndEnvExample_ShouldDeclareRequiredInfrastructureSecrets()
    {
        var root = FindRepositoryRoot();
        var envExample = File.ReadAllText(Path.Combine(root, ".env.example"));
        var compose = File.ReadAllText(Path.Combine(root, "docker-compose.yml"));

        foreach (var requiredVariable in new[]
                 {
                     "POSTGRES_PASSWORD",
                     "JWT_SECRET",
                     "RABBITMQ_USER",
                     "RABBITMQ_PASSWORD",
                     "REDIS_PASSWORD"
                 })
        {
            Assert.Contains($"{requiredVariable}=", envExample, StringComparison.Ordinal);
            Assert.Contains("${" + requiredVariable + ":?", compose, StringComparison.Ordinal);
        }

        Assert.Contains("--requirepass", compose, StringComparison.Ordinal);
        Assert.Contains("redis:6379,password=${REDIS_PASSWORD:?", compose, StringComparison.Ordinal);
        Assert.Contains("JwtSettings__Secret: ${JWT_SECRET:?", compose, StringComparison.Ordinal);
        Assert.Contains("127.0.0.1:5433:5432", compose, StringComparison.Ordinal);
        Assert.Contains("127.0.0.1:6379:6379", compose, StringComparison.Ordinal);
        Assert.Contains("127.0.0.1:5672:5672", compose, StringComparison.Ordinal);
        Assert.Contains("127.0.0.1:15672:15672", compose, StringComparison.Ordinal);
    }

    [Fact]
    [Trait("TestType", "System")]
    [Trait("TestType", "Acceptance")]
    [Trait("TestType", "Regression")]
    public void OcelotDockerRoutes_ShouldUseDockerServiceNamesAndHttpAuthEndpoint()
    {
        var root = FindRepositoryRoot();
        using var document = JsonDocument.Parse(
            File.ReadAllText(Path.Combine(root, "Planora.ApiGateway", "ocelot.Docker.json")),
            JsonDocumentOptions);
        var routes = document.RootElement.GetProperty("Routes").EnumerateArray().ToArray();

        var downstreamHosts = routes
            .SelectMany(route => route.GetProperty("DownstreamHostAndPorts").EnumerateArray())
            .Select(hostAndPort => hostAndPort.GetProperty("Host").GetString())
            .Where(host => host is not null)
            .ToHashSet(StringComparer.Ordinal);

        Assert.Contains("auth-api", downstreamHosts);
        Assert.Contains("todo-api", downstreamHosts);
        Assert.Contains("category-api", downstreamHosts);
        Assert.Contains("messaging-api", downstreamHosts);
        Assert.Contains("realtime-api", downstreamHosts);

        var authRoutes = routes
            .Where(route => route.GetProperty("DownstreamHostAndPorts").EnumerateArray()
                .Any(hostAndPort => hostAndPort.GetProperty("Host").GetString() == "auth-api"))
            .ToArray();

        Assert.All(authRoutes, route =>
        {
            Assert.Equal("http", route.GetProperty("DownstreamScheme").GetString());
            Assert.All(route.GetProperty("DownstreamHostAndPorts").EnumerateArray(), hostAndPort =>
            {
                Assert.Equal(80, hostAndPort.GetProperty("Port").GetInt32());
            });
        });

        Assert.Contains(routes, route => route.GetProperty("UpstreamPathTemplate").GetString() == "/auth/health");
        Assert.Contains(routes, route => route.GetProperty("UpstreamPathTemplate").GetString() == "/todos/health");
        Assert.Contains(routes, route => route.GetProperty("UpstreamPathTemplate").GetString() == "/categories/health");
    }

    [Fact]
    [Trait("TestType", "System")]
    [Trait("TestType", "Regression")]
    public void DockerAppSettings_ShouldUseDockerNetworkDependencies()
    {
        var root = FindRepositoryRoot();
        var dockerSettings = Directory.EnumerateFiles(root, "appsettings.Docker.json", SearchOption.AllDirectories)
            .Where(path => !IsBuildArtifact(path))
            .ToArray();

        Assert.NotEmpty(dockerSettings);
        Assert.All(dockerSettings, path =>
        {
            var content = File.ReadAllText(path);
            using var document = JsonDocument.Parse(content, JsonDocumentOptions);
            var dependencyValues = FlattenJsonValues(document.RootElement)
                .Where(item => item.Path.Contains("ConnectionStrings", StringComparison.Ordinal)
                    || item.Path.Contains("RabbitMq", StringComparison.Ordinal)
                    || item.Path.Contains("RabbitMQ", StringComparison.Ordinal)
                    || item.Path.Contains("Redis", StringComparison.Ordinal)
                    || item.Path.Contains("GrpcServices", StringComparison.Ordinal)
                    || item.Path.StartsWith("Services:", StringComparison.Ordinal))
                .Select(item => item.Value)
                .ToArray();

            Assert.DoesNotContain(dependencyValues, value => value.Contains("localhost", StringComparison.OrdinalIgnoreCase));
            Assert.DoesNotContain(dependencyValues, value => value.Contains("127.0.0.1", StringComparison.OrdinalIgnoreCase));
            Assert.Contains("Planora.Auth", content, StringComparison.Ordinal);
            Assert.Contains("Planora.Clients", content, StringComparison.Ordinal);
        });

        var gatewaySettings = File.ReadAllText(Path.Combine(root, "Planora.ApiGateway", "appsettings.Docker.json"));
        Assert.Contains("http://auth-api:80", gatewaySettings, StringComparison.Ordinal);
        Assert.Contains("http://todo-api:80", gatewaySettings, StringComparison.Ordinal);
        Assert.Contains("http://category-api:81", gatewaySettings, StringComparison.Ordinal);
        Assert.Contains("http://messaging-api:80", gatewaySettings, StringComparison.Ordinal);
        Assert.Contains("http://realtime-api:80", gatewaySettings, StringComparison.Ordinal);
    }

    [Fact]
    [Trait("TestType", "System")]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public void BrowserFacingApiCorsPolicies_ShouldUseExplicitOrigins()
    {
        var root = FindRepositoryRoot();
        var programFiles = new[]
        {
            Path.Combine(root, "Planora.ApiGateway", "Program.cs"),
            Path.Combine(root, "Services", "AuthApi", "Planora.Auth.Api", "Program.cs"),
            Path.Combine(root, "Services", "CategoryApi", "Planora.Category.Api", "Program.cs"),
            Path.Combine(root, "Services", "MessagingApi", "Planora.Messaging.Api", "Program.cs"),
            Path.Combine(root, "Services", "TodoApi", "Planora.Todo.Api", "Program.cs")
        };

        Assert.All(programFiles, path =>
        {
            var content = File.ReadAllText(path);
            Assert.DoesNotContain(".AllowAnyOrigin()", content, StringComparison.Ordinal);
            Assert.DoesNotContain("SetIsOriginAllowed(_ => true)", content, StringComparison.Ordinal);
            Assert.Contains(".WithOrigins(", content, StringComparison.Ordinal);
        });
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Acceptance")]
    [Trait("TestType", "Usability")]
    public void TestSuite_ShouldDeclareRequestedTestTypes()
    {
        var root = FindRepositoryRoot();
        var testSources = Directory.EnumerateFiles(Path.Combine(root, "tests"), "*.cs", SearchOption.AllDirectories)
            .Where(path => !IsBuildArtifact(path))
            .Select(File.ReadAllText)
            .ToArray();
        var combined = string.Join(Environment.NewLine, testSources);

        foreach (var testType in new[]
                 {
                     "Unit",
                     "Functional",
                     "Module",
                     "Integration",
                     "System",
                     "Acceptance",
                     "Load",
                     "Regression",
                     "Security",
                     "Usability"
                 })
        {
            Assert.Contains($"[Trait(\"TestType\", \"{testType}\")]", combined, StringComparison.Ordinal);
        }
    }

    [Fact]
    [Trait("TestType", "Usability")]
    [Trait("TestType", "Regression")]
    [Trait("TestType", "Acceptance")]
    public void FrontendTests_ShouldExerciseAccessibleUserFlows()
    {
        var root = FindRepositoryRoot();
        var frontendTests = Directory.EnumerateFiles(Path.Combine(root, "frontend", "src", "test"), "*.test.*", SearchOption.AllDirectories)
            .Where(path => !IsBuildArtifact(path))
            .Select(File.ReadAllText)
            .ToArray();
        var combined = string.Join(Environment.NewLine, frontendTests);

        Assert.Contains("userEvent", combined, StringComparison.Ordinal);
        Assert.Contains("getByRole", combined, StringComparison.Ordinal);
        Assert.Contains("findByRole", combined, StringComparison.Ordinal);
        Assert.Contains("toHaveFocus", combined, StringComparison.Ordinal);
        Assert.Contains("toBeDisabled", combined, StringComparison.Ordinal);
        Assert.Contains("{Escape}", combined, StringComparison.Ordinal);
    }

    private static string FindRepositoryRoot()
    {
        var current = AppContext.BaseDirectory;
        while (!string.IsNullOrWhiteSpace(current))
        {
            if (File.Exists(Path.Combine(current, "Planora.sln")))
            {
                return current;
            }

            current = Directory.GetParent(current)?.FullName;
        }

        throw new InvalidOperationException("Could not locate Planora.sln from test base directory.");
    }

    private static bool IsBuildArtifact(string path)
    {
        var normalized = path.Replace(Path.AltDirectorySeparatorChar, Path.DirectorySeparatorChar);
        return normalized.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase)
            || normalized.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase);
    }

    private static IEnumerable<(string Path, string Value)> FlattenJsonValues(JsonElement element, string path = "")
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var property in element.EnumerateObject())
                {
                    var childPath = string.IsNullOrEmpty(path) ? property.Name : $"{path}:{property.Name}";
                    foreach (var item in FlattenJsonValues(property.Value, childPath))
                    {
                        yield return item;
                    }
                }

                break;
            case JsonValueKind.Array:
                var index = 0;
                foreach (var item in element.EnumerateArray())
                {
                    foreach (var child in FlattenJsonValues(item, $"{path}:{index}"))
                    {
                        yield return child;
                    }

                    index++;
                }

                break;
            case JsonValueKind.String:
                yield return (path, element.GetString() ?? string.Empty);
                break;
            case JsonValueKind.Number:
            case JsonValueKind.True:
            case JsonValueKind.False:
                yield return (path, element.ToString());
                break;
        }
    }
}
