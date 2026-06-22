import type {Bindings} from '../types.js';

const rateLimitPrefix = 'rl:';

export function shouldEnforceRateLimit(env: Bindings) {
  return env.ENVIRONMENT === 'production';
}

export async function enforceRateLimit(
  env: Bindings,
  key: string,
  limit: number,
  windowSeconds: number
) {
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
  const storageKey = `${rateLimitPrefix}${key}:${String(bucket)}`;
  const currentRaw = await env.SCENARIO_KV.get(storageKey);
  const current = currentRaw ? Number.parseInt(currentRaw, 10) : 0;
  if (current >= limit) {
    return {allowed: false as const, retryAfter: windowSeconds};
  }
  await env.SCENARIO_KV.put(storageKey, String(current + 1), {
    expirationTtl: windowSeconds + 5,
  });
  return {allowed: true as const};
}
