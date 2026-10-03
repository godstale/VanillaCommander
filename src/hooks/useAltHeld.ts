import { useEffect, useState } from 'react';

/**
 * P13-01: Alt 키를 누르고 있는 동안 true를 반환한다.
 * 탐색기 툴바·주소창의 단축키 배지 표시에 사용한다 (탐색기 한정).
 */
export function useAltHeld(): boolean {
  const [held, setHeld] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey) setHeld(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!e.altKey) setHeld(false);
    };
    const onBlur = () => setHeld(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  return held;
}
