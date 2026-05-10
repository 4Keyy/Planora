using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Domain.Events;

namespace Planora.UnitTests.Services.TodoApi.Domain;

public class TodoItemWorkerTests
{
    // ─── AddWorker ────────────────────────────────────────────────────────────

    [Fact]
    public void AddWorker_ShouldAddWorkerAndFireEvent()
    {
        var ownerId = Guid.NewGuid();
        var workerId = Guid.NewGuid();
        var todo = TodoItem.Create(ownerId, "Task", isPublic: true);

        todo.AddWorker(workerId);

        Assert.Single(todo.Workers);
        Assert.Contains(todo.Workers, w => w.UserId == workerId);
        Assert.Contains(todo.DomainEvents, e => e is TodoWorkerJoinedDomainEvent ev && ev.WorkerUserId == workerId);
    }

    [Fact]
    public void AddWorker_WhenOwner_ShouldThrow()
    {
        var ownerId = Guid.NewGuid();
        var todo = TodoItem.Create(ownerId, "Task", isPublic: true);

        Assert.Throws<BusinessRuleViolationException>(() => todo.AddWorker(ownerId));
    }

    [Fact]
    public void AddWorker_WhenAlreadyWorker_ShouldThrow()
    {
        var ownerId = Guid.NewGuid();
        var workerId = Guid.NewGuid();
        var todo = TodoItem.Create(ownerId, "Task", isPublic: true);

        todo.AddWorker(workerId);

        Assert.Throws<BusinessRuleViolationException>(() => todo.AddWorker(workerId));
    }

    [Fact]
    public void AddWorker_WhenCapacityFull_ShouldThrow()
    {
        var ownerId = Guid.NewGuid();
        var worker1 = Guid.NewGuid();
        var worker2 = Guid.NewGuid();
        // RequiredWorkers = 2 → 1 slot for non-owner workers (owner occupies 1)
        var todo = TodoItem.Create(ownerId, "Task", isPublic: true, requiredWorkers: 2);

        todo.AddWorker(worker1);
        Assert.True(todo.IsCapacityFull);

        Assert.Throws<BusinessRuleViolationException>(() => todo.AddWorker(worker2));
    }

    [Fact]
    public void AddWorker_WithNoCapacitySet_ShouldAllowUnlimitedWorkers()
    {
        var ownerId = Guid.NewGuid();
        var todo = TodoItem.Create(ownerId, "Task", isPublic: true);
        Assert.False(todo.IsCapacityFull);

        for (var i = 0; i < 10; i++)
            todo.AddWorker(Guid.NewGuid());

        Assert.Equal(10, todo.Workers.Count);
        Assert.False(todo.IsCapacityFull);
    }

    // ─── RemoveWorker ─────────────────────────────────────────────────────────

    [Fact]
    public void RemoveWorker_ShouldRemoveWorkerAndFireLeftEvent()
    {
        var ownerId = Guid.NewGuid();
        var workerId = Guid.NewGuid();
        var todo = TodoItem.Create(ownerId, "Task", isPublic: true);
        todo.AddWorker(workerId);
        todo.ClearDomainEvents();

        todo.RemoveWorker(workerId);

        Assert.Empty(todo.Workers);
        Assert.Contains(todo.DomainEvents, e => e is TodoWorkerLeftDomainEvent ev && ev.WorkerUserId == workerId);
    }

    [Fact]
    public void RemoveWorker_WhenNotWorker_ShouldThrowEntityNotFound()
    {
        var ownerId = Guid.NewGuid();
        var todo = TodoItem.Create(ownerId, "Task", isPublic: true);

        Assert.Throws<EntityNotFoundException>(() => todo.RemoveWorker(Guid.NewGuid()));
    }

    // ─── IsCapacityFull ───────────────────────────────────────────────────────

    [Fact]
    public void IsCapacityFull_WithRequiredWorkers1_ShouldAlwaysBeFull()
    {
        // RequiredWorkers=1 means only owner → no slots for anyone else
        var ownerId = Guid.NewGuid();
        var todo = TodoItem.Create(ownerId, "Task", isPublic: true, requiredWorkers: 1);

        Assert.True(todo.IsCapacityFull);
    }

    [Fact]
    public void IsCapacityFull_WithRequiredWorkers3AndTwoWorkers_ShouldBeFull()
    {
        var ownerId = Guid.NewGuid();
        var todo = TodoItem.Create(ownerId, "Task", isPublic: true, requiredWorkers: 3);

        todo.AddWorker(Guid.NewGuid()); // 1st non-owner slot
        todo.AddWorker(Guid.NewGuid()); // 2nd non-owner slot

        Assert.True(todo.IsCapacityFull); // 2 workers + 1 owner = 3 = RequiredWorkers
    }

    // ─── SetRequiredWorkers ───────────────────────────────────────────────────

    [Fact]
    public void SetRequiredWorkers_ShouldUpdateValue()
    {
        var ownerId = Guid.NewGuid();
        var todo = TodoItem.Create(ownerId, "Task", isPublic: true);

        todo.SetRequiredWorkers(5, ownerId);

        Assert.Equal(5, todo.RequiredWorkers);
    }

    [Fact]
    public void SetRequiredWorkers_WithZero_ShouldThrow()
    {
        var ownerId = Guid.NewGuid();
        var todo = TodoItem.Create(ownerId, "Task", isPublic: true);

        Assert.Throws<InvalidValueObjectException>(() => todo.SetRequiredWorkers(0, ownerId));
    }

