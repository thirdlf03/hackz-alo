/** Maps session result to a stable ending id for future branching. */
export function resolveEndingId(result: string): string {
  switch (result) {
    case "resolved":
      return "clear-shift";
    case "failed":
      return "overtime";
    case "retired":
      return "early-exit";
    case "aborted":
      return "aborted";
    default:
      return "unknown";
  }
}
