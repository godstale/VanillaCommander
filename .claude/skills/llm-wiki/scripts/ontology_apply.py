#!/usr/bin/env python3
from __future__ import annotations

"""
Apply a declarative tagging plan to existing wiki pages' frontmatter in bulk.

Purpose: when an ontology is introduced (or changed) on a wiki that already has
many pages, hand-editing frontmatter file-by-file does not scale, and writing a
one-off script per project throws away the work. This script mechanically merges
`class`/`status`/`era`/other fields and `relations:` entries into each page's
existing frontmatter, driven by a reusable plan file — without touching the page
body or any other existing frontmatter key.

Usage:
    python scripts/ontology_apply.py --plan wiki/ontology-apply-plan.yaml            # dry run (default)
    python scripts/ontology_apply.py --plan wiki/ontology-apply-plan.yaml --apply    # write changes

Plan file schema (YAML):

    version: 1
    default:                        # optional — applied to every page first
      set: {status: legacy}
    rules:                          # applied in order; later rules override earlier fields
      - name: "hermes era"
        match:
          path_contains: [hermes-agent]        # substring match on repo-relative path (any-of, case-insensitive)
          # pages: [ExactStem1, ExactStem2]     # exact filename-stem match (any-of, case-sensitive)
          # path_glob: "wiki/sources/2026-06-*" # fnmatch pattern(s) on repo-relative posix path
        set:
          status: legacy
          era: hermes-agent
        relations:
          add:
            - {predicate: documents, target: SomePage}

A rule matches a page when ALL of its present match keys are satisfied
(pages/path_contains/path_glob are OR'd within themselves, AND'd across keys).
`set` fields are merged into existing frontmatter (added or overwritten, later
rules win); all other existing frontmatter keys and the page body are left
untouched. `relations.add` entries are appended to the page's `relations:` list,
de-duplicated by (predicate, target).

Never touches `wiki/originals/` (read-only archive per skill invariants).

Graceful degradation:
  - Exits with an instruction if PyYAML is not installed.
"""

import argparse
import fnmatch
import sys
from pathlib import Path
from collections import defaultdict
from datetime import date

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

REPO_ROOT = Path.cwd()
WIKI_DIR = REPO_ROOT / "wiki"
LOG_FILE = WIKI_DIR / "log.md"

SKIP_NAMES = {"index.md", "log.md", "lint-report.md", "ontology-validation-report.md",
              "overview.md", "ontology-guide.md"}

FM_START = "---\n"


def read_file(path: Path) -> str:
    if not path.exists():
        return ""
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        try:
            return path.read_text(encoding="utf-16")
        except UnicodeDecodeError:
            return path.read_text(encoding="latin-1")


def load_yaml_module():
    try:
        import yaml
        return yaml
    except ImportError:
        print("Error: PyYAML is required. Install with: pip install pyyaml")
        sys.exit(2)


def all_taggable_pages() -> list[Path]:
    """All wiki pages except registry/report files and the read-only originals/ archive."""
    pages = []
    for p in WIKI_DIR.rglob("*.md"):
        if p.name in SKIP_NAMES:
            continue
        try:
            rel_parts = p.relative_to(WIKI_DIR).parts
        except ValueError:
            continue
        if rel_parts and rel_parts[0] == "originals":
            continue
        pages.append(p)
    return pages


def split_frontmatter(content: str, yaml_mod) -> tuple[dict, str, bool]:
    """Returns (frontmatter_dict, body_including_trailing_content, had_frontmatter)."""
    if not content.startswith(FM_START):
        return {}, content, False
    end = content.find("\n---", len(FM_START))
    if end == -1:
        return {}, content, False
    fm_text = content[len(FM_START):end]
    body_start = content.find("\n", end + 1)
    body = content[body_start + 1:] if body_start != -1 else ""
    try:
        data = yaml_mod.safe_load(fm_text)
        return (data if isinstance(data, dict) else {}), body, True
    except Exception:
        return {}, content, False


def match_rule(rel_posix: str, stem: str, match: dict) -> bool:
    if not match:
        return True
    if "pages" in match:
        if stem not in (match["pages"] or []):
            return False
    if "path_contains" in match:
        needles = [str(n).lower() for n in (match["path_contains"] or [])]
        if not any(n in rel_posix.lower() for n in needles):
            return False
    if "path_glob" in match:
        patterns = match["path_glob"]
        patterns = [patterns] if isinstance(patterns, str) else (patterns or [])
        if not any(fnmatch.fnmatch(rel_posix, pat) for pat in patterns):
            return False
    return True


