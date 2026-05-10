using Planora.BuildingBlocks.Domain.Exceptions;

namespace Planora.Todo.Domain.Exceptions
{
    public sealed class TodoItemNotFoundDomainException : DomainException
    {
        public TodoItemNotFoundDomainException(Guid todoItemId)
            : base($"Todo item with ID '{todoItemId}' was not found", "TODO_NOT_FOUND")
        {
            AddDetail("TodoItemId", todoItemId);
        }
    }
}
