-- Provider-neutral billing state for Square first, with room for a future provider change.
-- Legacy Stripe columns and webhook_events remain untouched for migration safety.

ALTER TABLE subscriptions
ADD COLUMN billing_provider TEXT NOT NULL DEFAULT 'none';

ALTER TABLE subscriptions
ADD COLUMN provider_customer_id TEXT;

ALTER TABLE subscriptions
ADD COLUMN provider_subscription_id TEXT;

ALTER TABLE subscriptions
ADD COLUMN provider_plan_id TEXT;

ALTER TABLE subscriptions
ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'unknown';

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_provider_subscription
ON subscriptions(billing_provider, provider_subscription_id)
WHERE provider_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subscriptions_provider_customer
ON subscriptions(billing_provider, provider_customer_id);

CREATE TABLE IF NOT EXISTS billing_webhook_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('square', 'paypal')),
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  provider_object_id TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TEXT,
  UNIQUE (provider, event_id)
);

CREATE INDEX IF NOT EXISTS idx_billing_webhook_events_status
ON billing_webhook_events(provider, status, received_at);
