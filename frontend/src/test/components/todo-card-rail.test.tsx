import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { TodoCard } from '@/components/todos/todo-card';
import { useAuthStore } from '@/store/auth';
import { useNotificationStore } from '@/store/notifications';
import { TodoPriority, TodoStatus, type Todo } from '@/types/todo';

const task: Todo = {
  id: 'rail-worker-count', userId: 'owner', title: 'Materialized audience',
  status: TodoStatus.InProgress, priority: TodoPriority.Medium, isPublic: true,
  isCompleted: false, hidden: false, tags: [], createdAt: '2026-10-07T00:00:00Z',
  sharedWithUserIds: ['friend-one', 'friend-two'], workerCount: 2,
};
function card(extra: Partial<Todo> = {}) {
  const { container } = render(<TodoCard todo={{ ...task, ...extra }} onComplete={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} />);
  // PriorityMeter also has a denominator; inspect the worker chip specifically.
  return container.querySelector('svg.lucide-users')!.parentElement!.querySelector('span.tabular-nums')!;
}

describe('TodoCard worker count with a materialized All friends audience', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { userId: 'owner', email: 'owner@example.test' } } as never);
    useNotificationStore.setState({ items: [], perTask: {}, totalUnread: 0, listLoaded: false, seen: new Set() });
  });
  it('shows only the joined count for All friends even when the owner sees snapshot IDs', () => {
    expect(card()).toHaveTextContent(/^3$/);
  });
  it('keeps the explicit audience denominator for directly shared tasks', () => {
    expect(card({ isPublic: false })).toHaveTextContent(/^3\/3$/);
  });
  it('keeps All friends count-only for a legacy row carrying requiredWorkers', () => {
    expect(card({ requiredWorkers: 5 })).toHaveTextContent(/^3$/);
  });
});
