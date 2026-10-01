import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import type { EvalScoreRow, EvalTrialRow } from '@/lib/eval/types';
import { combineTrialScores, pickEffectiveScore } from '@/lib/eval/scoring/metrics';

export interface ContextCurveChartProps {
  trials: EvalTrialRow[];
  scores: EvalScoreRow[];
}

interface Bucket {
  len: number;
  acc: number | null;
  decode: number | null;
}

function bucketize(values: { len: number; v: number }[], width: number): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (const { len, v } of values) {
    const b = Math.floor(len / width) * width;
    const arr = out.get(b);
    if (arr) arr.push(v);
    else out.set(b, [v]);
  }
  return out;
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

export function ContextCurveChart({ trials, scores }: ContextCurveChartProps) {
  const { t } = useLanguage();

  const effective = pickEffectiveScore(scores);
  const byTrial = new Map<string, EvalScoreRow[]>();
  for (const s of effective) {
    const arr = byTrial.get(s.trialId);
    if (arr) arr.push(s);
    else byTrial.set(s.trialId, [s]);
  }

  const accPts: { len: number; v: number }[] = [];
  const decPts: { len: number; v: number }[] = [];
  for (const tr of trials) {
    if (tr.inputTokens === null) continue;
    const sc = combineTrialScores(byTrial.get(tr.id) ?? []);
    if (sc !== null) accPts.push({ len: tr.inputTokens, v: sc });
    if (tr.decodeTps !== null) decPts.push({ len: tr.inputTokens, v: tr.decodeTps });
  }

  if (accPts.length === 0 && decPts.length === 0) {
    return <p className="text-xs text-muted-foreground">{t('eval.report.context.noData')}</p>;
  }

  const widths = [2048, 8192];
  let width = 2048;
  const maxLen = Math.max(0, ...accPts.map((p) => p.len), ...decPts.map((p) => p.len));
  for (const w of widths) {
    if (maxLen / w <= 12) {
      width = w;
      break;
    }
    width = w;
  }

  const accBuckets = bucketize(accPts, width);
  const decBuckets = bucketize(decPts, width);
  const keys = [...new Set([...accBuckets.keys(), ...decBuckets.keys()])].sort((a, b) => a - b);
  const data: Bucket[] = keys.map((len) => ({
    len,
    acc: accBuckets.has(len) ? mean(accBuckets.get(len) ?? []) : null,
    decode: decBuckets.has(len) ? mean(decBuckets.get(len) ?? []) : null,
  }));
  const hasDecode = data.some((d) => d.decode !== null);

  return (
    <div className="rounded-lg border border-border p-2.5">
      <LineChart width={460} height={260} data={data} margin={{ top: 8, right: 12, bottom: 8, left: -8 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="len" name={t('eval.report.context.inputTokens')} tick={{ fontSize: 11 }} />
        <YAxis yAxisId="acc" tick={{ fontSize: 11 }} domain={[0, 1]} />
        {hasDecode && <YAxis yAxisId="dec" orientation="right" tick={{ fontSize: 11 }} />}
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Line yAxisId="acc" type="monotone" dataKey="acc" name={t('eval.report.context.accuracy')} stroke="#8884d8" dot={false} connectNulls />
        {hasDecode && (
          <Line yAxisId="dec" type="monotone" dataKey="decode" name={t('eval.report.context.decode')} stroke="#82ca9d" dot={false} connectNulls />
        )}
      </LineChart>
    </div>
  );
}
