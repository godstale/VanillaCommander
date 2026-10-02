import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { screen, act } from '@testing-library/react';
import { renderWithProviders as render } from '@/test-utils';
import { JobsProvider } from '@/lib/commander/jobs';
import { useJobs } from '@/lib/commander/useJobs';
import {
  clearFileClipboard,
  getFileClipboard,
  setFileClipboard,
  useFileClipboard,
} from '@/lib/commander/clipboard';
import { formatBytes } from '@/lib/commander/format';
import type { FcProgressEvent } from '@/lib/commander/types';

let capturedHandler: ((event: { payload: FcProgressEvent }) => void) | null = null;

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((name: string, handler: (event: { payload: FcProgressEvent }) => void) => {
    void name;
    capturedHandler = handler;
    return Promise.resolve(() => {
      capturedHandler = null;
    });
  }),
}));

function Probe() {
  const { jobs, conflicts, registerJob, dismissJob } = useJobs();
  return (
    <div>
      <button type="button" onClick={() => registerJob('j1', 'copy', 'copy label')}>
        reg
      </button>
      <button type="button" onClick={() => dismissJob('j1')}>
        dis
      </button>
      <span data-testid="jobs">{jobs.map((j) => `${j.id}:${j.status}:${j.doneFiles}`).join(',')}</span>
      <span data-testid="conflicts">{conflicts.map((c) => c.path).join(',')}</span>
    </div>
  );
}

function emit(payload: FcProgressEvent) {
  act(() => {
    capturedHandler?.({ payload });
  });
}

describe('JobsProvider', () => {
  it('tracks progress, conflicts, and completion from fc://progress events', async () => {
    render(
      <JobsProvider>
        <Probe />
      </JobsProvider>,
    );
    await act(async () => {});

    act(() => {
      screen.getByText('reg').click();
    });
    expect(screen.getByTestId('jobs').textContent).toBe('j1:running:0');

    emit({
      kind: 'progress',
      job_id: 'j1',
      done_files: 3,
      total_files: 10,
      done_bytes: 100,
      total_bytes: 500,
    });
    expect(screen.getByTestId('jobs').textContent).toBe('j1:running:3');

    emit({
      kind: 'conflict',
      job_id: 'j1',
      conflict_id: 7,
      path: 'C:/dst/a.txt',
      suggested_name: 'a (2).txt',
    });
    expect(screen.getByTestId('conflicts').textContent).toBe('C:/dst/a.txt');

    emit({ kind: 'done', job_id: 'j1', result: { files: 10 } });
    expect(screen.getByTestId('jobs').textContent).toBe('j1:done:3');
    expect(screen.getByTestId('conflicts').textContent).toBe('');

    act(() => {
      screen.getByText('dis').click();
    });
    expect(screen.getByTestId('jobs').textContent).toBe('');
  });

  it('accumulates search matches', async () => {
    render(
      <JobsProvider>
        <Probe />
      </JobsProvider>,
    );
    await act(async () => {});
    act(() => {
      screen.getAllByText('reg')[0].click();
    });
    emit({
      kind: 'match',
      job_id: 'j1',
      m: { path: 'C:/a.txt', is_dir: false, line_number: 3, line_content: 'hit' },
    });
    emit({ kind: 'done', job_id: 'j1', result: { count: 1 } });
    expect(screen.getByTestId('jobs').textContent).toBe('j1:done:0');
  });
});

describe('file clipboard', () => {
  function ClipProbe() {
    const v = useFileClipboard();
    return <span data-testid="clip">{JSON.stringify(v)}</span>;
  }

  it('sets, reads, and clears via hook', () => {
    render(<ClipProbe />);
    expect(screen.getByTestId('clip').textContent).toBe('null');
    act(() => {
      setFileClipboard('copy', ['C:/a.txt', 'C:/b.txt']);
    });
    expect(getFileClipboard()).toEqual({ mode: 'copy', paths: ['C:/a.txt', 'C:/b.txt'] });
    expect(screen.getByTestId('clip').textContent).toContain('C:/a.txt');
    act(() => {
      clearFileClipboard();
    });
    expect(getFileClipboard()).toBeNull();
    expect(screen.getByTestId('clip').textContent).toBe('null');
  });
});

describe('formatBytes', () => {
  it('formats sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
