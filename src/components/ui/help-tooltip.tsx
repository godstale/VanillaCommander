import { HelpCircle } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import {
  Tooltip as UiTooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';

export interface HelpTooltipProps {
  title?: string;
  description?: string;
  guide?: string;
  /** i18n key prefix: resolves monitorHelp.{prefix}.title/.desc/.guide */
  i18n?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** 다른 <button> 안에 들어갈 때는 'span'으로 (button-in-button 회피). */
  trigger?: 'button' | 'span';
}

// 앱 전역 [?] 마우스 오버레이 팝업. 네이티브 title 툴팁 대신 이것을 사용한다.
export function HelpTooltip({ title, description, guide, i18n, side = 'top', trigger = 'button' }: HelpTooltipProps) {
  const { t } = useLanguage();
  const titleText = i18n ? t(`monitorHelp.${i18n}.title`) : (title ?? '');
  const descText = i18n ? t(`monitorHelp.${i18n}.desc`) : (description ?? '');
  const guideText = i18n ? t(`monitorHelp.${i18n}.guide`) : guide;
  return (
    <TooltipProvider delayDuration={150}>
      <UiTooltip>
        <TooltipTrigger asChild>
          {trigger === 'span' ? (
            <span
              role="button"
              tabIndex={0}
              className="text-muted-foreground hover:text-foreground p-0.5 rounded transition-colors focus:outline-none focus:ring-1 focus:ring-primary inline-flex items-center justify-center cursor-help"
              aria-label={t('monitor.helpAria', { title: titleText })}
            >
              <HelpCircle className="h-3.5 w-3.5 opacity-60 hover:opacity-100 transition-opacity" />
            </span>
          ) : (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground p-0.5 rounded transition-colors focus:outline-none focus:ring-1 focus:ring-primary inline-flex items-center justify-center cursor-help"
            aria-label={t('monitor.helpAria', { title: titleText })}
          >
            <HelpCircle className="h-3.5 w-3.5 opacity-60 hover:opacity-100 transition-opacity" />
          </button>
          )}
        </TooltipTrigger>
        <TooltipContent
          side={side}
          className="max-w-xs p-3 bg-popover text-popover-foreground border border-border shadow-2xl rounded-lg space-y-2 z-50 text-left"
        >
          <div className="font-semibold text-xs text-foreground flex items-center gap-1.5 border-b border-border/60 pb-1.5">
            <span className="text-primary font-bold">❔</span>
            <span>{titleText}</span>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground whitespace-normal">
            {descText}
          </p>
          {guideText && (
            <div className="text-[10px] bg-accent/40 rounded p-2 font-sans text-accent-foreground border border-border/40 space-y-1">
              <span className="font-semibold text-foreground block">{t('monitor.guideHeader')}</span>
              <span className="leading-normal block whitespace-normal text-muted-foreground">{guideText}</span>
            </div>
          )}
        </TooltipContent>
      </UiTooltip>
    </TooltipProvider>
  );
}
