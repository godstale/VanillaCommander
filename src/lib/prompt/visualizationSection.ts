/**
 * Returns instructions for the model on when and how to output inline visualizations:
 * Mermaid code fences for diagrams and Recharts JSON DSL code fences for data charts.
 */
export function getVisualizationPromptSection(): string {
  return `When visual explanations, diagrams, or data charts help clarify an answer, provide them using the following code fence formats:

1. Diagrams and Architecture (Mermaid):
Use \`\`\`mermaid code fences ONLY for structural diagrams (flowchart, sequenceDiagram, classDiagram, erDiagram, stateDiagram).
Example:
\`\`\`mermaid
flowchart TD
  Client[Client] --> Server[API Server]
  Server --> DB[(Database)]
\`\`\`
CRITICAL: NEVER use \`\`\`mermaid for quantitative data charts, stock prices, numerical trends, time series, or bar/line charts. Mermaid cannot render numeric data charts properly.

2. Numerical Data Charts & Stock Trends (Recharts):
When presenting stock price trends, financial metrics, time series, quantitative comparisons, or distributions, ALWAYS use \`\`\`recharts code fences.
Supported chart types ("type"): "line", "bar", "area", "pie".

CRITICAL RULES FOR \`\`\`recharts:
- The content MUST BE 100% valid JSON starting with { and ending with }. Do NOT write comments or pseudo-code like "line chart title=...".
- Put all data points in the top-level "data" array. NEVER put a "data" array inside "series".
- Each object in "data" must have the xKey property (e.g. date, category, time) and the metric keys matching series[].key.

Example: Weekly Stock / Metric Trend (Line Chart):
\`\`\`recharts
{
  "type": "line",
  "title": "주간 주가 동향 (KOSPI & KOSDAQ)",
  "xKey": "date",
  "data": [
    { "date": "9/14(월)", "KOSPI": 7050, "KOSDAQ": 820 },
    { "date": "9/15(화)", "KOSPI": 7080, "KOSDAQ": 835 },
    { "date": "9/16(수)", "KOSPI": 7120, "KOSDAQ": 848 },
    { "date": "9/17(목)", "KOSPI": 7150, "KOSDAQ": 860 },
    { "date": "9/18(금)", "KOSPI": 7130, "KOSDAQ": 853 }
  ],
  "series": [
    { "key": "KOSPI", "label": "코스피 (p)", "color": "#3b82f6" },
    { "key": "KOSDAQ", "label": "코스닥 (p)", "color": "#10b981" }
  ]
}
\`\`\`

Example: Comparison / Distribution (Bar Chart):
\`\`\`recharts
{
  "type": "bar",
  "title": "월별 실적 비교",
  "xKey": "month",
  "data": [
    { "month": "1월", "sales": 120, "target": 100 },
    { "month": "2월", "sales": 150, "target": 130 }
  ],
  "series": [
    { "key": "sales", "label": "매출", "color": "#3b82f6" },
    { "key": "target", "label": "목표", "color": "#10b981" }
  ]
}
\`\`\`
Only output standard JSON inside the \`\`\`recharts block without comments.`;
}
