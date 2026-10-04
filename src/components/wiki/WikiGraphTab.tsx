// P14-07: 위키 그래프 탭. 페이지·카테고리·태그를 노드로, 소속·태그·[[링크]]를 간선으로 그린다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Network, RefreshCw, Search } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useSafeWorkspace } from '@/lib/context/WorkspaceContext';
import { useWorkspaceTabs } from '@/lib/context/WorkspaceTabsContext';
import { listWikiJobs } from '@/lib/db/repositories/wikiJobsRepo';
import { buildFileTab, planOpenFile } from '@/lib/commander/openFile';
import {
  buildWikiGraph,
  hueOf,
  parseWikiPage,
  stepLayout,
  type GraphNode,
  type ParsedWikiPage,
  type SimNode,
  type WikiGraph,
} from '@/lib/wiki/graph';

interface DirEntryItem {
  name: string;
  path: string;
  is_dir: boolean;
}

interface View {
  x: number;
  y: number;
  k: number;
}

const MAX_PAGES = 500;

function nodeRadius(node: GraphNode): number {
  const base = node.kind === 'category' ? 7 : node.kind === 'tag' ? 4 : 5;
  return base + Math.min(8, Math.sqrt(node.degree) * 1.4);
}

function nodeColor(node: GraphNode, dark: boolean): string {
  const hue = hueOf(node.group);
  if (node.kind === 'tag') return dark ? 'hsl(215 12% 60%)' : 'hsl(215 12% 55%)';
  const sat = node.kind === 'category' ? 70 : 55;
  const light = dark ? (node.kind === 'category' ? 62 : 58) : node.kind === 'category' ? 45 : 52;
  return `hsl(${hue} ${sat}% ${light}%)`;
}

