export interface CsvDiagnostic {
  row: number;
  message: string;
}

// RFC 4180: quoted fields with "" escapes and embedded CR/LF, CRLF line endings.
export function parseCsv(text: string): { rows: string[][]; diagnostics: CsvDiagnostic[] } {
  const normalized = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  const diagnostics: CsvDiagnostic[] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let row = 1;
  let i = 0;

  const pushField = () => {
    record.push(field);
    field = '';
  };
  const pushRecord = () => {
    // Skip fully empty trailing lines
    if (!(record.length === 1 && record[0] === '')) {
      rows.push(record);
    }
    record = [];
    row += 1;
  };

  while (i < normalized.length) {
    const ch = normalized[i];
    if (inQuotes) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += ch;
        i += 1;
      }
    } else if (ch === '"') {
      if (field === '') {
        inQuotes = true;
        i += 1;
      } else {
        field += ch;
        i += 1;
      }
    } else if (ch === ',') {
      pushField();
      i += 1;
    } else if (ch === '\r' && normalized[i + 1] === '\n') {
      pushField();
      pushRecord();
      i += 2;
    } else if (ch === '\n' || ch === '\r') {
      pushField();
      pushRecord();
      i += 1;
    } else {
      field += ch;
      i += 1;
    }
  }
  if (inQuotes) {
    diagnostics.push({ row, message: 'unterminated quoted field at EOF' });
  }
  pushField();
  pushRecord();
  return { rows, diagnostics };
}
