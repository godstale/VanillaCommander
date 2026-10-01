import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders as render } from '@/test-utils';
import '@testing-library/jest-dom/vitest';
import { SettingsIntegrations } from './SettingsIntegrations';

vi.mock('@/lib/db/repositories/integrationsRepo', () => ({
  listIntegrations: vi.fn().mockResolvedValue([]),
  saveIntegration: vi.fn().mockResolvedValue(undefined),
  deleteIntegration: vi.fn().mockResolvedValue(undefined),
  getIntegrationSettings: vi.fn().mockResolvedValue({
    masterEnabled: false,
    trustedLanHosts: [],
    allowLocalCodeExecution: false,
  }),
  saveIntegrationSettings: vi.fn().mockResolvedValue(undefined),
  appendAudit: vi.fn().mockResolvedValue(undefined),
  listAudit: vi.fn().mockResolvedValue([]),
  clearAudit: vi.fn().mockResolvedValue(undefined),
}));

describe('SettingsIntegrations', () => {
  it('renders title, export notice and master switch default off', async () => {
    render(<SettingsIntegrations />);
    await waitFor(() => {
      expect(screen.getByText('외부 연동 (LLM API / 에이전트 CLI)')).toBeInTheDocument();
    });
    expect(screen.getByText(/API key stored in this PC's app DB/)).toBeInTheDocument();
    const master = screen.getByLabelText('외부 연동 마스터 스위치') as HTMLInputElement;
    expect(master.checked).toBe(false);
    expect(screen.getByText('등록된 외부 연동이 없습니다.')).toBeInTheDocument();
    expect(screen.getByText('전송 감사 로그 (최근 200건)')).toBeInTheDocument();
    expect(screen.getByText(/주의: 로컬 코드 실행은/)).toBeInTheDocument();
  });
});
