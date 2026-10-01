#!/usr/bin/env node
// Converter: ko-ifeval pack (P10-24). Origin: allganize/IFEval-Ko (Apache-2.0).
import { CONVERTER_VERSION, DOWNLOAD_DATE, isMain } from './lib.mjs';
import { buildIfeval } from './convert-ifeval-lib.mjs';

export async function build() {
  return buildIfeval({
    packId: 'ko-ifeval',
    dataset: 'allganize/IFEval-Ko',
    revision: '54199e3801116897697babf341865741dcd06fc8',
    originUrl: 'https://huggingface.co/datasets/allganize/IFEval-Ko',
    lang: 'ko',
    title: { ko: 'IFEval-Ko 한국어 지시사항 준수', en: 'IFEval-Ko Korean instruction following' },
    description: {
      ko: '한국어 검증 가능한 지시사항(Q3). 한국어 체커와 strict/loose 두 지표로 평가합니다.',
      en: 'Korean verifiable instructions (Q3), scored with Korean checkers and strict/loose metrics.',
    },
    systemPrompt: '사용자 메시지의 모든 지시사항을 정확히 따르세요.',
    converterFile: 'convert-ko-ifeval.mjs',
    converterVersion: CONVERTER_VERSION,
    downloadDate: DOWNLOAD_DATE,
    tiers: { smoke: 20, standard: 100, full: 'all' },
    idPrefix: 'ko-ifeval',
  });
}

if (isMain(import.meta.url)) {
  await build();
}
