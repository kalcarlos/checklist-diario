-- Banco D1 do checklist-diario: contas, sessoes, listas e permissoes.
-- Aplicar com: wrangler d1 execute checklist-diario-db --file=schema.sql [--local|--remote]

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  username    TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash   TEXT NOT NULL,
  pass_salt   TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

-- token_hash = SHA-256 do token; o token bruto so existe no aparelho do usuario.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- data = JSON { name, emoji, type, reminder, sortOrder, items[], lastResetDate }
CREATE TABLE IF NOT EXISTS lists (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data        TEXT NOT NULL,
  rev         INTEGER NOT NULL DEFAULT 1,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lists_owner ON lists(owner_id);

-- O dono vem de lists.owner_id; aqui ficam so editores e leitores.
CREATE TABLE IF NOT EXISTS list_members (
  list_id     TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
  PRIMARY KEY (list_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON list_members(user_id);

CREATE TABLE IF NOT EXISTS invites (
  code        TEXT PRIMARY KEY,
  list_id     TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
  created_by  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL,
  uses_left   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invites_list ON invites(list_id);

-- Login com Google: liga o "sub" do Google a uma conta. Contas Google nao tem senha (pass_hash vazio).
CREATE TABLE IF NOT EXISTS oauth_identities (
  provider    TEXT NOT NULL,
  subject     TEXT NOT NULL,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email       TEXT,
  PRIMARY KEY (provider, subject)
);
