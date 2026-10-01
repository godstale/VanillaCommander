import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import {
  WorkspaceTabsProvider,
  useWorkspaceTabs,
} from './WorkspaceTabsContext';

describe('WorkspaceTabsContext', () => {
  it('does not duplicate tab when openTab is called with an existing id', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <WorkspaceTabsProvider>{children}</WorkspaceTabsProvider>
    );

    const { result } = renderHook(() => useWorkspaceTabs(), { wrapper });

    act(() => {
      result.current.openTab({
        id: 'editor:/path/to/file.ts',
        type: 'editor',
        title: 'file.ts',
      });
    });

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.activeTabId).toBe('editor:/path/to/file.ts');

    // Call openTab again with same id
    act(() => {
      result.current.openTab({
        id: 'editor:/path/to/file.ts',
        type: 'editor',
        title: 'file.ts',
      });
    });

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.activeTabId).toBe('editor:/path/to/file.ts');

    // Call openTab with a different id
    act(() => {
      result.current.openTab({
        id: 'editor:/path/to/other.ts',
        type: 'editor',
        title: 'other.ts',
      });
    });

    expect(result.current.tabs).toHaveLength(2);
    expect(result.current.activeTabId).toBe('editor:/path/to/other.ts');

    // Close first tab
    act(() => {
      result.current.closeTab('editor:/path/to/other.ts');
    });

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.activeTabId).toBe('editor:/path/to/file.ts');
  });

  it('reorders tabs using moveTab', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <WorkspaceTabsProvider>{children}</WorkspaceTabsProvider>
    );

    const { result } = renderHook(() => useWorkspaceTabs(), { wrapper });

    act(() => {
      result.current.openTab({ id: 'tab1', type: 'chat', title: 'Tab 1' });
      result.current.openTab({ id: 'tab2', type: 'chat', title: 'Tab 2' });
      result.current.openTab({ id: 'tab3', type: 'chat', title: 'Tab 3' });
    });

    expect(result.current.tabs.map((t) => t.id)).toEqual(['tab1', 'tab2', 'tab3']);

    // Move tab 0 (tab1) to index 2
    act(() => {
      result.current.moveTab(0, 2);
    });
    expect(result.current.tabs.map((t) => t.id)).toEqual(['tab2', 'tab3', 'tab1']);

    // Move tab 2 (tab1) to index 1
    act(() => {
      result.current.moveTab(2, 1);
    });
    expect(result.current.tabs.map((t) => t.id)).toEqual(['tab2', 'tab1', 'tab3']);

    // Out of bounds no-op
    act(() => {
      result.current.moveTab(-1, 1);
      result.current.moveTab(0, 10);
    });
    expect(result.current.tabs.map((t) => t.id)).toEqual(['tab2', 'tab1', 'tab3']);
  });
});
