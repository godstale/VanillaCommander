export interface MessageQueue {
  enqueue(msg: string): void;
  dequeue(): string | undefined;
  drain(): string[];
  clear(): void;
  size(): number;
  isEmpty(): boolean;
}

export function createMessageQueue(): MessageQueue {
  const items: string[] = [];

  return {
    enqueue(msg: string): void {
      items.push(msg);
    },
    dequeue(): string | undefined {
      return items.shift();
    },
    drain(): string[] {
      return items.splice(0, items.length);
    },
    clear(): void {
      items.length = 0;
    },
    size(): number {
      return items.length;
    },
    isEmpty(): boolean {
      return items.length === 0;
    },
  };
}
