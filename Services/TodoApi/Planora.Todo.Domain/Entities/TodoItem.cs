using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.Todo.Domain.Enums;
using Planora.Todo.Domain.Events;

namespace Planora.Todo.Domain.Entities
{
    public class TodoItem : BaseEntity, IAggregateRoot
    {
        private readonly List<TodoItemTag> _tags = new();
        private readonly List<TodoItemShare> _sharedWith = new();
        private readonly List<TodoItemWorker> _workers = new();

        public string Title { get; private set; } = string.Empty;
        public string? Description { get; private set; }
        public TodoStatus Status { get; private set; } = TodoStatus.Todo;
        public Guid UserId { get; private set; }
        public Guid? CategoryId { get; private set; }
        public DateTime? DueDate { get; private set; }
        public DateTime? ExpectedDate { get; private set; }
        public DateTime? ActualDate { get; private set; }
        public TodoPriority Priority { get; private set; } = TodoPriority.Medium;
        public bool IsPublic { get; private set; } = false;
        public bool Hidden { get; private set; } = false;
        public bool IsCompleted => Status == TodoStatus.Done;
        public DateTime? CompletedAt { get; private set; }
        public int? RequiredWorkers { get; private set; }

        /// <summary>
        /// When set, this item is a subtask: a child node in the parent task's tree. Subtasks
        /// are part of their parent, inherit its category/visibility/sharing, never carry a
        /// due/expected date, and are hidden from every task list (they live only in the branch).
        /// </summary>
        public Guid? ParentTodoId { get; private set; }
        public bool IsSubtask => ParentTodoId.HasValue;
        public IReadOnlyCollection<TodoItemTag> Tags => _tags.AsReadOnly();
        public IReadOnlyCollection<TodoItemShare> SharedWith => _sharedWith.AsReadOnly();
        public IReadOnlyCollection<TodoItemWorker> Workers => _workers.AsReadOnly();

        public bool IsCapacityFull =>
            RequiredWorkers.HasValue &&
            _workers.Count >= RequiredWorkers.Value - 1;

        private TodoItem() { }

        public static TodoItem Create(
            Guid userId,
            string title,
            string? description = null,
            Guid? categoryId = null,
            DateTime? dueDate = null,
            DateTime? expectedDate = null,
            TodoPriority priority = TodoPriority.Medium,
            bool isPublic = false,
            IEnumerable<Guid>? sharedWithUserIds = null,
            int? requiredWorkers = null)
        {
            if (string.IsNullOrWhiteSpace(title))
                throw new InvalidValueObjectException(nameof(TodoItem), "Title cannot be empty");

            // Removed: Allow past dates for historical todos
            // if (dueDate.HasValue && dueDate.Value < DateTime.UtcNow)
            //     throw new InvalidValueObjectException(nameof(TodoItem), "Due date cannot be in the past");

            // Removed: Allow past expected dates
            // if (expectedDate.HasValue && expectedDate.Value < DateTime.UtcNow)
            //     throw new InvalidValueObjectException(nameof(TodoItem), "Expected date cannot be in the past");

            var todoItem = new TodoItem
            {
                UserId = userId,
                Title = title.Trim(),
                Description = description?.Trim(),
                CategoryId = categoryId,
                DueDate = dueDate,
                ExpectedDate = expectedDate,
                Priority = priority,
                IsPublic = isPublic
            };
            if (sharedWithUserIds != null)
            {
                todoItem.SetSharedWith(sharedWithUserIds, userId);
            }
            if (requiredWorkers.HasValue)
            {
                todoItem.SetRequiredWorkers(requiredWorkers, userId);
            }
            todoItem.MarkAsModified(userId);

            todoItem.AddDomainEvent(new TodoItemCreatedDomainEvent(
                todoItem.Id,
                userId,
                title,
                categoryId));

            return todoItem;
        }

        /// <summary>
        /// Create a subtask attached to <paramref name="parent"/>. A subtask is a part of the
        /// parent task: it inherits the parent's category, public flag and shared audience, has
        /// its own priority/status/title, and never has a due or expected date. Nesting is not
        /// allowed — a subtask cannot itself have subtasks.
        /// </summary>
        public static TodoItem CreateSubtask(
            TodoItem parent,
            Guid creatorUserId,
            string title,
            string? description,
            TodoPriority priority = TodoPriority.Medium)
        {
            ArgumentNullException.ThrowIfNull(parent);

            if (parent.IsSubtask)
                throw new BusinessRuleViolationException("A subtask cannot be nested under another subtask");

            if (string.IsNullOrWhiteSpace(title))
                throw new InvalidValueObjectException(nameof(TodoItem), "Title cannot be empty");

            // A subtask always belongs to the PARENT TASK'S OWNER, regardless of which collaborator
            // added it: it is "part of" the parent task, inherits the parent's category/visibility/
            // shares, and stays owner-managed (rename/delete). WHO may add a subtask (the owner, or
            // a friend with access to a shared/public parent) is authorised by the application
            // handler — completion and "in work" are already per-user for collaborators.
            var ownerId = parent.UserId;
            var subtask = new TodoItem
            {
                UserId = ownerId,
                Title = title.Trim(),
                Description = description?.Trim(),
                // Inherited from the parent — never set independently.
                CategoryId = parent.CategoryId,
                IsPublic = parent.IsPublic,
                ParentTodoId = parent.Id,
                // Subtasks carry their own priority but never a due/expected date.
                Priority = priority,
            };

            // Inherit the parent's shared audience so branch access matches the parent exactly.
            subtask.SetSharedWith(parent._sharedWith.Select(s => s.SharedWithUserId), ownerId);
            subtask.MarkAsModified(ownerId);

            // The domain event records the actual creator (which may be a collaborator, not the owner).
            subtask.AddDomainEvent(new TodoItemCreatedDomainEvent(
                subtask.Id,
                creatorUserId,
                title,
                parent.CategoryId));

            return subtask;
        }

