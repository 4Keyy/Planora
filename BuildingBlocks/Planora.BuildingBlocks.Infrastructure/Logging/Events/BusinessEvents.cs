namespace Planora.BuildingBlocks.Infrastructure.Logging.Events;

/// <summary>
/// User registration business event for audit logging.
/// </summary>
public sealed class UserRegisteredEvent : BusinessEvent
{
    public string Email { get; }
    public string? Username { get; }
    public string RegistrationMethod { get; }

    public UserRegisteredEvent(string email, string? username, string registrationMethod = "Standard")
        : base("USER_REGISTERED")
    {
        Email = email ?? throw new ArgumentNullException(nameof(email));
        Username = username;
        RegistrationMethod = registrationMethod;
    }

    public override Dictionary<string, object> ToLogProperties()
    {
        var properties = base.ToLogProperties();
        properties["Email"] = Email;
        properties["Username"] = Username ?? "N/A";
        properties["RegistrationMethod"] = RegistrationMethod;
        return properties;
    }
}

/// <summary>
/// User login business event for audit and security monitoring.
/// </summary>
public sealed class UserLoggedInEvent : BusinessEvent
{
    public string Email { get; }
    public string IpAddress { get; }
    public string UserAgent { get; }
    public bool TwoFactorUsed { get; }

    public UserLoggedInEvent(string email, string ipAddress, string userAgent, bool twoFactorUsed)
        : base("USER_LOGGED_IN")
    {
        Email = email ?? throw new ArgumentNullException(nameof(email));
        IpAddress = ipAddress ?? "Unknown";
        UserAgent = userAgent ?? "Unknown";
        TwoFactorUsed = twoFactorUsed;
    }

    public override Dictionary<string, object> ToLogProperties()
    {
        var properties = base.ToLogProperties();
        properties["Email"] = Email;
        properties["IpAddress"] = IpAddress;
        properties["UserAgent"] = UserAgent;
        properties["TwoFactorUsed"] = TwoFactorUsed;
        return properties;
    }
}

/// <summary>
/// Token refresh business event for security monitoring.
/// </summary>
public sealed class TokenRefreshedEvent : BusinessEvent
{
    public string TokenType { get; }
    public DateTime ExpiresAt { get; }

    public TokenRefreshedEvent(string tokenType, DateTime expiresAt)
        : base("TOKEN_REFRESHED")
    {
        TokenType = tokenType ?? throw new ArgumentNullException(nameof(tokenType));
        ExpiresAt = expiresAt;
    }

    public override Dictionary<string, object> ToLogProperties()
    {
        var properties = base.ToLogProperties();
        properties["TokenType"] = TokenType;
        properties["ExpiresAt"] = ExpiresAt;
        return properties;
    }
}

/// <summary>
/// Todo item created business event.
/// </summary>
public sealed class TodoCreatedEvent : BusinessEvent
{
    public Guid TodoId { get; }
    public string Title { get; }
    public Guid? CategoryId { get; }

    public TodoCreatedEvent(Guid todoId, string title, Guid? categoryId)
        : base("TODO_CREATED")
    {
        TodoId = todoId;
        Title = title ?? throw new ArgumentNullException(nameof(title));
        CategoryId = categoryId;
    }

    public override Dictionary<string, object> ToLogProperties()
    {
        var properties = base.ToLogProperties();
        properties["TodoId"] = TodoId;
        properties["Title"] = Title;
        properties["CategoryId"] = CategoryId?.ToString() ?? "N/A";
        return properties;
    }
}

/// <summary>
/// Todo item completed business event.
/// </summary>
public sealed class TodoCompletedEvent : BusinessEvent
{
    public Guid TodoId { get; }
    public TimeSpan Duration { get; }

    public TodoCompletedEvent(Guid todoId, TimeSpan duration)
        : base("TODO_COMPLETED")
    {
        TodoId = todoId;
        Duration = duration;
    }

    public override Dictionary<string, object> ToLogProperties()
    {
        var properties = base.ToLogProperties();
        properties["TodoId"] = TodoId;
        properties["DurationHours"] = Duration.TotalHours;
        return properties;
    }
}

/// <summary>
/// Message sent business event.
/// </summary>
public sealed class MessageSentEvent : BusinessEvent
{
    public Guid MessageId { get; }
    public Guid RecipientId { get; }
    public int MessageLength { get; }

    public MessageSentEvent(Guid messageId, Guid recipientId, int messageLength)
        : base("MESSAGE_SENT")
    {
        MessageId = messageId;
        RecipientId = recipientId;
        MessageLength = messageLength;
    }

    public override Dictionary<string, object> ToLogProperties()
    {
        var properties = base.ToLogProperties();
        properties["MessageId"] = MessageId;
        properties["RecipientId"] = RecipientId;
        properties["MessageLength"] = MessageLength;
        return properties;
    }
}

/// <summary>
/// Category created business event.
/// </summary>
public sealed class CategoryCreatedEvent : BusinessEvent
{
    public Guid CategoryId { get; }
    public string Name { get; }
    public string? Color { get; }

    public CategoryCreatedEvent(Guid categoryId, string name, string? color)
        : base("CATEGORY_CREATED")
    {
        CategoryId = categoryId;
        Name = name ?? throw new ArgumentNullException(nameof(name));
        Color = color;
    }

    public override Dictionary<string, object> ToLogProperties()
    {
        var properties = base.ToLogProperties();
        properties["CategoryId"] = CategoryId;
        properties["Name"] = Name;
        properties["Color"] = Color ?? "N/A";
        return properties;
    }
}
