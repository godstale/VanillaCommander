import type { EvalMessage, EvalPackManifest, EvalSample, ScorerSpec, ScorerType } from '../types';

// Personal eval cases built from chat history stay local-only.
// Data-class tagging: samples carry tags ['personal'] (plus 'fixture-files'
// when fixtures are attached) and metadata.dataClass; new pack manifests
// carry an `x-fortress.dataClass` extension (kept in the file; zod strips
// unknown keys on parse, so readers must not rely on the parsed object).

export const PERSONAL_CATEGORY = 'Q9' as const;
export const PERSONAL_LICENSE_ID = 'personal' as const;
export const PERSONAL_SAMPLE_TAG = 'personal' as const;
export const FIXTURE_SAMPLE_TAG = 'fixture-files' as const;

/** CustomEvent name fired by MessageBubble; SaveCaseDialog listens for it. */
export const SAVE_EVAL_CASE_EVENT = 'fortress:save-eval-case';

export interface SaveEvalCaseDetail {
  /** Chat session id when known (MessageBubble has no entry ids, so null). */
  sessionId: string | null;
  /** Message content snapshot — the source of truth for the drafted case. */
  content: string;
  role: string;
}

export function dispatchSaveEvalCase(detail: SaveEvalCaseDetail): void {
  window.dispatchEvent(new CustomEvent<SaveEvalCaseDetail>(SAVE_EVAL_CASE_EVENT, { detail }));
}

export type SaveCaseMode = 'reference' | 'rules' | 'rubric';

export interface MessageToSampleOptions {
  id: string;
  /** Full conversation history (user/assistant turns); input is derived from it. */
  messages: EvalMessage[];
  /** Explicit prompt override; defaults to the last user message. */
  input?: string;
  /** Explicit expected answer; defaults to the last assistant message. */
  answer?: string;
  mode: SaveCaseMode;
  /** Required for mode 'rules': keywords the answer must include. */
  keywords?: string[];
  /** Required for mode 'rubric': free-text grading rubric. */
  rubric?: string;
  /** 'json' adds a json_schema scorer, 'viz' adds a viz_block scorer. */
  format?: 'text' | 'json' | 'viz';
  clusterId?: string;
}

function lastByRole(messages: EvalMessage[], role: 'user' | 'assistant'): string | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === role) return messages[i].content;
  }
  return undefined;
}

function scorer(type: ScorerType, options: Record<string, unknown> = {}): ScorerSpec {
  return { type, weight: 1, gate: false, options };
}

function slug(s: string): string {
  const out = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return out.length > 0 ? out : 'case';
}

export function draftSampleId(input: string, index: number): string {
  return `${slug(input.slice(0, 40))}-${index}`;
}

export function messageToSample(opts: MessageToSampleOptions): EvalSample {
  const input = opts.input ?? lastByRole(opts.messages, 'user') ?? '';
  const answer = opts.answer ?? lastByRole(opts.messages, 'assistant') ?? '';
  if (input.trim().length === 0) throw new Error('messageToSample: empty input');
  if (opts.mode === 'rules' && (!opts.keywords || opts.keywords.length === 0)) {
    throw new Error('messageToSample: rules mode requires keywords');
  }
  if (opts.mode === 'rubric' && (!opts.rubric || opts.rubric.trim().length === 0)) {
    throw new Error('messageToSample: rubric mode requires rubric text');
  }

  const sample: EvalSample = {
    id: opts.id,
    input: opts.messages.length > 0 ? opts.messages : input,
    tags: [PERSONAL_SAMPLE_TAG],
    metadata: { dataClass: 'personal', source: 'chat' },
  };
  if (opts.clusterId) sample.clusterId = opts.clusterId;

  if (opts.mode === 'reference') {
    sample.reference = answer;
    sample.scorers = [scorer('exact')];
  } else if (opts.mode === 'rules') {
    sample.target = opts.keywords;
    sample.scorers = [scorer('includes', { keywords: opts.keywords })];
  } else {
    sample.rubric = opts.rubric;
    sample.reference = answer || undefined;
    sample.scorers = [scorer('llm_judge_rubric')];
  }
  if (opts.format === 'json') {
    sample.scorers = [...(sample.scorers ?? []), scorer('json_schema')];
  } else if (opts.format === 'viz') {
    sample.scorers = [...(sample.scorers ?? []), scorer('viz_block')];
  }
  return sample;
}

