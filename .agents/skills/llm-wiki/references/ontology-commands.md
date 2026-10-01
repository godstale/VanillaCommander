# Ontology Commands Reference

Loaded when running `/wiki-ontology-init`, `/wiki-ontology-show`, `/wiki-ontology-validate`,
or when ontology-aware checks are needed in `/wiki-lint` or `/wiki-graph`.

---

## /wiki-ontology-init

Interactive ontology builder. Produces `wiki/ontology.yaml` + `wiki/ontology-guide.md`.

**Arguments:**

- _(none)_ → full interview (Stages 0–8)
- `--edit <stage>` → revisit one stage (`project`, `actor`, `activity`, `artifact`, `objective`, `resource`, `context`, `workflow`, `relations`)
- `--regen-guide` → only rewrite `wiki/ontology-guide.md` from existing `wiki/ontology.yaml`
- `--from-template` → copy `references/ontology-template.yaml` verbatim; skip interview

**Flow:**

1. Read `references/ontology-template.yaml` (skeleton) and `references/ontology-interview.md` (full interview script — follow it precisely)
2. If `wiki/ontology.yaml` exists and no flags → ask: _(a) edit a stage, (b) full re-interview (overwrites), (c) cancel_
3. Run interview per `references/ontology-interview.md`:
   - Stage 0: Project Profiling (type, name, description, period)
   - Stage 1: Actor Axis
   - Stage 2: Activity Axis + workflow phases
   - Stage 3: Artifact Axis
   - Stage 4: Objective Axis
   - Stage 5: Resource Axis (off by default)
   - Stage 6: Context Axis (off by default)
   - Stage 7: Relations Confirmation
   - Stage 8: Review & Save
4. Write `wiki/ontology.yaml` (Write tool — never shell echo) and `wiki/ontology-guide.md`
5. Append to `wiki/log.md`: `## [YYYY-MM-DD] ontology-init | <N> classes, <M> relations, workflow=<phase_count>`
6. Offer to create stub entity/concept pages for named instances given during interview

**Output:**

```
✅ Ontology saved to wiki/ontology.yaml
✅ Guide saved to wiki/ontology-guide.md
Active axes: Actor, Activity, Artifact, Objective
Classes: 14 | Relations: 11 | Phases: 5
Next: /wiki-ingest | /wiki-ontology-validate | /wiki-ontology-init --edit <stage>
```

---

## /wiki-ontology-show

1. If `wiki/ontology.yaml` absent → _"No ontology configured. Run `/wiki-ontology-init` to create one (optional — the wiki works without it)."_
2. Read `wiki/ontology.yaml` and render:

   ```
   Project: <name> (<type>) — <description>
   Period: <start> → <end>

   Active Axes & Classes:
     Actor    : Person, Team, Role
     Activity : Task, Phase, Meeting, Decision
     Artifact : Document, Deliverable
     Objective: Goal, Milestone, Risk
     (Resource: off)
     (Context : off)

   Workflow: Discover → Design → Build → Validate → Release

   Relations: owns, produces, consumes, achieves, part_of, precedes, authored_by, based_on
   ```

3. Tail with instance counts: _"14 entities, 6 concepts currently tagged with a class."_
4. No `wiki/log.md` append (read-only command).

---

## /wiki-ontology-validate

_(... existing validate content ...)_

---

## /wiki-ingest-ontology

Extracts structured knowledge from a source document into a machine-readable YAML file.

**Arguments:**

- `<file>` → path to the source document.
- `--schema <type>` → (optional) specific domain schema.

**Flow:**

1. **Preparation:** Read the source file and `references/ontology-data-template.yaml`.
2. **Knowledge Extraction:**
   - Identify domain entities (tools, libraries, components).
   - Identify domain concepts (theories, skills, patterns).
   - Map relationships (X is part of Y, X requires Z).
   - If `--schema roadmap` is used, prioritize extraction of 'Phases', 'Topics', and 'IDE/Tools' as seen in developer roadmaps.
