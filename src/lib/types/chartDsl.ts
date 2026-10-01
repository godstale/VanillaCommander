import { z } from 'zod';

export const ChartDslSchema = z.object({
  type: z.enum(['bar', 'line', 'pie', 'area']),
  data: z.array(z.record(z.union([z.string(), z.number()]))),
  xKey: z.string().optional(),
  series: z.array(
    z.object({
      key: z.string(),
      label: z.string().optional(),
      color: z.string().optional(),
    }),
  ),
  title: z.string().optional(),
});

export type ChartDsl = z.infer<typeof ChartDslSchema>;

/**
 * Checks whether a code block looks like a chart DSL or pseudo-chart configuration
 * rather than a standard Mermaid diagram.
 */
export function isChartDsl(code: string): boolean {
  if (!code || typeof code !== 'string') return false;
  const trimmed = code.trim();

  // Pseudo-DSL header: line chart, bar chart, area chart, pie chart
  if (/^(?:line|bar|area|pie)\s+chart\b/i.test(trimmed)) {
    return true;
  }

  // Has xKey and series properties (YAML or loose syntax)
  if (/(?:^|\n)\s*xKey\s*[:=]/i.test(trimmed) && /(?:^|\n)\s*series\s*[:=]/i.test(trimmed)) {
    return true;
  }

  // JSON or object syntax with type in ['bar', 'line', 'area', 'pie'] and data or series
  if (trimmed.startsWith('{') || trimmed.includes('"type"') || trimmed.includes("'type'")) {
    if (
      /["']type["']\s*:\s*["'](line|bar|area|pie)["']/i.test(trimmed) &&
      (/["']series["']/i.test(trimmed) || /["']data["']/i.test(trimmed))
    ) {
      return true;
    }
  }

  return false;
}

function tryCleanJson(str: string): string {
  return str
    // Remove JS comments // ...
    .replace(/\/\/[^\n]*/g, '')
    // Remove trailing commas before } or ]
    .replace(/,\s*([\]}])/g, '$1')
    // Quote unquoted keys: { foo: 1 } -> { "foo": 1 }
    .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":')
    // Convert single quoted strings to double quoted strings
    .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"');
}

function extractBalancedBracket(
  str: string,
  startIdx: number,
  openChar: string,
  closeChar: string,
): string | null {
  if (startIdx < 0 || str[startIdx] !== openChar) return null;
  let depth = 0;
  let inString: string | null = null;
  let escape = false;

  for (let i = startIdx; i < str.length; i++) {
    const char = str[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === '\\') {
      escape = true;
      continue;
    }
    if (inString) {
      if (char === inString) {
        inString = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      inString = char;
      continue;
    }
    if (char === openChar) {
      depth++;
    } else if (char === closeChar) {
      depth--;
      if (depth === 0) {
        return str.slice(startIdx, i + 1);
      }
    }
  }
  return null;
}

interface RawChartObject {
  type?: string;
  title?: string;
  xKey?: string;
  data?: Array<Record<string, unknown>>;
  series?: Array<{
    key?: string;
    dataKey?: string;
    label?: string;
    color?: string;
    data?: Array<Record<string, unknown>>;
    [k: string]: unknown;
  }>;
  [k: string]: unknown;
}

function parseRawChart(input: string | unknown): RawChartObject {
  if (typeof input !== 'string') {
    if (input && typeof input === 'object') {
      return input as RawChartObject;
    }
    throw new Error('Chart input must be a string or object');
  }

  const trimmed = input.trim();

  // 1. Try standard JSON first
  try {
    return JSON.parse(trimmed) as RawChartObject;
  } catch {
    // Continue to fallback parsers
  }

  // 2. Check if pseudo DSL:
  // e.g.:
  // line chart title="2026 년 9 월 셋째주 KOSPI & KOSDAQ 동향"
  // xKey: "날짜"
  // series: [ ... ]
  const headerMatch = /^(line|bar|area|pie)\s+chart(?:\s+title=["'](?<title1>[^"']+)["'])?/i.exec(trimmed);
  const typeMatch = /(?:^|\n)\s*type\s*[:=]\s*["']?(line|bar|area|pie)["']?/i.exec(trimmed);
  const chartType = (headerMatch ? headerMatch[1] : typeMatch ? typeMatch[1] : 'line').toLowerCase();

  let title = headerMatch?.groups?.title1;
  if (!title) {
    const titleMatch = /(?:^|\n)\s*title\s*[:=]\s*["']([^"']+)["']/i.exec(trimmed);
    if (titleMatch) title = titleMatch[1];
  }

  let xKey: string | undefined;
  const xKeyMatch = /(?:^|\n)\s*xKey\s*[:=]\s*["']?([^"',\r\n]+)["']?/i.exec(trimmed);
  if (xKeyMatch) {
    xKey = xKeyMatch[1].trim();
  }

  // Extract series array: series:\s*(\[[\s\S]*\])
  let series: RawChartObject['series'] | undefined;
  const seriesIndex = trimmed.search(/(?:^|\n)\s*series\s*[:=]\s*\[/i);
  if (seriesIndex !== -1) {
    const startBracket = trimmed.indexOf('[', seriesIndex);
    const seriesStr = extractBalancedBracket(trimmed, startBracket, '[', ']');
    if (seriesStr) {
      try {
        series = JSON.parse(seriesStr) as RawChartObject['series'];
      } catch {
        try {
          series = JSON.parse(tryCleanJson(seriesStr)) as RawChartObject['series'];
        } catch {
          // ignore
        }
      }
    }
  }

  // Extract data array: data:\s*(\[[\s\S]*\])
  let data: RawChartObject['data'] | undefined;
  const dataIndex = trimmed.search(/(?:^|\n)\s*data\s*[:=]\s*\[/i);
  if (dataIndex !== -1) {
    const startBracket = trimmed.indexOf('[', dataIndex);
    const dataStr = extractBalancedBracket(trimmed, startBracket, '[', ']');
    if (dataStr) {
      try {
        data = JSON.parse(dataStr) as RawChartObject['data'];
      } catch {
        try {
          data = JSON.parse(tryCleanJson(dataStr)) as RawChartObject['data'];
        } catch {
          // ignore
        }
      }
    }
  }

  if (series || data) {
    return {
      type: chartType,
      title,
      xKey,
      series,
      data,
    };
  }

  // 3. Try relaxed JSON cleaner on the whole string
  try {
    return JSON.parse(tryCleanJson(trimmed)) as RawChartObject;
  } catch (err) {
    throw new Error(
      `Failed to parse chart DSL: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

/**
 * Robustly parses and normalizes chart DSL input.
 * Handles standard JSON, relaxed JSON, pseudo-DSL headers ("line chart title=..."),
 * and series with nested data arrays.
 */
export function parseAndNormalizeChartDsl(input: string | unknown): ChartDsl {
  const raw = parseRawChart(input);

  // 1. Normalize type
  let type: 'bar' | 'line' | 'pie' | 'area' = 'line';
  if (typeof raw.type === 'string') {
    const rawType = raw.type.toLowerCase();
    if (rawType === 'bar' || rawType === 'line' || rawType === 'pie' || rawType === 'area') {
      type = rawType;
    } else if (rawType.includes('bar')) {
      type = 'bar';
    } else if (rawType.includes('pie')) {
      type = 'pie';
    } else if (rawType.includes('area')) {
      type = 'area';
    } else if (rawType.includes('line')) {
      type = 'line';
    } else {
      type = raw.type as 'line';
    }
  }

  // 2. Normalize title
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : undefined;

  let xKey = typeof raw.xKey === 'string' && raw.xKey.trim() ? raw.xKey.trim() : undefined;
  let data: unknown = [];
  let series: unknown = [];

  // 3. Check if series has nested data (e.g. series[i].data = [{ category: ..., val1: ... }])
  const rawSeries = Array.isArray(raw.series) ? raw.series : [];
  const seriesHasNestedData = rawSeries.some((s) => Array.isArray(s?.data) && s.data.length > 0);

  if (seriesHasNestedData) {
    // Pivot nested data in series to flat top-level data array
    const categoryMap = new Map<string, Record<string, string | number>>();
    const effectiveXKey = xKey || 'category';
    xKey = effectiveXKey;
    const normalizedSeries: Array<{ key: string; label?: string; color?: string }> = [];

    for (let sIdx = 0; sIdx < rawSeries.length; sIdx++) {
      const s = rawSeries[sIdx];
      const seriesKey = String(s.key || s.dataKey || s.label || `series_${sIdx}`);
      const seriesLabel = s.label ? String(s.label) : seriesKey;
      const seriesColor = typeof s.color === 'string' ? s.color : undefined;
      normalizedSeries.push({ key: seriesKey, label: seriesLabel, color: seriesColor });

      const nestedData = Array.isArray(s.data) ? s.data : [];
      for (const item of nestedData) {
        if (!item || typeof item !== 'object') continue;
        const itemObj = item as Record<string, unknown>;

        // Extract category value
        let categoryVal: string | number | undefined;
        if (effectiveXKey in itemObj && itemObj[effectiveXKey] != null) {
          categoryVal = String(itemObj[effectiveXKey]);
        } else if ('category' in itemObj && itemObj.category != null) {
          categoryVal = String(itemObj.category);
        } else if ('date' in itemObj && itemObj.date != null) {
          categoryVal = String(itemObj.date);
        } else if ('name' in itemObj && itemObj.name != null) {
          categoryVal = String(itemObj.name);
        } else {
          // Find first string property
          const strProp = Object.entries(itemObj).find(([, v]) => typeof v === 'string');
          if (strProp) {
            categoryVal = String(strProp[1]);
          }
        }

        if (categoryVal === undefined) continue;

        const catKey = String(categoryVal);
        if (!categoryMap.has(catKey)) {
          categoryMap.set(catKey, { [effectiveXKey]: categoryVal });
        }
        const row = categoryMap.get(catKey)!;

        // Extract numeric value for this series
        let numVal: number | undefined;
        if (typeof itemObj[seriesKey] === 'number') {
          numVal = itemObj[seriesKey] as number;
        } else if (typeof itemObj.val1 === 'number') {
          numVal = itemObj.val1 as number;
        } else if (typeof itemObj.value === 'number') {
          numVal = itemObj.value as number;
        } else if (typeof itemObj.val === 'number') {
          numVal = itemObj.val as number;
        } else if (typeof itemObj.y === 'number') {
          numVal = itemObj.y as number;
        } else {
          // Look for any non-null number property
          const numEntry = Object.entries(itemObj).find(
            ([k, v]) => typeof v === 'number' && k !== effectiveXKey && k !== 'category',
          );
          if (numEntry) {
            numVal = numEntry[1] as number;
          }
        }

        if (numVal !== undefined) {
          row[seriesKey] = numVal;
        }
      }
    }
    data = Array.from(categoryMap.values());
    series = normalizedSeries;
  } else {
    // Normal flat data or standard format
    if (raw.data !== undefined && !Array.isArray(raw.data)) {
      data = raw.data;
    } else if (Array.isArray(raw.data)) {
      data = raw.data
        .filter((d): d is Record<string, unknown> => typeof d === 'object' && d !== null)
        .map((d) => {
          const row: Record<string, string | number> = {};
          for (const [k, v] of Object.entries(d)) {
            if (typeof v === 'string' || typeof v === 'number') {
              row[k] = v;
            }
          }
          return row;
        });
    }

    if (raw.series !== undefined && !Array.isArray(raw.series)) {
      series = raw.series;
    } else if (rawSeries.length > 0) {
      series = rawSeries.map((s, idx) => ({
        key: String(s.key || s.dataKey || s.name || `val_${idx}`),
        label: typeof s.label === 'string' ? s.label : undefined,
        color: typeof s.color === 'string' ? s.color : undefined,
      }));
    } else if (Array.isArray(data) && data.length > 0) {
      // Auto-detect series keys from data
      const sample = data[0] as Record<string, unknown>;
      const detectedKeys = Object.keys(sample).filter(
        (k) => k !== xKey && typeof sample[k] === 'number',
      );
      series = detectedKeys.map((k) => ({ key: k, label: k }));
    }

    // Auto-detect xKey if not set
    if (!xKey && Array.isArray(data) && data.length > 0) {
      const sample = data[0] as Record<string, unknown>;
      const detectedXKey = Object.keys(sample).find((k) => typeof sample[k] === 'string');
      if (detectedXKey) {
        xKey = detectedXKey;
      }
    }
  }

  const normalized = {
    type,
    title,
    xKey,
    series,
    data,
  };

  return ChartDslSchema.parse(normalized);
}
