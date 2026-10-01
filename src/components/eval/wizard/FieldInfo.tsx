import { HelpTooltip } from '@/components/ui/help-tooltip';

interface FieldInfoProps {
  label: string;
  help: string;
}

// 라벨 옆 [?] 아이콘 — 앱 전역 도움말 팝업과 동일한 형태를 사용한다.
// 카드 <button> 안에 들어가는 경우가 있어 span 트리거를 사용한다.
export function FieldInfo({ label, help }: FieldInfoProps) {
  return <HelpTooltip title={label} description={help} trigger="span" />;
}
