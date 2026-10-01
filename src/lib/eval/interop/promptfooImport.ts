import type { EvalPackManifest, EvalSample, ScorerSpec } from '../types';
import {
  buildImportManifest,
  validateImportPack,
  withTierCounts,
  type ImportManifestOptions,
} from './draft';

// promptfoo `tests:` YAML import. The repo has no YAML dependency, so this
// module implements a minimal block-subset reader (maps / block sequences /
// scalars at 2-space indent, plus inline scalar flow lists). Anything outside
// that subset throws PromptfooYamlError with a line number.
//
// YAML-SUBSET LIMITS (kept intentionally small):
// - Allowed: block maps, block sequences, plain/single-quoted/double-quoted
//   scalars, numbers, booleans, null, full-line `#` comments, `---` marker,
//   inline flow lists of scalars (`key: [a, b, "c"]`).
// - Rejected (clear error): tabs, non-2-space indent, block scalars (`|`, `>`),
//   anchors/aliases (`&`, `*`), tags (`!`), flow maps (`{...}`), `%` directives,
//   multi-line quoted scalars, complex (`?`) keys.

export class PromptfooYamlError extends Error {
  readonly line: number;
  constructor(line: number, message: string) {
    super(`YAML line ${line}: ${message}`);
    this.name = 'PromptfooYamlError';
    this.line = line;
  }
}

interface SrcLine {
  no: number;
  indent: number;
  text: string;
}

export interface YamlMap {
  [key: string]: YamlValue;
}

export type YamlValue = YamlMap | YamlValue[] | string | number | boolean | null;

function stripTrailingComment(line: string): string {
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (quote === '"' && ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === quote) {
        if (quote === "'" && line[i + 1] === "'") {
          i += 1;
          continue;
        }
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '#' && (i === 0 || line[i - 1] === ' ' || line[i - 1] === '\t')) {
      return line.slice(0, i).trimEnd();
    }
  }
  return line;
}

function tokenize(text: string): SrcLine[] {
  const out: SrcLine[] = [];
  const rawLines = text.replace(/^\uFEFF/, '').split('\n');
  for (let i = 0; i < rawLines.length; i++) {
    const no = i + 1;
    const raw = rawLines[i].replace(/\r$/, '');
    if (raw.includes('\t')) {
      const first = raw.search(/[^\s]/);
      if (first >= 0 && !raw.slice(0, first).includes('\t')) {
        // Tab inside content (e.g. a scalar) is tolerated; leading tabs are not.
      } else if (first >= 0) {
        throw new PromptfooYamlError(no, 'tab indentation is not supported (use 2 spaces)');
      }
    }
    const stripped = raw.trim();
    if (stripped === '' || stripped.startsWith('#')) continue;
    if (stripped === '---' || stripped === '...') continue;
    if (stripped.startsWith('%')) {
      throw new PromptfooYamlError(no, 'YAML directives are not supported');
    }
    const indent = raw.length - raw.trimStart().length;
    if (indent % 2 !== 0) {
      throw new PromptfooYamlError(no, `indent ${indent} is not a multiple of 2 spaces`);
    }
    out.push({ no, indent, text: stripTrailingComment(raw.trim()) });
    if (out[out.length - 1].text === '') {
      out.pop();
    }
  }
  return out;
}

function unquote(token: string, no: number): string {
  if (token.length >= 2 && token.startsWith('"') && token.endsWith('"')) {
    const inner = token.slice(1, -1);
    if (inner.includes('\n')) {
      throw new PromptfooYamlError(no, 'multi-line quoted scalars are not supported');
    }
    return inner.replace(/\\(\\|"|n|t|r)/g, (_m, c: string) => {
      if (c === 'n') return '\n';
      if (c === 't') return '\t';
      if (c === 'r') return '\r';
      return c;
    });
  }
  if (token.length >= 2 && token.startsWith("'") && token.endsWith("'")) {
    return token.slice(1, -1).replace(/''/g, "'");
  }
  return token;
}

