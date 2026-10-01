# llm-wiki

An agent-maintained personal knowledge base for Claude Code. Drop in source documents, and Claude ingests, queries, lints, and visualizes your knowledge — no API key or Python scripts required.

> 한국어 가이드: [README.ko.md](README.ko.md)

```
ingest → query → lint → graph
```

---

## Installation

### Using npx (recommended)

```bash
npx skills add godstale/llm-wiki
```

This installs the skill to your global Claude Code skills directory (`~/.claude/skills/llm-wiki`).

To install at project level instead:

```bash
npx skills add godstale/llm-wiki --project
```

### Manual installation

```bash
# Global (available in all projects)
cp -r llm-wiki ~/.claude/skills/llm-wiki

# Project-level
cp -r llm-wiki .agents/skills/llm-wiki
```

### Python dependencies (optional)

Required only for the `lint.py` and `build_graph.py` scripts. The agent-based fallback works without them.

```bash
pip install -r ~/.claude/skills/llm-wiki/scripts/requirements.txt
```

---

## Project Setup

Create this directory structure once in your wiki project:

```
raw/              # Drop zone — place source documents here before ingesting
wiki/
  index.md        # Catalog of all pages (auto-maintained)
  log.md          # Append-only change log (auto-maintained)
  overview.md     # Living synthesis across all sources (auto-maintained)
  originals/      # Full source docs after ingest — read-only archive
  sources/        # One summary page per source document
  entities/       # People, companies, projects, products
  concepts/       # Ideas, frameworks, methods, theories
  syntheses/      # Saved query answers
graph/            # Auto-generated graph data (graph.json, graph.html)
```

You only need to create `raw/` and `wiki/` to start. Subdirectories are created automatically during ingest.

---

## Usage

All commands work as slash commands or natural language in Claude Code.

### Ingest a document

```
/wiki-ingest raw/my-article.md
```

- Reads the source file
- Creates a summary page in `wiki/sources/`
- Extracts and creates entity and concept pages
- Moves the original to `wiki/originals/`
- Updates `wiki/index.md` and `wiki/overview.md`

**Supported file types:** `.md`, `.txt`. For `.pdf`, `.docx`, `.pptx`, `.xlsx` — place the file in `raw/` and Claude will convert it automatically (requires the `pdf`, `docx`, `pptx`, or `xlsx` skill, or the `file_to_markdown.py` script as fallback).

### Query the knowledge base

```
/wiki-query what are the main themes across all sources?
```

- Reads the index to find relevant pages
- Synthesizes a markdown answer with `[[wikilink]]` citations
- Offers to save the answer as a synthesis page in `wiki/syntheses/`

### Lint the wiki

```
/wiki-lint
```

Checks for:

- Orphan pages (no inbound links)
- Broken `[[wikilinks]]`
- Missing entity pages (mentioned 3+ times, no dedicated page)
- Contradictions between sources
- Stale summaries
- Data gaps

Option A — Python script (structural + graph-aware):

```bash
python scripts/lint.py
python scripts/lint.py --save   # save report to wiki/lint-report.md
```

Option B — Agent-based (no Python needed): just run `/wiki-lint`.

**If `wiki/ontology.yaml` exists**, `/wiki-lint` also runs `python scripts/ontology_validate.py` (schema checks: unknown classes/predicates/phases, domain/range violations, missing required properties, workflow gaps) and folds its report into `wiki/lint-report.md`.

### Build the knowledge graph

```
/wiki-graph
```

Generates an interactive HTML visualization of all wiki pages and their wikilink connections.

Option A — Python script (preferred):

```bash
python scripts/build_graph.py --open
python scripts/build_graph.py --report --save
```

Outputs `graph/graph.json` and `graph/graph.html`, then opens in the browser.

Option B — Agent-based fallback: runs automatically when Python is unavailable.

**Ontology-aware by default:** when `wiki/ontology.yaml` exists, the graph automatically colors nodes by axis (instead of by `type:`), draws typed edges from each page's `relations:` frontmatter, highlights structural hubs (star-shaped, high-degree nodes) and adds a "dim legacy pages" toggle for pages tagged `status: legacy|archived|deprecated`. No manual graph customization needed.

