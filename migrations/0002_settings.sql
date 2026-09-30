-- Ajustes del sitio (opcional: la tabla también se crea sola al usar el interruptor del panel de administración).
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
