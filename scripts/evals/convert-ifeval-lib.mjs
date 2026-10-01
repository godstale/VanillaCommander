#!/usr/bin/env node
// Shared IFEval conversion: instruction_id_list + per-instruction kwargs
// (non-null fields verbatim) -> sample.ifeval[].
import {
  assertUniqueIds,
  fetchAllDsRows,
  log,
  tagReliability,
  writeJsonl,
  writeLicense,
  writeManifest,
  EVALS_ROOT,
  SEED,
} from './lib.mjs';

export function toIfevalArray(instructionIds, kwargs) {
  // datasets-server returns the kwargs list either as an array or as an
  // object keyed by instruction index ("0", "1", ...).
  const list = Array.isArray(kwargs)
    ? kwargs
    : Object.keys(kwargs ?? {})
      .filter((k) => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => kwargs[k]);
  return instructionIds.map((id, i) => {
    const raw = list[i] ?? {};
    const clean = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v !== null && v !== undefined) clean[k] = v;
    }
    return { id, kwargs: clean };
  });
}

function ifevalMetrics() {
  const mk = (id, label) => ({
    id,
    description: { ko: label.ko, en: label.en },
    source: 'score',
    aggregation: 'mean',
    lowerIsBetter: false,
    scoreType: 'binary',
    range: { min: 0, max: 1 },
    normalization: { kind: 'baseline', baseline: 0 },
  });
  return [
    mk('prompt-strict', { ko: '프롬프트 통과율(strict)', en: 'Prompt-level pass rate (strict)' }),
    mk('prompt-loose', { ko: '프롬프트 통과율(loose)', en: 'Prompt-level pass rate (loose)' }),
  ];
}

function ifevalScorers() {
  return [
    { type: 'ifeval', key: 'strict', options: { mode: 'strict' } },
    { type: 'ifeval', key: 'loose', options: { mode: 'loose' } },
  ];
}

export async function buildIfeval({
  packId,
  dataset,
  revision,
  originUrl,
  lang,
  title,
  description,
  systemPrompt,
  converterFile,
  converterVersion,
  downloadDate,
  tiers,
  idPrefix,
}) {
  const { rows, total } = await fetchAllDsRows(dataset, 'default', 'train');
  log(`${packId}: fetched ${rows.length}/${total}`);
  const samples = rows.map((row, i) => ({
    id: `${idPrefix}-${row.key ?? i}`,
    input: row.prompt,
    ifeval: toIfevalArray(row.instruction_id_list, row.kwargs),
    metadata: { task: packId, lang },
  }));
  assertUniqueIds(samples, packId);
  for (const s of samples) {
    if (!Array.isArray(s.ifeval) || s.ifeval.length === 0) {
      throw new Error(`${packId}: sample ${s.id} has empty ifeval[]`);
    }
  }
  const tagged = tagReliability(samples, SEED);
  writeManifest(packId, {
    schemaVersion: '1.0',
    id: packId,
    version: '1.0.0',
    title,
    description,
    category: 'Q3',
    lang: [lang],
    license: { id: 'Apache-2.0', source: originUrl },
    kind: 'single_turn',
    source: { type: 'jsonl', file: 'samples.jsonl' },
    systemPrompt,
    scorers: ifevalScorers(),
    metrics: ifevalMetrics(),
    tiers,
  });
  writeJsonl(`${EVALS_ROOT}/${packId}/samples.jsonl`, samples);
  const idSet = new Set();
  for (const s of samples) for (const ins of s.ifeval) idSet.add(ins.id);
  writeLicense(packId, [
    `# License — ${packId}`,
    '',
    `- Origin: ${originUrl} (${total} rows)`,
    `- Revision (HF commit sha): ${revision}`,
    `- Download date (UTC): ${downloadDate}`,
    `- Converter: scripts/evals/${converterFile} v${converterVersion} (seed ${SEED})`,
    `- License: Apache-2.0`,
    `- Bundled samples: ${samples.length}`,
    `- Instruction types (${idSet.size}): ${[...idSet].sort().join(', ')}`,
  ]);
  log(`${packId}: wrote ${samples.length} samples, reliability=${tagged}`);
  return { packId, samples: samples.length, instructionTypes: [...idSet].sort() };
}