        /// <summary>
        /// Re-anchor this subtask's inherited fields (category, public flag, shared audience) to
        /// the parent's current values. Called when the parent task changes so the invariant
        /// "a subtask is always as visible as its parent" holds.
        /// </summary>
        public void SyncInheritedFromParent(TodoItem parent, Guid userId)
        {
            ArgumentNullException.ThrowIfNull(parent);
            if (!IsSubtask || ParentTodoId != parent.Id)
                throw new BusinessRuleViolationException("Item is not a subtask of the given parent");

            CategoryId = parent.CategoryId;
            IsPublic = parent.IsPublic;
            // SetSharedWith also evicts workers who lost access — keeps capacity consistent.
            SetSharedWith(parent._sharedWith.Select(s => s.SharedWithUserId), userId);
            MarkAsModified(userId);
        }

        public void UpdateTitle(string title, Guid userId)
        {
            if (string.IsNullOrWhiteSpace(title))
                throw new InvalidValueObjectException(nameof(TodoItem), "Title cannot be empty");

            Title = title.Trim();
            MarkAsModified(userId);

            AddDomainEvent(new TodoItemUpdatedDomainEvent(Id, userId, title));
        }

        public void UpdateDescription(string? description, Guid userId)
        {
            Description = description?.Trim();
            MarkAsModified(userId);
        }

        public void UpdateCategory(Guid? categoryId, Guid userId)
        {
            CategoryId = categoryId;
            MarkAsModified(userId);

            AddDomainEvent(new TodoItemCategoryChangedDomainEvent(Id, userId, categoryId));
        }

        public void UpdatePriority(TodoPriority priority, Guid userId)
        {
            Priority = priority;
            MarkAsModified(userId);
        }

        public void UpdateExpectedDate(DateTime? expectedDate, Guid userId)
        {
            if (expectedDate.HasValue && expectedDate.Value < DateTime.UtcNow)
                throw new InvalidValueObjectException(nameof(TodoItem), "Expected date cannot be in the past");

            ExpectedDate = expectedDate;
            MarkAsModified(userId);
        }

        public void UpdateActualDate(DateTime? actualDate, Guid userId)
        {
            ActualDate = actualDate;
            MarkAsModified(userId);

            // Auto-complete if actual date is set and status is not done
            if (actualDate.HasValue && Status != TodoStatus.Done)
            {
                MarkAsDone(userId);
            }
        }

        public void SetPublic(bool isPublic, Guid userId)
        {
            IsPublic = isPublic;
            if (!isPublic)
                CleanupWorkersOnAccessChange(_sharedWith.Select(s => s.SharedWithUserId));
            MarkAsModified(userId);
        }

        public void SetHidden(bool hidden, Guid userId)
        {
            Hidden = hidden;
            MarkAsModified(userId);
        }

        public bool IsOnTime()
        {
            if (!ExpectedDate.HasValue || !ActualDate.HasValue)
                return false;

            return ActualDate.Value <= ExpectedDate.Value;
        }

        public TimeSpan? GetDelay()
        {
            if (!ExpectedDate.HasValue || !ActualDate.HasValue)
                return null;

            if (ActualDate.Value > ExpectedDate.Value)
                return ActualDate.Value - ExpectedDate.Value;

            return null;
        }

        public void UpdateDueDate(DateTime? dueDate, Guid userId)
        {
            DueDate = dueDate;
            MarkAsModified(userId);
        }

        public void MarkAsDone(Guid userId)
        {
            if (IsCompleted)
                throw new BusinessRuleViolationException("Todo is already completed");

            Status = TodoStatus.Done;
            CompletedAt = DateTime.UtcNow;

            // Set actual date if not already set
            if (!ActualDate.HasValue)
                ActualDate = DateTime.UtcNow;

            MarkAsModified(userId);

            AddDomainEvent(new TodoItemCompletedDomainEvent(Id, userId));
        }

        public void MarkAsInProgress(Guid userId)
        {
            if (Status == TodoStatus.Done)
                throw new BusinessRuleViolationException("Cannot reopen a completed todo");

            Status = TodoStatus.InProgress;
            CompletedAt = null;
            MarkAsModified(userId);
        }

