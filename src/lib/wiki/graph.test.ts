import { describe, it, expect } from 'vitest';
import { buildWikiGraph, extractLinks, parseWikiPage, stepLayout } from './graph';

describe('wiki graph', () => {
  it('parses frontmatter title, category and tags', () => {
    const page = parseWikiPage({
      slug: 'a',
      text: "---\ntitle: 'It''s A'\ntype: source\ncategory: '문서/학습'\ntags: ['x', 'y z']\n---\n\n본문 [[b]] 와 [c](sources/c.md)",
    });
    expect(page.title).toBe("It's A");
    expect(page.category).toBe('문서/학습');
    expect(page.tags).toEqual(['x', 'y z']);
    expect(page.links.sort()).toEqual(['b', 'c']);
  });

  it('falls back to the job folder when frontmatter has no category', () => {
    const page = parseWikiPage({ slug: 'a', text: '---\ntitle: t\ntags: []\n---\nbody', fallbackCategory: '재무' });
    expect(page.category).toBe('재무');
    expect(page.tags).toEqual([]);
  });

  it('extracts wikilinks with aliases', () => {
    expect(extractLinks('[[a|별칭]] [[b#h]]').sort()).toEqual(['a', 'b']);
  });

  it('builds category chains, tag nodes and page links', () => {
    const pages = [
      { slug: 'a', title: 'A', category: '문서/학습', tags: ['t'], links: ['b'] },
      { slug: 'b', title: 'B', category: '문서', tags: ['t'], links: ['missing'] },
    ];
    const g = buildWikiGraph(pages, { includeTags: true, uncategorizedLabel: '미분류' });
    const ids = g.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(['c:문서', 'c:문서/학습', 'p:a', 'p:b', 't:t']);
    expect(g.edges.filter((e) => e.kind === 'link')).toHaveLength(1);
    expect(buildWikiGraph(pages, { includeTags: false, uncategorizedLabel: '' }).nodes.some((n) => n.kind === 'tag')).toBe(false);
  });

  it('settles the layout', () => {
    const sim = [0, 1, 2].map((i) => ({ id: String(i), x: i * 5, y: 0, vx: 0, vy: 0, fixed: false }));
    let energy = Infinity;
    for (let i = 0; i < 400; i++) energy = stepLayout(sim, [{ a: 0, b: 1 }, { a: 1, b: 2 }], Math.max(0.05, 1 - i / 300));
    expect(Number.isFinite(energy)).toBe(true);
    expect(energy).toBeLessThan(5);
  });
});
