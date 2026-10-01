import type { IntegrationSettings } from '../types';

export type EndpointClass = 'local' | 'lan-trusted' | 'external';

function stripBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

function isLoopbackIpv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  if (parts[0] !== '127') return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

/**
 * 외부 연동 베이스 URL의 엔드포인트 등급을 분류한다.
 * - 'local': localhost, 127.0.0.0/8, ::1
 * - 'lan-trusted': settings.trustedLanHosts에 등록된 호스트
 * - 'external': 그 외 전부 (사설 IP 포함), URL 파싱 실패 시도 마찬가지
 */
export function classifyEndpoint(
  baseUrl: string,
  settings: Pick<IntegrationSettings, 'trustedLanHosts'>,
): EndpointClass {
  let host = '';
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return 'external';
  }
  host = stripBrackets(host);
  if (host === 'localhost' || host === '::1' || isLoopbackIpv4(host)) {
    return 'local';
  }
  if (settings.trustedLanHosts.some((h) => h.toLowerCase() === host)) {
    return 'lan-trusted';
  }
  return 'external';
}
