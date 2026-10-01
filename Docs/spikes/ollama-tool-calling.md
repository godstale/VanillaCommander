# Ollama Tool-Calling 검증 스파이크 결과

- **일시**: 2026-09-18
- **실행 스크립트**: `scripts/spike-agent-loop.mjs`
- **테스트 환경**: Node.js v22.13.0, Ollama HTTP API (`/api/chat` with streaming)

## 1. 모델별 테스트 결과 요약

| 모델 | 단일 도구 호출 | 멀티턴(3턴) | 병렬 호출 | usage 보고 | 비고 |
|---|:---:|:---:|:---:|:---:|---|
| `qwen3.5:9b` | O | O | - | O | 1턴 list_files → 2턴 read_file → 3턴 최종 답변 완료. 안정적인 JSON 파싱. |
| `granite4.1:8b` | O | O | - | O | 빠른 응답 속도, 간결하고 정확한 도구 인자 생성. 3턴 정상 완료. |
| `gemma4:12b` | O | O | - | O | 우수한 추론력 및 정확한 도구 호출, 3턴 정상 완료. |

## 2. 세부 관찰 결과

1. **스트리밍 도구 호출 (Streaming Tool Calls)**
   - Ollama `/api/chat` 스트리밍 응답에서 `chunk.message.tool_calls`가 올바르게 전달됨.
   - 인자(`arguments`)가 올바른 JSON 객체로 제공됨.

2. **멀티턴 턴 루프 (`role: "tool"`)**
   - 도구 실행 결과를 `{ role: "tool", content: "..." }` 메시지로 이전 어시스턴트 메시지(`tool_calls` 포함) 뒤에 붙여 전달했을 때, 다음 턴에서 다음 도구를 순차적으로 호출하거나 최종 응답을 정상 산출함.

3. **토큰 사용량 (Token Usage 실측)**
   - 스트리밍 청크 말미에 `prompt_eval_count` 및 `eval_count`가 정확하게 보고됨.
   - Phase 4의 usage 기반 토큰 추정 및 컨텍스트 압축 트리거 구현에 즉시 활용 가능.

## 3. Phase 2 기본 모델 결정

- **Phase 2 기본 추천 모델**: `qwen3.5:9b` (또는 로컬 환경에 따라 `granite4.1:8b`, `gemma4:12b`)
  - Qwen 시리즈는 코딩 및 도구 호출 스키마 준수율이 매우 높고, 프롬프트 지시사항 이해도가 우수함.
  - 시스템 설정(SettingsModel)에서 사용자가 설치된 모델 중 원하는 모델로 언제든 전환 가능하도록 지원.
