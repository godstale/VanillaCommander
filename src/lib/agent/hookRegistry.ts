import { composeHooks, type AgentHooks } from './hooks';

const registry = new Map<string, AgentHooks>();

export function registerHooks(id: string, hooks: AgentHooks): void {
  registry.set(id, hooks);
}

export function unregisterHooks(id: string): void {
  registry.delete(id);
}

export function clearRegisteredHooks(): void {
  registry.clear();
}

export function getRegisteredHooks(): AgentHooks {
  return composeHooks(...Array.from(registry.values()));
}
