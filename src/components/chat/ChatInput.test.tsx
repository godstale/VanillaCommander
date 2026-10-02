import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders as render } from '@/test-utils';
import '@testing-library/jest-dom/vitest';
import { ChatInput } from './ChatInput';
import { chatQueueManager } from '@/lib/agent/chatQueueManager';
import type { SkillManifest } from '@/lib/types/skill';

// Mock tauri core invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string, args: { path: string }) => {
    if (cmd === 'read_text_file') {
      if (args.path.includes('pdf-tools')) {
        return `---\nname: pdf-tools\ndescription: PDF tool\n---\n# PDF Manual\nExecute scripts/pdf.py`;
      }
    }
    throw new Error(`File not found: ${args.path}`);
  }),
}));

vi.mock('@/lib/commander/ipc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/commander/ipc')>();
  return {
    ...actual,
    fcListDir: vi.fn(async () => [
      { name: 'notes.txt', path: 'C:/work/notes.txt', kind: 'file', size: 11, modified_ms: 1, hidden: false, readonly: false, symlink: false, warning: false },
    ]),
    fcReadTextHead: vi.fn(async () => ({ text: 'hello notes', size: 11, truncated: false })),
  };
});

describe('ChatInput component', () => {
  const mockSkills: SkillManifest[] = [
    {
      name: 'pdf-tools',
      description: 'Extract and analyze PDF documents',
      filePath: 'C:/skills/pdf-tools/SKILL.md',
      baseDir: 'C:/skills/pdf-tools',
      source: 'workspace',
      disableModelInvocation: false,
    },
    {
      name: 'code-analyzer',
      description: 'Analyze codebase for errors',
      filePath: 'C:/skills/code-analyzer/SKILL.md',
      baseDir: 'C:/skills/code-analyzer',
      source: 'global',
      disableModelInvocation: false,
    },
  ];

  it('renders textarea and submit button', () => {
    render(
      <ChatInput
        onSend={vi.fn()}
        onSteer={vi.fn()}
        onStop={vi.fn()}
        isStreaming={false}
      />,
    );

    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByTitle('전송')).toBeInTheDocument();
  });

  it('sends normal text via onSend on Enter', () => {
    const onSend = vi.fn();
    render(
      <ChatInput
        onSend={onSend}
        onSteer={vi.fn()}
        onStop={vi.fn()}
        isStreaming={false}
      />,
    );

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Hello world' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(onSend).toHaveBeenCalledWith('Hello world');
  });

  it('shows autocomplete popup when typing /skill:', () => {
    render(
      <ChatInput
        onSend={vi.fn()}
        onSteer={vi.fn()}
        onStop={vi.fn()}
        isStreaming={false}
        skills={mockSkills}
      />,
    );

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: '/skill:' } });

    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getByText('/skill:pdf-tools')).toBeInTheDocument();
    expect(screen.getByText('/skill:code-analyzer')).toBeInTheDocument();
  });

  it('filters autocomplete list by query', () => {
    render(
      <ChatInput
        onSend={vi.fn()}
        onSteer={vi.fn()}
        onStop={vi.fn()}
        isStreaming={false}
        skills={mockSkills}
      />,
    );

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: '/skill:pdf' } });

    expect(screen.getByText('/skill:pdf-tools')).toBeInTheDocument();
    expect(screen.queryByText('/skill:code-analyzer')).not.toBeInTheDocument();
  });

  it('selects skill on click and inserts /skill:name into input', () => {
    render(
      <ChatInput
        onSend={vi.fn()}
        onSteer={vi.fn()}
        onStop={vi.fn()}
        isStreaming={false}
        skills={mockSkills}
      />,
    );

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: '/skill:pdf' } });

    const option = screen.getByText('/skill:pdf-tools');
    fireEvent.click(option);

    expect(textarea).toHaveValue('/skill:pdf-tools ');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('resolves skill content on submit and sends the expanded prompt', async () => {
    const onSend = vi.fn();
    render(
      <ChatInput
        onSend={onSend}
        onSteer={vi.fn()}
        onStop={vi.fn()}
        isStreaming={false}
        skills={mockSkills}
      />,
    );

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, {
      target: { value: '/skill:pdf-tools invoice.pdf' },
    });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith(
        '# PDF Manual\nExecute scripts/pdf.py\n\nUser: invoice.pdf',
      );
    });
  });

  it('shows error banner when skill is not found', async () => {    const onSend = vi.fn();
    render(
      <ChatInput
        onSend={onSend}
        onSteer={vi.fn()}
        onStop={vi.fn()}
        isStreaming={false}
        skills={mockSkills}
      />,
    );

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, {
      target: { value: '/skill:non-existent' },
    });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByText(/찾을 수 없습니다/)).toBeInTheDocument();
    });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('handles /compact command and invokes onCompact with arguments', async () => {
    const onCompact = vi.fn();
    render(
      <ChatInput
        onSend={vi.fn()}
        onSteer={vi.fn()}
        onStop={vi.fn()}
        onCompact={onCompact}
        isStreaming={false}
      />,
    );

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, {
      target: { value: '/compact focus on auth flow' },
    });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => {
      expect(onCompact).toHaveBeenCalledWith('focus on auth flow');
    });
  });

  it('applies customHeight style when customHeight prop is provided', () => {
    const { container } = render(
      <ChatInput
        onSend={vi.fn()}
        onSteer={vi.fn()}
        onStop={vi.fn()}
        isStreaming={false}
        customHeight={240}
      />,
    );

    const outerDiv = container.firstChild as HTMLElement;
    expect(outerDiv).toHaveStyle({ height: '240px' });
  });

  it('locks reasoning/effort selects while the LLM is running (P9-06)', () => {
    const { container } = render(
      <ChatInput
        onSend={vi.fn()}
        onSteer={vi.fn()}
        onStop={vi.fn()}
        isStreaming
        isThisSessionBusy
      />,
    );

    const selects = container.querySelectorAll('select');
    expect(selects.length).toBe(2);
    selects.forEach((select) => {
      expect(select).toBeDisabled();
    });
  });

  it('keeps reasoning/effort selects enabled when idle', () => {
    const { container } = render(
      <ChatInput
        onSend={vi.fn()}
        onSteer={vi.fn()}
        onStop={vi.fn()}
        isStreaming={false}
      />,
    );

    const selects = container.querySelectorAll('select');
    expect(selects.length).toBe(2);
    expect(selects[0]).not.toBeDisabled();
  });

  it('keeps input, send, and selects enabled without any lock', () => {
    chatQueueManager.resetAll();
    const onSend = vi.fn();
    const onQueue = vi.fn();
    const { container } = render(
      <ChatInput
        onSend={onSend}
        onSteer={vi.fn()}
        onStop={vi.fn()}
        onQueue={onQueue}
        isStreaming={false}
      />,
    );

    const textarea = screen.getByRole('textbox');
    expect(textarea).toBeEnabled();

    fireEvent.change(textarea, { target: { value: 'hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(onSend).toHaveBeenCalledTimes(1);

    const selects = container.querySelectorAll('select');
    expect(selects.length).toBe(2);
    selects.forEach((select) => {
      expect(select).toBeEnabled();
    });
  });

  it('recalls the previous prompt with ArrowUp and restores draft with ArrowDown', () => {
    window.localStorage.removeItem('vanilla-commander:prompt-history');
    const onSend = vi.fn();
    render(
      <ChatInput
        onSend={onSend}
        onSteer={vi.fn()}
        onStop={vi.fn()}
        isStreaming={false}
      />,
    );

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'first prompt' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    fireEvent.change(textarea, { target: { value: 'second prompt' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    expect(textarea).toHaveValue('second prompt');
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    expect(textarea).toHaveValue('first prompt');
    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    expect(textarea).toHaveValue('second prompt');
    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    expect(textarea).toHaveValue('');
    window.localStorage.removeItem('vanilla-commander:prompt-history');
  });

  it('renders save/load macro buttons before the context gauge', () => {
    render(
      <ChatInput
        onSend={vi.fn()}
        onSteer={vi.fn()}
        onStop={vi.fn()}
        isStreaming={false}
        contextUsage={{ tokens: 10, limit: 8192 }}
        onSaveLog={vi.fn()}
        onLoadLog={vi.fn()}
        canSaveLog
        hasSavedLog={false}
      />,
    );

    expect(screen.getByLabelText('매크로 저장')).toBeEnabled();
    expect(screen.getByLabelText('매크로 불러오기')).toBeDisabled();
  });

  it('navigates history from the first line of a multiline input, keeps native caret motion inside', () => {
    window.localStorage.removeItem('vanilla-commander:prompt-history');
    const onSend = vi.fn();
    render(
      <ChatInput
        onSend={onSend}
        onSteer={vi.fn()}
        onStop={vi.fn()}
        isStreaming={false}
      />,
    );

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'first prompt' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    fireEvent.change(textarea, { target: { value: 'second prompt' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledTimes(2);

    // Multiline draft: caret on the second line keeps native behavior.
    fireEvent.change(textarea, { target: { value: 'line1\nline2' } });
    textarea.selectionStart = textarea.selectionEnd = 'line1\nline2'.length;
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    expect(textarea).toHaveValue('line1\nline2');

    // Caret on the first line recalls the latest sent prompt, keeping the draft.
    textarea.selectionStart = textarea.selectionEnd = 2;
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    expect(textarea).toHaveValue('second prompt');

    // ArrowDown past the end restores the multiline draft.
    textarea.selectionStart = textarea.selectionEnd = 'second prompt'.length;
    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    expect(textarea).toHaveValue('line1\nline2');
    window.localStorage.removeItem('vanilla-commander:prompt-history');
  });

  it('keeps prompt history scoped per chat session', () => {
    window.localStorage.removeItem('vanilla-commander:prompt-history:session-a');
    window.localStorage.removeItem('vanilla-commander:prompt-history:session-b');
    const onSend = vi.fn();
    const { unmount } = render(
      <ChatInput
        onSend={onSend}
        onSteer={vi.fn()}
        onStop={vi.fn()}
        isStreaming={false}
        sessionId="session-a"
      />,
    );

    const textareaA = screen.getByRole('textbox');
    fireEvent.change(textareaA, { target: { value: 'prompt in chat A' } });
    fireEvent.keyDown(textareaA, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('prompt in chat A');
    unmount();

    render(
      <ChatInput
        onSend={vi.fn()}
        onSteer={vi.fn()}
        onStop={vi.fn()}
        isStreaming={false}
        sessionId="session-b"
      />,
    );

    // 다른 채팅창에서는 A의 히스토리가 조회되지 않아야 한다.
    const textareaB = screen.getByRole('textbox');
    fireEvent.keyDown(textareaB, { key: 'ArrowUp' });
    expect(textareaB).toHaveValue('');

    window.localStorage.removeItem('vanilla-commander:prompt-history:session-a');
    window.localStorage.removeItem('vanilla-commander:prompt-history:session-b');
  });

  it('completes @ file references and inlines content on send', async () => {
    const onSend = vi.fn();
    render(
      <ChatInput
        onSend={onSend}
        onSteer={vi.fn()}
        onStop={vi.fn()}
        isStreaming={false}
        cwd="C:/work"
      />,
    );

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '요약 @note' } });
    textarea.selectionStart = textarea.selectionEnd = '요약 @note'.length;

    expect(await screen.findByText('notes.txt')).toBeInTheDocument();
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(textarea).toHaveValue('요약 @C:/work/notes.txt ');

    fireEvent.keyDown(textarea, { key: 'Enter' });
    await waitFor(() => {
      expect(onSend).toHaveBeenCalledTimes(1);
    });
    const sent = onSend.mock.calls[0]?.[0] as unknown as string;
    expect(sent).toContain('@C:/work/notes.txt (파일 내용)');
    expect(sent).toContain('hello notes');
  });
});

