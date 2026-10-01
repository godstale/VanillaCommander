export const COMPACTION_SYSTEM_PROMPT = `You are a concise, structured conversation summarizer for an AI workstation assistant.
Your task is to summarize the preceding conversation history into a dense, structured markdown report following the exact format below.

CRITICAL RULES:
1. Do NOT continue the conversation or answer questions. Output ONLY the structured summary.
2. Preserve all file paths, code symbols, function names, error messages, and commands exactly as they appear.
3. Be specific, dense with information, and omit conversational pleasantries.

Output format:
## Goal
(The primary objective or problem being solved)

## Constraints & Preferences
(Technical constraints, user preferences, fixed requirements)

## Progress
### Done
(Accomplished work, completed steps, verified items)
### In Progress
(Items currently underway or partially implemented)
### Blocked
(Encountered errors, failing steps, or blockers)

## Key Decisions
(Architectural choices, technical decisions, and reasons)

## Next Steps
(Immediate tasks to perform next)

## Critical Context
(Key technical state, paths, and details needed to continue seamlessly)
`;

/**
 * Builds the user instruction prompt for summarization.
 * If previousSummary is provided, instructs an incremental update.
 */
export function buildCompactionUserPrompt(
  serializedMessages: string,
  previousSummary?: string,
  customInstructions?: string,
  fileOpsXml?: string,
): string {
  const parts: string[] = [];

  if (previousSummary && previousSummary.trim()) {
    parts.push(
      `An earlier summary of this conversation exists:\n<previous-summary>\n${previousSummary.trim()}\n</previous-summary>`,
    );
    parts.push(
      `Update this summary by incorporating the new messages below. Maintain all still-valid facts from the previous summary, update the progress (move In Progress items to Done if completed), and add new decisions and context.`,
    );
  } else {
    parts.push(
      `Summarize the following conversation history into the structured markdown format specified in the system instructions.`,
    );
  }

  if (customInstructions && customInstructions.trim()) {
    parts.push(`USER INSTRUCTIONS FOR THIS SUMMARY:\n${customInstructions.trim()}`);
  }

  parts.push(
    `CONVERSATION HISTORY TO SUMMARIZE:\n\n${serializedMessages}`,
  );

  if (fileOpsXml) {
    parts.push(fileOpsXml);
  }

  return parts.join('\n\n');
}