3. **Storage:**
   - Generate a slug from the filename.
   - Write `wiki/ontologies/<slug>.yaml` using the universal template.
4. **Registration:**
   - Check if `wiki/ontology-registry.md` exists. Create it if not.
   - Append the new entry: `- [[<slug>]] — Knowledge data extracted from [[sources/<slug>]]`.
5. **Log:** Append to `wiki/log.md`: `## [YYYY-MM-DD] ontology-ingest | <slug>`.

**Output:**

```
✅ Knowledge extraction complete.
✅ Data saved to: wiki/ontologies/<slug>.yaml
✅ Registered in: wiki/ontology-registry.md
Next: Run /wiki-query to use this data in analysis.
```

---

## Ontology Checks for /wiki-lint (checks 7–12)

Run only when `wiki/ontology.yaml` exists. Add to the lint report after standard checks 1–6.

**Implementation:** run `python scripts/ontology_validate.py` — it implements checks 7–12
deterministically and prints a report already bucketed into `### Errors (N)` / `### Warnings (M)`
(see format below). Splice its `## Ontology Violations` section into `wiki/lint-report.md` after
the standard checks. Only fall back to manually re-deriving these checks by reading every page
if Python or PyYAML is unavailable in the environment.

**7. Unknown class** _(ERROR)_ — `class:` values not in any axis's `default_classes`
**8. Unknown predicate** _(ERROR)_ — `relations[].predicate` not declared in `relations:` block
**9. Unknown phase** _(ERROR)_ — `context.phase` not in `workflow.phases[].id`
**10. Domain/range violation** _(ERROR)_ — source class not in predicate's `domain`, or target class not in `range`

- Example: `{predicate: produces}` on `class: Document` — `produces` expects `domain: [Activity]`
  **11. Missing required properties** _(WARNING)_ — instances with a declared `class:` that are missing properties listed in that class's `properties:` array. Report each missing field by name (e.g. "Task `wiki/entities/TaskX.md` missing: owner, deadline").
  **12. Workflow gaps** _(WARNING)_ — Activity instances with no `context.phase`, or phases with zero instances

### Ontology Violations Report Format

```markdown
## Ontology Violations

### Errors (N) — schema contract broken

- Unknown class `ClassName` in `wiki/entities/Foo.md`
- Unknown predicate `custom_relation` in `wiki/sources/bar.md`
- Unknown phase `Shipping` in `wiki/sources/baz.md` (declared phases: Discover, Build, Validate)
- Domain violation: `{predicate: produces}` on `wiki/entities/TeamAlpha.md` (class: Team) — expects domain [Activity]

### Warnings (M) — data gaps

- Missing property `owner` on Task instance `wiki/entities/TaskX.md`
- Missing property `deadline` on Task instance `wiki/entities/TaskX.md`
- Phase `Validate` has no associated Activity instances
```

---

## Ontology-Aware Graph Building (/wiki-graph)

**Implementation:** `python scripts/build_graph.py` (or `/wiki-graph`) detects `wiki/ontology.yaml`
automatically and switches on ontology-aware rendering — no manual graph customization needed.
Run it plain; do not hand-edit `graph.html` to add this styling.

When `wiki/ontology.yaml` exists (and PyYAML is installed), the script:

- Colors each tagged node by its `class:` frontmatter, resolved to its axis:

  | Axis      | Color   |
  | --------- | ------- |
  | Actor     | #1976D2 |
  | Activity  | #388E3C |
  | Artifact  | #F57C00 |
  | Objective | #7B1FA2 |
  | Resource  | #5D4037 |
  | Context   | #546E7A |

  Untagged pages keep the plain `type:`-based color. The node's `axis` field carries the axis
  name for the legend and drawer; `group` still carries the **numeric Louvain community id**
  (not the axis name) so `lint.py`'s graph-aware checks — which key community-pair comparisons
  off `group` being an int — keep working unmodified.