        public void MarkAsTodo(Guid userId)
        {
            Status = TodoStatus.Todo;
            CompletedAt = null;
            MarkAsModified(userId);
        }

        public void AddTag(string tagName, Guid userId)
        {
            if (string.IsNullOrWhiteSpace(tagName))
                throw new InvalidValueObjectException(nameof(TodoItem), "Tag name cannot be empty");

            if (_tags.Any(t => t.Name.Equals(tagName, StringComparison.OrdinalIgnoreCase)))
                throw new BusinessRuleViolationException($"Tag '{tagName}' already exists on this todo");

            var tag = new TodoItemTag { Id = Guid.NewGuid(), Name = tagName.Trim() };
            _tags.Add(tag);
            MarkAsModified(userId);
        }

        public void RemoveTag(string tagName, Guid userId)
        {
            var tag = _tags.FirstOrDefault(t =>
                t.Name.Equals(tagName, StringComparison.OrdinalIgnoreCase));

            if (tag == null)
                throw new EntityNotFoundException(nameof(TodoItemTag), tagName);

            _tags.Remove(tag);
            MarkAsModified(userId);
        }

        public void ClearTags(Guid userId)
        {
            _tags.Clear();
            MarkAsModified(userId);
        }

        public void SetSharedWith(IEnumerable<Guid> userIds, Guid userId)
        {
            _sharedWith.Clear();

            foreach (var shareUserId in userIds.Distinct())
            {
                if (shareUserId == Guid.Empty || shareUserId == UserId)
                    continue;

                _sharedWith.Add(new TodoItemShare
                {
                    TodoItemId = Id,
                    SharedWithUserId = shareUserId,
                });
            }

            CleanupWorkersOnAccessChange(_sharedWith.Select(s => s.SharedWithUserId));
            MarkAsModified(userId);
        }

        public void SetRequiredWorkers(int? value, Guid userId)
        {
            if (value.HasValue)
            {
                if (value.Value < 1)
                    throw new InvalidValueObjectException(nameof(TodoItem), "RequiredWorkers must be at least 1");

                if (_sharedWith.Any())
                {
                    var maxAllowed = 1 + _sharedWith.Count;
                    if (value.Value > maxAllowed)
                        throw new InvalidValueObjectException(
                            nameof(TodoItem),
                            $"RequiredWorkers cannot exceed 1 (owner) + {_sharedWith.Count} (shared users) = {maxAllowed}");
                }

                // Evict most-recently-joined workers when capacity shrinks
                var capacity = value.Value - 1; // owner occupies 1 slot
                while (_workers.Count > capacity)
                {
                    var evicted = _workers.OrderByDescending(w => w.JoinedAt).First();
                    _workers.Remove(evicted);
                    AddDomainEvent(new TodoWorkerRemovedDomainEvent(Id, evicted.UserId));
                }
            }

            RequiredWorkers = value;
            MarkAsModified(userId);
        }

        public void AddWorker(Guid workerUserId)
        {
            // On a normal task the owner is implicitly the primary worker, so they never hold a
            // worker row. A SUBTASK's "in work" is per-user instead (everyone, owner included, opts
            // in independently and is counted), so the owner may be added as a worker there.
            if (workerUserId == UserId && !IsSubtask)
                throw new BusinessRuleViolationException("Owner is always a worker on their own task");

            if (_workers.Any(w => w.UserId == workerUserId))
                throw new BusinessRuleViolationException("You are already working on this task");

            if (IsCapacityFull)
                throw new BusinessRuleViolationException("This task is already at full capacity");

            _workers.Add(new TodoItemWorker
            {
                TodoItemId = Id,
                UserId = workerUserId,
                JoinedAt = DateTime.UtcNow,
            });

            AddDomainEvent(new TodoWorkerJoinedDomainEvent(Id, workerUserId));
        }

        public void RemoveWorker(Guid workerUserId)
        {
            var worker = _workers.FirstOrDefault(w => w.UserId == workerUserId)
                ?? throw new EntityNotFoundException(nameof(TodoItemWorker), workerUserId);

            _workers.Remove(worker);
            AddDomainEvent(new TodoWorkerLeftDomainEvent(Id, workerUserId));
        }

        private void CleanupWorkersOnAccessChange(IEnumerable<Guid> allowedUserIds)
        {
            // The owner always retains access to their own task, so their worker row — only ever
            // present on a SUBTASK (a normal task's owner is implicitly working, never a worker
            // row; see AddWorker) — must never be evicted by a share/visibility change. Without
            // including UserId here, re-syncing a subtask's inherited shares from the parent
            // (SyncInheritedFromParent → SetSharedWith) dropped the owner's "in work" status
            // whenever the parent task was edited or its visibility changed.
            var allowed = new HashSet<Guid>(allowedUserIds) { UserId };
            var toEvict = _workers.Where(w => !allowed.Contains(w.UserId)).ToList();
            foreach (var worker in toEvict)
            {
                _workers.Remove(worker);
                AddDomainEvent(new TodoWorkerRemovedDomainEvent(Id, worker.UserId));
            }
        }
    }
}
