import React, { useState } from 'react';
import {
  Bot,
  MessageSquare,
  Edit2,
  Trash2,
  Copy,
  Star,
  Cpu,
  Thermometer,
  Wrench,
  BookOpen,
  Layers,
  Activity,
  Terminal,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import type { Agent, AgentConnectionStatus } from '@/lib/types/agent';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

export interface AgentCardProps {
  agent: Agent;
  isOnlyAgent?: boolean;
  status?: AgentConnectionStatus;
  isChecking?: boolean;
  onCheckConnection?: (agent: Agent) => void;
  onOpenMonitor?: (agent: Agent) => void;
  onStartChat: (agent: Agent) => void;
  onShowStats?: (agent: Agent) => void;
  onShowLogs?: (agent: Agent) => void;
  onEdit: (agent: Agent) => void;
  onDuplicate?: (agent: Agent) => void;
  onSetDefault: (agent: Agent) => void;
  onDelete: (agent: Agent) => void;
}

export const AgentCard: React.FC<AgentCardProps> = ({
  agent,
  isOnlyAgent,
  status = 'unknown',
  isChecking = false,
  onCheckConnection,
  onOpenMonitor,
  onStartChat,
  onShowStats,
  onShowLogs,
  onEdit,
  onDuplicate,
  onSetDefault,
  onDelete,
}) => {
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const { t } = useLanguage();


  const handleDelete = () => {
    setDeleteConfirmOpen(false);
    onDelete(agent);
  };

  const getStatusConfig = () => {
    switch (status) {
      case 'connected':
        return {
          containerClass: 'bg-success/10 border-success/30 text-success',
          iconClass: 'text-success',
          dotClass: 'bg-success',
          label: t('agentCard.connected'),
        };
      case 'disconnected':
        return {
          containerClass: 'bg-destructive/10 border-destructive/30 text-destructive',
          iconClass: 'text-destructive',
          dotClass: 'bg-destructive',
          label: t('agentCard.disconnected'),
        };
      case 'unknown':
      default:
        return {
          containerClass: 'bg-muted border-border text-foreground',
          iconClass: 'text-foreground',
          dotClass: 'bg-foreground',
          label: t('agentCard.unchecked'),
        };
    }
  };

  const statusConfig = getStatusConfig();

  return (
    <>
      <div className="group rounded-xl border border-border bg-card p-3.5 transition-all hover:border-primary/50 hover:shadow-xs space-y-2.5">
        {/* Header: Name + Badges */}
        <div className="relative flex items-start gap-2">
          <div className="flex flex-1 items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => (onOpenMonitor ? onOpenMonitor(agent) : onCheckConnection?.(agent))}
              disabled={isChecking}
              className={`relative h-8 w-8 rounded-lg border flex items-center justify-center shrink-0 transition-all cursor-pointer hover:opacity-85 hover:scale-105 active:scale-95 focus:outline-none focus:ring-1 focus:ring-ring ${statusConfig.containerClass}`}
              title={t('agentCard.statusTitle', { label: statusConfig.label, checking: isChecking ? t('agentCard.checking') : '' })}
              aria-label={t('agentCard.statusLabel', { label: statusConfig.label })}
            >
              {isChecking ? (
                <Loader2 className={`h-4 w-4 animate-spin ${statusConfig.iconClass}`} />
              ) : (
                <Bot className={`h-4 w-4 ${statusConfig.iconClass}`} />
              )}
              <span
                className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-card shadow-xs ${statusConfig.dotClass}`}
              />
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <h4 className="text-xs font-semibold text-foreground truncate">{agent.name}</h4>
                {agent.isDefault && (
                  <span className="flex items-center gap-0.5 px-1.5 py-0.2 rounded-full bg-warning/15 text-warning text-[10px] font-medium border border-warning/25 shrink-0">
                    <Star className="h-2.5 w-2.5 fill-warning" />
                    <span>{t('agentCard.isDefault')}</span>
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground line-clamp-1">
                {agent.description || t('agentCard.noDesc')}
              </p>
            </div>
          </div>

          <div className="absolute right-0 top-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto focus-within:pointer-events-auto bg-card pl-2">
            <button
              type="button"
              onClick={() => onCheckConnection?.(agent)}
              disabled={isChecking}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
              title={t('agentCard.check')}
              aria-label={t('agentCard.check')}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isChecking ? 'animate-spin' : ''}`} />
            </button>
            {!agent.isDefault && (
              <button
                type="button"
                onClick={() => onSetDefault(agent)}
                className="p-1 rounded text-muted-foreground hover:text-warning hover:bg-muted transition-colors"
                title={t('agentCard.setDefault')}
              >
                <Star className="h-3.5 w-3.5" />
              </button>
            )}
            {!isOnlyAgent && (
              <button
                type="button"
                onClick={() => setDeleteConfirmOpen(true)}
                className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-muted transition-colors"
                title={t('agentCard.delete')}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
            {onDuplicate && (
              <button
                type="button"
                onClick={() => onDuplicate(agent)}
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title={t('agentCard.duplicate')}
                aria-label={t('agentCard.duplicate')}
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Metadata Badges */}
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono text-muted-foreground">
          <span className="flex items-center gap-1 bg-muted/60 px-1.5 py-0.5 rounded">
            <Cpu className="h-3 w-3 text-primary" />
            <span className="truncate max-w-[100px]">{agent.model}</span>
          </span>
          <span className="flex items-center gap-1 bg-muted/60 px-1.5 py-0.5 rounded">
            <Layers className="h-3 w-3 text-info" />
            <span>
              {agent.contextSize > 0
                ? `${agent.contextSize >= 1024 ? Math.round(agent.contextSize / 1024) + 'k' : agent.contextSize} ctx`
                : '8k ctx'}
            </span>
          </span>
          <span className="flex items-center gap-1 bg-muted/60 px-1.5 py-0.5 rounded">
            <Thermometer className="h-3 w-3" />
            <span>{agent.temperature}</span>
          </span>
          <span className="flex items-center gap-1 bg-muted/60 px-1.5 py-0.5 rounded">
            <Wrench className="h-3 w-3" />
            <span>{t('agentCard.tools', { n: agent.enabledBuiltinTools.length })}</span>
          </span>
          {agent.enabledSkills.length > 0 && (
            <span className="flex items-center gap-1 bg-muted/60 px-1.5 py-0.5 rounded">
              <BookOpen className="h-3 w-3 text-primary" />
              <span>{t('agentCard.skills', { n: agent.enabledSkills.length })}</span>
            </span>
          )}
        </div>

        {/* Action Buttons: Start Conversation + Edit side-by-side, Statistics & Logs */}
        <div className="pt-1 space-y-1.5">
          <div className="flex gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onStartChat(agent)}
              className="flex-1 h-7 text-xs flex items-center justify-center gap-1.5 border-border/80 hover:bg-primary hover:text-primary-foreground hover:border-primary transition-colors cursor-pointer"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              <span>{t('agentCard.startChat')}</span>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onEdit(agent)}
              className="flex-1 h-7 text-xs flex items-center justify-center gap-1.5 border-border/80 hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
              title={t('agentCard.edit')}
            >
              <Edit2 className="h-3.5 w-3.5" />
              <span>{t('agentCard.editShort')}</span>
            </Button>
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onOpenMonitor?.(agent)}
              className="w-full h-7 text-[10px] px-1 flex items-center justify-center gap-1 text-primary hover:text-primary hover:bg-primary/10 transition-colors border border-primary/30 cursor-pointer"
              title={t('agentCard.monitorTitle')}
            >
              <Activity className="h-3 w-3 text-primary" />
              <span>{t('agentCard.monitor')}</span>
            </Button>

            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onShowStats?.(agent)}
              className="w-full h-7 text-[10px] px-1 flex items-center justify-center gap-1 text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors border border-border/40 cursor-pointer"
              title={t('agentCard.statsTitle')}
            >
              <Cpu className="h-3 w-3 text-warning" />
              <span>{t('agentCard.stats')}</span>
            </Button>

            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onShowLogs?.(agent)}
              className="w-full h-7 text-[10px] px-1 flex items-center justify-center gap-1 text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors border border-border/40 cursor-pointer"
              title={t('agentCard.logTitle')}
            >
              <Terminal className="h-3 w-3 text-primary" />
              <span>{t('agentCard.log')}</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">{t('agentCard.deleteTitle')}</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground leading-relaxed pt-2">
              {t('agentCard.deleteBody', { name: agent.name })}
              {agent.isDefault && (
                <span className="block mt-2 text-warning font-medium">
                  {t('agentCard.deleteDefaultNote')}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="flex flex-row justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDeleteConfirmOpen(false)}
              className="text-xs"
            >
              {t('agentCard.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              className="text-xs"
            >
              {t('agentCard.confirmDelete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
