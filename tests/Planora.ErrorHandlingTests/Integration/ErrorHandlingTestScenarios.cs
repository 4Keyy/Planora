namespace Planora.ErrorHandlingTests.Integration;

/// <summary>
/// Comprehensive integration test scenarios covering:
/// - Invalid input validation
/// - Non-existent resources
/// - Concurrent updates
/// - Authentication/Authorization failures
/// - Infrastructure failures
/// - Timeout scenarios
/// 
/// Each scenario validates:
/// ✓ Correct HTTP status code
/// ✓ Structured ProblemDetails response
/// ✓ Error code in response
/// ✓ Trace ID in response
/// ✓ No stack trace exposure
/// ✓ Field errors (if validation)
/// </summary>
public static class ErrorHandlingTestScenarios
{
    public static class ValidationScenarios
    {
        /// <summary>Scenario: POST /api/users with invalid email format</summary>
        public static readonly ErrorTestScenario InvalidEmailFormat = new()
        {
            Name = "Invalid Email Format",
            Description = "User submits registration with malformed email",
            Endpoint = "POST /api/auth/register",
            RequestBody = new { email = "not-an-email", password = "ValidPass123!" },
            ExpectedStatusCode = 400,
            ExpectedErrorCode = "VALIDATION.INVALID_INPUT",
            ExpectedTitle = "Validation Error",
            ShouldContainValidationErrors = true,
            ShouldContainStackTrace = false
        };

        /// <summary>Scenario: POST /api/users with missing required field</summary>
        public static readonly ErrorTestScenario MissingRequiredField = new()
        {
            Name = "Missing Required Field",
            Description = "User submits form without password field",
            Endpoint = "POST /api/auth/register",
            RequestBody = new { email = "user@example.com" },
            ExpectedStatusCode = 400,
            ExpectedErrorCode = "VALIDATION.INVALID_INPUT",
            ExpectedTitle = "Validation Error"
        };

        /// <summary>Scenario: POST /api/todos with empty title</summary>
        public static readonly ErrorTestScenario InvalidLength = new()
        {
            Name = "Invalid Field Length",
            Description = "Todo title exceeds maximum length",
            Endpoint = "POST /api/todos",
            RequestBody = new { title = new string('a', 1001), description = "Test" },
            ExpectedStatusCode = 400,
            ExpectedErrorCode = "VALIDATION.INVALID_LENGTH"
        };
    }

    public static class NotFoundScenarios
    {
        /// <summary>Scenario: GET /api/users/00000000-0000-0000-0000-000000000000</summary>
        public static readonly ErrorTestScenario UserNotFound = new()
        {
            Name = "User Not Found",
            Description = "Request for non-existent user ID",
            Endpoint = "GET /api/users/{invalidId}",
            ExpectedStatusCode = 404,
            ExpectedErrorCode = "NOT_FOUND.USER",
            ExpectedTitle = "Not Found",
            ShouldContainStackTrace = false
        };

        /// <summary>Scenario: GET /api/todos/00000000-0000-0000-0000-000000000000</summary>
        public static readonly ErrorTestScenario TodoNotFound = new()
        {
            Name = "Todo Item Not Found",
            Description = "Request for non-existent todo item",
            Endpoint = "GET /api/todos/{invalidId}",
            ExpectedStatusCode = 404,
            ExpectedErrorCode = "NOT_FOUND.TODO_ITEM"
        };

        /// <summary>Scenario: GET /api/categories/00000000-0000-0000-0000-000000000000</summary>
        public static readonly ErrorTestScenario CategoryNotFound = new()
        {
            Name = "Category Not Found",
            Description = "Request for non-existent category",
            Endpoint = "GET /api/categories/{invalidId}",
            ExpectedStatusCode = 404,
            ExpectedErrorCode = "NOT_FOUND.CATEGORY"
        };
    }

    public static class AuthenticationScenarios
    {
        /// <summary>Scenario: GET /api/protected without Authorization header</summary>
        public static readonly ErrorTestScenario MissingToken = new()
        {
            Name = "Missing Authentication Token",
            Description = "Request without authorization header",
            Endpoint = "GET /api/todos",
            Headers = new Dictionary<string, string>(),
            ExpectedStatusCode = 401,
            ExpectedErrorCode = "AUTH.MISSING_TOKEN",
            ExpectedTitle = "Unauthorized"
        };

        /// <summary>Scenario: GET /api/protected with expired JWT</summary>
        public static readonly ErrorTestScenario ExpiredToken = new()
        {
            Name = "Expired Authentication Token",
            Description = "Request with expired JWT token",
            Endpoint = "GET /api/todos",
            Headers = new Dictionary<string, string> { ["Authorization"] = "Bearer eyExpiredToken" },
            ExpectedStatusCode = 401,
            ExpectedErrorCode = "AUTH.EXPIRED_TOKEN"
        };

