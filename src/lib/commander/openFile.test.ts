import { describe, it, expect } from 'vitest';
import { planOpenFile, buildFileTab, LARGE_TEXT_BYTES } from './openFile';

describe('planOpenFile', () => {
  it('routes images to the image viewer', () => {
    expect(planOpenFile('C:/pics/photo.JPG')).toEqual({ action: 'image', path: 'C:/pics/photo.JPG' });
  });

  it('routes documents to the document viewer', () => {
    expect(planOpenFile('C:/d/a.pdf')).toMatchObject({ action: 'document', docKind: 'pdf' });
    expect(planOpenFile('C:/d/a.docx')).toMatchObject({ action: 'document', docKind: 'docx' });
    expect(planOpenFile('C:/d/a.xlsx')).toMatchObject({ action: 'document', docKind: 'xlsx' });
    expect(planOpenFile('C:/d/a.xls')).toMatchObject({ action: 'document', docKind: 'xlsx' });
    expect(planOpenFile('C:/d/a.csv')).toMatchObject({ action: 'document', docKind: 'csv' });
    expect(planOpenFile('C:/d/a.pptx')).toMatchObject({ action: 'document', docKind: 'pptx' });
  });

  it('routes archives to the archive viewer', () => {
    expect(planOpenFile('C:/d/a.zip')).toEqual({ action: 'archive', path: 'C:/d/a.zip' });
  });

  it('routes text to the editor, large files read-only', () => {
    expect(planOpenFile('C:/d/a.ts', 100)).toEqual({
      action: 'editor',
      path: 'C:/d/a.ts',
      readOnlyHead: false,
    });
    expect(planOpenFile('C:/d/big.log', LARGE_TEXT_BYTES + 1)).toMatchObject({
      action: 'editor',
      readOnlyHead: true,
    });
  });

  it('routes html/media/executables to the default app', () => {
    for (const f of ['a.html', 'a.mp4', 'a.mp3', 'a.exe', 'a.bin', 'Makefile']) {
      expect(planOpenFile(`C:/d/${f}`)).toEqual({ action: 'external', path: `C:/d/${f}` });
    }
  });
});

describe('buildFileTab', () => {
  it('builds editor/image/document/archive tabs', () => {
    expect(buildFileTab({ action: 'editor', path: 'C:/d/a.ts', readOnlyHead: false })).toMatchObject({
      id: 'editor:C:/d/a.ts',
      type: 'editor',
    });
    expect(
      buildFileTab({ action: 'editor', path: 'C:/d/big.log', readOnlyHead: true }).meta,
    ).toMatchObject({ filePath: 'C:/d/big.log', readOnlyHead: true });
    expect(buildFileTab({ action: 'image', path: 'C:/p.png' })).toMatchObject({
      id: 'image-viewer:C:/p.png',
      type: 'image-viewer',
    });
    expect(buildFileTab({ action: 'document', path: 'C:/d/a.pdf', docKind: 'pdf' })).toMatchObject({
      id: 'document:C:/d/a.pdf',
      type: 'document-viewer',
    });
    expect(buildFileTab({ action: 'archive', path: 'C:/d/a.zip' })).toMatchObject({
      id: 'archive:C:/d/a.zip',
      type: 'archive-viewer',
    });
  });

  it('throws for external plans', () => {
    expect(() => buildFileTab({ action: 'external', path: 'C:/d/a.exe' })).toThrow();
  });
});
