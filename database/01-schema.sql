CREATE TABLE users (
  id uuid PRIMARY KEY, tenant varchar(40) NOT NULL,
  username varchar(80) UNIQUE NOT NULL, role varchar(20) NOT NULL CHECK (role IN ('REQUESTER','APPROVER')),
  password_hash text NOT NULL
);
CREATE TABLE sessions (
  token_hash char(64) PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE purchases (
  id uuid PRIMARY KEY, tenant varchar(40) NOT NULL, owner_id uuid NOT NULL REFERENCES users(id),
  title varchar(120) NOT NULL, amount_cents bigint NOT NULL CHECK (amount_cents BETWEEN 1 AND 1000000),
  vendor varchar(30) NOT NULL CHECK (vendor IN ('acme','globex')),
  status varchar(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  idempotency_key uuid NOT NULL, fingerprint char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, idempotency_key)
);
CREATE INDEX purchases_scope ON purchases(tenant, owner_id, created_at DESC);
CREATE TABLE audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, tenant varchar(40) NOT NULL,
  actor varchar(80) NOT NULL, action varchar(40) NOT NULL, object_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_scope ON audit(tenant, id DESC);
CREATE TABLE rate_buckets (
  bucket_key varchar(180) PRIMARY KEY, count integer NOT NULL,
  expires_at timestamptz NOT NULL
);
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO sentinel_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON users, sessions, purchases, rate_buckets TO sentinel_app;
GRANT SELECT, INSERT ON audit TO sentinel_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sentinel_app;
