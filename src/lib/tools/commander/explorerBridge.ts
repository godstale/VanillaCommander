// P11-24: explorer 도구 → 탐색기 탭 연결 브리지 (approvalBus 패턴).
// 에이전트 도구는 React 바깥에서 동작하므로, 마운트된 UI가 opener를 등록한다.

export interface ExplorerRequest {
  action: 'open' | 'goto' | 'select';
  path: string;
}

type ExplorerOpener = (req: ExplorerRequest) => void;

let opener: ExplorerOpener | null = null;

export function setExplorerOpener(fn: ExplorerOpener | null): void {
  opener = fn;
}

/** 등록된 UI가 있으면 true. 없으면 도구가 에러를 반환한다. */
export function requestExplorer(req: ExplorerRequest): boolean {
  if (!opener) return false;
  opener(req);
  return true;
}
