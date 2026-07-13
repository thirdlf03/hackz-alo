create table pager_subscriptions (
  session_id text not null check (length(session_id) > 0),
  endpoint text not null check (length(endpoint) > 0),
  subscription_json text not null check (length(subscription_json) > 0),
  created_at integer not null,
  primary key (session_id, endpoint)
);
