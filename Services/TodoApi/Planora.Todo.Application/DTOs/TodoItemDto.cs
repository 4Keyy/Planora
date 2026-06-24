using AutoMapper;
using Planora.Todo.Application.Features.Todos;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Domain.ValueObjects;

namespace Planora.Todo.Application.DTOs
{
    public sealed record TodoItemDto
    {
        public required Guid Id { get; init; }
        public required Guid UserId { get; init; }
        /// <summary>Who created the item. Only set for subtasks (the collaborator who added it);
        /// null for top-level tasks where the owner is the creator. Lets the UI surface
        /// rename/delete to a subtask's creator as well as the parent owner.</summary>
        public Guid? CreatedByUserId { get; init; }
        public required string Title { get; init; }
        public string? Description { get; init; }
        public required string Status { get; init; }
        public Guid? CategoryId { get; init; }
        /// <summary>The estimated-completion date — a single target date, or the END (later bound)
        /// of an interval when <see cref="DueDateStart"/> is set.</summary>
        public DateTime? DueDate { get; init; }
        /// <summary>Optional START (earlier bound) of the estimated-completion interval. Null for a
        /// single-date or no-date task; when set it is always ≤ <see cref="DueDate"/>.</summary>
        public DateTime? DueDateStart { get; init; }
        public DateTime? ExpectedDate { get; init; }
        public DateTime? ActualDate { get; init; }
        public required string Priority { get; init; }
        public required bool IsPublic { get; init; }
        public required bool Hidden { get; init; }
        public required bool IsCompleted { get; init; }
        public DateTime? CompletedAt { get; init; }
        public bool? IsOnTime { get; init; }
        public TimeSpan? Delay { get; init; }
        public required IReadOnlyList<string> Tags { get; init; }
        public required DateTime CreatedAt { get; init; }
        public DateTime? UpdatedAt { get; init; }
        public string? CategoryName { get; init; }
        public string? CategoryColor { get; init; }
        public string? CategoryIcon { get; init; }
        public string? AuthorCategoryName { get; init; }
        public string? AuthorCategoryColor { get; init; }
        public string? AuthorCategoryIcon { get; init; }
        public IReadOnlyList<Guid> SharedWithUserIds { get; init; } = Array.Empty<Guid>();
        public bool? HasSharedAudience { get; init; }
        public bool? IsVisuallyUrgent { get; init; }
        public int? RequiredWorkers { get; init; }
        public int WorkerCount { get; init; }
        public bool IsWorking { get; init; }
        public IReadOnlyList<Guid> WorkerUserIds { get; init; } = Array.Empty<Guid>();
        /// <summary>
        /// Live display identity of everyone currently working on this item (subtask reads only —
        /// resolved from Auth at query time, never stored). Surfaced so the branch shows *who* took a
        /// subtask into work — the same shared, global "in work" state for every viewer — rather than
        /// an anonymous count. Empty on endpoints that skip the enrichment.
        /// </summary>
        public IReadOnlyList<TodoWorkerDto> Workers { get; init; } = Array.Empty<TodoWorkerDto>();
        public bool? IsCompletedByViewer { get; init; }

        /// <summary>
        /// The author's real completion state (the entity's <c>IsCompleted</c>, i.e. global
        /// <c>Status == Done</c>) — always the owner's truth, independent of any per-viewer
        /// completion. Lets the UI tell "the author finished the whole task" apart from "I finished
        /// it for myself", so it can show the correct reopen affordance and avoid sending a request
        /// the server will reject with <c>AUTHOR_ALREADY_COMPLETED</c>.
        /// </summary>
        public bool OwnerCompleted { get; init; }

        /// <summary>When set, this item is a subtask (child) of the given parent task.</summary>
        public Guid? ParentTodoId { get; init; }

        /// <summary>
        /// Number of this task's subtasks that are still open (not done, not deleted). Zero when the
        /// task has no subtasks or every subtask is finished. Drives the "finish a task that still has
        /// unfinished subtasks?" confirmation in the UI. Always 0 for a subtask (subtasks have no
        /// children) and on list endpoints that skip the enrichment.
        /// </summary>
        public int OpenSubtaskCount { get; init; }

        /// <summary>
        /// Live display identity of the item's author (subtask reads only — resolved from Auth
        /// at query time, never stored). Null on list endpoints that skip the enrichment.
        /// </summary>
        public string? AuthorName { get; init; }
        public string? AuthorAvatarUrl { get; init; }
    }

    /// <summary>
    /// A single worker's live display identity (id + name + avatar) for a subtask's shared "in work"
    /// presence. Name/avatar are resolved from Auth at query time and may be null when unknown.
    /// </summary>
    public sealed record TodoWorkerDto
    {
        public required Guid UserId { get; init; }
        public string? Name { get; init; }
        public string? AvatarUrl { get; init; }
    }

    public class TodoItemMappingProfile : Profile
    {
        public TodoItemMappingProfile()
        {
            CreateMap<TodoItem, TodoItemDto>()
                .ForMember(dst => dst.Status,
                    opt => opt.MapFrom(src => src.Status.Display()))
                .ForMember(dst => dst.Priority,
                    opt => opt.MapFrom(src => src.Priority.ToString()))
                .ForMember(dst => dst.IsOnTime,
                    opt => opt.MapFrom(src => src.IsOnTime()))
                .ForMember(dst => dst.Delay,
                    opt => opt.MapFrom(src => src.GetDelay()))
                .ForMember(dst => dst.Tags,
                    opt => opt.MapFrom(src => src.Tags.Select(t => t.Name).ToList()))
                .ForMember(dst => dst.Hidden,
                    opt => opt.MapFrom(src => src.Hidden))
                .ForMember(dst => dst.SharedWithUserIds,
                    opt => opt.MapFrom(src => src.SharedWith.Select(s => s.SharedWithUserId).ToList()))
                .ForMember(dst => dst.HasSharedAudience,
                    opt => opt.MapFrom(src => src.IsPublic || src.SharedWith.Any()))
                // The author's real completion truth — independent of any per-viewer override the
                // handlers layer on top via `with { IsCompleted = ... }`.
                .ForMember(dst => dst.OwnerCompleted,
                    opt => opt.MapFrom(src => src.IsCompleted))
                .ForMember(dst => dst.IsVisuallyUrgent,
                    opt => opt.MapFrom(src => TodoViewerStateResolver.IsVisuallyUrgent(src, null)))
                .ForMember(dst => dst.RequiredWorkers,
                    opt => opt.MapFrom(src => src.RequiredWorkers))
                .ForMember(dst => dst.WorkerCount,
                    opt => opt.MapFrom(src => src.Workers.Count))
                .ForMember(dst => dst.WorkerUserIds,
                    opt => opt.MapFrom(src => src.Workers.Select(w => w.UserId).ToList()))
                // Worker display identities are resolved live from Auth by the handler that needs
                // them (GetSubtasks), exactly like AuthorName — never auto-mapped from the entity.
                .ForMember(dst => dst.Workers, opt => opt.Ignore())
                .ForMember(dst => dst.IsWorking,
                    opt => opt.MapFrom(src => false))
                // Author identity is resolved live from Auth by the handlers that need it.
                .ForMember(dst => dst.AuthorName, opt => opt.Ignore())
                .ForMember(dst => dst.AuthorAvatarUrl, opt => opt.Ignore())
                // Open-subtask count is a per-task aggregate set by the list/detail handlers that
                // need it — never auto-mapped from the entity (a task does not load its children).
                .ForMember(dst => dst.OpenSubtaskCount, opt => opt.Ignore());
        }
    }
}
