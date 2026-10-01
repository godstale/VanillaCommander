/**
 * Compares two section maps and returns patches for added, modified, or deleted sections.
 * Deleted sections map to null. Unchanged sections are omitted.
 */
export function diffSections(
  previous: Record<string, string>,
  current: Record<string, string>,
): Record<string, string | null> {
  const diff: Record<string, string | null> = {};

  // Check additions and modifications
  for (const [key, val] of Object.entries(current)) {
    if (previous[key] === undefined) {
      diff[key] = val;
    } else if (previous[key] !== val) {
      diff[key] = val;
    }
  }

  // Check deletions
  for (const key of Object.keys(previous)) {
    if (current[key] === undefined) {
      diff[key] = null;
    }
  }

  return diff;
}
