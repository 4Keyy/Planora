using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.Collaboration.Domain.Events;

namespace Planora.Collaboration.Domain.Entities
{
    /// <summary>
    /// A single entry in a task's activity timeline ("ветка"). Carries the same three flavours
    /// the timeline has always had: a regular user comment, the genesis comment (the task's
    /// initial description / author note) and auto-generated system event comments. Ported
    /// verbatim from the former TodoApi.TodoItemComment — the only change is that the foreign
    /// reference is named <see cref="TaskId"/> because this service owns no task aggregate.
    /// </summary>
    public sealed class Comment : BaseEntity, IAggregateRoot
    {
        public Guid TaskId { get; private set; }
        public Guid AuthorId { get; private set; }
        public string AuthorName { get; private set; } = string.Empty;
        public string Content { get; private set; } = string.Empty;
        public bool IsSystemComment { get; private set; }
        public bool IsGenesisComment { get; private set; }

        public bool IsEdited =>
            (!IsSystemComment || IsGenesisComment) && UpdatedAt.HasValue && UpdatedAt.Value > CreatedAt.AddSeconds(5);

        private Comment() { }

        public static Comment Create(
            Guid taskId,
            Guid authorId,
            string authorName,
            string content)
        {
            if (taskId == Guid.Empty)
                throw new InvalidValueObjectException(nameof(Comment), "TaskId cannot be empty");
            if (authorId == Guid.Empty)
                throw new InvalidValueObjectException(nameof(Comment), "AuthorId cannot be empty");
            if (string.IsNullOrWhiteSpace(authorName))
                throw new InvalidValueObjectException(nameof(Comment), "AuthorName cannot be empty");
            if (string.IsNullOrWhiteSpace(content))
                throw new InvalidValueObjectException(nameof(Comment), "Content cannot be empty");
            if (content.Length > 2000)
                throw new InvalidValueObjectException(nameof(Comment), "Content cannot exceed 2000 characters");

            var comment = new Comment
            {
                TaskId = taskId,
                AuthorId = authorId,
                AuthorName = authorName.Trim(),
                Content = content.Trim(),
                IsSystemComment = false,
            };
            comment.AddDomainEvent(new CommentAddedDomainEvent(comment.Id, taskId, authorId));

            return comment;
        }

        public static Comment CreateSystem(Guid taskId, string content)
        {
            if (taskId == Guid.Empty)
                throw new InvalidValueObjectException(nameof(Comment), "TaskId cannot be empty");
            if (string.IsNullOrWhiteSpace(content))
                throw new InvalidValueObjectException(nameof(Comment), "Content cannot be empty");

            return new Comment
            {
                TaskId = taskId,
                AuthorId = Guid.Empty,
                AuthorName = string.Empty,
                Content = content.Trim(),
                IsSystemComment = true,
                IsGenesisComment = false,
            };
        }

        public void UpdateContent(string content, Guid editorUserId)
        {
            if (editorUserId != AuthorId)
                throw new ForbiddenException("Only the author can edit this comment");
            if (string.IsNullOrWhiteSpace(content))
                throw new InvalidValueObjectException(nameof(Comment), "Content cannot be empty");
            if (content.Length > 2000)
                throw new InvalidValueObjectException(nameof(Comment), "Content cannot exceed 2000 characters");

            Content = content.Trim();
            MarkAsModified(editorUserId);
        }
    }
}
