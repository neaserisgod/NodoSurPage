-- De qué producto es cada negocio: gestion, estudio o gastro (2026-10-19, functions/_lib/productos.js).
-- Opcional, como las anteriores: la columna se crea sola la primera vez.
ALTER TABLE orgs ADD COLUMN producto TEXT;
UPDATE orgs SET producto = 'gestion' WHERE producto IS NULL AND id IN
  (SELECT owner_org FROM devices WHERE kind = 'pc' AND owner_org IS NOT NULL);