function splitFlowItems(inner: string, no: number): string[] {
  const items: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quote) {
      cur += ch;
      if (ch === '\\' && quote === '"') {
        cur += inner[i + 1] ?? '';
        i += 1;
      } else if (ch === quote) {
        if (quote === "'" && inner[i + 1] === "'") {
          cur += "'";
          i += 1;
        } else quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === ',') {
      items.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (quote) throw new PromptfooYamlError(no, 'unterminated quote in flow list');
  if (cur.trim() !== '' || items.length > 0) items.push(cur.trim());
  return items.filter((s) => s !== '');
}

function parseScalar(token: string, no: number): YamlValue {
  const t = token.trim();
  if (t === '' || t === 'null' || t === '~') return null;
  if (t === 'true' || t === 'True' || t === 'TRUE') return true;
  if (t === 'false' || t === 'False' || t === 'FALSE') return false;
  if (/^[+-]?\d+$/.test(t)) return Number.parseInt(t, 10);
  if (/^[+-]?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?$/.test(t)) return Number(t);
  if (t.startsWith('[') && t.endsWith(']')) {
    return splitFlowItems(t.slice(1, -1), no).map((s) => {
      const v = parseScalar(s, no);
      if (typeof v === 'object' && v !== null) {
        throw new PromptfooYamlError(no, 'nested collections in flow lists are not supported');
      }
      return v as string | number | boolean | null;
    });
  }
  if (t.startsWith('{') || t.endsWith('}')) {
    throw new PromptfooYamlError(no, 'flow maps ({...}) are not supported');
  }
  if (
    t === '|' ||
    t === '>' ||
    t.startsWith('|') ||
    t.startsWith('>') ||
    t.startsWith('&') ||
    t.startsWith('*') ||
    t.startsWith('!') ||
    t.startsWith('?')
  ) {
    throw new PromptfooYamlError(
      no,
      `block scalars, anchors/aliases, tags and complex keys are not supported (got '${t.slice(0, 8)}')`,
    );
  }
  if ((t.startsWith('"') && !t.endsWith('"')) || (t.startsWith("'") && !t.endsWith("'"))) {
    throw new PromptfooYamlError(no, 'multi-line quoted scalars are not supported');
  }
  return unquote(t, no);
}

function splitKeyValue(text: string): { key: string; value: string } | null {
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\' && quote === '"') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ':') {
      const next = text[i + 1];
      if (next === undefined || next === ' ' || next === '\t') {
        return {
          key: text.slice(0, i).trim(),
          value: text.slice(i + 1).trim(),
        };
      }
    }
  }
  return null;
}

function isSeqItem(text: string): boolean {
  return text === '-' || text.startsWith('- ');
}

class YamlParser {
  private readonly lines: SrcLine[];

  constructor(lines: SrcLine[]) {
    this.lines = lines;
  }

  parse(): YamlValue {
    if (this.lines.length === 0) return null;
    const [value, next] = this.parseBlock(0, this.lines[0].indent);
    if (next < this.lines.length) {
      const stray = this.lines[next];
      throw new PromptfooYamlError(stray.no, `unexpected indent ${stray.indent}`);
    }
    return value;
  }

  private parseBlock(start: number, indent: number): [YamlValue, number] {
    const first = this.lines[start];
    if (isSeqItem(first.text)) return this.parseSeq(start, indent);
    return this.parseMap(start, indent, null);
  }

  private parseSeq(start: number, indent: number): [YamlValue[], number] {
    const items: YamlValue[] = [];
    let i = start;
    while (i < this.lines.length) {
      const line = this.lines[i];
      if (line.indent < indent) break;
      if (line.indent !== indent || !isSeqItem(line.text)) {
        if (line.indent === indent) break;
        throw new PromptfooYamlError(line.no, `unexpected indent ${line.indent}`);
      }
      const rest = line.text === '-' ? '' : line.text.slice(2).trim();
      i += 1;
      if (rest.startsWith('{')) {
        throw new PromptfooYamlError(line.no, 'flow maps ({...}) are not supported');
      }
      if (rest === '') {
        if (i < this.lines.length && this.lines[i].indent > indent) {
          const [nested, next] = this.parseBlock(i, this.lines[i].indent);
          items.push(nested);
          i = next;
        } else {
          items.push(null);
        }
        continue;
      }
      const kv = splitKeyValue(rest);
      if (kv && kv.key !== '') {
        const [map, next] = this.parseMap(i, indent + 2, { line: line.no, kv });
        items.push(map);
        i = next;
      } else {
        items.push(parseScalar(rest, line.no));
      }
    }
    return [items, i];
  }

