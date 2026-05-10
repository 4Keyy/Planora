namespace Planora.BuildingBlocks.Domain;

public abstract class AggregateRoot<TId> : BaseEntity<TId>
{
    // For Optimistic Concurrency
    public byte[] RowVersion { get; private set; } = Array.Empty<byte>();

    protected AggregateRoot() : base() { }

    protected AggregateRoot(TId id) : base()
    {
        Id = id;
    }
}

public abstract class BaseEntity<TId>
{
    public TId Id { get; protected set; } = default!;
    public DateTime CreatedAt { get; private set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; private set; }
    public string? CreatedBy { get; private set; }
    public string? UpdatedBy { get; private set; }

    protected BaseEntity() { }

    public void MarkUpdated(string? userId = null)
    {
        UpdatedAt = DateTime.UtcNow;
        UpdatedBy = userId;
    }

    public void MarkCreated(string? userId = null)
    {
        CreatedAt = DateTime.UtcNow;
        CreatedBy = userId;
    }
}
