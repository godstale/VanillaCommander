import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { EvalRunRow } from '@/lib/eval/types';

function formatGb(mb: number): string {
  if (!Number.isFinite(mb) || mb <= 0) return '—';
  return `${(mb / 1024).toFixed(1)} GB`;
}

function shortOs(os: string): string {
  return os.length > 80 ? `${os.slice(0, 80)}…` : os;
}

export function RunEnvironment({
  run,
  judgeLabel,
  totalSamples,
  latest,
}: {
  run: EvalRunRow;
  judgeLabel: string;
  totalSamples: number;
  latest: { vramUsedMb: number | null; gpuUtilPct: number | null; gpuTempC: number | null } | null;
}) {
  const { t, locale } = useLanguage();
  const hw = run.hardware;
  const opts = run.config.options;
  const providerVersions = Object.entries(hw.providerVersions ?? {});
  const rows: Array<[string, string, string?]> = [
    [t('eval.progress.env.profile'), locale === 'ko' ? run.config.profile.name.ko : run.config.profile.name.en],
    [
      t('eval.progress.env.packs'),
      t('eval.progress.env.packsValue', { n: run.config.packs.length, m: totalSamples }),
    ],
    [
      t('eval.progress.env.candidates'),
      t('eval.progress.env.candidatesValue', { n: run.config.candidates.length }),
    ],
    [t('eval.progress.matrix.judge'), judgeLabel],
    [t('eval.progress.env.gpu'), hw.gpuName || t('eval.progress.results.noData')],
    [t('eval.progress.env.vramTotal'), formatGb(hw.vramTotalMb)],
    [t('eval.progress.env.ramTotal'), formatGb(hw.ramTotalMb)],
    [t('eval.progress.env.os'), shortOs(hw.os), hw.os],
    [
      t('eval.progress.env.versions'),
      [
        hw.appVersion,
        ...providerVersions.map(([k, v]) => `${k} ${v}`),
      ].join(' · ') || t('eval.progress.results.noData'),
    ],
    [
      t('eval.progress.env.options'),
      t('eval.progress.env.optionsValue', {
        d: opts.deterministicMode ? t('eval.progress.env.on') : t('eval.progress.env.off'),
        r: opts.reliabilityEpochs,
        t: opts.timeoutMultiplier,
        u: opts.unloadBetweenCandidates ? t('eval.progress.env.on') : t('eval.progress.env.off'),
      }),
    ],
    [
      t('eval.progress.env.latest'),
      latest && (latest.vramUsedMb != null || latest.gpuUtilPct != null || latest.gpuTempC != null)
        ? t('eval.progress.env.latestValue', {
          v: latest.vramUsedMb != null ? `${Math.round(latest.vramUsedMb)} MB` : '—',
          g: latest.gpuUtilPct != null ? `${Math.round(latest.gpuUtilPct)}%` : '—',
          t: latest.gpuTempC != null ? Math.round(latest.gpuTempC) : '—',
        })
        : t('eval.progress.env.latestUnknown'),
    ],
  ];

  return (
    <dl className="grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
      {rows.map(([label, value, title]) => (
        <div key={label} className="flex items-baseline justify-between gap-3">
          <dt className="shrink-0 text-muted-foreground">{label}</dt>
          <dd
            className="min-w-0 truncate text-right font-mono text-[11px] text-foreground"
            title={title ?? (value.length > 40 ? value : undefined)}
          >
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
