using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Xunit;

namespace Planora.ErrorHandlingTests.Integration;

/// <summary>
/// Current Todo API integration coverage for the executable HTTP contract.
/// These tests run against WebApplicationFactory with in-memory persistence and
/// mocked network dependencies, so they validate the real middleware/controller
/// pipeline without requiring Docker infrastructure.
/// </summary>
public class ErrorHandlingIntegrationTests : IClassFixture<TodoApiTestFactory>
{
    private readonly HttpClient _client;
    private readonly TodoApiTestFactory _factory;

    public ErrorHandlingIntegrationTests(TodoApiTestFactory factory)
    {
        _factory = factory;
        _client = _factory.CreateClient();
    }

    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task TodoApi_InMemoryHost_ShouldServeAuthenticatedTodoList()
    {
        var response = await _client.GetAsync("/api/v1/todos");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var body = await ReadJsonAsync(response);
        body.RootElement.TryGetProperty("items", out _).Should().BeTrue();
    }

    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public async Task TodoApi_InMemoryHost_ShouldRejectAnonymousTodoListRequest()
    {
        using var anonymousClient = _factory.CreateDefaultClient();

        var response = await anonymousClient.GetAsync("/api/v1/todos");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Acceptance")]
    public async Task CreateTodo_WithValidPayload_ReturnsCreatedTodo()
    {
        var response = await _client.PostAsJsonAsync("/api/v1/todos", ValidCreateRequest("Create integration todo"));

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        response.Headers.Location.Should().NotBeNull();
        using var body = await ReadJsonAsync(response);
        body.RootElement.GetProperty("id").GetGuid().Should().NotBeEmpty();
        body.RootElement.GetProperty("title").GetString().Should().Be("Create integration todo");
    }

    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task GetTodo_AfterCreate_ReturnsTodoDetails()
    {
        var id = await CreateTodoAsync("Read integration todo");

        var response = await _client.GetAsync($"/api/v1/todos/{id}");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var body = await ReadJsonAsync(response);
        body.RootElement.GetProperty("id").GetGuid().Should().Be(id);
        body.RootElement.GetProperty("title").GetString().Should().Be("Read integration todo");
    }

    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task UpdateTodo_WithExistingTodo_ReturnsUpdatedTodo()
    {
        var id = await CreateTodoAsync("Original integration todo");

        var response = await _client.PutAsJsonAsync($"/api/v1/todos/{id}", new
        {
            title = "Updated integration todo",
            description = "Updated through WebApplicationFactory"
        });

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var body = await ReadJsonAsync(response);
        body.RootElement.GetProperty("id").GetGuid().Should().Be(id);
        body.RootElement.GetProperty("title").GetString().Should().Be("Updated integration todo");
    }

    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task DeleteTodo_WithExistingTodo_ReturnsNoContent()
    {
        var id = await CreateTodoAsync("Delete integration todo");

        var response = await _client.DeleteAsync($"/api/v1/todos/{id}");

        response.StatusCode.Should().Be(HttpStatusCode.NoContent);
    }

    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task CreateTodo_WithCategory_ReturnsCategoryEnrichment()
    {
        var categoryId = Guid.NewGuid();

        var response = await _client.PostAsJsonAsync("/api/v1/todos", new
        {
            title = "Categorized integration todo",
            description = "Category metadata comes from mocked gRPC dependency",
            categoryId
        });

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        using var body = await ReadJsonAsync(response);
        body.RootElement.GetProperty("categoryId").GetGuid().Should().Be(categoryId);
        body.RootElement.GetProperty("categoryName").GetString().Should().Be("Test Category");
        body.RootElement.GetProperty("categoryColor").GetString().Should().Be("#3b82f6");
        body.RootElement.GetProperty("categoryIcon").GetString().Should().Be("folder");
    }

    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task CreateTodo_WithEmptyTitle_ReturnsValidationError()
    {
        var response = await _client.PostAsJsonAsync("/api/v1/todos", new { title = "", description = "Test" });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        using var body = await ReadJsonAsync(response);
        AssertFailureEnvelope(body, "VALIDATION.INVALID_INPUT", "Title is required");
    }

    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task CreateTodo_WithTitleTooLong_ReturnsValidationError()
    {
        var response = await _client.PostAsJsonAsync("/api/v1/todos", new
        {
            title = new string('a', 201),
            description = "Test"
        });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        using var body = await ReadJsonAsync(response);
        AssertFailureEnvelope(body, "VALIDATION.INVALID_INPUT", "Title cannot exceed 200 characters");
    }

    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task CreateTodo_WithExpectedDateAfterDueDate_ReturnsValidationError()
    {
        var dueDate = DateTime.UtcNow.AddDays(1);
        var response = await _client.PostAsJsonAsync("/api/v1/todos", new
        {
            title = "Invalid date order",
            description = "Expected date cannot be after due date",
            dueDate,
            expectedDate = dueDate.AddDays(1)
        });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        using var body = await ReadJsonAsync(response);
        AssertFailureEnvelope(body, "VALIDATION.INVALID_INPUT", "Expected date cannot be after due date");
    }

    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task UpdateTodo_WithTitleTooLong_ReturnsValidationError()
    {
        var id = await CreateTodoAsync("Update validation integration todo");

        var response = await _client.PutAsJsonAsync($"/api/v1/todos/{id}", new
        {
            title = new string('b', 201)
        });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        using var body = await ReadJsonAsync(response);
        AssertFailureEnvelope(body, "VALIDATION.INVALID_INPUT", "Title cannot exceed 200 characters");
    }

    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task GetTodo_WithNonExistentId_ReturnsNotFound()
    {
        var id = Guid.NewGuid();

        var response = await _client.GetAsync($"/api/v1/todos/{id}");

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
        using var body = await ReadJsonAsync(response);
        AssertFailureEnvelope(body, "NOT_FOUND.RESOURCE", id.ToString());
    }

    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task UpdateTodo_WithNonExistentId_ReturnsNotFound()
    {
        var id = Guid.NewGuid();

        var response = await _client.PutAsJsonAsync($"/api/v1/todos/{id}", new { title = "Updated" });

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
        using var body = await ReadJsonAsync(response);
        AssertFailureEnvelope(body, "NOT_FOUND.RESOURCE", id.ToString());
    }

    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task DeleteTodo_WithNonExistentId_ReturnsNotFound()
    {
        var id = Guid.NewGuid();

        var response = await _client.DeleteAsync($"/api/v1/todos/{id}");

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
        using var body = await ReadJsonAsync(response);
        AssertFailureEnvelope(body, "NOT_FOUND.RESOURCE", id.ToString());
    }

    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public async Task CreateTodo_WithNonFriendShare_ReturnsForbidden()
    {
        var response = await _client.PostAsJsonAsync("/api/v1/todos", new
        {
            title = "Shared with non-friend",
            description = "Friendship service returns no accepted friends",
            sharedWithUserIds = new[] { Guid.NewGuid() }
        });

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        using var body = await ReadJsonAsync(response);
        AssertFailureEnvelope(body, "AUTHORIZATION.FORBIDDEN", "accepted friends");
    }

    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Resilience")]
    [Trait("TestType", "Regression")]
    public async Task CreateTodo_WhenCategoryGrpcTimesOut_ReturnsServiceUnavailable()
    {
        try
        {
            _factory.SimulateGrpcTimeout(true);

            var response = await _client.PostAsJsonAsync("/api/v1/todos", new
            {
                title = "Category timeout",
                description = "The category dependency times out",
                categoryId = Guid.NewGuid()
            });

            response.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
            using var body = await ReadJsonAsync(response);
            AssertFailureEnvelope(body, "INFRASTRUCTURE.TIMEOUT", "operation took too long");
        }
        finally
        {
            _factory.SimulateGrpcTimeout(false);
        }
    }

    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Resilience")]
    [Trait("TestType", "Regression")]
    public async Task CreateTodo_WhenCategoryGrpcReturnsNotFound_ReturnsMappedNotFound()
    {
        try
        {
            _factory.SimulateGrpcNotFound(true);

            var response = await _client.PostAsJsonAsync("/api/v1/todos", new
            {
                title = "Category not found",
                description = "The category dependency returns NOT_FOUND",
                categoryId = Guid.NewGuid()
            });

            response.StatusCode.Should().Be(HttpStatusCode.NotFound);
            using var body = await ReadJsonAsync(response);
            AssertFailureEnvelope(body, "NOT_FOUND.RESOURCE", "Category not found");
        }
        finally
        {
            _factory.SimulateGrpcNotFound(false);
        }
    }

    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Resilience")]
    [Trait("TestType", "Regression")]
    public async Task CreateTodo_WhenCategoryGrpcValidationFails_ReturnsMappedValidationError()
    {
        try
        {
            _factory.SimulateGrpcValidationError(true);

            var response = await _client.PostAsJsonAsync("/api/v1/todos", new
            {
                title = "Category validation failure",
                description = "The category dependency returns INVALID_ARGUMENT",
                categoryId = Guid.NewGuid()
            });

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            using var body = await ReadJsonAsync(response);
            AssertFailureEnvelope(body, "VALIDATION.INVALID_INPUT", "Invalid category data");
        }
        finally
        {
            _factory.SimulateGrpcValidationError(false);
        }
    }

    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public async Task GetTodos_WithInvalidBearerToken_ReturnsUnauthorized()
    {
        using var client = _factory.CreateDefaultClient();
        client.DefaultRequestHeaders.Add("Authorization",
            "Bearer invalid-token-for-test");

        var response = await client.GetAsync("/api/v1/todos");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "System")]
    [Trait("TestType", "Regression")]
    public async Task AllErrors_ShouldContainCorrelationId()
    {
        var correlationId = Guid.NewGuid().ToString();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/todos")
        {
            Content = JsonContent.Create(new { title = "" })
        };
        request.Headers.Add("X-Correlation-ID", correlationId);

        var response = await _client.SendAsync(request);

        response.Headers.GetValues("X-Correlation-ID").Should().Contain(correlationId);
        using var body = await ReadJsonAsync(response);
        body.RootElement.GetProperty("meta").GetProperty("correlationId").GetString()
            .Should().Be(correlationId);
    }

    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "System")]
    [Trait("TestType", "Regression")]
    public async Task MultipleRequests_ShouldPreserveDistinctCorrelationIds()
    {
        var firstCorrelationId = Guid.NewGuid().ToString();
        var secondCorrelationId = Guid.NewGuid().ToString();

        using var first = await SendInvalidCreateWithCorrelationAsync(firstCorrelationId);
        using var second = await SendInvalidCreateWithCorrelationAsync(secondCorrelationId);

        first.RootElement.GetProperty("meta").GetProperty("correlationId").GetString()
            .Should().Be(firstCorrelationId);
        second.RootElement.GetProperty("meta").GetProperty("correlationId").GetString()
            .Should().Be(secondCorrelationId);
    }

    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public async Task ErrorResponses_ShouldNotExposeStackTraceOrExceptionTypes()
    {
        try
        {
            _factory.SimulateGrpcNotFound(true);

            var response = await _client.PostAsJsonAsync("/api/v1/todos", new
            {
                title = "No stack traces",
                description = "Mapped gRPC errors must stay client-safe",
                categoryId = Guid.NewGuid()
            });

            var body = await response.Content.ReadAsStringAsync();
            body.Should().NotContain("RpcException");
            body.Should().NotContain("StackTrace");
            body.Should().NotContain("Grpc.Core");
        }
        finally
        {
            _factory.SimulateGrpcNotFound(false);
        }
    }

    private async Task<Guid> CreateTodoAsync(string title)
    {
        var response = await _client.PostAsJsonAsync("/api/v1/todos", ValidCreateRequest(title));
        var bodyText = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.Created, bodyText);

        using var document = JsonDocument.Parse(bodyText);
        return document.RootElement.GetProperty("id").GetGuid();
    }

    private async Task<JsonDocument> SendInvalidCreateWithCorrelationAsync(string correlationId)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/todos")
        {
            Content = JsonContent.Create(new { title = "" })
        };
        request.Headers.Add("X-Correlation-ID", correlationId);

        var response = await _client.SendAsync(request);
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        return await ReadJsonAsync(response);
    }

    private static object ValidCreateRequest(string title) => new
    {
        title,
        description = "Created by integration test"
    };

    private static async Task<JsonDocument> ReadJsonAsync(HttpResponseMessage response)
    {
        var body = await response.Content.ReadAsStringAsync();
        body.Should().NotBeNullOrWhiteSpace();
        return JsonDocument.Parse(body);
    }

    private static void AssertFailureEnvelope(JsonDocument document, string expectedCode, string expectedMessageFragment)
    {
        var root = document.RootElement;
        root.GetProperty("success").GetBoolean().Should().BeFalse();
        var error = root.GetProperty("error");
        error.GetProperty("code").GetString().Should().Be(expectedCode);
        error.GetProperty("message").GetString().Should().Contain(expectedMessageFragment);
        root.GetProperty("meta").GetProperty("correlationId").GetString().Should().NotBeNullOrWhiteSpace();
    }
}
