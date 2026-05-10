using Planora.Auth.Domain.Enums;
using Planora.Auth.Domain.Exceptions;

namespace Planora.Auth.Domain.Entities
{
    public sealed class Friendship : BaseEntity
    {
        public Guid RequesterId { get; private set; }
        public Guid AddresseeId { get; private set; }
        public FriendshipStatus Status { get; private set; }
        public DateTime? RequestedAt { get; private set; }
        public DateTime? AcceptedAt { get; private set; }
        public DateTime? RejectedAt { get; private set; }

        // Navigation properties
        public User? Requester { get; private set; }
        public User? Addressee { get; private set; }

        private Friendship() { }

        public static Friendship Create(Guid requesterId, Guid addresseeId)
        {
            if (requesterId == Guid.Empty)
                throw new AuthDomainException("Requester ID cannot be empty");
            if (addresseeId == Guid.Empty)
                throw new AuthDomainException("Addressee ID cannot be empty");
            if (requesterId == addresseeId)
                throw new AuthDomainException("Cannot send friend request to yourself");

            return new Friendship
            {
                Id = Guid.NewGuid(),
                RequesterId = requesterId,
                AddresseeId = addresseeId,
                Status = FriendshipStatus.Pending,
                RequestedAt = DateTime.UtcNow,
                CreatedAt = DateTime.UtcNow,
                CreatedBy = requesterId
            };
        }

        public void Accept(Guid acceptedBy)
        {
            if (Status != FriendshipStatus.Pending)
                throw new AuthDomainException("Friendship request is not pending");

            if (acceptedBy != AddresseeId)
                throw new AuthDomainException("Only the addressee can accept the request");

            Status = FriendshipStatus.Accepted;
            AcceptedAt = DateTime.UtcNow;
            MarkAsModified(acceptedBy);
        }

        public void Reject(Guid rejectedBy)
        {
            if (Status != FriendshipStatus.Pending)
                throw new AuthDomainException("Friendship request is not pending");

            if (rejectedBy != AddresseeId)
                throw new AuthDomainException("Only the addressee can reject the request");

            Status = FriendshipStatus.Rejected;
            RejectedAt = DateTime.UtcNow;
            MarkAsModified(rejectedBy);
        }

        public void Cancel(Guid cancelledBy)
        {
            if (Status != FriendshipStatus.Pending)
                throw new AuthDomainException("Only pending requests can be cancelled");

            if (cancelledBy != RequesterId)
                throw new AuthDomainException("Only the requester can cancel the request");

            Status = FriendshipStatus.Cancelled;
            MarkAsModified(cancelledBy);
        }

        public void Remove(Guid removedBy)
        {
            if (Status != FriendshipStatus.Accepted)
                throw new AuthDomainException("Only accepted friendships can be removed");

            if (removedBy != RequesterId && removedBy != AddresseeId)
                throw new AuthDomainException("Only participants can remove the friendship");

            Status = FriendshipStatus.Removed;
            MarkAsModified(removedBy);
        }

        public bool IsActive => Status == FriendshipStatus.Accepted;
    }
}

