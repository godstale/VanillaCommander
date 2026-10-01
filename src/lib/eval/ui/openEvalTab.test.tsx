import { describe, expect, it } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders as render } from '@/test-utils';
import '@testing-library/jest-dom/vitest';
import { WorkspaceTabsProvider, useWorkspaceTabs } from '@/lib/context/WorkspaceTabsContext';
import { EvalProvider } from '@/lib/context/EvalContext';
import { useOpenEvalTab } from '@/lib/eval/ui/openEvalTab';
import { EvalTab } from '@/components/workspace/EvalTab';

function Probe() {
  const { openEvalWizard, openEvalRun, openEvalPacks, openEvalPack, openArenaList } = useOpenEvalTab();
  const { tabs, activeTabId } = useWorkspaceTabs();
  return (
    <div>
      <button type="button" onClick={openEvalWizard}>wizard</button>
      <button type="button" onClick={() => openEvalRun('r1', 'Run 1')}>run</button>
      <button type="button" onClick={openEvalPacks}>packs</button>
      <button type="button" onClick={() => openEvalPack('user', 'p1')}>pack</button>
      <button type="button" onClick={openArenaList}>arena</button>
      <span data-testid="count">{tabs.length}</span>
      <span data-testid="active">{activeTabId}</span>
    </div>
  );
}

describe('eval tab helpers', () => {
  it('opens idempotent eval tabs with meta views', () => {
    render(
      <WorkspaceTabsProvider>
        <Probe />
      </WorkspaceTabsProvider>,
    );
    fireEvent.click(screen.getByText('wizard'));
    fireEvent.click(screen.getByText('run'));
    fireEvent.click(screen.getByText('packs'));
    fireEvent.click(screen.getByText('pack'));
    fireEvent.click(screen.getByText('arena'));
    expect(screen.getByTestId('count').textContent).toBe('5');
    // Idempotent: reopening wizard does not duplicate.
    fireEvent.click(screen.getByText('wizard'));
    expect(screen.getByTestId('count').textContent).toBe('5');
    expect(screen.getByTestId('active').textContent).toBe('eval:wizard');
  });

  it('EvalTab renders wired views and placeholders', () => {
    render(
      <WorkspaceTabsProvider>
        <EvalProvider>
          <EvalTab tab={{ id: 'eval:packs', type: 'eval', title: 'p', meta: { view: 'packs' } }} />
        </EvalProvider>
      </WorkspaceTabsProvider>,
    );
    expect(screen.getByText(/eval\.packs\.title|팩 관리/)).toBeInTheDocument();
  });
});
