import { useState, useEffect, useMemo } from 'react';
import {
  ShieldAlert,
  Terminal,
  FileCode,
  AlertTriangle,
  Check,
  X,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useSafeWorkspace } from '@/lib/context/WorkspaceContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import {
  approvalBus,
  type ApprovalRequestItem,
  type ApprovalDecision,
} from '@/lib/approval/approvalBus';

interface ApprovalDialogProps {
  request?: ApprovalRequestItem | null;
  onDecision?: (id: string, decision: ApprovalDecision) => void;
}

export function ApprovalDialog({ request: propRequest, onDecision }: ApprovalDialogProps) {
  const { t } = useLanguage();
  const [busRequest, setBusRequest] = useState<ApprovalRequestItem | null>(
    () => (propRequest !== undefined ? null : approvalBus.getPendingRequests()[0] ?? null),
  );
  const [showArgs, setShowArgs] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);

  const activeRequest = propRequest !== undefined ? propRequest : busRequest;
  const workspaceCtx = useSafeWorkspace();
  const workspaceRoot = workspaceCtx?.workspaceRoot;

  const argsObj = (activeRequest?.arguments ?? {}) as Record<string, unknown>;
  const isShell = activeRequest?.toolName === 'shell';
  const isWrite = activeRequest?.toolName === 'write';
  const isEdit = activeRequest?.toolName === 'edit';

  const shellCommand = isShell ? String(argsObj.command || '') : '';
  const filePath = isWrite || isEdit ? String(argsObj.path || '') : '';
  const targetContent = isEdit ? String(argsObj.targetContent || '') : '';
  const replacementContent = isEdit ? String(argsObj.replacementContent || '') : '';

  const resolvedFilePath = useMemo(() => {
    if (!filePath || !workspaceRoot) return null;
    const isAbs = filePath.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(filePath);
    if (isAbs) return null;
    const clean = filePath.replace(/^\.[\\/]/, '');
    const separator = workspaceRoot.includes('\\') ? '\\' : '/';
    return `${workspaceRoot.replace(/[\\/]+$/, '')}${separator}${clean}`;
  }, [filePath, workspaceRoot]);

  // Subscribe to approval bus if not controlled by props
  useEffect(() => {
    if (propRequest !== undefined) return;

    const unsubscribe = approvalBus.subscribe((req) => {
      setBusRequest(req);
      setShowArgs(false);
      setRejectReason('');
      setShowRejectInput(false);
    });

    return () => {
      unsubscribe();
    };
  }, [propRequest]);

  if (!activeRequest) return null;

  const handleDecision = (approved: boolean, rememberForSession = false) => {
    const decision: ApprovalDecision = {
      approved,
      reason: approved
        ? undefined
        : rejectReason.trim() || t('approval.defaultReject'),
      rememberForSession,
    };

    if (onDecision) {
      onDecision(activeRequest.id, decision);
    } else {
      approvalBus.resolve(activeRequest.id, decision);
    }

    // Advance to next pending request if any
    const remaining = approvalBus.getPendingRequests().filter((r) => r.id !== activeRequest.id);
    setBusRequest(remaining.length > 0 ? remaining[0] : null);
    setShowArgs(false);
    setRejectReason('');
    setShowRejectInput(false);
  };

  const riskBadgeColor =
    activeRequest.risk === 'critical'
      ? 'bg-destructive/20 text-destructive border-destructive/30'
      : activeRequest.risk === 'high'
        ? 'bg-warning/20 text-warning border-warning/30'
        : 'bg-primary/20 text-primary border-primary/30';

  return (
    <Dialog open={Boolean(activeRequest)} onOpenChange={(open) => !open && handleDecision(false)}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            {activeRequest.risk === 'critical' ? (
              <AlertTriangle className="h-5 w-5 text-destructive" />
            ) : (
              <ShieldAlert className="h-5 w-5 text-warning" />
            )}
            <DialogTitle className="text-base font-semibold text-foreground">
              {t('approval.title')}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            {t('approval.desc')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2 text-xs">
          {/* Tool Info Bar */}
          <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted/50 border border-border/60">
            <div className="flex items-center gap-2">
              {isShell ? (
                <Terminal className="h-4 w-4 text-destructive" />
              ) : (
                <FileCode className="h-4 w-4 text-primary" />
              )}
              <span className="font-mono font-semibold text-foreground text-sm">
                {activeRequest.toolName}
              </span>
            </div>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase font-semibold border ${riskBadgeColor}`}
            >
              {activeRequest.risk}
            </span>
          </div>

          {/* Special view for shell: full command */}
          {isShell && shellCommand && (
            <div className="space-y-1">
              <span className="text-[11px] font-medium text-muted-foreground">{t('approval.command')}</span>
              <div className="p-3 rounded-lg bg-code text-code-foreground font-mono text-xs overflow-x-auto border border-border/80">
                <code>$ {shellCommand}</code>
              </div>
            </div>
          )}

          {/* Special view for write / edit: file path */}
          {filePath && (
            <div className="space-y-1">
              <span className="text-[11px] font-medium text-muted-foreground">{t('approval.targetFile')}</span>
              <div className="p-2 rounded bg-muted/60 font-mono text-xs text-foreground break-all border border-border/40 space-y-1">
                <div>{filePath}</div>
                {resolvedFilePath && (
                  <div className="text-[11px] text-muted-foreground font-sans pt-1 border-t border-border/30">
                    {t('approval.saveLocation')}{' '}
                    <span className="font-mono text-foreground font-medium">{resolvedFilePath}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Edit diff preview */}
          {isEdit && (targetContent || replacementContent) && (
            <div className="space-y-1">
              <span className="text-[11px] font-medium text-muted-foreground">{t('approval.diff')}</span>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] font-mono">
                <div className="p-2 rounded bg-destructive/10 border border-destructive/20 max-h-32 overflow-y-auto">
                  <div className="text-destructive font-semibold mb-1">{t('approval.before')}</div>
                  <pre className="whitespace-pre-wrap">{targetContent}</pre>
                </div>
                <div className="p-2 rounded bg-success/10 border border-success/20 max-h-32 overflow-y-auto">
                  <div className="text-success font-semibold mb-1">{t('approval.after')}</div>
                  <pre className="whitespace-pre-wrap">{replacementContent}</pre>
                </div>
              </div>
            </div>
          )}

          {/* Collapsible raw arguments */}
          <div className="border border-border/60 rounded-md overflow-hidden bg-muted/20">
            <button
              type="button"
              onClick={() => setShowArgs((prev) => !prev)}
              className="w-full flex items-center justify-between px-3 py-1.5 text-muted-foreground hover:text-foreground text-[11px]"
            >
              <span>{t('approval.rawArgs')}</span>
              {showArgs ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
            {showArgs && (
              <div className="p-2 border-t border-border/50 bg-background/50 font-mono text-[10px] overflow-x-auto max-h-40">
                <pre>{JSON.stringify(activeRequest.arguments, null, 2)}</pre>
              </div>
            )}
          </div>

          {/* Optional rejection reason input */}
          {showRejectInput ? (
            <div className="space-y-1 pt-1">
              <label className="text-[11px] font-medium text-muted-foreground">
                {t('approval.rejectLabel')}
              </label>
              <input
                type="text"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder={t('approval.rejectPlaceholder')}
                className="w-full px-2.5 py-1.5 rounded-md border border-border bg-background text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowRejectInput(true)}
              className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              {t('approval.rejectToggle')}
            </button>
          )}
        </div>

        <DialogFooter className="flex flex-col sm:flex-row gap-2 pt-2 sm:justify-between items-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => handleDecision(true, true)}
            className="text-[11px] text-muted-foreground hover:text-foreground w-full sm:w-auto"
          >
            {t('approval.alwaysAllow')}
          </Button>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => handleDecision(false)}
              className="text-xs flex items-center gap-1"
            >
              <X className="h-3.5 w-3.5" />
              <span>{t('approval.reject')}</span>
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => handleDecision(true)}
              className="text-xs flex items-center gap-1 bg-primary text-primary-foreground"
            >
              <Check className="h-3.5 w-3.5" />
              <span>{t('approval.approve')}</span>
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
