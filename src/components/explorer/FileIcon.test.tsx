import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { FileKindIcon } from './FileIcon';

function iconClass(name: string, kind: 'file' | 'dir' | 'symlink' | 'other' = 'file') {
  const { container } = render(<FileKindIcon name={name} kind={kind} />);
  return container.querySelector('svg')?.getAttribute('class') ?? '';
}

describe('FileKindIcon', () => {
  it('uses dedicated colors for viewer-supported files', () => {
    expect(iconClass('doc.pdf')).toContain('text-red-400');
    expect(iconClass('report.docx')).toContain('text-blue-400');
    expect(iconClass('sheet.xlsx')).toContain('text-green-500');
    expect(iconClass('data.csv')).toContain('text-green-500');
    expect(iconClass('deck.pptx')).toContain('text-orange-400');
    expect(iconClass('backup.zip')).toContain('text-violet-400');
    expect(iconClass('photo.png')).toContain('text-sky-400');
    expect(iconClass('app.ts')).toContain('text-emerald-400');
    expect(iconClass('notes.txt')).toContain('text-zinc-400');
  });

  it('falls back to the generic icon for unknown files', () => {
    expect(iconClass('mystery.zzz9')).toContain('text-muted-foreground');
  });
});