def plan_for_page(page: Path, plan: dict) -> tuple[dict, list[dict], list[str]]:
    """Resolve (set_fields, relations_to_add, matched_rule_names) for one page."""
    rel_posix = page.relative_to(REPO_ROOT).as_posix()
    stem = page.stem

    fields: dict = {}
    default = plan.get("default") or {}
    if default.get("set"):
        fields.update(default["set"])

    relations_add: list[dict] = []
    matched: list[str] = []
    for rule in plan.get("rules") or []:
        if match_rule(rel_posix, stem, rule.get("match") or {}):
            matched.append(rule.get("name", "<unnamed rule>"))
            fields.update(rule.get("set") or {})
            rel_block = rule.get("relations") or {}
            relations_add.extend(rel_block.get("add") or [])

    return fields, relations_add, matched


def apply_to_content(content: str, fields: dict, relations_add: list[dict], yaml_mod) -> tuple[str, bool]:
    """Returns (new_content, changed)."""
    fm, body, _had_fm = split_frontmatter(content, yaml_mod)
    changed = False

    for k, v in fields.items():
        if fm.get(k) != v:
            fm[k] = v
            changed = True

    if relations_add:
        existing = fm.get("relations") or []
        existing_keys = {(r.get("predicate"), str(r.get("target"))) for r in existing if isinstance(r, dict)}
        for rel in relations_add:
            key = (rel.get("predicate"), str(rel.get("target")))
            if key not in existing_keys:
                existing.append(rel)
                existing_keys.add(key)
                changed = True
        fm["relations"] = existing

    if not changed:
        return content, False

    fm_text = yaml_mod.safe_dump(fm, sort_keys=False, allow_unicode=True,
                                  default_flow_style=False).rstrip("\n")
    new_content = f"---\n{fm_text}\n---\n{body}"
    return new_content, True


def append_log(entry: str):
    existing = read_file(LOG_FILE)
    LOG_FILE.write_text(entry.strip() + "\n\n" + existing, encoding="utf-8")


def main():
    ap = argparse.ArgumentParser(description="Bulk-apply an ontology tagging plan to existing wiki pages")
    ap.add_argument("--plan", default="wiki/ontology-apply-plan.yaml", help="Path to the plan YAML file")
    ap.add_argument("--apply", action="store_true", help="Write changes (default is dry-run)")
    args = ap.parse_args()

    yaml_mod = load_yaml_module()

    plan_path = REPO_ROOT / args.plan
    if not plan_path.exists():
        print(f"Plan file not found: {plan_path}")
        sys.exit(1)
    plan = yaml_mod.safe_load(read_file(plan_path)) or {}

    pages = all_taggable_pages()
    rule_hit_counts: dict[str, int] = defaultdict(int)
    unmatched: list[str] = []
    to_write: list[tuple[Path, str]] = []
    changed_count = 0
    has_default = bool((plan.get("default") or {}).get("set"))

    for p in pages:
        fields, relations_add, matched = plan_for_page(p, plan)
        rel = p.relative_to(REPO_ROOT).as_posix()
        if not matched and not has_default:
            unmatched.append(rel)
            continue
        for m in matched:
            rule_hit_counts[m] += 1
        if not fields and not relations_add:
            continue
        content = read_file(p)
        new_content, changed = apply_to_content(content, fields, relations_add, yaml_mod)
        if changed:
            changed_count += 1
            to_write.append((p, new_content))

    print(f"Plan: {plan_path.relative_to(REPO_ROOT)}")
    print(f"Scanned {len(pages)} taggable pages (wiki/originals/ excluded).")
    verb = "would change" if not args.apply else "changed"
    print(f"  {changed_count} page(s) {verb}")
    print(f"  {len(unmatched)} page(s) matched no rule and no default")
    print("")
    print("Rule hit counts:")
    for name, count in rule_hit_counts.items():
        print(f"  {name}: {count}")
    if unmatched:
        print("")
        print(f"Unmatched pages ({len(unmatched)}):")
        for u in unmatched[:30]:
            print(f"  - {u}")
        if len(unmatched) > 30:
            print(f"  ... and {len(unmatched) - 30} more")

    if not args.apply:
        print("\nDry run only — no files written. Re-run with --apply to write changes.")
        return

    for p, new_content in to_write:
        p.write_text(new_content, encoding="utf-8")

    today = date.today().isoformat()
    rule_summary = ", ".join(f"{name}={count}" for name, count in rule_hit_counts.items()) or "none"
    append_log(
        f"## [{today}] ontology-apply | {changed_count} pages tagged from plan {plan_path.name}\n\n"
        f"Rules: {rule_summary}. {len(unmatched)} pages left untouched (no matching rule)."
    )
    print(f"\nWrote {changed_count} file(s). Logged to wiki/log.md.")


if __name__ == "__main__":
    main()
