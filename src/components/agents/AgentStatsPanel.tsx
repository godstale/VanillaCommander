import React, { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Activity, MessageSquare, History } from 'lucide-react';
import * as sessionsRepo from '@/lib/db/repositories/sessionsRepo';
import * as entriesRepo from '@/lib/db/repositories/entriesRepo';
import { useLanguage } from '@/lib/i18n/LanguageContext';

interface AgentStats {
  sessionCount: number;
  messageCount: number;
  sessionData: { name: string; messages: number }[];
}

export const AgentStatsPanel: React.FC<{ agentId: string }> = ({ agentId }) => {
  const [stats, setStats] = useState<AgentStats | null>(null);
  const [loading, setLoading] = useState(true);
  const { t } = useLanguage();

  useEffect(() => {
    let active = true;

    const loadStats = async () => {
      try {
        const allSessions = await sessionsRepo.listSessions();
        const agentSessions = allSessions.filter((s) => s.agentId === agentId);

        let totalMessages = 0;
        const chartItems: { name: string; messages: number }[] = [];

        for (const s of agentSessions) {
          let entries = await entriesRepo.getEntries(s.id);
          if (entries.length === 0 && !s.id.startsWith('chat:')) {
            const fallback = await entriesRepo.getEntries(`chat:${s.id}`);
            if (fallback.length > 0) {
              entries = fallback;
            }
          }
          const msgCount = entries.filter((e) => e.type === 'message').length;
          totalMessages += msgCount;
          chartItems.push({
            name: s.title.length > 12 ? s.title.slice(0, 12) + '...' : s.title,
            messages: msgCount,
          });
        }

        if (active) {
          setStats({
            sessionCount: agentSessions.length,
            messageCount: totalMessages,
            sessionData: chartItems.slice(-7), // Last 7 sessions
          });
        }
      } catch (err) {
        console.error('Failed to load agent stats:', err);
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadStats();

    return () => {
      active = false;
    };
  }, [agentId]);

  if (loading) {
    return (
      <div className="py-4 text-center text-xs text-muted-foreground animate-pulse">
        {t('agentStats.loading')}
      </div>
    );
  }

  if (!stats || stats.sessionCount === 0) {
    return (
      <div className="py-4 text-center text-xs text-muted-foreground">
        {t('agentStats.empty')}
      </div>
    );
  }

  return (
    <div className="space-y-4 pt-2">
      {/* Metric Cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 rounded-lg bg-card border border-border flex items-center gap-3">
          <div className="p-2 rounded-md bg-primary/10 text-primary">
            <History className="h-4 w-4" />
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground">{t('agentStats.sessions')}</div>
            <div className="text-base font-bold text-foreground">{t('agentStats.sessionsUnit', { n: stats.sessionCount })}</div>
          </div>
        </div>

        <div className="p-3 rounded-lg bg-card border border-border flex items-center gap-3">
          <div className="p-2 rounded-md bg-primary/10 text-primary">
            <MessageSquare className="h-4 w-4" />
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground">{t('agentStats.messages')}</div>
            <div className="text-base font-bold text-foreground">{t('agentStats.messagesUnit', { n: stats.messageCount })}</div>
          </div>
        </div>
      </div>

      {/* Session Message Activity Chart */}
      {stats.sessionData.length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card space-y-2">
          <div className="flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-semibold text-foreground">{t('agentStats.recentChart')}</span>
          </div>

          <div className="w-full h-40 pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.sessionData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--card)',
                    borderRadius: '6px',
                    fontSize: '11px',
                  }}
                />
                <Bar dataKey="messages" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
};

export default AgentStatsPanel;
