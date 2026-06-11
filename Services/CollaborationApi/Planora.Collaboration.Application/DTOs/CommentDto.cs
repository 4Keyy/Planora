namespace Planora.Collaboration.Application.DTOs
{
    /// <summary>
    /// Wire-compatible with the former TodoApi TodoCommentDto so the frontend timeline/"ветка"
    /// components need no shape changes — only their base URL moves to the Collaboration service.
    /// The <c>TodoItemId</c> field name is kept deliberately for that JSON contract compatibility.
    /// The reply block (<c>ReplyTo*</c>) is additive: null/false on plain comments, so existing
    /// clients keep working untouched.
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
        bool IsGenesisComment = false,
        // ── Reply reference (the quoted target) — all defaulted for plain comments ──
        // "comment" | "subtask" | null. Lower-case strings on the wire, mirroring the
        // frontend's literal union type.
        string? ReplyToType = null,
        Guid? ReplyToId = null,
        Guid? ReplyToAuthorId = null,
        // Live-resolved when the author still exists; falls back to the snapshot taken at
        // reply time so a quote never renders nameless.
        string? ReplyToAuthorName = null,
        string? ReplyToAuthorAvatarUrl = null,
        // One-line excerpt of the quoted comment/subtask. For comment targets this is
        // refreshed from the live target on read (so edits propagate); the stored snapshot
        // only backs deleted targets.
        string? ReplyToPreview = null,
        // True when the quoted target no longer exists — the UI renders a "deleted" quote.
        bool ReplyToDeleted = false
    );
}
