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
        public string? AuthorAvatarUrl { get; private set; }
        public string Content { get; private set; } = string.Empty;
        public bool IsSystemComment { get; private set; }
        public bool IsGenesisComment { get; private set; }

        public bool IsEdited =>
            (!IsSystemComment || IsGenesisComment) && UpdatedAt.HasValue && UpdatedAt.Value > CreatedAt.AddSeconds(5);

        private TodoItemComment() { }

        public static TodoItemComment Create(
            Guid todoItemId,
            Guid authorId,
            string authorName,
            string content,
            string? authorAvatarUrl = null)
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
                AuthorAvatarUrl = authorAvatarUrl,
                Content = content.Trim(),
                IsSystemComment = false,
            };
            comment.AddDomainEvent(new TodoCommentAddedDomainEvent(comment.Id, todoItemId, authorId));

            return comment;
        }

        public static TodoItemComment CreateSystem(Guid todoItemId, string content)
        {
            if (todoItemId == Guid.Empty)
                throw new InvalidValueObjectException(nameof(TodoItemComment), "TodoItemId cannot be empty");
            if (string.IsNullOrWhiteSpace(content))
                throw new InvalidValueObjectException(nameof(TodoItemComment), "Content cannot be empty");

            return new TodoItemComment
            {
                TodoItemId = todoItemId,
                AuthorId = Guid.Empty,
                AuthorName = string.Empty,
                Content = content.Trim(),
                IsSystemComment = true,
                IsGenesisComment = false,
            };
        }

        public static TodoItemComment CreateGenesis(
            Guid todoItemId,
            string content,
            string authorName,
            string? authorAvatarUrl = null)
        {
            if (todoItemId == Guid.Empty)
                throw new InvalidValueObjectException(nameof(TodoItemComment), "TodoItemId cannot be empty");
            if (string.IsNullOrWhiteSpace(content))
                throw new InvalidValueObjectException(nameof(TodoItemComment), "Content cannot be empty");
            if (content.Length > 5000)
                throw new InvalidValueObjectException(nameof(TodoItemComment), "Description cannot exceed 5000 characters");

            return new TodoItemComment
            {
                TodoItemId = todoItemId,
                AuthorId = Guid.Empty,
                AuthorName = string.IsNullOrWhiteSpace(authorName) ? string.Empty : authorName.Trim(),
                // Normalise empty string → null so the live-avatar enrichment triggers on read
                AuthorAvatarUrl = string.IsNullOrEmpty(authorAvatarUrl) ? null : authorAvatarUrl,
                Content = content.Trim(),
                IsSystemComment = true,
                IsGenesisComment = true,
            };
        }

        public void UpdateGenesisContent(string content, Guid ownerUserId)
        {
            if (!IsGenesisComment)
                throw new ForbiddenException("Only the genesis comment can be updated via this method");
            if (string.IsNullOrWhiteSpace(content))
                throw new InvalidValueObjectException(nameof(TodoItemComment), "Content cannot be empty");
            if (content.Length > 5000)
                throw new InvalidValueObjectException(nameof(TodoItemComment), "Description cannot exceed 5000 characters");

            Content = content.Trim();
            MarkAsModified(ownerUserId);
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
