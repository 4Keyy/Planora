namespace Planora.BuildingBlocks.Application.Services;

/// <summary>
/// Service for logging structured business events.
/// </summary>
public interface IBusinessEventLogger
{
    void LogBusinessEvent(string eventType, string message, object? data = null, string? userId = null);
    void LogUserAction(string action, string userId, object? details = null);
}

/// <summary>
/// Common business event types.
/// </summary>
public static class BusinessEvents
{
    public const string SignupCompleted = "SIGNUP_COMPLETED";
    public const string FirstTaskCreated = "FIRST_TASK_CREATED";
    public const string FirstCategoryCreated = "FIRST_CATEGORY_CREATED";
    public const string FriendRequestSent = "FRIEND_REQUEST_SENT";
    public const string FriendRequestAccepted = "FRIEND_REQUEST_ACCEPTED";
    public const string TodoShared = "TODO_SHARED";
    public const string HiddenTodoRevealed = "HIDDEN_TODO_REVEALED";
    public const string SessionRestored = "SESSION_RESTORED";
    public const string TokenRefreshFailed = "TOKEN_REFRESH_FAILED";

    public const string UserRegistered = "USER_REGISTERED";
    public const string UserLoggedIn = "USER_LOGGED_IN";
    public const string UserLoggedOut = "USER_LOGGED_OUT";
    public const string PasswordChanged = "PASSWORD_CHANGED";
    public const string TodoCreated = "TODO_CREATED";
    public const string TodoUpdated = "TODO_UPDATED";
    public const string TodoDeleted = "TODO_DELETED";
    public const string TokenRefreshed = "TOKEN_REFRESHED";
    public const string MessageSent = "MESSAGE_SENT";
    public const string CategoryCreated = "CATEGORY_CREATED";
    public const string CategoryUpdated = "CATEGORY_UPDATED";
    public const string CategoryDeleted = "CATEGORY_DELETED";

    private static readonly HashSet<string> ProductEventAllowlist = new(StringComparer.Ordinal)
    {
        SignupCompleted,
        FirstTaskCreated,
        FirstCategoryCreated,
        FriendRequestSent,
        FriendRequestAccepted,
        TodoShared,
        HiddenTodoRevealed,
        SessionRestored,
        TokenRefreshFailed,
    };

    public static bool IsAllowedProductEvent(string eventName) =>
        ProductEventAllowlist.Contains(eventName);
}
