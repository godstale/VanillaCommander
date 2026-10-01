# Changelog

All notable changes to `llm-wiki` are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Added

- **`/wiki-ontology-apply`** — bulk-apply a declarative tagging plan (`wiki/ontology-apply-plan.yaml`)
  to many existing pages at once, backed by `scripts/ontology_apply.py`. Fixes the workflow gap
  where introducing an ontology on a wiki that already has content required a throwaway per-project
  script; the plan format supports a tiered "precise tag a small active subset, light status/era
  tag the rest" pattern for large legacy corpora. Dry-run by default; never touches `wiki/originals/`.

### Changed

- **`/wiki-lint`** now wires in `scripts/ontology_validate.py` when `wiki/ontology.yaml` exists,
  instead of leaving ontology checks 7–12 as agent-fallback prose with no script actually invoking
  them. Its report format was restructured into `### Errors (N)` / `### Warnings (M)` buckets to
  match `references/ontology-commands.md`.
- **`/wiki-graph`** (`scripts/build_graph.py`) is now genuinely ontology-aware instead of just
  documenting the feature: axis-based node coloring from `class:` frontmatter, typed edges drawn
  from `relations:` frontmatter, structural hub highlighting (degree > mean+2σ), and a
  project-agnostic "dim legacy pages" toggle based on a generic `status:` field. `deduplicate_edges`
  now keys on `(pair, type, predicate)` instead of just the pair, so a typed relation edge no
  longer silently drops an extracted wikilink edge (or vice versa) between the same two pages.

---

## [1.0.0] — 2026-04-19

### Added

- **`/wiki-ingest`** — ingest source documents into the knowledge base
  - Reads and summarizes source files into `wiki/sources/`
  - Extracts entity pages (`wiki/entities/`) and concept pages (`wiki/concepts/`)
  - Moves originals to `wiki/originals/` after processing
  - Updates `wiki/index.md` and `wiki/overview.md` automatically
  - Supports `.md` and `.txt` natively; delegates `.pdf`, `.docx`, `.pptx`, `.xlsx` to companion skills
  - Falls back to `scripts/file_to_markdown.py` when companion skills are unavailable
  - Post-ingest validation: checks for broken wikilinks and missing index entries

- **`/wiki-query`** — query the knowledge base with natural language
  - Reads `wiki/index.md` to identify relevant pages
  - Synthesizes answers with `[[wikilink]]` citations
  - Falls back to `wiki/originals/` for detail-heavy questions
  - Offers to save answers as synthesis pages in `wiki/syntheses/`

- **`/wiki-lint`** — health-check the wiki
  - Orphan page detection (no inbound wikilinks)
  - Broken `[[wikilink]]` detection
  - Missing entity page detection (entity mentioned 3+ times, no dedicated page)
  - Contradiction detection across sources
  - Stale summary detection
  - Data gap suggestions
  - Agent-based mode (no Python required) and Python script mode (`scripts/lint.py`)

- **`/wiki-graph`** — build an interactive knowledge graph
  - Extracts nodes from all wiki pages (sources, entities, concepts, syntheses)
  - Extracts edges from `[[wikilinks]]` and infers topical connections
  - Outputs `graph/graph.json` and self-contained `graph/graph.html` (vis.js)
  - Agent-based fallback when Python is unavailable
  - Python script mode: `scripts/build_graph.py --open`

- **`scripts/build_graph.py`** — standalone Python graph builder
- **`scripts/lint.py`** — standalone Python lint checker
- **`scripts/file_to_markdown.py`** — convert PDFs, Word docs, and Office files to `.md`
- **`scripts/requirements.txt`** — Python dependencies (`networkx`)
- **`references/templates.md`** — page templates for sources, entities, concepts, and syntheses
- **`references/graph-html.md`** — self-contained vis.js HTML template for graph output
