/**
 * Constant-time string comparison for secrets/tokens (write-token hashes,
 * ADMIN_SECRET, smoke-test bypass secret, ...). A plain `===`/`!==` short
 * circuits on the first mismatching character, which leaks timing
 * information proportional to how many leading characters an attacker
 * guessed correctly. This instead always walks the full length of the
 * longer input, XOR-accumulating every character pair (missing
 * characters compare against 0) and folding a length mismatch into the
 * accumulator rather than returning early, so total execution time does
 * not depend on where — or whether — the inputs diverge.
 *
 * Pure JS (no crypto.subtle), so it runs identically on Workers and Node.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const maxLength = Math.max(a.length, b.length);
  let mismatch = a.length === b.length ? 0 : 1;
  for (let index = 0; index < maxLength; index++) {
    const charA = index < a.length ? a.charCodeAt(index) : 0;
    const charB = index < b.length ? b.charCodeAt(index) : 0;
    mismatch |= charA ^ charB;
  }
  return mismatch === 0;
}
