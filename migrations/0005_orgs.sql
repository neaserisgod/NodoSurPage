-- Negocios, sucursales y miembros. El sitio crea estas tablas solo (functions/_lib/orgs.js, ensureOrgTables);
-- correr esto a mano es opcional. Las columnas nuevas de devices y backups son nullable: se completan con
-- backfillOrgs (cada dueño existente recibe su negocio y su "Sucursal principal").
CREATE TABLE IF NOT EXISTS orgs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, owner_sub TEXT NOT NULL,
  billing_email TEXT NOT NULL,  -- mail con el que se paga en Mercado Pago (no cambia al transferir la propiedad)
  created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_orgs_owner ON orgs(owner_sub);
CREATE TABLE IF NOT EXISTS branches (
  id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_branches_org ON branches(org_id);
CREATE TABLE IF NOT EXISTS memberships (
  id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, user_sub TEXT NOT NULL, email TEXT NOT NULL,
  role TEXT NOT NULL,                              -- owner | manager | employee
  status TEXT NOT NULL DEFAULT 'active',           -- active | removed
  all_branches INTEGER NOT NULL DEFAULT 0, pin_hash TEXT, created_at INTEGER NOT NULL,
  UNIQUE (org_id, user_sub));
CREATE INDEX IF NOT EXISTS idx_memberships_sub ON memberships(user_sub);
CREATE TABLE IF NOT EXISTS membership_branches (
  membership_id INTEGER NOT NULL, branch_id INTEGER NOT NULL, PRIMARY KEY (membership_id, branch_id));
CREATE TABLE IF NOT EXISTS invitations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL,
  all_branches INTEGER NOT NULL DEFAULT 0, branch_ids TEXT, token_hash TEXT NOT NULL UNIQUE,
  exp INTEGER NOT NULL, created_at INTEGER NOT NULL, accepted_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email);
ALTER TABLE devices ADD COLUMN owner_org INTEGER;
ALTER TABLE devices ADD COLUMN branch_id INTEGER;
ALTER TABLE backups ADD COLUMN owner_org INTEGER;
ALTER TABLE backups ADD COLUMN branch_id INTEGER;