    [Fact]
    public void SetRequiredWorkers_WithNull_ShouldClearCapacity()
    {
        var ownerId = Guid.NewGuid();
        var todo = TodoItem.Create(ownerId, "Task", isPublic: true, requiredWorkers: 3);

        todo.SetRequiredWorkers(null, ownerId);

        Assert.Null(todo.RequiredWorkers);
        Assert.False(todo.IsCapacityFull);
    }

    [Fact]
    public void SetRequiredWorkers_WhenReducedBelowCurrentWorkers_ShouldEvictLIFO()
    {
        var ownerId = Guid.NewGuid();
        var todo = TodoItem.Create(ownerId, "Task", isPublic: true);

        var worker1 = Guid.NewGuid();
        var worker2 = Guid.NewGuid();
        var worker3 = Guid.NewGuid();

        todo.AddWorker(worker1);
        todo.AddWorker(worker2);
        todo.AddWorker(worker3); // most recently joined
        todo.ClearDomainEvents();

        // Reduce to 2 total (1 owner + 1 non-owner slot) → evict 2 most recent
        todo.SetRequiredWorkers(2, ownerId);

        Assert.Single(todo.Workers);
        Assert.Contains(todo.Workers, w => w.UserId == worker1); // earliest stays
        Assert.DoesNotContain(todo.Workers, w => w.UserId == worker2);
        Assert.DoesNotContain(todo.Workers, w => w.UserId == worker3);

        // Two RemovedEvents fired
        var removedEvents = todo.DomainEvents.OfType<TodoWorkerRemovedDomainEvent>().ToList();
        Assert.Equal(2, removedEvents.Count);
        Assert.Contains(removedEvents, e => e.WorkerUserId == worker2);
        Assert.Contains(removedEvents, e => e.WorkerUserId == worker3);
    }

    [Fact]
    public void SetRequiredWorkers_ForPrivateTask_ShouldEnforceSharedWithUpperBound()
    {
        var ownerId = Guid.NewGuid();
        var friendId = Guid.NewGuid();
        // private (not public) task shared with 1 friend → max RequiredWorkers = 2
        var todo = TodoItem.Create(ownerId, "Task", sharedWithUserIds: new[] { friendId });

        Assert.Throws<InvalidValueObjectException>(() => todo.SetRequiredWorkers(3, ownerId));
        todo.SetRequiredWorkers(2, ownerId); // should succeed
        Assert.Equal(2, todo.RequiredWorkers);
    }

    // ─── SetSharedWith / SetPublic worker cleanup ─────────────────────────────

    [Fact]
    public void SetSharedWith_ShouldEvictWorkersWhoLoseAccess()
    {
        var ownerId = Guid.NewGuid();
        var friend1 = Guid.NewGuid();
        var friend2 = Guid.NewGuid();
        // Task is public AND shared with both friends so both can join
        var todo = TodoItem.Create(ownerId, "Task", isPublic: true,
            sharedWithUserIds: new[] { friend1, friend2 });

        todo.AddWorker(friend1);
        todo.AddWorker(friend2);
        todo.ClearDomainEvents();

        // Reduce SharedWith to friend1 only → friend2 loses access and is evicted
        todo.SetSharedWith(new[] { friend1 }, ownerId);

        Assert.Contains(todo.Workers, w => w.UserId == friend1);
        Assert.DoesNotContain(todo.Workers, w => w.UserId == friend2);

        var removedEvents = todo.DomainEvents.OfType<TodoWorkerRemovedDomainEvent>().ToList();
        Assert.Single(removedEvents);
        Assert.Equal(friend2, removedEvents[0].WorkerUserId);
    }

    [Fact]
    public void SetPublic_ToFalse_ShouldEvictWorkersNotInSharedWith()
    {
        var ownerId = Guid.NewGuid();
        var sharedUser = Guid.NewGuid();
        var publicWorker = Guid.NewGuid(); // joined only via public access
        // Task is public AND explicitly shares sharedUser
        var todo = TodoItem.Create(ownerId, "Task", isPublic: true,
            sharedWithUserIds: new[] { sharedUser });

        todo.AddWorker(sharedUser);
        todo.AddWorker(publicWorker);
        todo.ClearDomainEvents();

        // Making non-public: only sharedWith users stay as workers
        todo.SetPublic(false, ownerId);

        // publicWorker is not in SharedWith → evicted
        Assert.DoesNotContain(todo.Workers, w => w.UserId == publicWorker);
        // sharedUser is in SharedWith → stays
        Assert.Contains(todo.Workers, w => w.UserId == sharedUser);

        var removedEvents = todo.DomainEvents.OfType<TodoWorkerRemovedDomainEvent>().ToList();
        Assert.Single(removedEvents);
        Assert.Equal(publicWorker, removedEvents[0].WorkerUserId);
    }

    [Fact]
    public void SetPublic_ToTrue_ShouldNotEvictAnyWorkers()
    {
        var ownerId = Guid.NewGuid();
        var friend = Guid.NewGuid();
        var todo = TodoItem.Create(ownerId, "Task", isPublic: true);
        todo.AddWorker(friend);
        todo.ClearDomainEvents();

        todo.SetPublic(true, ownerId); // no-op on public->public

        Assert.Contains(todo.Workers, w => w.UserId == friend);
        Assert.DoesNotContain(todo.DomainEvents, e => e is TodoWorkerRemovedDomainEvent);
    }
}
