-- Plan que eligió cada usuario (se recuerda entre el registro y el pago). El sitio también agrega estas
-- columnas solo la primera vez que hacen falta; correr esto a mano es opcional.
ALTER TABLE users ADD COLUMN plan_interest TEXT;                      -- pos | pos-bot | bot
ALTER TABLE users ADD COLUMN promo_interest INTEGER NOT NULL DEFAULT 0; -- 1 = pidió el precio de fundador
ALTER TABLE users ADD COLUMN plan_chosen_at INTEGER;                  -- epoch segundos
