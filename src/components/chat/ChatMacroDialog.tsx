import { Trash2, CornerDownLeft } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { ChatMacro } from '@/lib/chat/chatMacros';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export interface ChatMacroDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  macros: ChatMacro[];
  onSelect: (macro: ChatMacro) => void;
  onDelete: (id: string) => void;
}

export function ChatMacroDialog({ open, onOpenChange, macros, onSelect, onDelete }: ChatMacroDialogProps) {
  const { t } = useLanguage();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">{t('chatInput.macroTitle')}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
            {t('chatInput.macroDesc')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-2 py-2">
          {macros.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">
              {t('chatInput.macroEmpty')}
            </p>
          ) : (
            macros.map((macro) => (
              <div
                key={macro.id}
                className="flex items-start gap-2 p-2.5 rounded-lg border border-border/70 bg-card/60 hover:bg-muted/40 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-semibold text-foreground truncate">{macro.name}</span>
                    <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                      {t('chatInput.macroItems', { n: macro.items.length })}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate mt-0.5">{macro.items[0]}</p>
                  <p className="text-[10px] font-mono text-muted-foreground/70 mt-0.5">
                    {new Date(macro.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    type="button"
                    size="sm"
                    variant="default"
                    onClick={() => onSelect(macro)}
                    title={t('chatInput.macroLoadTitle')}
                    className="gap-1 text-[11px] h-7"
                  >
                    <CornerDownLeft className="h-3 w-3" />
                    <span>{t('chatInput.macroLoad')}</span>
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => onDelete(macro.id)}
                    title={t('chatInput.macroDelete')}
                    aria-label={`${t('chatInput.macroDelete')}: ${macro.name}`}
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ChatMacroDialog;
