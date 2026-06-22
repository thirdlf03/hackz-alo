import type {Sandbox} from '@cloudflare/sandbox';

export interface Bindings {
  ASSETS: Fetcher;
  DB: D1Database;
  REPLAY_BUCKET: R2Bucket;
  SCENARIO_KV: KVNamespace;
  SESSION_DO: DurableObjectNamespace;
  Sandbox: DurableObjectNamespace<Sandbox>;
  AI?: Ai;
}
