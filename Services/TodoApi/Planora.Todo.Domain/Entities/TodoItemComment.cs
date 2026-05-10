using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.Todo.Domain.Events;

namespace Planora.Todo.Domain.Entities
{
    public sealed class TodoItemComment : BaseEntity, IAggregateRoot
    {
        public Guid TodoItemId { get; private set; }
        public Guid AuthorId { get; private set; }
        public string AuthorName { get; private set; } = string.Empty;
        public string Content { get; private set; } = string.Empty;

        public bool IsEdited =>
            UpdatedAt.HasValue && UpdatedAt.Value > CreatedAt.AddSeconds(5);

        private TodoItemComment() { }

        public static TodoItemComment Create(
            Guid todoItemId,
            Guid authorId,
            string authorName,
            string content)
        {
            if (todoItemId == Guid.Empty)
                throw new InvalidValueObjectException(nameof(TodoItemComment), "TodoItemId cannot be empty");
            if (authorId == Guid.Empty)
                throw new InvalidValueObjectException(nameof(TodoItemComment), "AuthorId cannot be empty");
            if (string.IsNullOrWhiteSpace(authorName))
                throw new InvalidValueObjectException(nameof(TodoItemComment), "AuthorName cannot be empty");
            if (string.IsNullOrWhiteSpace(content))
                throw new InvalidValueObjectException(nameof(TodoItemComment), "Content cannot be empty");
            if (content.Length > 2000)
                throw new InvalidValueObjectException(nameof(TodoItemComment), "Content cannot exceed 2000 characters");

            var comment = new TodoItemComment
            {
                TodoItemId = todoItemId,
                AuthorId = authorId,
                AuthorName = authorName.Trim(),
                Content = content.Trim(),
            };
            comment.AddDomainEvent(new TodoCommentAddedDomainEvent(comment.Id, todoItemId, authorId));

            return comment;
        }

        public void UpdateContent(string content, Guid editorUserId)
        {
            if (editorUserId != AuthorId)
                throw new ForbiddenException("Only the author can edit this comment");
            if (string.IsNullOrWhiteSpace(content))
                throw new InvalidValueObjectException(nameof(TodoItemComment), "Content cannot be empty");
            if (content.Length > 2000)
                throw new InvalidValueObjectException(nameof(TodoItemComment), "Content cannot exceed 2000 characters");

            Content = content.Trim();
            MarkAsModified(editorUserId);
        }
    }
}
