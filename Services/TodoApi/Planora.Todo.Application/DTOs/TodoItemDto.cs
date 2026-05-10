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
        public required string Title { get; init; }
        public string? Description { get; init; }
        public required string Status { get; init; }
        public Guid? CategoryId { get; init; }
        public DateTime? DueDate { get; init; }
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
        public IReadOnlyList<Guid> SharedWithUserIds { get; init; } = Array.Empty<Guid>();
        public bool? HasSharedAudience { get; init; }
        public bool? IsVisuallyUrgent { get; init; }
        public int? RequiredWorkers { get; init; }
        public int WorkerCount { get; init; }
        public bool IsWorking { get; init; }
        public IReadOnlyList<Guid> WorkerUserIds { get; init; } = Array.Empty<Guid>();
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
                .ForMember(dst => dst.IsVisuallyUrgent,
                    opt => opt.MapFrom(src => TodoViewerStateResolver.IsVisuallyUrgent(src, null)))
                .ForMember(dst => dst.RequiredWorkers,
                    opt => opt.MapFrom(src => src.RequiredWorkers))
                .ForMember(dst => dst.WorkerCount,
                    opt => opt.MapFrom(src => src.Workers.Count))
                .ForMember(dst => dst.WorkerUserIds,
                    opt => opt.MapFrom(src => src.Workers.Select(w => w.UserId).ToList()))
                .ForMember(dst => dst.IsWorking,
                    opt => opt.MapFrom(src => false));
        }
    }
}
