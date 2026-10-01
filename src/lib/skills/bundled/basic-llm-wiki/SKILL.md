---
name: basic-llm-wiki
description: 'Minimal personal knowledge base in the workspace wiki/ folder: register (ingest), look up (query/list), and delete wiki pages. Use when the user asks to save/remember knowledge, search or ask the wiki, list wiki pages, or remove a wiki page.'
---

# Basic LLM Wiki

A minimal markdown wiki stored in the workspace. Only three operations: **register**, **look up**, **delete**.

## Layout

```
wiki/
  index.md            # One line per page (update on every register/delete)
  log.md              # Append-only change log
  sources/<slug>.md   # One page per piece of knowledge
```

- `slug`: kebab-case, lowercase ASCII/Korean allowed, no spaces (e.g. `ollama-setup`).
- If the `wiki` tool is available, you may use it instead of manual file edits — it uses the same layout.

## Register

1. Choose a `title` and `slug`. If `wiki/sources/<slug>.md` already exists, update that page instead of creating a duplicate.
2. Write `wiki/sources/<slug>.md`:

   ```markdown
   ---
   title: 'Page Title'
   type: source
   tags: []
   last_updated: YYYY-MM-DD
   ---

   ## Summary

   2–4 sentence summary.

   ## Details

   - Key facts, decisions, numbers.
   ```

3. Add to `wiki/index.md` (create with a `# Wiki Index` heading if missing):
   `- [Page Title](sources/<slug>.md) — YYYY-MM-DD`
4. Append to `wiki/log.md`: `- YYYY-MM-DD register <slug>`

## Look up

- **List:** read `wiki/index.md`.
- **Query:** find candidates in `wiki/index.md`, then grep `wiki/sources/` for keywords. Read the matching pages and answer from them, citing pages as `sources/<slug>.md`.
- If nothing matches, say so. Do not invent content that is not in the wiki.

## Delete

1. Confirm the slug exists (`wiki/sources/<slug>.md`). Ask the user to confirm before deleting.
2. Delete `wiki/sources/<slug>.md`.
3. Remove its line from `wiki/index.md`.
4. Append to `wiki/log.md`: `- YYYY-MM-DD delete <slug>`

## Rules

- Only touch files under `wiki/`.
- Always read-merge-write `index.md` and `log.md`; never overwrite other entries.
- Keep `index.md` in sync with `wiki/sources/` on every change.
