using System.Data;
using Planora.Collaboration.Application.Services;
using Planora.Collaboration.Domain.Enums;

namespace Planora.Collaboration.Infrastructure.Persistence.Repositories;

public sealed class BranchTimeline(
    CollaborationDbContext db,
    ICommentRepository comments,
    IUnitOfWork unitOfWork) : IBranchTimeline
{
    private const int BranchLockNamespace = 742810642;

    public async Task<TimelineAppendResult> AppendAsync(Comment comment, CancellationToken cancellationToken,
        Func<CancellationToken, Task>? stageOutbox = null)
    {
        var subtaskId = comment.SourceSubtaskId ??
            (comment.ReplyToType == ReplyTargetType.Subtask ? comment.ReplyToId : null);
        var staged = false;
        var result = TimelineAppendResult.TaskDeleted;
        try
        {
            result = await db.Database.CreateExecutionStrategy().ExecuteInTransactionAsync(
                async token =>
                {
                    await LockBranchAsync(comment.TaskId, token);
                    var deleted = await db.BranchDeletions
                        .Where(row => row.TaskId == comment.TaskId &&
                            (row.SubtaskId == Guid.Empty || row.SubtaskId == subtaskId))
                        .Select(row => row.SubtaskId)
                        .ToListAsync(token);
                    if (deleted.Contains(Guid.Empty))
                        return TimelineAppendResult.TaskDeleted;
                    if (deleted.Count != 0)
                        return TimelineAppendResult.SubtaskDeleted;

                    // Reuse the same IDs if the commit is retried. Eligibility is checked each time.
                    if (!staged)
                    {
                        try
                        {
                            await comments.AddAsync(comment, token);
                            if (stageOutbox is not null)
                                await stageOutbox(token);
                            staged = true;
                        }
                        catch
                        {
                            db.ChangeTracker.Clear();
                            throw;
                        }
                    }

                    await db.SaveChangesAsync(acceptAllChangesOnSuccess: false, token);
                    return TimelineAppendResult.Added;
                },
                token => db.Comments.AnyAsync(row => row.Id == comment.Id, token),
                IsolationLevel.ReadCommitted, cancellationToken);

            if (result == TimelineAppendResult.Added)
                db.ChangeTracker.AcceptAllChanges();
            return result;
        }
        finally
        {
            // A deletion may win between attempts. Never leave staged rows for the inbox save.
            if (staged && result != TimelineAppendResult.Added)
                db.ChangeTracker.Clear();
        }
    }

    public Task DeleteTaskAsync(Guid taskId, Guid actorId, CancellationToken cancellationToken) =>
        DeleteAsync(taskId, Guid.Empty, token => comments.SoftDeleteByTaskIdAsync(taskId, actorId, token),
            cancellationToken);

    public Task DeleteSubtaskAsync(Guid taskId, Guid subtaskId, Guid actorId, CancellationToken cancellationToken)
    {
        if (subtaskId == Guid.Empty)
            return Task.CompletedTask;

        return DeleteAsync(taskId, subtaskId, async token =>
        {
            await comments.SoftDeleteSubtaskActivityAsync(taskId, subtaskId, actorId, token);
            await comments.MarkSubtaskReplyTargetsDeletedAsync(taskId, subtaskId, token);
        }, cancellationToken);
    }

    private async Task DeleteAsync(Guid taskId, Guid subtaskId, Func<CancellationToken, Task> cleanup,
        CancellationToken cancellationToken)
    {
        var started = false;
        try
        {
            await db.Database.CreateExecutionStrategy().ExecuteAsync(async token =>
            {
                if (started)
                    db.ChangeTracker.Clear();
                started = true;
                await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, token);
                await LockBranchAsync(taskId, token);
                await db.Database.ExecuteSqlInterpolatedAsync($"""
                    INSERT INTO collaboration.branch_deletions ("TaskId", "SubtaskId")
                    VALUES ({taskId}, {subtaskId}) ON CONFLICT ("TaskId", "SubtaskId") DO NOTHING
                    """, token);
                await cleanup(token);
                await unitOfWork.SaveChangesAsync(token);
                await transaction.CommitAsync(token);
            }, cancellationToken);
        }
        catch
        {
            db.ChangeTracker.Clear();
            throw;
        }
    }

    private Task LockBranchAsync(Guid taskId, CancellationToken cancellationToken) =>
        db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT pg_catalog.pg_advisory_xact_lock({BranchLockNamespace}, pg_catalog.hashtext({taskId.ToString("N")}))",
            cancellationToken);
}
