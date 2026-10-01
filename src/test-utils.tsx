import React from 'react';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';

export function renderWithProviders(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
): RenderResult {
  return render(ui, {
    ...options,
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <LanguageProvider>{children}</LanguageProvider>
    ),
  });
}
