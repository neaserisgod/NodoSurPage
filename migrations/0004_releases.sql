-- Versiones del sistema POS (los archivos viven en R2). El sitio crea estas tablas solo al publicar la primera
-- versión; correr esto a mano es opcional.
CREATE TABLE IF NOT EXISTS releases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,            -- stable | beta
  platform TEXT NOT NULL,           -- windows | macos | linux | android
  version TEXT NOT NULL,            -- 1.4.0
  file_key TEXT NOT NULL,           -- clave en R2: stable/1.4.0/NodoSur-Setup-1.4.0.exe
  size INTEGER NOT NULL, sha256 TEXT NOT NULL, signature TEXT, notes TEXT,
  sig_type TEXT NOT NULL DEFAULT 'ed',    -- ed = EdDSA (WinSparkle 0.9+) | dsa = DSA (WinSparkle 0.8, el de auto_updater 1.0)
  mandatory INTEGER NOT NULL DEFAULT 0,
  rollout INTEGER NOT NULL DEFAULT 100,   -- % de instalaciones a las que se ofrece la actualización
  blocked INTEGER NOT NULL DEFAULT 0,     -- 1 = no se entrega más
  active INTEGER NOT NULL DEFAULT 1,      -- 0 = retirada (la versión anterior pasa a ser la vigente)
  published_at INTEGER NOT NULL,
  UNIQUE (channel, platform, version)
);
CREATE TABLE IF NOT EXISTS downloads (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, release_id INTEGER NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_downloads_release ON downloads(release_id);
