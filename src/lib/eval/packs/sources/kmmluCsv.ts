import type { EvalSample } from '../../types';
import type { PackDiagnostic } from '../../types';
import { parseCsv } from './csv';

const EXPECTED_HEADER = ['question', 'answer', 'A', 'B', 'C', 'D', 'Category', 'Human Accuracy'];
const LETTERS = ['A', 'B', 'C', 'D'];

function subjectFromFile(file: string): string {
  const base = file.split('/').pop() ?? file;
  return base.replace(/-test\.csv$/i, '').replace(/\.csv$/i, '');
}

export function convertKmmluCsv(
  file: string,
  csvText: string,
): { samples: EvalSample[]; diagnostics: PackDiagnostic[] } {
  const samples: EvalSample[] = [];
  const diagnostics: PackDiagnostic[] = [];
  const { rows, diagnostics: csvDiag } = parseCsv(csvText);
  for (const d of csvDiag) {
    diagnostics.push({ sampleId: null, message: `${file}:${d.row}: ${d.message}` });
  }
  if (rows.length === 0) {
    diagnostics.push({ sampleId: null, message: `${file}: empty file` });
    return { samples, diagnostics };
  }
  const header = rows[0].map((h) => h.trim());
  // Upstream KMMLU headers are inconsistent: 44 files use
  // `question,answer,A,B,C,D,Category,Human Accuracy` but `math-test.csv`
  // swaps the last two columns. Map columns by header name (P10-24) instead
  // of editing the ND-licensed origin files.
  const headerOk =
    header.length === EXPECTED_HEADER.length &&
    EXPECTED_HEADER.every((h) => header.includes(h));
  if (!headerOk) {
    diagnostics.push({
      sampleId: null,
      message: `${file}: unexpected header [${header.join(',')}]; expected [${EXPECTED_HEADER.join(',')}]`,
    });
    return { samples, diagnostics };
  }
  const col = (name: string): number => header.indexOf(name);
  const subject = subjectFromFile(file);
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (cells.every((c) => c.trim() === '')) continue;
    const id = `${file}#${r}`;
    if (cells.length < 8) {
      diagnostics.push({ sampleId: id, message: `${file}:${r + 1}: short row (${cells.length} cells)` });
      continue;
    }
    const question = cells[col('question')];
    const answerRaw = cells[col('answer')];
    const a = cells[col('A')];
    const b = cells[col('B')];
    const c = cells[col('C')];
    const d = cells[col('D')];
    const category = cells[col('Category')];
    const answer = Number(answerRaw.trim());
    if (!Number.isInteger(answer) || answer < 1 || answer > 4) {
      diagnostics.push({ sampleId: id, message: `${file}:${r + 1}: invalid answer index '${answerRaw}'` });
      continue;
    }
    samples.push({
      id,
      input: question,
      choices: [a, b, c, d],
      target: LETTERS[answer - 1],
      metadata: { subject, category, lang: 'ko' },
    });
  }
  return { samples, diagnostics };
}
