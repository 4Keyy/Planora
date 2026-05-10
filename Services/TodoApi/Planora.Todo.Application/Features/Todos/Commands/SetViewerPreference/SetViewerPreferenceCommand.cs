using Planora.BuildingBlocks.Domain;
using Planora.Todo.Application.DTOs;
using MediatR;

namespace Planora.Todo.Application.Features.Todos.Commands.SetViewerPreference
{
    public sealed record SetViewerPreferenceCommand(
        Guid TodoId,
        bool? HiddenByViewer = null,
        Guid? ViewerCategoryId = null,
        bool UpdateViewerCategory = false) : IRequest<Result<ViewerPreferenceResponseDto>>;
}
