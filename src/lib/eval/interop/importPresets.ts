import { z } from 'zod';

// D4 라이선스 예외로 번들하지 않는 외부 팩의 사용자 측 import 프리셋.
// 네트워크 호출 없음: origin 서술자(descriptor)만 제공한다. 실제 다운로드는
// 사용자가 라이선스를 확인한 뒤 수동으로 수행하고 user/project 팩으로 적재한다.

export const ImportPresetSourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('hf'),
    repo: z.string(),
    path: z.string().optional(),
    revision: z.string().optional(),
  }),
  z.object({
    kind: z.literal('github-raw'),
    url: z.string(),
    path: z.string(),
    revision: z.string().optional(),
  }),
]);
export type ImportPresetSource = z.infer<typeof ImportPresetSourceSchema>;

export const ImportPresetSchema = z.object({
  id: z.string(),
  reason: z.string(),
  license: z.string(),
  source: ImportPresetSourceSchema,
  importAs: z.string(),
  notes: z.string(),
});
export type ImportPreset = z.infer<typeof ImportPresetSchema>;

function preset(value: ImportPreset): ImportPreset {
  return ImportPresetSchema.parse(value);
}

export const IMPORT_PRESETS: ImportPreset[] = [
  preset({
    id: 'hae-rae',
    reason: 'CC-BY-NC-ND: 비상업·변경금지 조건으로 앱 번들에 포함할 수 없음',
    license: 'CC-BY-NC-ND-4.0',
    source: {
      kind: 'hf',
      repo: 'HAERAE-HUB/HAE_RAE_BENCH_2.0',
      revision: 'latest',
    },
    importAs: 'user pack (single_turn, choice)',
    notes:
      '사용자가 HF에서 직접 다운로드한 뒤 user 팩으로 적재. 재배포 금지. ' +
      'HF 태그에 MIT가 표기된 경우가 있으나 저작자 고지는 CC-BY-NC-ND이므로 import 시점에 라이선스를 재확인할 것.',
  }),
  preset({
    id: 'gpqa',
    reason: '저작자의 평문 배포 금지 요청 + HF gated 데이터셋이라 번들 불가',
    license: 'unverified (gated; confirm before import)',
    source: {
      kind: 'hf',
      repo: 'Idavidrein/gpqa',
      revision: 'latest',
    },
    importAs: 'user pack (single_turn, choice) via file import after gate approval',
    notes:
      'gated 승인을 받은 사용자가 파일을 직접 내려받아 파일 import로 적재. ' +
      '내보내기(export)/공유 시 samples 원문을 제거(strip)하고 문제 ID·출처만 유지할 것.',
  }),
  preset({
    id: 'click',
    reason: '라이선스 미확인(license unverified)이라 번들 불가',
    license: 'unverified',
    source: {
      kind: 'github-raw',
      url: 'https://github.com/rladmstn1714/CLIcK',
      path: 'Dataset',
      revision: 'latest',
    },
    importAs: 'user pack (single_turn, choice)',
    notes:
      'CLIcK: 한국어 문화·언어 지능 벤치마크. 리포지토리 license 필드가 비어 있어 ' +
      'import 전에 라이선스를 반드시 확인할 것. 확인 전까지 번들·재배포 금지.',
  }),
  preset({
    id: 'logickor',
    reason: '라이선스 미확인(license unverified)이라 번들 불가',
    license: 'unverified',
    source: {
      kind: 'github-raw',
      url: 'https://github.com/instructkr/LogicKor',
      path: 'questions.jsonl',
      revision: 'latest',
    },
    importAs: 'user pack (Q4 judge pack)',
    notes:
      'GitHub raw questions.jsonl을 Q4 Judge 팩 형태로 적재하는 프리셋. ' +
      '판정자(judge) 실행이 필요하므로 외부 연동 동의가 필요할 수 있음. 라이선스 확인 전까지 번들·재배포 금지.',
  }),
];

export function getImportPreset(id: string): ImportPreset | undefined {
  return IMPORT_PRESETS.find((p) => p.id === id);
}
