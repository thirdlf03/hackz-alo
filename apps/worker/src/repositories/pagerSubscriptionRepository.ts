import type {Bindings} from '../types.js';

export async function upsertPagerSubscription(
  env: Bindings,
  input: {
    sessionId: string;
    endpoint: string;
    subscriptionJson: string;
    createdAt: number;
  }
) {
  await env.DB.prepare(
    `insert into pager_subscriptions (session_id, endpoint, subscription_json, created_at)
     values (?, ?, ?, ?)
     on conflict (session_id, endpoint) do update set
       subscription_json = excluded.subscription_json,
       created_at = excluded.created_at`
  )
    .bind(
      input.sessionId,
      input.endpoint,
      input.subscriptionJson,
      input.createdAt
    )
    .run();
}

export async function listPagerSubscriptionsForSession(
  env: Bindings,
  sessionId: string
) {
  const rows = await env.DB.prepare(
    'select endpoint, subscription_json from pager_subscriptions where session_id = ?'
  )
    .bind(sessionId)
    .all<{endpoint: string; subscription_json: string}>();
  return rows.results.map((row) => ({
    endpoint: row.endpoint,
    subscriptionJson: row.subscription_json,
  }));
}

export async function deletePagerSubscription(
  env: Bindings,
  sessionId: string,
  endpoint: string
) {
  await env.DB.prepare(
    'delete from pager_subscriptions where session_id = ? and endpoint = ?'
  )
    .bind(sessionId, endpoint)
    .run();
}
