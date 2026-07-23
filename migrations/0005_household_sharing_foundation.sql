-- Security-first foundation for one owner and one editor sharing an encrypted plan.
-- This migration stores authorization metadata only. It never stores plan plaintext,
-- recovery passwords, shared passwords, encryption keys, or plaintext invitation tokens.

CREATE TABLE IF NOT EXISTS shared_households (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'read_only', 'deleting')),
  key_epoch INTEGER NOT NULL DEFAULT 1 CHECK (key_epoch >= 1),
  current_revision INTEGER NOT NULL DEFAULT 0 CHECK (current_revision >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_shared_households_active_owner
ON shared_households(owner_user_id)
WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS household_memberships (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked', 'left')),
  joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  UNIQUE (household_id, user_id),
  FOREIGN KEY (household_id) REFERENCES shared_households(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_household_memberships_one_active_household
ON household_memberships(user_id)
WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS idx_household_memberships_one_active_owner
ON household_memberships(household_id)
WHERE role = 'owner' AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_household_memberships_household_active
ON household_memberships(household_id, status);

CREATE TABLE IF NOT EXISTS household_invitations (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  invitee_email_hmac TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor' CHECK (role = 'editor'),
  expires_at INTEGER NOT NULL,
  accepted_at TEXT,
  accepted_by TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (household_id) REFERENCES shared_households(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (accepted_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_household_invitations_token
ON household_invitations(token_hash);

CREATE INDEX IF NOT EXISTS idx_household_invitations_household_pending
ON household_invitations(household_id, accepted_at, revoked_at, expires_at);

CREATE TABLE IF NOT EXISTS shared_plan_revisions (
  household_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  key_epoch INTEGER NOT NULL CHECK (key_epoch >= 1),
  r2_object_key TEXT NOT NULL UNIQUE,
  envelope_version INTEGER NOT NULL,
  plan_version INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  checksum_sha256 TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (household_id, revision),
  FOREIGN KEY (household_id) REFERENCES shared_households(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_shared_plan_revisions_household_created
ON shared_plan_revisions(household_id, created_at DESC);

CREATE TABLE IF NOT EXISTS household_audit_events (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  actor_user_id TEXT,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('created', 'invited', 'invitation_revoked', 'joined', 'removed', 'left', 'saved', 'restored')),
  revision INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (household_id) REFERENCES shared_households(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_household_audit_events_household_created
ON household_audit_events(household_id, created_at DESC);