---

## Page Format

Every wiki page uses this frontmatter:

```yaml
---
title: 'Page Title'
type: source | entity | concept | synthesis
tags: []
sources: [] # list of source slugs that inform this page
last_updated: YYYY-MM-DD
---
```

Use `[[PageName]]` wikilinks to link to other wiki pages.

### Naming conventions

| Type      | File location     | Naming          |
| --------- | ----------------- | --------------- |
| Source    | `wiki/sources/`   | `kebab-case.md` |
| Entity    | `wiki/entities/`  | `TitleCase.md`  |
| Concept   | `wiki/concepts/`  | `TitleCase.md`  |
| Synthesis | `wiki/syntheses/` | `kebab-case.md` |

---

## Ontology (optional)

Every command above works with zero setup. If you want stronger structure — typed classes, a
relation vocabulary, phased workflows — define an ontology once and the rest of the skill picks
it up automatically (context-tagged ingest, structural `/wiki-query` filters, schema-validated
lint, axis-colored graph).

| Command                                | Purpose                                                                 |
| -------------------------------------- | ----------------------------------------------------------------------- |
| `/wiki-ontology-init`                  | Interactive interview → `wiki/ontology.yaml` + `wiki/ontology-guide.md` |
| `/wiki-ontology-show`                  | Print the current ontology's axes, classes, and relations               |
| `/wiki-ontology-validate`              | Check all pages against the schema (`scripts/ontology_validate.py`)     |
| `/wiki-ontology-apply [--plan <file>]` | Bulk-tag many **existing** pages from a declarative plan                |

`/wiki-ontology-apply` is for the common case of introducing an ontology on a wiki that already
has content: instead of hand-editing frontmatter file by file, write a plan
(`wiki/ontology-apply-plan.yaml`) with a `default` rule plus ordered `rules` matched by page name,
path substring, or glob, and run:

```bash
python scripts/ontology_apply.py --plan wiki/ontology-apply-plan.yaml            # dry run
python scripts/ontology_apply.py --plan wiki/ontology-apply-plan.yaml --apply    # write changes
```

It merges `class`/`status`/`era`/etc. into each page's existing frontmatter (body untouched, `wiki/originals/` never touched), de-duplicates `relations:` entries, and logs the change to `wiki/log.md`.

Full schema and details → `references/ontology-commands.md`.

---

## Natural language triggers

You don't have to use slash commands. Claude also responds to:

- _"ingest raw/my-article.md"_
- _"query: what are the main themes?"_
- _"lint the wiki"_
- _"build the knowledge graph"_

---

## Utilities

Convert non-markdown files to `.md` before ingesting:

```bash
python scripts/file_to_markdown.py --input_dir raw/
```

Ontology validation and bulk-tagging (only relevant once `wiki/ontology.yaml` exists):

```bash
python scripts/ontology_validate.py --save
python scripts/ontology_apply.py --plan wiki/ontology-apply-plan.yaml --apply
```

---

## Gotchas

- **`raw/` is a drop zone** — files are moved to `wiki/originals/` after ingest; only unprocessed files remain
- **Never modify `wiki/originals/`** — read-only archive of source documents
- **Always keep `wiki/index.md` up to date** — stale index breaks `/wiki-query`
- **Wikilinks are case-sensitive** — `[[OpenAI]]` ≠ `[[Openai]]`
- **Source slugs must match filenames** — the slug in `sources:` frontmatter must equal the source `.md` filename without extension
- **`wiki/log.md` is append-only** — never edit past entries
- **Scripts run from project root** — `python scripts/build_graph.py` must be run from your wiki project directory
- **`ontology_apply.py` defaults to dry-run** — always review the per-rule hit counts and unmatched-page list before re-running with `--apply`

---

## Extensions

### WiKi-Hub

You can merge other people's wikis into your current project using the **WiKi-Hub** skill. This allows for seamless knowledge sharing and collaboration across different wiki repositories.

- **GitHub Repository:** [godstale/WiKi-Hub](https://github.com/godstale/WiKi-Hub)
- **Installation:** `npx skills add godstale/wiki-hub`

---

## License

MIT