  private parseMap(
    start: number,
    indent: number,
    firstEntry: { line: number; kv: { key: string; value: string } } | null,
  ): [Record<string, YamlValue>, number] {
    const map: Record<string, YamlValue> = {};
    const put = (no: number, key: string, value: YamlValue): void => {
      if (key === '') throw new PromptfooYamlError(no, 'empty mapping key');
      map[key] = value;
    };
    let i = start;
    if (firstEntry) {
      const key = unquoteKey(firstEntry.kv.key, firstEntry.line);
      if (firstEntry.kv.value !== '') {
        put(firstEntry.line, key, parseScalar(firstEntry.kv.value, firstEntry.line));
      } else if (i < this.lines.length && this.lines[i].indent > indent) {
        const [nested, next] = this.parseBlock(i, this.lines[i].indent);
        put(firstEntry.line, key, nested);
        i = next;
      } else {
        put(firstEntry.line, key, null);
      }
    }
    while (i < this.lines.length) {
      const line = this.lines[i];
      if (line.indent < indent) break;
      if (line.indent !== indent) {
        throw new PromptfooYamlError(line.no, `unexpected indent ${line.indent}`);
      }
      if (isSeqItem(line.text)) break;
      const kv = splitKeyValue(line.text);
      if (!kv || kv.key === '') {
        throw new PromptfooYamlError(line.no, `expected 'key: value' (got '${line.text.slice(0, 32)}')`);
      }
      const key = unquoteKey(kv.key, line.no);
      i += 1;
      if (kv.value !== '') {
        put(line.no, key, parseScalar(kv.value, line.no));
      } else if (i < this.lines.length && this.lines[i].indent > indent) {
        const [nested, next] = this.parseBlock(i, this.lines[i].indent);
        put(line.no, key, nested);
        i = next;
      } else {
        put(line.no, key, null);
      }
    }
    return [map, i];
  }
}

function unquoteKey(token: string, no: number): string {
  const t = token.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return unquote(t, no);
  }
  if (t.includes('{') || t.includes('}') || t.includes('[') || t.includes(']')) {
    throw new PromptfooYamlError(no, 'complex mapping keys are not supported');
  }
  return t;
}

/** Parse the supported YAML subset; throws PromptfooYamlError otherwise. */
export function parseSubsetYaml(text: string): YamlValue {
  return new YamlParser(tokenize(text)).parse();
}

// ---- promptfoo tests conversion ----

export interface PromptfooImportResult {
  manifest: EvalPackManifest;
  samples: EvalSample[];
  scorers: ScorerSpec[];
  warnings: string[];
}

function isObject(value: YamlValue): value is Record<string, YamlValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function scalarText(value: YamlValue): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function applyVars(template: string, vars: Record<string, YamlValue>, warnings: string[]): string {
  return template.replace(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g, (match, name: string) => {
    const value = vars[name];
    const text = value === undefined ? null : scalarText(value);
    if (text === null) {
      warnings.push(`template variable '${name}' has no scalar value; placeholder kept`);
      return match;
    }
    return text;
  });
}

function pushScorer(
  scorers: ScorerSpec[],
  seen: Set<string>,
  spec: ScorerSpec,
): void {
  const key = `${spec.type}:${JSON.stringify(spec.options)}`;
  if (seen.has(key)) return;
  seen.add(key);
  scorers.push(spec);
}

/**
 * Map one promptfoo assert entry to a Fortress scorer. Returns null when the
 * assertion type is unsupported (caller records a warning and skips it).
 */
function mapAssert(
  assert: YamlValue,
  sample: EvalSample,
  scorers: ScorerSpec[],
  seen: Set<string>,
  testLabel: string,
  warnings: string[],
): void {
  if (!isObject(assert)) {
    warnings.push(`${testLabel}: non-object assert skipped`);
    return;
  }
  const type = scalarText(assert.type ?? null);
  const value = assert.value ?? null;
  const weightRaw = assert.weight;
  const weight =
    typeof weightRaw === 'number' && weightRaw > 0 ? weightRaw : 1;
  if (!type) {
    warnings.push(`${testLabel}: assert without type skipped`);
    return;
  }
  const key = type.startsWith('promptfoo:') ? type.slice('promptfoo:'.length) : type;
  switch (key) {
    case 'equals': {
      const text = scalarText(value);
      if (text === null) {
        warnings.push(`${testLabel}: equals assert without scalar value skipped`);
        return;
      }
      if (sample.target === undefined) sample.target = text;
      pushScorer(scorers, seen, { type: 'exact', weight, gate: false, options: {} });
      break;
    }
    case 'contains':
    case 'icontains': {
      const values =
        typeof value === 'string'
          ? [value]
          : Array.isArray(value)
            ? value.map(scalarText).filter((v): v is string => v !== null)
            : [];
      if (values.length === 0) {
        warnings.push(`${testLabel}: ${key} assert without value skipped`);
        return;
      }
      pushScorer(scorers, seen, {
        type: 'includes',
        weight,
        gate: false,
        options: { mode: 'any', caseSensitive: key === 'contains', values },
      });
      break;
    }
    case 'regex': {
      const pattern = scalarText(value);
      if (pattern === null) {
        warnings.push(`${testLabel}: regex assert without pattern skipped`);
        return;
      }
      pushScorer(scorers, seen, {
        type: 'regex',
        weight,
        gate: false,
        options: { pattern, compareTo: 'none' },
      });
      break;
    }
    case 'is-json':
    case 'contains-json': {
      const schema =
        isObject(value) && Object.keys(value).length > 0
          ? (value as Record<string, unknown>)
          : { type: 'object' };
      pushScorer(scorers, seen, {
        type: 'json_schema',
        weight,
        gate: false,
        options: { schema },
      });
      break;
    }
    case 'llm-rubric': {
      const rubric = scalarText(value);
      if (rubric === null) {
        warnings.push(`${testLabel}: llm-rubric assert without rubric skipped`);
        return;
      }
      if (sample.rubric === undefined) sample.rubric = rubric;
      pushScorer(scorers, seen, {
        type: 'llm_judge_rubric',
        weight,
        gate: false,
        options: { rubric },
      });
      break;
    }
    case 'javascript':
    case 'python':
    case 'file':
    case 'webhook':
    case 'rouge-n':
    case 'levenshtein':
    case 'latency':
    case 'cost':
    case 'perplexity':
      warnings.push(`${testLabel}: ${key} assert is unsupported and was skipped`);
      break;
    default:
      warnings.push(`${testLabel}: unknown assert type '${type}' skipped`);
      break;
  }
}

