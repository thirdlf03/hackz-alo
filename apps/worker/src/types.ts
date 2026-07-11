import type {Sandbox} from '@cloudflare/sandbox';

export interface Bindings {
  ASSETS: Fetcher;
  DB: D1Database;
  REPLAY_BUCKET: R2Bucket;
  SCENARIO_KV: KVNamespace;
  SESSION_DO: DurableObjectNamespace;
  Sandbox: DurableObjectNamespace<Sandbox>;
  ENVIRONMENT?: string;
  INCIDENT_PERF?: string;
  INCIDENT_SANDBOX_SLEEP_AFTER?: string;
  TURNSTILE_SECRET_KEY?: string;
  ADMIN_SECRET?: string;
  /** Cloudflare Calls TURN サービスの鍵。未設定なら STUN のみで動作する。 */
  CF_TURN_KEY_ID?: string;
  CF_TURN_KEY_API_TOKEN?: string;
  AI?: Ai;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}
