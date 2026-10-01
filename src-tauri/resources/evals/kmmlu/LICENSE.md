# License — kmmlu

- Origin: https://huggingface.co/datasets/HAERAE-HUB/KMMLU (data/*-test.csv, 45 files)
- Revision (HF commit sha): d61b3f19e552c576bf5960dd24289763edc36a88
- Download date (UTC): 2026-09-25
- Converter: scripts/evals/convert-kmmlu.mjs v1.0.0
- License: CC-BY-ND-4.0 — origin files bundled UNMODIFIED under data/ (no derivatives)
- Header note: 44 files use `question,answer,A,B,C,D,Category,Human Accuracy`;
  math-test.csv uses `question,answer,A,B,C,D,Human Accuracy,Category` (cols 7-8 swapped upstream).
  The runtime kmmluCsv adapter maps columns by header name; see task report.
- Data rows (excl. headers): 35030
