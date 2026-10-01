---
name: commit-message
description: Draft a Conventional Commits message (type(scope): subject) from a diffstat and change summary.
---

# Commit Message

Reply with a single commit message line only, matching:

[type(scope): subject]

- type is one of feat, fix, docs, refactor, test, chore.
- scope is a short area name in parentheses.
- subject is an imperative phrase under 50 chars.

Rules:

- Output the message line only, no explanation.
- Never exceed 72 characters total.