        /// <summary>Scenario: POST /api/auth/login with wrong password</summary>
        public static readonly ErrorTestScenario InvalidCredentials = new()
        {
            Name = "Invalid Credentials",
            Description = "Login attempt with wrong password",
            Endpoint = "POST /api/auth/login",
            RequestBody = new { email = "user@example.com", password = "WrongPassword123!" },
            ExpectedStatusCode = 401,
            ExpectedErrorCode = "AUTH.INVALID_CREDENTIALS"
        };

        /// <summary>Scenario: POST /api/auth/register with existing email</summary>
        public static readonly ErrorTestScenario UserAlreadyExists = new()
        {
            Name = "User Already Exists",
            Description = "Registration with email that already has account",
            Endpoint = "POST /api/auth/register",
            RequestBody = new { email = "existing@example.com", password = "ValidPass123!" },
            ExpectedStatusCode = 409,
            ExpectedErrorCode = "AUTH.USER_ALREADY_EXISTS",
            ExpectedTitle = "Conflict"
        };

        /// <summary>Scenario: POST /api/auth/login with locked account</summary>
        public static readonly ErrorTestScenario UserLocked = new()
        {
            Name = "User Account Locked",
            Description = "Login attempt on locked account (too many failed attempts)",
            Endpoint = "POST /api/auth/login",
            RequestBody = new { email = "locked@example.com", password = "ValidPass123!" },
            ExpectedStatusCode = 401,
            ExpectedErrorCode = "AUTH.USER_LOCKED"
        };

        /// <summary>Scenario: POST /api/auth/register with weak password</summary>
        public static readonly ErrorTestScenario WeakPassword = new()
        {
            Name = "Weak Password",
            Description = "Registration with password that doesn't meet requirements",
            Endpoint = "POST /api/auth/register",
            RequestBody = new { email = "user@example.com", password = "weak" },
            ExpectedStatusCode = 400,
            ExpectedErrorCode = "AUTH.WEAK_PASSWORD"
        };
    }

    public static class AuthorizationScenarios
    {
        /// <summary>Scenario: DELETE /api/users/{otherId} as non-admin user</summary>
        public static readonly ErrorTestScenario InsufficientPermissions = new()
        {
            Name = "Insufficient Permissions",
            Description = "User lacks required role to perform action",
            Endpoint = "DELETE /api/users/{otherId}",
            Headers = new Dictionary<string, string> { ["Authorization"] = "Bearer userToken" },
            ExpectedStatusCode = 403,
            ExpectedErrorCode = "AUTHORIZATION.FORBIDDEN",
            ExpectedTitle = "Forbidden"
        };

        /// <summary>Scenario: POST /api/admin/settings without admin role</summary>
        public static readonly ErrorTestScenario RoleRequired = new()
        {
            Name = "Role Required",
            Description = "Endpoint requires specific role",
            Endpoint = "POST /api/admin/settings",
            Headers = new Dictionary<string, string> { ["Authorization"] = "Bearer userToken" },
            ExpectedStatusCode = 403,
            ExpectedErrorCode = "AUTHORIZATION.ROLE_REQUIRED"
        };
    }

    public static class ConcurrencyScenarios
    {
        /// <summary>Scenario: PUT /api/todos/{id} when entity was modified by another user</summary>
        public static readonly ErrorTestScenario ConcurrencyConflict = new()
        {
            Name = "Concurrency Conflict",
            Description = "Attempt to update entity that was modified by another user",
            Endpoint = "PUT /api/todos/{id}",
            RequestBody = new { title = "Updated", version = 1 },
            ExpectedStatusCode = 409,
            ExpectedErrorCode = "CONCURRENCY.CONFLICT_ON_UPDATE",
            ExpectedTitle = "Conflict"
        };

        /// <summary>Scenario: DELETE /api/todos/{id} when entity was modified</summary>
        public static readonly ErrorTestScenario DeleteConflict = new()
        {
            Name = "Delete Concurrency Conflict",
            Description = "Attempt to delete entity with stale version",
            Endpoint = "DELETE /api/todos/{id}",
            RequestBody = new { version = 1 },
            ExpectedStatusCode = 409,
            ExpectedErrorCode = "CONCURRENCY.CONFLICT_ON_DELETE"
        };
    }

    public static class BusinessLogicScenarios
    {
        /// <summary>Scenario: POST /api/todos with duplicate title in same category</summary>
        public static readonly ErrorTestScenario DuplicateEntity = new()
        {
            Name = "Duplicate Entity",
            Description = "Attempt to create duplicate entity",
            Endpoint = "POST /api/todos",
            RequestBody = new { title = "Existing Title", categoryId = "category123" },
            ExpectedStatusCode = 409,
            ExpectedErrorCode = "BUSINESS.DUPLICATE_ENTITY"
        };

        /// <summary>Scenario: POST /api/todos with marked-complete item</summary>
        public static readonly ErrorTestScenario BusinessRuleViolation = new()
        {
            Name = "Business Rule Violation",
            Description = "Action violates business rule",
            Endpoint = "POST /api/todos/{id}/sub-items",
            RequestBody = new { title = "Subtask" },
            ExpectedStatusCode = 409,
            ExpectedErrorCode = "BUSINESS.RULE_VIOLATION"
        };
    }

