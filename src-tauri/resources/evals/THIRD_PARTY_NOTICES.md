# Third-Party Notices — bundled eval packs

This directory ships 9 public evaluation packs under `src-tauri/resources/evals/<pack-id>/`.
Each pack folder contains its own `LICENSE.md` (origin URL, revision, download
date, converter version, license id). Converters live in `scripts/evals/`
(deterministic, seed `20260925` unless noted). Download date for all packs
below: **2026-09-25 (UTC)**.

| Pack | Origin | Revision | License | Samples |
| --- | --- | --- | --- | --- |
| `gsm8k` | https://huggingface.co/datasets/openai/gsm8k (test) | `740312add88f781978c0658806c59bc2815b9866` | MIT | 1319 |
| `gsm8k-perturb` | derived from openai/gsm8k test (see row above) | same as above | MIT-derived (note origin) | 100 |
| `mmlu-pro` | https://huggingface.co/datasets/TIGER-Lab/MMLU-Pro (test) | `b189ec765aa7ed75c8acfea42df31fdae71f97be` | MIT | 1400 (14 subjects x 100, seed 20260925) |
| `ifeval` | https://huggingface.co/datasets/google/IFEval | `966cd89545d6b6acfd7638bc708b98261ca58e84` | Apache-2.0 | 541 |
| `ko-ifeval` | https://huggingface.co/datasets/allganize/IFEval-Ko | `54199e3801116897697babf341865741dcd06fc8` | Apache-2.0 | 342 |
| `kmmlu` | https://huggingface.co/datasets/HAERAE-HUB/KMMLU (`data/*-test.csv`) | `d61b3f19e552c576bf5960dd24289763edc36a88` | CC-BY-ND-4.0 (originals unmodified) | 35030 rows across 45 CSVs |
| `kobest` | https://huggingface.co/datasets/skt/kobest_v1 (test: boolq/copa/wic/hellaswag/sentineg) | `a5ea15e3ac77ed694b79f6204eb31889a2ba989f` | CC-BY-SA-4.0 | 1000 (200/task) |
| `humaneval-plus` | https://huggingface.co/datasets/evalplus/humanevalplus (test) | `d32357cf319e50e9c8d8dab5ea876c72b0fd321b` | Apache-2.0 | 164 (needs Python opt-in at runtime) |
| `bfcl` | https://github.com/ShishirPatil/gorilla (`berkeley-function-call-leaderboard/bfcl_eval/data`, BFCL v3 non-live Python + `possible_answer/`) | `c15b2a151662cac9839c96d7dfb1493b5329c975` | Apache-2.0 | 500 (100/category x 5) |

Notes and exceptions (D4):

- `gsm8k`: solution text dropped; only question + final number bundled.
- `mmlu-pro`: `cot_content` dropped; bundled subset is the stratified 1400 only.
- `kmmlu`: all 45 CSVs bundled byte-identical and unmodified (ND clause).
  Upstream header inconsistency: 44 files use
  `question,answer,A,B,C,D,Category,Human Accuracy` while `math-test.csv`
  uses `question,answer,A,B,C,D,Human Accuracy,Category`. Recorded here and in
  the pack LICENSE.md; the runtime `kmmluCsv` adapter maps columns by header
  name instead of editing origin files.
- `humaneval-plus`: execution requires a Python runtime opt-in
  (`requires.codeRuntime: python` in the manifest).
- `bfcl`: BFCL v3 files no longer exist at the gorilla repo HEAD; they were
  taken from the last commit that contained them (pinned above).
- IFEval instruction coverage: the app registry implements all instruction
  types in both packs EXCEPT `detectable_format:number_highlighted_sections`
  and `length_constraints:nth_paragraph_first_word` (samples kept verbatim;
  those checks fail at score time until checkers land).
- NEVER bundled (license exceptions): hae-rae (CC-BY-NC-ND), gpqa
  (plaintext-distribution ban + gated), click / logickor (license unverified).
  See `src/lib/eval/interop/importPresets.ts` for user-side import presets
  (descriptors only, no vendored content).