- Draws **typed edges** from each page's `relations:` frontmatter array (predicate/target pairs),
  dashed and colored `#00BCD4`, independent of and additive to plain `[[wikilink]]` edges between
  the same two pages (`type: "TYPED"`, with `predicate` and `label` set to the predicate name).
  When a predicate declares an `inverse` and the target page also links back with that inverse
  predicate, only one directed edge is drawn.

- Flags **structural hubs** — nodes with degree > mean + 2σ (same threshold as `lint.py`'s hub-stub
  check) — with `hub: true`, rendered as a larger star-shaped node. This is degree-based, not
  class-based, so it naturally highlights whichever pages are actually most-connected instead of
  hardcoding "View pages are hubs."

- Reads a generic (ontology-independent) `status:` frontmatter field: pages with
  `status: legacy|archived|deprecated` get `legacy: true` and are dimmed in the graph, with a
  "Dim legacy pages" toggle in the UI (checked by default). This is a project-agnostic pattern for
  wikis that mix an active tier with a large legacy/archival tier — useful even without an
  ontology active.

**graph.json extended fields when ontology is active:**

```json
{ "nodes": [{"...": "...", "class": "View", "axis": "Artifact", "status": "active", "era": "...", "legacy": false, "hub": true}], "edges": [...], "built": "YYYY-MM-DD", "ontology_active": true }
```

---

## /wiki-ontology-apply

Bulk-apply a tagging plan to many **existing** pages at once — the workflow for the common case
where an ontology is introduced (or changed) on a wiki that already has a lot of untagged content.
Without this, every project reinvents a one-off throwaway script to do the same mechanical
frontmatter merge, and that script is discarded instead of reused.

**When to use:** right after `/wiki-ontology-init` on a non-empty wiki, or after a schema
migration that needs to re-tag many instances at once.

**Arguments:**

- `--plan <file>` → path to the plan YAML (default `wiki/ontology-apply-plan.yaml`)
- `--dry-run` (default) / `--apply` → dry-run only prints what would change

**Flow:**

1. **Design the plan with the user.** For a large legacy corpus, propose a tiered approach rather
   than tagging every page with full precision:
   - **Tier A (small, high-value subset):** precise `class:` + `relations:` tagging — pages that
     map directly to current hubs/docs.
   - **Tier B (the rest):** a lightweight `default:` rule — just `status: legacy` + an `era:`
     derived from a filename/path keyword — with no relation-graph connections. This is a
     deliberate isolation choice, not laziness: it keeps the legacy corpus queryable
     (`class:`/`status:`/`era:` filters via `/wiki-query`) without forcing precise ontology
     mapping onto content nobody will re-visit.
2. Write the plan to `wiki/ontology-apply-plan.yaml` — see `scripts/ontology_apply.py`'s module
   docstring for the full schema (`default.set`, `rules[].match.{pages,path_contains,path_glob}`,
   `rules[].set`, `rules[].relations.add`).
3. Run `python scripts/ontology_apply.py --plan wiki/ontology-apply-plan.yaml` (dry-run) and review
   the per-rule hit counts and the unmatched-page list with the user before writing anything.
4. Re-run with `--apply` once the plan looks right. The script merges fields into each page's
   existing frontmatter (preserving all other keys and the entire page body untouched), appends
   `relations:` entries without duplicating, never touches `wiki/originals/`, and appends a summary
   entry to `wiki/log.md` itself.
5. Run `/wiki-ontology-validate` (or `python scripts/ontology_validate.py`) to confirm 0 errors
   after the bulk tag.

**Output:**

```
✅ Applied plan wiki/ontology-apply-plan.yaml
   <N> pages changed, <M> pages left untouched (no matching rule)
Next: /wiki-ontology-validate | /wiki-graph
```

---

## Ontology-Specific Gotchas

