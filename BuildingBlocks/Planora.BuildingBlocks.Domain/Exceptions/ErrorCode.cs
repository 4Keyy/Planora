namespace Planora.BuildingBlocks.Domain.Exceptions;

/// <summary>
/// Unified error code catalog for the entire system.
/// Machine-readable error codes in format: SERVICE.OPERATION.ERROR
/// Example: AUTH.USER.NOT_FOUND, TODO.ITEM.CONCURRENCY_CONFLICT
/// </summary>
public static class ErrorCode
{
    // ============ VALIDATION ERRORS (4xx) ============
    public static class Validation
    {
        public const string InvalidInput = "VALIDATION.INVALID_INPUT";
        public const string MissingRequired = "VALIDATION.MISSING_REQUIRED";
        public const string InvalidFormat = "VALIDATION.INVALID_FORMAT";
        public const string InvalidLength = "VALIDATION.INVALID_LENGTH";
        public const string InvalidRange = "VALIDATION.INVALID_RANGE";
    }

    // ============ AUTHENTICATION ERRORS (401) ============
    public static class Auth
    {
        public const string MissingToken = "AUTH.MISSING_TOKEN";
        public const string InvalidToken = "AUTH.INVALID_TOKEN";
        public const string ExpiredToken = "AUTH.EXPIRED_TOKEN";
        public const string InvalidCredentials = "AUTH.INVALID_CREDENTIALS";
        public const string UserNotFound = "AUTH.USER_NOT_FOUND";
        public const string UserAlreadyExists = "AUTH.USER_ALREADY_EXISTS";
        public const string UserLocked = "AUTH.USER_LOCKED";
        public const string WeakPassword = "AUTH.WEAK_PASSWORD";
        public const string InvalidRefreshToken = "AUTH.INVALID_REFRESH_TOKEN";
        public const string RefreshTokenNotFound = "AUTH.REFRESH_TOKEN_NOT_FOUND";
        public const string RefreshTokenExpired = "AUTH.REFRESH_TOKEN_EXPIRED";
        public const string TokenBlacklisted = "AUTH.TOKEN_BLACKLISTED";
    }

    // ============ AUTHORIZATION ERRORS (403) ============
    public static class Authorization
    {
        public const string Forbidden = "AUTHORIZATION.FORBIDDEN";
        public const string InsufficientPermissions = "AUTHORIZATION.INSUFFICIENT_PERMISSIONS";
        public const string RoleRequired = "AUTHORIZATION.ROLE_REQUIRED";
    }

    // ============ RESOURCE NOT FOUND ERRORS (404) ============
    public static class NotFound
    {
        public const string UserNotFound = "NOT_FOUND.USER";
        public const string TodoItemNotFound = "NOT_FOUND.TODO_ITEM";
        public const string CategoryNotFound = "NOT_FOUND.CATEGORY";
        public const string ResourceNotFound = "NOT_FOUND.RESOURCE";
    }

    // ============ BUSINESS LOGIC ERRORS (409) ============
    public static class Business
    {
        public const string DuplicateEntity = "BUSINESS.DUPLICATE_ENTITY";
        public const string InvalidOperation = "BUSINESS.INVALID_OPERATION";
        public const string BusinessRuleViolation = "BUSINESS.RULE_VIOLATION";
        public const string ConflictingState = "BUSINESS.CONFLICTING_STATE";
    }

    // ============ CONCURRENCY ERRORS (409) ============
    public static class Concurrency
    {
        public const string ConflictOnUpdate = "CONCURRENCY.CONFLICT_ON_UPDATE";
        public const string ConflictOnDelete = "CONCURRENCY.CONFLICT_ON_DELETE";
        public const string EntityModifiedByAnother = "CONCURRENCY.ENTITY_MODIFIED_BY_ANOTHER";
    }

    // ============ INFRASTRUCTURE ERRORS (500/503) ============
    public static class Infrastructure
    {
        public const string DatabaseUnavailable = "INFRASTRUCTURE.DATABASE_UNAVAILABLE";
        public const string RedisUnavailable = "INFRASTRUCTURE.REDIS_UNAVAILABLE";
        public const string MessageQueueUnavailable = "INFRASTRUCTURE.MESSAGE_QUEUE_UNAVAILABLE";
        public const string ExternalServiceUnavailable = "INFRASTRUCTURE.EXTERNAL_SERVICE_UNAVAILABLE";
        public const string TimeoutException = "INFRASTRUCTURE.TIMEOUT";
        public const string CorruptedData = "INFRASTRUCTURE.CORRUPTED_DATA";
    }

    // ============ SYSTEM ERRORS (500) ============
    public static class System
    {
        public const string UnexpectedException = "SYSTEM.UNEXPECTED_EXCEPTION";
        public const string NotImplemented = "SYSTEM.NOT_IMPLEMENTED";
        public const string InternalError = "SYSTEM.INTERNAL_ERROR";
    }
}
