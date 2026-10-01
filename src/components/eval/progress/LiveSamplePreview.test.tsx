import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders as render } from '@/test-utils';
import '@testing-library/jest-dom/vitest';
import {
  LiveSamplePreview,
  SAMPLE_INPUT_PREVIEW_CHARS,
} from './LiveSamplePreview';

describe('LiveSamplePreview', () => {
  it('shows idle state without a current sample', () => {
    render(
      <LiveSamplePreview
        packId={null}
        sampleId={null}
        candidateLabel={null}
        sampleInput={null}
        streamText=""
        turns={null}
        toolCallCount={null}
        outcome={null}
      />,
    );
    expect(
      screen.getByText('현재 실행 중인 샘플이 없습니다.'),
    ).toBeInTheDocument();
  });

  it('truncates sample input to 300 chars and shows stream + tool calls', () => {
    const longInput = 'x'.repeat(500);
    render(
      <LiveSamplePreview
        packId="pack-x"
        sampleId="s1"
        candidateLabel="model-a"
        sampleInput={longInput}
        streamText="hello world"
        turns={3}
        toolCallCount={2}
        outcome={null}
      />,
    );
    expect(screen.getByText(/s1/)).toBeInTheDocument();
    expect(screen.getByText('hello world')).toBeInTheDocument();
    expect(screen.getByText(/도구 호출 2회 · 턴 3회/)).toBeInTheDocument();
    const shown = screen.getByText(/x{100}/).textContent ?? '';
    expect(shown.replace('…', '').length).toBe(SAMPLE_INPUT_PREVIEW_CHARS);
  });

  it('shows fallback when sample input is unavailable', () => {
    render(
      <LiveSamplePreview
        packId="pack-x"
        sampleId="s1"
        candidateLabel={null}
        sampleInput={null}
        streamText=""
        turns={null}
        toolCallCount={null}
        outcome="ok"
      />,
    );
    expect(screen.getByText('샘플 입력을 불러올 수 없습니다.')).toBeInTheDocument();
    expect(screen.getByText('ok')).toBeInTheDocument();
  });
});
