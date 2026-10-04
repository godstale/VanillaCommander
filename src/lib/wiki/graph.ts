// P14-07: 위키 그래프 데이터. wiki/sources/*.md의 프런트매터·링크에서 노드와 간선을 만든다.

export type GraphNodeKind = 'page' | 'category' | 'tag';

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  /** page: slug, category: 경로, tag: 태그명 */
  key: string;
  /** 색상 그룹(최상위 카테고리). */
  group: string;
  /** 연결 수 (노드 크기에 쓴다). */
  degree: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: 'category' | 'tag' | 'link';
}

export interface WikiGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface WikiPageInput {
  slug: string;
  text: string;
  /** 프런트매터에 카테고리가 없을 때 쓰는 보조값(처리 이력의 folder). */
  fallbackCategory?: string | null;
}

export interface ParsedWikiPage {
  slug: string;
  title: string;
  category: string;
  tags: string[];
  links: string[];
}

function unquote(raw: string): string {
  const v = raw.trim();
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
  return v;
}

function parseInlineList(raw: string): string[] {
  const inner = raw.trim().replace(/^\[/, '').replace(/\]$/, '');
  if (!inner.trim()) return [];
  const items: string[] = [];
  const re = /\s*(?:'((?:[^']|'')*)'|"([^"]*)"|([^,]+))\s*,?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner)) !== null) {
    const value = m[1] !== undefined ? m[1].replace(/''/g, "'") : (m[2] ?? m[3] ?? '').trim();
    if (value) items.push(value.trim());
  }
  return items;
}

/** `[[slug]]`·`[[slug|별칭]]`·`(sources/slug.md)` 링크에서 slug를 뽑는다. */
export function extractLinks(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) {
    out.add(m[1].trim());
  }
  for (const m of body.matchAll(/\]\((?:\.\/|\.\.\/)?(?:sources\/)?([^()\s/]+)\.md\)/g)) {
    out.add(m[1].trim());
  }
  return Array.from(out);
}

export function parseWikiPage(input: WikiPageInput): ParsedWikiPage {
  let title = input.slug;
  let category = '';
  let tags: string[] = [];
  let body = input.text;
  const fm = input.text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (fm) {
    body = input.text.slice(fm[0].length);
    for (const line of fm[1].split(/\r?\n/)) {
      const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
      if (!kv) continue;
      if (kv[1] === 'title') title = unquote(kv[2]) || title;
      else if (kv[1] === 'category') category = unquote(kv[2]);
      else if (kv[1] === 'tags') tags = parseInlineList(kv[2]);
    }
  }
  if (!category && input.fallbackCategory) category = input.fallbackCategory;
  const links = extractLinks(body).filter((l) => l !== input.slug);
  return {
    slug: input.slug,
    title,
    category: category.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''),
    tags: Array.from(new Set(tags)),
    links,
  };
}

export function buildWikiGraph(
  pages: ParsedWikiPage[],
  options: { includeTags: boolean; uncategorizedLabel: string },
): WikiGraph {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const edgeKeys = new Set<string>();

  const addEdge = (source: string, target: string, kind: GraphEdge['kind']) => {
    const key = source < target ? `${source}|${target}` : `${target}|${source}`;
    if (source === target || edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ source, target, kind });
  };
  const addNode = (node: Omit<GraphNode, 'degree'>) => {
    if (!nodes.has(node.id)) nodes.set(node.id, { ...node, degree: 0 });
  };

  const slugSet = new Set(pages.map((p) => p.slug));
  for (const page of pages) {
    const category = page.category || options.uncategorizedLabel;
    const group = category.split('/')[0];
    addNode({ id: `p:${page.slug}`, kind: 'page', label: page.title, key: page.slug, group });

    // 카테고리 사슬: 최상위 → … → 페이지가 속한 카테고리.
    const parts = category.split('/');
    for (let i = 0; i < parts.length; i++) {
      const path = parts.slice(0, i + 1).join('/');
      addNode({ id: `c:${path}`, kind: 'category', label: parts[i], key: path, group });
      if (i > 0) addEdge(`c:${parts.slice(0, i).join('/')}`, `c:${path}`, 'category');
    }
    addEdge(`p:${page.slug}`, `c:${category}`, 'category');

    if (options.includeTags) {
      for (const tag of page.tags) {
        addNode({ id: `t:${tag.toLowerCase()}`, kind: 'tag', label: `#${tag}`, key: tag, group });
        addEdge(`p:${page.slug}`, `t:${tag.toLowerCase()}`, 'tag');
      }
    }
  }
  for (const page of pages) {
    for (const link of page.links) {
      if (slugSet.has(link)) addEdge(`p:${page.slug}`, `p:${link}`, 'link');
    }
  }
  for (const e of edges) {
    const s = nodes.get(e.source);
    const t = nodes.get(e.target);
    if (s) s.degree++;
    if (t) t.degree++;
  }
  return { nodes: Array.from(nodes.values()), edges };
}

/** 문자열에서 안정적인 색상 hue(0-359)를 만든다. */
export function hueOf(group: string): number {
  let h = 0;
  for (let i = 0; i < group.length; i++) h = (h * 31 + group.charCodeAt(i)) >>> 0;
  return h % 360;
}

export interface SimNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fixed: boolean;
}

/** 힘 기반 배치 1스텝. 반발 + 간선 스프링 + 중심 인력. 반환값은 남은 운동량(수렴 판정용). */
export function stepLayout(
  sim: SimNode[],
  edges: Array<{ a: number; b: number }>,
  alpha: number,
): number {
  const n = sim.length;
  const repulsion = 2600;
  const springLen = 70;
  const springK = 0.04;
  const gravity = 0.012;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let dx = sim[i].x - sim[j].x;
      let dy = sim[i].y - sim[j].y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 0.01) {
        dx = Math.random() - 0.5;
        dy = Math.random() - 0.5;
        d2 = 0.25;
      }
      if (d2 > 160_000) continue;
      const f = (repulsion / d2) * alpha;
      const d = Math.sqrt(d2);
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      sim[i].vx += fx;
      sim[i].vy += fy;
      sim[j].vx -= fx;
      sim[j].vy -= fy;
    }
  }
  for (const { a, b } of edges) {
    const dx = sim[b].x - sim[a].x;
    const dy = sim[b].y - sim[a].y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const f = (d - springLen) * springK * alpha;
    const fx = (dx / d) * f;
    const fy = (dy / d) * f;
    sim[a].vx += fx;
    sim[a].vy += fy;
    sim[b].vx -= fx;
    sim[b].vy -= fy;
  }
  let energy = 0;
  for (const node of sim) {
    node.vx -= node.x * gravity * alpha;
    node.vy -= node.y * gravity * alpha;
    node.vx *= 0.82;
    node.vy *= 0.82;
    if (!node.fixed) {
      node.x += node.vx;
      node.y += node.vy;
    }
    energy += Math.abs(node.vx) + Math.abs(node.vy);
  }
  return energy;
}
