using Planora.Category.Domain.Events;

namespace Planora.Category.Domain.Entities;

public sealed class Category : BaseEntity, IAggregateRoot
{
    public Guid UserId { get; private set; }
    public string Name { get; private set; } = string.Empty;
    public string? Description { get; private set; }
    public string Color { get; private set; } = "#000000";
    public string? Icon { get; private set; }
    public int Order { get; private set; }
    public Guid? ParentCategoryId { get; private set; }
    public bool IsArchived { get; private set; }

    public Category? ParentCategory { get; private set; }
    public ICollection<Category> SubCategories { get; private set; } = new List<Category>();

    private Category() : base() { }

    public static Category Create(
        Guid userId,
        string name,
        string? description,
        string color,
        string? icon,
        int order,
        Guid? parentCategoryId = null)
    {
        ValidateName(name);
        ValidateColor(color);

        var category = new Category
        {
            UserId = userId,
            Name = name,
            Description = description,
            Color = color,
            Icon = icon,
            Order = order,
            ParentCategoryId = parentCategoryId,
            IsArchived = false
        };
        category.MarkAsModified(userId);

        return category;
    }

    public void UpdateName(string name)
    {
        ValidateName(name);
        Name = name;
        MarkAsModified(UserId);
    }

    public void UpdateDescription(string? description)
    {
        Description = description;
        MarkAsModified(UserId);
    }

    public void UpdateAppearance(string color, string? icon)
    {
        ValidateColor(color);
        Color = color;
        Icon = icon;
        MarkAsModified(UserId);
    }

    public void SetDisplayOrder(int order)
    {
        if (order < 0)
            throw new ArgumentException("Order must be non-negative", nameof(order));

        Order = order;
        MarkAsModified(UserId);
    }

    public void Update(
        string name,
        string? description,
        string color,
        string? icon,
        int order)
    {
        ValidateName(name);
        ValidateColor(color);

        Name = name;
        Description = description;
        Color = color;
        Icon = icon;
        Order = order;
        MarkAsModified(UserId);
    }

    public void Archive()
    {
        IsArchived = true;
        MarkAsModified(UserId);
    }

    public void Unarchive()
    {
        IsArchived = false;
        MarkAsModified(UserId);
    }

    public void Delete(Guid deletedBy)
    {
        if (UserId != deletedBy)
            throw new UnauthorizedAccessException("Only the owner can delete the category");

        MarkAsDeleted(deletedBy);
        AddDomainEvent(new CategoryDeletedDomainEvent(Id, UserId));
    }

    private static void ValidateName(string name)
    {
        if (string.IsNullOrWhiteSpace(name))
            throw new ArgumentException("Category name cannot be empty", nameof(name));

        if (name.Length > 100)
            throw new ArgumentException("Category name cannot exceed 100 characters", nameof(name));
    }

    private static void ValidateColor(string color)
    {
        if (string.IsNullOrWhiteSpace(color))
            throw new ArgumentException("Color cannot be empty", nameof(color));

        if (!System.Text.RegularExpressions.Regex.IsMatch(color, "^#[0-9A-Fa-f]{6}$"))
            throw new ArgumentException("Color must be a valid hex color code", nameof(color));
    }
}