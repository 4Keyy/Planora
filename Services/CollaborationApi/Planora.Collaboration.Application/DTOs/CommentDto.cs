namespace Planora.Collaboration.Application.DTOs
{
    /// <summary>
    /// Wire-compatible with the former TodoApi TodoCommentDto so the frontend timeline/"ветка"
    /// components need no shape changes — only their base URL moves to the Collaboration service.
    /// The <c>TodoItemId</c> field name is kept deliberately for that JSON contract compatibility.
    /// </summary>
    public sealed record CommentDto(
        Guid Id,
        Guid TodoItemId,
        Guid AuthorId,
        string AuthorName,
        string? AuthorAvatarUrl,
        string Content,
        DateTime CreatedAt,
        DateTime? UpdatedAt,
        bool IsOwn,
        bool IsEdited,
        bool IsSystemComment = false,
        bool IsGenesisComment = false
    );
}
