#!/usr/bin/env node
// Converter: ifeval pack (P10-24). Origin: google/IFEval (Apache-2.0), 541 rows.
import { CONVERTER_VERSION, DOWNLOAD_DATE, isMain } from './lib.mjs';
import { buildIfeval } from './convert-ifeval-lib.mjs';

export async function build() {
  return buildIfeval({
    packId: 'ifeval',
    dataset: 'google/IFEval',
    revision: '966cd89545d6b6acfd7638bc708b98261ca58e84',
    originUrl: 'https://huggingface.co/datasets/google/IFEval',
    lang: 'en',
    title: { ko: 'IFEval 지시사항 준수', en: 'IFEval instruction following' },
    description: {
      ko: '검증 가능한 지시사항 541개(Q3). strict/loose 두 지표로 평가합니다.',
      en: '541 verifiable instructions (Q3), scored with strict and loose metrics.',
    },
    systemPrompt: 'Follow every instruction in the user message exactly.',
    converterFile: 'convert-ifeval.mjs',
    converterVersion: CONVERTER_VERSION,
    downloadDate: DOWNLOAD_DATE,
    tiers: { smoke: 20, standard: 100, full: 'all' },
    idPrefix: 'ifeval',
  });
}

if (isMain(import.meta.url)) {
  await build();
}
