-- Transferencia de propiedad de un negocio. El sitio crea esta tabla solo (functions/_lib/orgs.js, ensureOrgTables);
-- correr esto a mano es opcional. Como mucho una pendiente por negocio.
CREATE TABLE IF NOT EXISTS org_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, from_sub TEXT NOT NULL, from_email TEXT NOT NULL,
  to_sub TEXT NOT NULL, to_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',          -- pending | accepted | declined | cancelled | expired
  created_at INTEGER NOT NULL, exp INTEGER NOT NULL, resolved_at INTEGER);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transfers_pending ON org_transfers(org_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_transfers_to ON org_transfers(to_sub, status);
