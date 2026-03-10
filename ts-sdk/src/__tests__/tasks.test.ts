/**
 * Tests for MAP Task methods (map/tasks/*)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestServer } from '../testing/server';
import { ClientConnection } from '../connection/client';
import { createStreamPair } from '../stream';
import type { MAPTask } from '../types';

describe('Task Methods', () => {
  let server: TestServer;
  let client: ClientConnection;

  beforeEach(async () => {
    server = new TestServer();
    const [clientStream, serverStream] = createStreamPair();
    server.acceptConnection(serverStream);
    client = new ClientConnection(clientStream);
    await client.connect({ participantType: 'client', name: 'test-client' });
  });

  afterEach(async () => {
    await client.disconnect();
  });

  describe('createTask', () => {
    it('creates a task with server-generated ID', async () => {
      const result = await client.createTask({ task: { title: 'Test task' } });

      expect(result.task).toBeDefined();
      expect(result.task.id).toBeTruthy();
      expect(result.task.title).toBe('Test task');
    });

    it('creates a task with client-provided ID', async () => {
      const result = await client.createTask({
        task: { id: 'my-task-1', title: 'Custom ID task' },
      });

      expect(result.task.id).toBe('my-task-1');
    });

    it('creates a task with all optional fields', async () => {
      const result = await client.createTask({
        task: {
          title: 'Full task',
          assignee: 'agent-1',
          status: 'open',
          description: 'A detailed description',
          meta: { priority: 2, tags: ['backend', 'api'] },
        },
      });

      expect(result.task.title).toBe('Full task');
      expect(result.task.assignee).toBe('agent-1');
      expect(result.task.status).toBe('open');
      expect(result.task.description).toBe('A detailed description');
      expect(result.task.meta).toEqual({ priority: 2, tags: ['backend', 'api'] });
    });

    it('creates a minimal task with only ID', async () => {
      const result = await client.createTask({ task: {} });

      expect(result.task.id).toBeTruthy();
      expect(result.task.assignee).toBeUndefined();
      expect(result.task.title).toBeUndefined();
      expect(result.task.status).toBeUndefined();
    });

    it('stores the task on the server', async () => {
      const result = await client.createTask({ task: { title: 'Stored task' } });

      expect(server.tasks.get(result.task.id)).toBeDefined();
      expect(server.tasks.get(result.task.id)?.title).toBe('Stored task');
    });
  });

  describe('assignTask', () => {
    let task: MAPTask;

    beforeEach(async () => {
      const result = await client.createTask({ task: { title: 'Assignable task' } });
      task = result.task;
    });

    it('assigns a task to an agent', async () => {
      const result = await client.assignTask(task.id, 'agent-worker-1');

      expect(result.task.assignee).toBe('agent-worker-1');
    });

    it('reassigns a task to a different agent', async () => {
      await client.assignTask(task.id, 'agent-1');
      const result = await client.assignTask(task.id, 'agent-2');

      expect(result.task.assignee).toBe('agent-2');
    });

    it('throws for nonexistent task', async () => {
      await expect(
        client.assignTask('nonexistent', 'agent-1')
      ).rejects.toThrow();
    });
  });

  describe('updateTask', () => {
    let task: MAPTask;

    beforeEach(async () => {
      const result = await client.createTask({
        task: { title: 'Updatable task', status: 'open' },
      });
      task = result.task;
    });

    it('updates task status', async () => {
      const result = await client.updateTask({
        taskId: task.id,
        status: 'in_progress',
      });

      expect(result.task.status).toBe('in_progress');
    });

    it('updates task title', async () => {
      const result = await client.updateTask({
        taskId: task.id,
        title: 'Updated title',
      });

      expect(result.task.title).toBe('Updated title');
    });

    it('updates task description', async () => {
      const result = await client.updateTask({
        taskId: task.id,
        description: 'New description',
      });

      expect(result.task.description).toBe('New description');
    });

    it('updates task assignee', async () => {
      const result = await client.updateTask({
        taskId: task.id,
        assignee: 'agent-3',
      });

      expect(result.task.assignee).toBe('agent-3');
    });

    it('merges meta fields', async () => {
      await client.updateTask({
        taskId: task.id,
        meta: { priority: 1 },
      });
      const result = await client.updateTask({
        taskId: task.id,
        meta: { tags: ['urgent'] },
      });

      expect(result.task.meta).toEqual({ priority: 1, tags: ['urgent'] });
    });

    it('completes a task', async () => {
      const result = await client.updateTask({
        taskId: task.id,
        status: 'completed',
      });

      expect(result.task.status).toBe('completed');
    });

    it('throws for nonexistent task', async () => {
      await expect(
        client.updateTask({ taskId: 'nonexistent', status: 'completed' })
      ).rejects.toThrow();
    });
  });

  describe('listTasks', () => {
    beforeEach(async () => {
      await client.createTask({ task: { title: 'Task A', status: 'open', assignee: 'agent-1' } });
      await client.createTask({ task: { title: 'Task B', status: 'in_progress', assignee: 'agent-2' } });
      await client.createTask({ task: { title: 'Task C', status: 'open', assignee: 'agent-1' } });
      await client.createTask({ task: { title: 'Task D', status: 'completed', assignee: 'agent-2' } });
    });

    it('lists all tasks with no filter', async () => {
      const result = await client.listTasks();

      expect(result.tasks).toHaveLength(4);
      expect(result.hasMore).toBe(false);
    });

    it('filters by assignee', async () => {
      const result = await client.listTasks({
        filter: { assignee: 'agent-1' },
      });

      expect(result.tasks).toHaveLength(2);
      expect(result.tasks.every((t) => t.assignee === 'agent-1')).toBe(true);
    });

    it('filters by single status', async () => {
      const result = await client.listTasks({
        filter: { status: 'open' },
      });

      expect(result.tasks).toHaveLength(2);
      expect(result.tasks.every((t) => t.status === 'open')).toBe(true);
    });

    it('filters by multiple statuses', async () => {
      const result = await client.listTasks({
        filter: { status: ['open', 'in_progress'] },
      });

      expect(result.tasks).toHaveLength(3);
    });

    it('supports pagination with limit', async () => {
      const result = await client.listTasks({ limit: 2 });

      expect(result.tasks).toHaveLength(2);
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBeDefined();
    });

    it('supports cursor-based pagination', async () => {
      const page1 = await client.listTasks({ limit: 2 });
      const page2 = await client.listTasks({ limit: 2, cursor: page1.nextCursor });

      expect(page2.tasks).toHaveLength(2);
      expect(page2.hasMore).toBe(false);

      const allTitles = [...page1.tasks, ...page2.tasks].map((t) => t.title);
      expect(allTitles).toHaveLength(4);
    });

    it('returns empty list when no tasks match filter', async () => {
      const result = await client.listTasks({
        filter: { assignee: 'nonexistent-agent' },
      });

      expect(result.tasks).toHaveLength(0);
      expect(result.hasMore).toBe(false);
    });
  });
});