export function WikiGraphTab() {
  const { t } = useLanguage();
  const workspace = useSafeWorkspace();
  const { openTab } = useWorkspaceTabs();
  const workspaceRoot = workspace?.workspaceRoot ?? null;

  const [pages, setPages] = useState<ParsedWikiPage[]>([]);
  const [loading, setLoading] = useState(false);
  const [showTags, setShowTags] = useState(true);
  const [filter, setFilter] = useState('');

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<SimNode[]>([]);
  const viewRef = useRef<View>({ x: 0, y: 0, k: 1 });
  const hoverRef = useRef<number>(-1);
  const alphaRef = useRef(1);
  const filterRef = useRef('');
  const rafRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    if (!workspaceRoot) return;
    setLoading(true);
    try {
      let entries: DirEntryItem[] = [];
      try {
        entries = await invoke<DirEntryItem[]>('list_dir', { path: 'wiki/sources', workspaceRoot });
      } catch {
        entries = [];
      }
      const files = entries.filter((e) => !e.is_dir && e.name.endsWith('.md')).slice(0, MAX_PAGES);
      const jobs = await listWikiJobs(1000, workspaceRoot).catch(() => []);
      const folderBySlug = new Map<string, string>();
      for (const job of jobs) {
        if (job.status === 'done' && job.slug && job.folder) folderBySlug.set(job.slug, job.folder);
      }
      const parsed = await Promise.all(
        files.map(async (file) => {
          const slug = file.name.slice(0, -3);
          try {
            const text = await invoke<string>('read_text_file', {
              path: `wiki/sources/${file.name}`,
              workspaceRoot,
            });
            return parseWikiPage({ slug, text, fallbackCategory: folderBySlug.get(slug) });
          } catch {
            return parseWikiPage({ slug, text: '', fallbackCategory: folderBySlug.get(slug) });
          }
        }),
      );
      setPages(parsed);
    } finally {
      setLoading(false);
    }
  }, [workspaceRoot]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 탭 표시 시 1회 로드
    void load();
  }, [load]);

  const graph: WikiGraph = useMemo(
    () => buildWikiGraph(pages, { includeTags: showTags, uncategorizedLabel: t('wiki.graphUncategorized') }),
    [pages, showTags, t],
  );
  const pageCount = pages.length;
  const linkCount = graph.edges.filter((e) => e.kind === 'link').length;

  useEffect(() => {
    filterRef.current = filter.trim().toLowerCase();
  }, [filter]);

  const openPageNode = useCallback((node: GraphNode) => {
    if (node.kind !== 'page' || !workspaceRoot) return;
    const sep = workspaceRoot.includes('\\') ? '\\' : '/';
    const path = `${workspaceRoot.replace(/[\\/]+$/, '')}${sep}wiki${sep}sources${sep}${node.key}.md`;
    openTab(buildFileTab(planOpenFile(path)));
  }, [workspaceRoot, openTab]);

  // 시뮬레이션·렌더·상호작용. 그래프가 바뀔 때마다 새로 구성한다.
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || graph.nodes.length === 0) return;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return;
    const ctx = ctx2d;

    const dark = document.documentElement.classList.contains('dark')
      || window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
    const textColor = getComputedStyle(wrap).color || (dark ? '#e5e7eb' : '#1f2937');
    const indexOf = new Map(graph.nodes.map((n, i) => [n.id, i]));
    const edges = graph.edges
      .map((e) => ({ a: indexOf.get(e.source) ?? -1, b: indexOf.get(e.target) ?? -1, kind: e.kind }))
      .filter((e) => e.a >= 0 && e.b >= 0);
    const neighbors: Set<number>[] = graph.nodes.map(() => new Set<number>());
    for (const e of edges) {
      neighbors[e.a].add(e.b);
      neighbors[e.b].add(e.a);
    }
    const radius = graph.nodes.map(nodeRadius);

    // 초기 배치: 원형 + 약간의 흩뿌림.
    const spread = 40 + Math.sqrt(graph.nodes.length) * 22;
    simRef.current = graph.nodes.map((_, i) => {
      const angle = (i / graph.nodes.length) * Math.PI * 2;
      const r = spread * (0.5 + Math.random() * 0.5);
      return { id: graph.nodes[i].id, x: Math.cos(angle) * r, y: Math.sin(angle) * r, vx: 0, vy: 0, fixed: false };
    });
    alphaRef.current = 1;
    viewRef.current = { x: 0, y: 0, k: 1 };
    hoverRef.current = -1;

    let width = 0;
    let height = 0;
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

    const toWorld = (px: number, py: number) => {
      const v = viewRef.current;
      return { x: (px - width / 2 - v.x) / v.k, y: (py - height / 2 - v.y) / v.k };
    };
    const hitTest = (px: number, py: number): number => {
      const w = toWorld(px, py);
      let best = -1;
      let bestD = Infinity;
      simRef.current.forEach((s, i) => {
        const d = Math.hypot(s.x - w.x, s.y - w.y);
        if (d <= radius[i] + 3 / viewRef.current.k && d < bestD) {
          best = i;
          bestD = d;
        }
      });
      return best;
    };

    const draw = () => {
      const sim = simRef.current;
      if (alphaRef.current > 0.02) {
        stepLayout(sim, edges, alphaRef.current);
        alphaRef.current *= 0.985;
      }
      const v = viewRef.current;
      const hover = hoverRef.current;
      const q = filterRef.current;
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.translate(width / 2 + v.x, height / 2 + v.y);
      ctx.scale(v.k, v.k);

      const matches = q
        ? new Set(graph.nodes.flatMap((n, i) => (n.label.toLowerCase().includes(q) || n.key.toLowerCase().includes(q) ? [i] : [])))
        : null;
      const focus = hover >= 0 ? new Set<number>([hover, ...neighbors[hover]]) : null;
      const dimmed = (i: number) => (focus ? !focus.has(i) : matches ? !matches.has(i) : false);

      ctx.lineWidth = 1 / v.k;
      for (const e of edges) {
        const hot = focus ? focus.has(e.a) && focus.has(e.b) && (e.a === hover || e.b === hover) : false;
        const fade = (focus && !hot) || (!focus && matches && !(matches.has(e.a) && matches.has(e.b)));
        ctx.strokeStyle = hot
          ? 'hsl(215 80% 60%)'
          : e.kind === 'link'
            ? dark ? 'rgba(148,163,184,0.7)' : 'rgba(100,116,139,0.7)'
            : dark ? 'rgba(148,163,184,0.28)' : 'rgba(100,116,139,0.3)';
        ctx.globalAlpha = fade ? 0.12 : 1;
        ctx.beginPath();
        ctx.moveTo(sim[e.a].x, sim[e.a].y);
        ctx.lineTo(sim[e.b].x, sim[e.b].y);
        ctx.stroke();
      }

      sim.forEach((s, i) => {
        const node = graph.nodes[i];
        ctx.globalAlpha = dimmed(i) ? 0.15 : 1;
        ctx.fillStyle = nodeColor(node, dark);
        ctx.beginPath();
        if (node.kind === 'category') {
          const r = radius[i];
          ctx.rect(s.x - r, s.y - r, r * 2, r * 2);
        } else {
          ctx.arc(s.x, s.y, radius[i], 0, Math.PI * 2);
        }
        ctx.fill();
        if (i === hover) {
          ctx.strokeStyle = textColor;
          ctx.lineWidth = 2 / v.k;
          ctx.stroke();
        }
      });

      // 라벨: 확대했거나, 카테고리·강조 노드일 때만 그려 겹침을 줄인다.
      ctx.fillStyle = textColor;
      ctx.textAlign = 'center';
      ctx.font = `${11 / Math.max(v.k, 0.6)}px sans-serif`;
      sim.forEach((s, i) => {
        const node = graph.nodes[i];
        const show = i === hover || (focus?.has(i) ?? false) || (matches?.has(i) ?? false)
          || node.kind === 'category' || v.k > 1.3 || (node.kind === 'page' && graph.nodes.length < 40);
        if (!show || dimmed(i)) return;
        const label = node.label.length > 24 ? `${node.label.slice(0, 23)}…` : node.label;
        ctx.globalAlpha = 0.9;
        ctx.fillText(label, s.x, s.y + radius[i] + 12 / Math.max(v.k, 0.6));
      });
      ctx.restore();
      ctx.globalAlpha = 1;
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);

    // 상호작용: 노드 드래그 / 빈 곳 드래그로 이동 / 휠 확대.
    let dragNode = -1;
    let panning = false;
    let last = { x: 0, y: 0 };
    let downAt = { x: 0, y: 0 };
    let dragged = false;
    const local = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onDown = (e: MouseEvent) => {
      const p = local(e);
      last = p;
      downAt = p;
      dragged = false;
      const hit = hitTest(p.x, p.y);
      if (hit >= 0) {
        dragNode = hit;
        simRef.current[hit].fixed = true;
        alphaRef.current = Math.max(alphaRef.current, 0.3);
      } else {
        panning = true;
      }
    };
    const onMove = (e: MouseEvent) => {
      const p = local(e);
      if (Math.hypot(p.x - downAt.x, p.y - downAt.y) > 4) dragged = true;
      if (dragNode >= 0) {
        const w = toWorld(p.x, p.y);
        const s = simRef.current[dragNode];
        s.x = w.x;
        s.y = w.y;
        s.vx = 0;
        s.vy = 0;
        alphaRef.current = Math.max(alphaRef.current, 0.3);
      } else if (panning) {
        viewRef.current.x += p.x - last.x;
        viewRef.current.y += p.y - last.y;
      } else {
        hoverRef.current = hitTest(p.x, p.y);
        canvas.style.cursor = hoverRef.current >= 0 ? 'pointer' : 'grab';
      }
      last = p;
    };
    const onUp = () => {
      if (dragNode >= 0) simRef.current[dragNode].fixed = false;
      dragNode = -1;
      panning = false;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      const p = local(e);
      const next = Math.min(4, Math.max(0.2, v.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      // 커서 아래 지점을 고정한 채 확대한다.
      const wx = (p.x - width / 2 - v.x) / v.k;
      const wy = (p.y - height / 2 - v.y) / v.k;
      v.x = p.x - width / 2 - wx * next;
      v.y = p.y - height / 2 - wy * next;
      v.k = next;
    };
    // 클릭(드래그 아님)한 페이지 노드는 파일 탭으로 연다.
    const onClick = (e: MouseEvent) => {
      if (dragged) return;
      const p = local(e);
      const hit = hitTest(p.x, p.y);
      if (hit >= 0) openPageNode(graph.nodes[hit]);
    };
    const onLeave = () => {
      hoverRef.current = -1;
      onUp();
    };
    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('mouseleave', onLeave);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      observer.disconnect();
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('mouseleave', onLeave);
    };
  }, [graph, openPageNode]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border shrink-0 text-xs">
        <Network className="h-4 w-4 text-primary" />
        <h2 className="font-semibold">{t('wiki.graphTabTitle')}</h2>
        <span className="text-muted-foreground">
          {t('wiki.graphStats', { p: pageCount, l: linkCount })}
        </span>
        <div className="flex-1" />
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={showTags}
            onChange={(e) => setShowTags(e.target.checked)}
            className="accent-primary"
          />
          {t('wiki.graphTags')}
        </label>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('wiki.graphFilter')}
            className="w-44 pl-6 pr-2 py-1 text-xs rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          title={t('wiki.graphReload')}
          aria-label={t('wiki.graphReload')}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-40 cursor-pointer"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <div ref={wrapRef} className="relative flex-1 min-h-0 overflow-hidden bg-background text-foreground">
        {graph.nodes.length === 0 ? (
          <p className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
            {t('wiki.graphEmpty')}
          </p>
        ) : (
          <>
            <canvas ref={canvasRef} className="absolute inset-0" />
            <p className="absolute bottom-2 left-3 text-[11px] text-muted-foreground pointer-events-none">
              {t('wiki.graphHint')}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default WikiGraphTab;