const SECRET_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /sk-[A-Za-z0-9-_]{8,}/g, label: 'api-key' },
  { re: /sk-ant-[A-Za-z0-9-_]{8,}/g, label: 'api-key' },
  { re: /\b(AKIA[0-9A-Z]{16})\b/g, label: 'aws-key' },
  { re: /ghp_[A-Za-z0-9]{8,}|gho_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,}/g, label: 'github-token' },
  { re: /xox[baprs]-[A-Za-z0-9-]{8,}/g, label: 'slack-token' },
  { re: /Bearer\s+[A-Za-z0-9\-._~+/=]{8,}/g, label: 'bearer-token' },
  { re: /(?<=["']?)(api[_-]?key|api[_-]?secret|access[_-]?token|secret[_-]?key|client[_-]?secret)(["']?\s*[:=]\s*["']?)([^\s"'<>;]{4,})/gi, label: 'credential' },
];

const ENV_LINE_RE = /^(\s*(?:export\s+)?[A-Z_][A-Z0-9_]*\s*=\s*)(.+?)\s*$/;

export function maskSecrets(text: string): { text: string; redacted: boolean } {
  let redacted = false;
  let out = text;
  for (const { re } of SECRET_PATTERNS) {
    out = out.replace(re, (m) => {
      redacted = true;
      // Preserve `Bearer ` / `KEY=` prefixes so the shape stays readable.
      const prefix = /^(Bearer\s+|[^=:]*[:=]["']?)/.exec(m)?.[1] ?? '';
      void prefix;
      if (/^Bearer\s+/i.test(m)) {
        redacted = true;
        return m.replace(/\s+\S+$/, ' [REDACTED]');
      }
      const kv = /^(.*[:=]["']?)([^\s"'<>;]+)(["']?)$/.exec(m);
      if (kv) return `${kv[1]}[REDACTED]${kv[3]}`;
      return '[REDACTED]';
    });
  }
  out = out
    .split('\n')
    .map((line) => {
      const m = ENV_LINE_RE.exec(line);
      if (m && /KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL/i.test(m[1])) {
        const value = m[2].replace(/^["']|["']$/g, '');
        if (value.length > 0 && value !== '[REDACTED]') {
          redacted = true;
          return `${m[1]}[REDACTED]`;
        }
      }
      return line;
    })
    .join('\n');
  return { text: out, redacted };
}

export interface FixtureCandidate {
  path: string;
  size?: number;
}

export interface FixtureDrop {
  path: string;
  reason: string;
}

export const FIXTURE_MAX_BYTES = 1024 * 1024;

const IGNORED_DIR_PARTS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'target',
  '__pycache__',
  '.venv',
  'coverage',
  '.next',
  '.tauri',
  'src-tauri/target',
];

const SECRET_FILENAME_RES = [
  /(^|[\\/])\.env(\.|$)/i,
  /credential/i,
  /\.pem$/i,
  /\.key$/i,
  /(^|[\\/])secrets?([\\/.-]|$)/i,
  /\.p12$/i,
  /id_rsa/i,
];

export function buildFixtureWhitelist(
  paths: FixtureCandidate[],
): { kept: FixtureCandidate[]; dropped: FixtureDrop[] } {
  const kept: FixtureCandidate[] = [];
  const dropped: FixtureDrop[] = [];
  for (const p of paths) {
    const normalized = p.path.replace(/\\/g, '/');
    if (SECRET_FILENAME_RES.some((re) => re.test(normalized))) {
      dropped.push({ path: p.path, reason: 'secret-filename' });
      continue;
    }
    if (IGNORED_DIR_PARTS.some((part) => normalized.split('/').includes(part))) {
      dropped.push({ path: p.path, reason: 'ignored-pattern' });
      continue;
    }
    if (typeof p.size === 'number' && p.size > FIXTURE_MAX_BYTES) {
      dropped.push({ path: p.path, reason: 'over-1mb' });
      continue;
    }
    kept.push(p);
  }
  return { kept, dropped };
}

export interface PersonalManifestOptions {
  id: string;
  titleKo: string;
  titleEn: string;
  descriptionKo?: string;
  descriptionEn?: string;
  version?: string;
  withFixtures?: boolean;
}

export function createPersonalManifest(opts: PersonalManifestOptions): EvalPackManifest {
  return {
    schemaVersion: '1.0',
    id: opts.id,
    version: opts.version ?? '0.1.0',
    title: { ko: opts.titleKo, en: opts.titleEn },
    description: {
      ko: opts.descriptionKo ?? '개인 채팅에서 저장한 평가 케이스',
      en: opts.descriptionEn ?? 'Eval cases saved from personal chats',
    },
    category: PERSONAL_CATEGORY,
    lang: ['ko'],
    license: { id: PERSONAL_LICENSE_ID },
    kind: 'single_turn',
    source: { type: 'jsonl', file: 'samples.jsonl' },
    useAgentSystemPrompt: false,
    scorers: [],
    metrics: [
      {
        id: 'accuracy',
        description: { ko: '정확도', en: 'Accuracy' },
        source: 'score',
        field: 'accuracy',
        aggregation: 'mean',
        lowerIsBetter: false,
        scoreType: 'binary',
        range: { min: 0, max: 1 },
        normalization: { kind: 'baseline', baseline: 0, ceiling: 1 },
        countsTowardComposite: true,
      },
    ],
    tiers: { smoke: 5, standard: 20, full: 'all' },
    defaults: { timeoutSec: 180, maxTurns: 12, epochs: 1, circular: false },
    requires: { toolCalling: false, logprobs: false },
    trusted: false,
    // Data-class tagging for future export gating (extension key; not in schema).
    ...({
      'x-fortress': {
        dataClass: opts.withFixtures ? ['personal', 'fixture-files'] : ['personal'],
      },
    } as unknown as Partial<EvalPackManifest>),
  };
}

export function samplesToJsonl(samples: EvalSample[]): string {
  return samples.map((s) => JSON.stringify(s)).join('\n') + (samples.length > 0 ? '\n' : '');
}