function promptTemplate(doc: Record<string, YamlValue>, warnings: string[]): string | null {
  const raw = doc.prompts ?? doc.prompt ?? null;
  const list = raw === null ? [] : Array.isArray(raw) ? raw : [raw];
  for (const entry of list) {
    if (typeof entry === 'string' && entry !== '') return entry;
    if (isObject(entry)) {
      const text = scalarText(entry.raw ?? entry.label ?? null);
      if (text) return text;
    }
  }
  if (list.length > 0) {
    warnings.push('prompts use file:// references or unsupported shapes; vars are used as input instead');
  }
  return null;
}

export function convertPromptfoo(
  text: string,
  opts: ImportManifestOptions,
): PromptfooImportResult {
  const warnings: string[] = [];
  const doc = parseSubsetYaml(text);
  if (!isObject(doc)) {
    throw new Error('promptfoo config must be a mapping with a top-level `tests` list');
  }
  const tests = doc.tests;
  if (!Array.isArray(tests)) {
    throw new Error('promptfoo config needs a top-level `tests` list');
  }
  const template = promptTemplate(doc, warnings);

  const rawSamples: EvalSample[] = [];
  const packScorers: ScorerSpec[] = [];
  const seen = new Set<string>();
  tests.forEach((entry, i) => {
    const label = `tests[${i}]`;
    if (!isObject(entry)) {
      warnings.push(`${label}: skipped (not a mapping)`);
      return;
    }
    const vars = entry.vars;
    if (!isObject(vars)) {
      warnings.push(`${label}: skipped (missing vars mapping)`);
      return;
    }
    let input: string;
    if (template) {
      input = applyVars(template, vars, warnings);
    } else {
      warnings.push(`${label}: no inline prompt; vars rendered as input`);
      input = Object.entries(vars)
        .map(([k, v]) => `${k}=${scalarText(v) ?? JSON.stringify(v)}`)
        .join('\n');
    }
    if (input.trim() === '') {
      warnings.push(`${label}: skipped (empty input)`);
      return;
    }
    const sample: EvalSample = { id: `${label}`, input };
    const asserts = entry.assert === undefined ? [] : Array.isArray(entry.assert) ? entry.assert : [entry.assert];
    const sampleScorers: ScorerSpec[] = [];
    const sampleSeen = new Set<string>();
    for (const assert of asserts) {
      mapAssert(assert, sample, sampleScorers, sampleSeen, label, warnings);
    }
    for (const s of sampleScorers) pushScorer(packScorers, seen, s);
    if (sampleScorers.length > 0) sample.scorers = sampleScorers;
    rawSamples.push(sample);
  });

  if (packScorers.length === 0) {
    packScorers.push({ type: 'exact', weight: 1, gate: false, options: {} });
    warnings.push('no mappable asserts found; pack falls back to the exact scorer');
  }
  const validated = validateImportPack(
    buildImportManifest({ ...opts, scorers: packScorers }),
    rawSamples,
  );
  warnings.push(...validated.errors);
  return {
    manifest: withTierCounts(validated.manifest, validated.samples.length),
    samples: validated.samples,
    scorers: packScorers,
    warnings,
  };
}
