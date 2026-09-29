-- Base D1 "nodosur": una fila por cliente que ingresó con Google.
CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  sub            TEXT    NOT NULL UNIQUE,   -- id estable de Google
  email          TEXT    NOT NULL UNIQUE,   -- mail verificado (minúsculas)
  name           TEXT,
  created_at     INTEGER NOT NULL,          -- epoch segundos
  last_seen      INTEGER NOT NULL,          -- último uso
  login_count    INTEGER NOT NULL DEFAULT 1,
  exempt         INTEGER NOT NULL DEFAULT 0, -- 1 = nunca se borra
  notice_sent_at INTEGER,                   -- cuándo se avisó del borrado
  delete_after   INTEGER                    -- desde cuándo se puede borrar
);
CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen);
