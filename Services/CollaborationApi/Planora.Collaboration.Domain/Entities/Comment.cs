using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.Collaboration.Domain.Enums;
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
        /// <summary>
        /// Hard cap for the quoted-target excerpt stored on a reply. Long enough for a
        /// meaningful quote line, short enough to keep timeline pages lean.
        /// </summary>
        public const int ReplyPreviewMaxLength = 300;

        public Guid TaskId { get; private set; }
        public Guid AuthorId { get; private set; }
        public string AuthorName { get; private set; } = string.Empty;
        public string Content { get; private set; } = string.Empty;
        public bool IsSystemComment { get; private set; }
        public bool IsGenesisComment { get; private set; }

        // ── Reply reference (all null/false on a plain comment) ─────────────────────────────
        // The reference is a SNAPSHOT taken server-side at reply time: the preview and author
        // are captured from the validated target, never trusted from the client. Author
        // identity is still re-resolved live on read (the name here is only a fallback);
        // the preview self-heals from the live target content for comment targets.
        public ReplyTargetType? ReplyToType { get; private set; }
        public Guid? ReplyToId { get; private set; }
        public Guid? ReplyToAuthorId { get; private set; }
        public string? ReplyToAuthorName { get; private set; }
        public string? ReplyToPreview { get; private set; }

        /// <summary>
        /// Set when the reply's target is gone (the quoted comment was deleted, or the quoted
        /// subtask was removed via the SubtaskDeleted integration event). The reply itself
        /// survives with its snapshot — the UI renders the quote in a "deleted" state.
        /// </summary>
        public bool ReplyToDeleted { get; private set; }

        public bool IsReply => ReplyToType.HasValue;

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

        /// <summary>
        /// Creates a reply — a regular comment carrying a validated, server-captured snapshot
        /// of its target (another comment/reply or a subtask). The caller (application layer)
        /// is responsible for having validated that the target exists, lives in the same task
        /// branch and is a legal target (no system/genesis comments).
        /// </summary>
        public static Comment CreateReply(
            Guid taskId,
            Guid authorId,
            string authorName,
            string content,
            ReplyTargetType replyToType,
            Guid replyToId,
            Guid replyToAuthorId,
            string? replyToAuthorName,
            string? replyToPreview)
        {
            if (replyToId == Guid.Empty)
                throw new InvalidValueObjectException(nameof(Comment), "ReplyToId cannot be empty");
            if (!Enum.IsDefined(replyToType))
                throw new InvalidValueObjectException(nameof(Comment), "ReplyToType is not a valid target type");

            var comment = Create(taskId, authorId, authorName, content);
            comment.ReplyToType = replyToType;
            comment.ReplyToId = replyToId;
            comment.ReplyToAuthorId = replyToAuthorId == Guid.Empty ? null : replyToAuthorId;
            comment.ReplyToAuthorName = string.IsNullOrWhiteSpace(replyToAuthorName)
                ? null
                : replyToAuthorName.Trim();
            comment.ReplyToPreview = TruncatePreview(replyToPreview);
            return comment;
        }

        /// <summary>
        /// Normalises a quoted excerpt: trims, collapses to a single line and hard-caps the
        /// length so a multi-kilobyte target never bloats every page of the timeline.
        /// </summary>
        public static string? TruncatePreview(string? preview)
        {
            if (string.IsNullOrWhiteSpace(preview))
                return null;

            // A quote renders as one line — newlines become spaces before capping.
            var flat = string.Join(' ',
                preview.Split('\n', '\r').Select(s => s.Trim()).Where(s => s.Length > 0));

            return flat.Length <= ReplyPreviewMaxLength
                ? flat
                : flat[..(ReplyPreviewMaxLength - 1)].TrimEnd() + "…";
        }

        /// <summary>
        /// Marks the reply's quoted target as deleted. Deliberately does NOT touch
        /// <c>UpdatedAt</c> — this is not an edit by the author, and bumping the timestamp
        /// would falsely flag the reply as "edited" in the timeline.
        /// </summary>
        public void MarkReplyTargetDeleted()
        {
            if (!IsReply)
                throw new InvalidValueObjectException(nameof(Comment), "Only a reply has a target to mark deleted");
            ReplyToDeleted = true;
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
