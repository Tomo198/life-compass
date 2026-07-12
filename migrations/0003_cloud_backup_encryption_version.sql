-- Track the encrypted envelope format without storing plan contents in D1.

ALTER TABLE cloud_backups
ADD COLUMN encryption_version INTEGER NOT NULL DEFAULT 1 CHECK (encryption_version >= 1);

