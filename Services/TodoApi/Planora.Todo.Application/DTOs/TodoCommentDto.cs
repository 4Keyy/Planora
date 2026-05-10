namespace Planora.Todo.Application.DTOs
{
    public sealed record TodoCommentDto(
        Guid Id,
        Guid TodoItemId,
        Guid AuthorId,
        string AuthorName,
        string Content,
        DateTime CreatedAt,
        DateTime? UpdatedAt,
        bool IsOwn,
        bool IsEdited
    );
}
