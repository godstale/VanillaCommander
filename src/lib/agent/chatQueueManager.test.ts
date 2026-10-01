import { describe, it, expect, beforeEach } from 'vitest';
import { chatQueueManager } from './chatQueueManager';

describe('ChatQueueManager', () => {
  beforeEach(() => {
    chatQueueManager.resetAll();
  });

  it('manages busy session ID correctly', () => {
    expect(chatQueueManager.getBusySessionId()).toBeNull();
    expect(chatQueueManager.isOtherSessionBusy('session_1')).toBe(false);

    chatQueueManager.setSessionBusy('session_1');
    expect(chatQueueManager.getBusySessionId()).toBe('session_1');
    expect(chatQueueManager.isSessionBusy('session_1')).toBe(true);
    expect(chatQueueManager.isOtherSessionBusy('session_2')).toBe(true);
    expect(chatQueueManager.isOtherSessionBusy('session_1')).toBe(false);

    chatQueueManager.setSessionIdle('session_1');
    expect(chatQueueManager.getBusySessionId()).toBeNull();
    expect(chatQueueManager.isOtherSessionBusy('session_2')).toBe(false);
  });

  it('enqueues messages and slash commands in FIFO order', () => {
    chatQueueManager.enqueue('session_1', {
      text: 'First question',
      type: 'message',
    });
    chatQueueManager.enqueue('session_1', {
      text: '/compact',
      type: 'slash_command',
      commandName: 'compact',
    });
    chatQueueManager.enqueue('session_1', {
      text: 'Second question',
      type: 'message',
    });

    const queue = chatQueueManager.getQueue('session_1');
    expect(queue).toHaveLength(3);
    expect(queue[0].text).toBe('First question');
    expect(queue[0].type).toBe('message');
    expect(queue[1].commandName).toBe('compact');
    expect(queue[1].type).toBe('slash_command');
    expect(queue[2].text).toBe('Second question');

    // Dequeue in FIFO order
    const first = chatQueueManager.dequeue('session_1');
    expect(first?.text).toBe('First question');
    expect(chatQueueManager.getQueue('session_1')).toHaveLength(2);

    const second = chatQueueManager.dequeue('session_1');
    expect(second?.commandName).toBe('compact');

    const third = chatQueueManager.dequeue('session_1');
    expect(third?.text).toBe('Second question');

    expect(chatQueueManager.dequeue('session_1')).toBeUndefined();
  });

  it('removes individual items and clears queue', () => {
    const item1 = chatQueueManager.enqueue('session_1', { text: 'Item 1', type: 'message' });
    const item2 = chatQueueManager.enqueue('session_1', { text: 'Item 2', type: 'message' });
    const item3 = chatQueueManager.enqueue('session_1', { text: 'Item 3', type: 'message' });

    expect(chatQueueManager.getQueue('session_1')).toHaveLength(3);

    const removed = chatQueueManager.removeItem('session_1', item2.id);
    expect(removed).toBe(true);
    const queueAfterRemove = chatQueueManager.getQueue('session_1');
    expect(queueAfterRemove).toHaveLength(2);
    expect(queueAfterRemove.map((i) => i.id)).toEqual([item1.id, item3.id]);

    chatQueueManager.clearQueue('session_1');
    expect(chatQueueManager.getQueue('session_1')).toHaveLength(0);
  });

  it('locks other sessions when LLM is running even if queue has 0 items', () => {
    // Session 1 starts running LLM, queue is empty (0 items)
    expect(chatQueueManager.getQueue('session_1')).toHaveLength(0);
    chatQueueManager.setSessionRunning('session_1', true);

    // Busy session must be session_1
    expect(chatQueueManager.getBusySessionId()).toBe('session_1');
    expect(chatQueueManager.isSessionRunning('session_1')).toBe(true);

    // Session 1 itself is not locked by other session
    expect(chatQueueManager.isOtherSessionBusy('session_1')).toBe(false);

    // Session 2 MUST be locked even though queue is empty!
    expect(chatQueueManager.isOtherSessionBusy('session_2')).toBe(true);

    // When session 1 finishes running LLM and queue is still empty
    chatQueueManager.setSessionRunning('session_1', false);

    // Session 2 is now unlocked
    expect(chatQueueManager.getBusySessionId()).toBeNull();
    expect(chatQueueManager.isOtherSessionBusy('session_2')).toBe(false);
  });

  it('handles pause, resume, and dequeueItem correctly', () => {
    const item1 = chatQueueManager.enqueue('session_1', { text: 'Query 1', type: 'message' });
    const item2 = chatQueueManager.enqueue('session_1', { text: 'Query 2', type: 'message' });
    const item3 = chatQueueManager.enqueue('session_1', { text: 'Query 3', type: 'message' });

    expect(chatQueueManager.isSessionPaused('session_1')).toBe(false);

    // Pause session (e.g. LLM was stopped or encountered error)
    chatQueueManager.pauseSession('session_1');
    expect(chatQueueManager.isSessionPaused('session_1')).toBe(true);

    // Pick specific item to run immediately (e.g. user clicked item 2)
    const picked = chatQueueManager.dequeueItem('session_1', item2.id);
    expect(picked?.id).toBe(item2.id);
    expect(picked?.text).toBe('Query 2');

    // Remaining items should be item 1 and item 3
    const queueAfterPick = chatQueueManager.getQueue('session_1');
    expect(queueAfterPick.map((i) => i.id)).toEqual([item1.id, item3.id]);

    // Resuming session unpauses it
    chatQueueManager.resumeSession('session_1');
    expect(chatQueueManager.isSessionPaused('session_1')).toBe(false);

    // Resetting all clears pause states as well
    chatQueueManager.pauseSession('session_1');
    expect(chatQueueManager.isSessionPaused('session_1')).toBe(true);
    chatQueueManager.resetAll();
    expect(chatQueueManager.isSessionPaused('session_1')).toBe(false);
  });
});
