namespace Planora.Collaboration.Infrastructure.Persistence;

internal sealed class BranchDeletion
{
    public Guid TaskId { get; set; }
    // Guid.Empty represents deletion of the whole branch.
    public Guid SubtaskId { get; set; }
}
