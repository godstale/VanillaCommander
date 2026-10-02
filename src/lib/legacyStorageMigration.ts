// Fortress 시절 localStorage 키(`fortress:*`, `fortress_*`, `fortress-*`, 패널 autoSaveId 등)를 새 이름으로 옮긴다.
// 다른 모듈이 import 시점에 localStorage를 읽으므로 main.tsx의 첫 import로 실행돼야 한다.
const LEGACY = 'fortress';
const CURRENT = 'vanilla-commander';

export function migrateLegacyStorageKeys(storage: Storage): void {
  const legacyKeys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.includes(LEGACY)) legacyKeys.push(key);
  }
  for (const key of legacyKeys) {
    const nextKey = key.split(LEGACY).join(CURRENT);
    const value = storage.getItem(key);
    if (value !== null && storage.getItem(nextKey) === null) {
      storage.setItem(nextKey, value);
    }
    storage.removeItem(key);
  }
}

try {
  migrateLegacyStorageKeys(window.localStorage);
} catch {
  // 저장소 접근 불가(프라이빗 모드 등) — 이관 없이 계속
}