    public static class InfrastructureScenarios
    {
        /// <summary>Scenario: Any request when database is down</summary>
        public static readonly ErrorTestScenario DatabaseUnavailable = new()
        {
            Name = "Database Unavailable",
            Description = "PostgreSQL connection failure",
            Endpoint = "GET /api/todos",
            ExpectedStatusCode = 500,
            ExpectedErrorCode = "INFRASTRUCTURE.DATABASE_UNAVAILABLE",
            ExpectedTitle = "Internal Server Error"
        };

        /// <summary>Scenario: Redis cache operation timeout</summary>
        public static readonly ErrorTestScenario RedisUnavailable = new()
        {
            Name = "Redis Unavailable",
            Description = "Redis connection or timeout",
            Endpoint = "GET /api/todos",
            ExpectedStatusCode = 500,
            ExpectedErrorCode = "INFRASTRUCTURE.REDIS_UNAVAILABLE"
        };

        /// <summary>Scenario: RabbitMQ message queue unavailable</summary>
        public static readonly ErrorTestScenario MessageQueueUnavailable = new()
        {
            Name = "Message Queue Unavailable",
            Description = "RabbitMQ broker unreachable",
            Endpoint = "POST /api/todos",
            ExpectedStatusCode = 500,
            ExpectedErrorCode = "INFRASTRUCTURE.MESSAGE_QUEUE_UNAVAILABLE"
        };

        /// <summary>Scenario: External service (gRPC) timeout</summary>
        public static readonly ErrorTestScenario ExternalServiceTimeout = new()
        {
            Name = "External Service Timeout",
            Description = "gRPC call to another service times out",
            Endpoint = "POST /api/todos",
            ExpectedStatusCode = 503,
            ExpectedErrorCode = "INFRASTRUCTURE.TIMEOUT",
            ExpectedTitle = "Service Unavailable"
        };

        /// <summary>Scenario: External service returns error</summary>
        public static readonly ErrorTestScenario ExternalServiceUnavailable = new()
        {
            Name = "External Service Unavailable",
            Description = "Downstream microservice is down",
            Endpoint = "GET /api/todos",
            ExpectedStatusCode = 503,
            ExpectedErrorCode = "INFRASTRUCTURE.EXTERNAL_SERVICE_UNAVAILABLE"
        };
    }

    public static class SystemScenarios
    {
        /// <summary>Scenario: Unhandled exception in application code</summary>
        public static readonly ErrorTestScenario UnexpectedException = new()
        {
            Name = "Unexpected Exception",
            Description = "Unhandled exception in application logic",
            Endpoint = "GET /api/todos",
            ExpectedStatusCode = 500,
            ExpectedErrorCode = "SYSTEM.UNEXPECTED_EXCEPTION",
            ExpectedTitle = "Unexpected Error"
        };
    }

    public static IEnumerable<ErrorTestScenario> GetAllScenarios()
    {
        yield return ValidationScenarios.InvalidEmailFormat;
        yield return ValidationScenarios.MissingRequiredField;
        yield return ValidationScenarios.InvalidLength;

        yield return NotFoundScenarios.UserNotFound;
        yield return NotFoundScenarios.TodoNotFound;
        yield return NotFoundScenarios.CategoryNotFound;

        yield return AuthenticationScenarios.MissingToken;
        yield return AuthenticationScenarios.ExpiredToken;
        yield return AuthenticationScenarios.InvalidCredentials;
        yield return AuthenticationScenarios.UserAlreadyExists;
        yield return AuthenticationScenarios.UserLocked;
        yield return AuthenticationScenarios.WeakPassword;

        yield return AuthorizationScenarios.InsufficientPermissions;
        yield return AuthorizationScenarios.RoleRequired;

        yield return ConcurrencyScenarios.ConcurrencyConflict;
        yield return ConcurrencyScenarios.DeleteConflict;

        yield return BusinessLogicScenarios.DuplicateEntity;
        yield return BusinessLogicScenarios.BusinessRuleViolation;

        yield return InfrastructureScenarios.DatabaseUnavailable;
        yield return InfrastructureScenarios.RedisUnavailable;
        yield return InfrastructureScenarios.MessageQueueUnavailable;
        yield return InfrastructureScenarios.ExternalServiceTimeout;
        yield return InfrastructureScenarios.ExternalServiceUnavailable;

        yield return SystemScenarios.UnexpectedException;
    }
}

public class ErrorTestScenario
{
    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string Endpoint { get; set; } = string.Empty;
    public object? RequestBody { get; set; }
    public Dictionary<string, string>? Headers { get; set; }
    public int ExpectedStatusCode { get; set; }
    public string ExpectedErrorCode { get; set; } = string.Empty;
    public string ExpectedTitle { get; set; } = "Error";
    public bool ShouldContainValidationErrors { get; set; } = false;
    public bool ShouldContainStackTrace { get; set; } = false;

    public override string ToString() => $"{Name}: {ExpectedStatusCode} {ExpectedErrorCode}";
}
