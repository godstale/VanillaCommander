import { CONSENT_TEXT_VERSION } from '../constants';
import type { DataClass, IntegrationPurpose } from '../types';

export const INTEGRATION_CONSENT_TEXT_VERSION = CONSENT_TEXT_VERSION;

export const INTEGRATION_CONSENT_TEXT =
  `[${CONSENT_TEXT_VERSION}] 외부 연동 데이터 전송 동의\n` +
  '선택한 평가 데이터(공개 번들, 개인 입력, 픽스처 파일 포함 가능)가 외부 API/에이전트 CLI로 전송될 수 있습니다. ' +
  'API key stored in this PC\'s app DB — API 키는 이 PC의 앱 DB에만 저장되며 외부로 전송되지 않습니다. ' +
  '전송 목적·데이터 범위가 넓어지면 다시 동의를 구합니다.';

/** 동의 범위(목적·데이터 등급)가 넓어지면 true. 동의 없음(null) → true. */
export function needsReconsent(
  prev: { purposes: IntegrationPurpose[]; dataClasses: DataClass[] } | null,
  next: { purposes: IntegrationPurpose[]; dataClasses: DataClass[] },
): boolean {
  if (prev == null) return true;
  const prevPurposes = new Set<string>(prev.purposes);
  if (next.purposes.some((p) => !prevPurposes.has(p))) return true;
  const prevClasses = new Set<string>(prev.dataClasses);
  if (next.dataClasses.some((d) => !prevClasses.has(d))) return true;
  return false;
}
