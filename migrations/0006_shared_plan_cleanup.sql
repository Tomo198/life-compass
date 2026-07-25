-- Tracks encrypted R2 objects from the moment a save starts until D1 metadata
-- confirms that the object belongs to a committed shared-plan revision.

CREATE TABLE IF NOT EXISTS shared_plan_object_cleanup (
  r2_object_key TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_shared_plan_object_cleanup_created
ON shared_plan_object_cleanup(created_at);
