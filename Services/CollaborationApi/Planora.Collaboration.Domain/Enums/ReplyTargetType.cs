namespace Planora.Collaboration.Domain.Enums
{
    /// <summary>
    /// What a reply comment points at. Replies are ordinary comments that carry a quoted
    /// reference: to another comment (including other replies — chains are just replies whose
    /// target is itself a reply) or to a subtask card living in the same task branch.
    /// </summary>
    public enum ReplyTargetType
    {
        /// <summary>A regular user comment or another reply (same aggregate, same service).</summary>
        Comment = 1,

        /// <summary>A subtask of the branch's task (owned by TodoApi; validated over gRPC).</summary>
        Subtask = 2,
    }
}