- **Ontology is opt-in** — every command works without `wiki/ontology.yaml`; ontology features are additive
- **Never edit `wiki/ontology.yaml` silently** — only `/wiki-ontology-init` and `--edit` may modify it
- **`ontology-guide.md` is derived** — regenerated from `ontology.yaml`; direct edits are lost on `--regen-guide`
- **Unknown classes/predicates do not block ingest** — printed as inline `⚠ Schema warnings` at end of ingest; full report at `/wiki-ontology-validate`
- **Context Interview answers belong in `context:`, not in the page body** — do not duplicate into narrative sections
- **`--summary-only` sources are read on demand by `/wiki-query`** — original file is the authoritative data source
- **Entity/concept frontmatter is derived from the ontology, not from fixed templates** — field names must match the class's `properties:` array in `wiki/ontology.yaml`

---

## Schema Migration

When you change `wiki/ontology.yaml` (rename a class, remove a property, change predicate domain/range, modify phase ids):

1. Increment `project.schema_version` in `wiki/ontology.yaml`
2. Run `/wiki-ontology-validate` — it lists all pages that now violate the updated schema
3. For each ERROR: update the page frontmatter, or run `/wiki-update <slug>` to re-derive from the original source
4. For each WARNING: fill missing properties directly on the page, or leave for later
5. Append to `wiki/log.md`: `## [YYYY-MM-DD] schema-migration | v<N> → v<N+1>: <what changed>`

**Breaking changes** (must migrate): class rename or removal, property rename or removal, predicate rename or removal, phase id change.
**Non-breaking changes** (no migration needed): adding a new class, property, predicate, or phase; changing descriptions.

---

## Page Frontmatter with Ontology

When `wiki/ontology.yaml` is active, the ontology class definition is the **authoritative schema** for entity and concept pages. Derive field names from `axes.<Axis>.default_classes.<ClassName>.properties` — do not invent fields not declared there.

### Source page — `context:` block

Added by `/wiki-ingest` during the Context Interview:

```yaml
---
title: 'Sprint 12 Retrospective'
type: source
class: Meeting # ontology class name
tags: [meeting]
date: 2026-04-18
source_file: wiki/originals/sprint12-retro.md
sources: []
last_updated: 2026-04-18
context:
  authored_by: Alice # Actor instance name (must match entity page)
  authored_at: 2026-04-18
  phase: Build # workflow.phases[].id value
  activity: sprint-12 # Activity instance name
  artifact_type: Meeting # class from Artifact or Activity axis
  relates_to:
    - { target: TeamAlpha, predicate: part_of }
    - { target: SprintGoal-Q2, predicate: achieves }
---
```

### Entity page — `class:` and `relations:` blocks

```yaml
---
title: 'TeamAlpha'
type: entity
class: Team # must match a class in wiki/ontology.yaml
tags: []
sources: [sprint12-retro, design-doc-v2]
last_updated: 2026-04-18
properties: # fields from class's properties: array
  lead: Alice
  domain: backend-services
relations:
  - { predicate: owns, target: TaskX }
  - { predicate: part_of, target: ProjectAlpha }
---
```

### Concept page — same extension pattern

```yaml
---
title: 'SprintGoal-Q2'
type: concept
class: Goal # typically from Objective or Context axis
sources: [sprint12-retro]
last_updated: 2026-04-18
properties:
  parent_goal: YearlyOKR-2026
  target_date: 2026-06-30
  metric: '<measurable target>'
  status: on-track
relations:
  - { predicate: part_of, target: YearlyOKR-2026 }
---
```

### Field rules

- `class:` must match a class name declared in `wiki/ontology.yaml` under some axis's `default_classes`.
- `relations[].predicate` must match a key under `relations:` in `wiki/ontology.yaml`.
- `relations[].target` is an entity/concept name — case-sensitive, must match the page filename without extension.
- `context.phase` must match a `workflow.phases[].id` when phases are declared.
- All ontology fields are optional — omitting them degrades gracefully to non-ontology behavior.
- Unknown values are not an ingest-time error; they produce inline `⚠ Schema warnings` and are fully reported by `/wiki-ontology-validate`.
