namespace Planora.Collaboration.Infrastructure.Persistence.Configurations
{
    public sealed class CommentConfiguration : IEntityTypeConfiguration<Comment>
    {
        public void Configure(EntityTypeBuilder<Comment> builder)
        {
            builder.ToTable("comments");

            builder.HasKey(x => x.Id);

            builder.Property(x => x.TaskId).IsRequired();
            builder.Property(x => x.AuthorId).IsRequired();

            builder.Property(x => x.AuthorName)
                .IsRequired()
                .HasMaxLength(200);

            builder.Property(x => x.Content)
                .IsRequired()
                .HasMaxLength(5000);

            builder.Property(x => x.CreatedAt).IsRequired();
            builder.Property(x => x.UpdatedAt).IsRequired(false);
            builder.Property(x => x.DeletedAt).IsRequired(false);
            builder.Property(x => x.IsDeleted).HasDefaultValue(false);

            builder.Property(x => x.IsSystemComment)
                .IsRequired()
                .HasDefaultValue(false);

            builder.Property(x => x.IsGenesisComment)
                .IsRequired()
                .HasDefaultValue(false);

            // ── Reply reference (nullable on plain comments) ──
            // Stored as a string ("Comment"/"Subtask") for readable rows and stable values
            // even if enum members are ever reordered.
            builder.Property(x => x.ReplyToType)
                .HasConversion<string>()
                .HasMaxLength(16)
                .IsRequired(false);

            builder.Property(x => x.ReplyToId).IsRequired(false);
            builder.Property(x => x.ReplyToAuthorId).IsRequired(false);

            builder.Property(x => x.ReplyToAuthorName)
                .HasMaxLength(200)
                .IsRequired(false);

            builder.Property(x => x.ReplyToPreview)
                .HasMaxLength(Comment.ReplyPreviewMaxLength)
                .IsRequired(false);

            builder.Property(x => x.ReplyToDeleted)
                .IsRequired()
                .HasDefaultValue(false);

            // Reply-target lookups: the SubtaskDeleted cascade ("flag every reply quoting this
            // subtask") and any per-target fan-in are both keyed by (TaskId, ReplyToId).
            builder.HasIndex(x => new { x.TaskId, x.ReplyToId });

            // Optimised for timeline reads (ordered by creation per task).
            builder.HasIndex(x => new { x.TaskId, x.CreatedAt });

            // Index on AuthorId (carried over from develop T4.2): "comments authored by X"
            // queries — the UserDeleted cascade cleanup and moderation/audit views — would
            // otherwise seq-scan the table once a thread accumulates. Collaboration owns no
            // TodoItem aggregate, so there is no foreign key to the task (INV-OWN-1) — the
            // task↔comment link lives only as the TaskId value.
            builder.HasIndex(x => x.AuthorId);
        }
    }
}
