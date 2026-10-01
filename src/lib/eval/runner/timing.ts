export interface TrialTiming {
  ttftMs: number | null;
  totalMs: number;
}

export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parent?: AbortSignal,
): Promise<{ result: T; timedOut: boolean }> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;
  const onParentAbort = () => controller.abort();
  if (parent) {
    if (parent.aborted) controller.abort();
    else parent.addEventListener('abort', onParentAbort, { once: true });
  }
  try {
    const result = await Promise.race([
      fn(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new Error('eval trial timeout'));
        }, timeoutMs);
      }),
    ]);
    return { result, timedOut };
  } catch (err) {
    if (timedOut) throw err;
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
    parent?.removeEventListener('abort', onParentAbort);
  }
}

// Best-effort Ollama model unload (frees VRAM between candidates). Never throws.
export async function unloadOllamaModel(baseUrl: string, model: string): Promise<void> {
  try {
    await fetch(`${baseUrl.replace(/\/+$/, '')}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, keep_alive: 0 }),
    });
  } catch {
    // ignore — unloading is opportunistic
  }
}
