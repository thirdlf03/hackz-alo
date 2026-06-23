import {roundSessionEdgeRtt} from '../pure/sessionEdgeRtt.js';

export async function measureSessionEdgeRtt(
  request: () => Promise<unknown>
): Promise<number> {
  const startedAt = performance.now();
  await request();
  return roundSessionEdgeRtt(performance.now() - startedAt);
}
