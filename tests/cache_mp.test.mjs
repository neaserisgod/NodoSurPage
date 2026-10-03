// Camino caliente: el estado de pago de un negocio se recuerda 2 minutos (no una consulta a Mercado Pago por cada pedido de cada
// dispositivo) y, si Mercado Pago falla, se sigue con lo último que se supo por poco tiempo.
import assert from 'node:assert/strict';
import { listSubscriptionsCached, clearMpCache } from '../functions/_lib/mp.js';
import { mkEnv, mp, mpSub, mockMP } from './helpers-nube.mjs';

let pass = 0; const t = async (n, f) => { await f(); pass++; console.log('ok  ', n); };
let llamadas = 0;
const simular = () => { mp.subs = [mpSub('duena@x.com', 'authorized')]; mp.fail = false; mockMP(); const base = globalThis.fetch; globalThis.fetch = async (u, i) => { if (String(u).includes('/preapproval/search')) llamadas++; return base(u, i); }; llamadas = 0; };
const reloj = (ms) => { const ahora = Date.now; Date.now = () => ahora() + ms; return () => { Date.now = ahora; }; };

await t('varios pedidos seguidos hacen UNA sola consulta a Mercado Pago', async () => {
  const env = mkEnv({ MP_CACHE_MS: undefined }); simular();
  assert.equal((await listSubscriptionsCached(env, 'duena@x.com')).length, 1);
  for (let i = 0; i < 4; i++) assert.equal((await listSubscriptionsCached(env, 'Duena@X.com')).length, 1);
  assert.equal(llamadas, 1, 'el mail se normaliza: mayúsculas no son otra clave');
  await listSubscriptionsCached(env, 'otra@x.com'); assert.equal(llamadas, 2, 'otro mail, otra consulta');
});
await t('pasados 2 minutos se vuelve a consultar y una baja se nota', async () => {
  const env = mkEnv({ MP_CACHE_MS: undefined }); simular();
  assert.equal((await listSubscriptionsCached(env, 'duena@x.com'))[0].status, 'authorized');
  mp.subs = [mpSub('duena@x.com', 'cancelled')];
  assert.equal((await listSubscriptionsCached(env, 'duena@x.com'))[0].status, 'authorized', 'todavía vale lo recordado');
  const volver = reloj(2 * 60_000 + 1000); try { assert.equal((await listSubscriptionsCached(env, 'duena@x.com'))[0].status, 'cancelled'); } finally { volver(); }
});
await t('si Mercado Pago falla se sigue con lo último que se supo hasta 15 minutos; después no se afirma nada', async () => {
  const env = mkEnv({ MP_CACHE_MS: undefined }); simular(); await listSubscriptionsCached(env, 'duena@x.com');
  mp.fail = true;
  let volver = reloj(5 * 60_000); try { assert.equal((await listSubscriptionsCached(env, 'duena@x.com'))[0].status, 'authorized', 'a los 5 min, con MP caído, sigue lo último'); } finally { volver(); }
  volver = reloj(16 * 60_000); try { await assert.rejects(() => listSubscriptionsCached(env, 'duena@x.com'), 'a los 16 min ya no se afirma nada'); } finally { volver(); }
  await assert.rejects(() => listSubscriptionsCached(mkEnv({ MP_CACHE_MS: undefined }), 'nunca-visto@x.com'), 'sin nada recordado, el error sale');
});
await t('MP_CACHE_MS=0 apaga la memoria: cada pedido consulta', async () => {
  const env = mkEnv({ MP_CACHE_MS: 0 }); simular(); clearMpCache();
  await listSubscriptionsCached(env, 'duena@x.com'); await listSubscriptionsCached(env, 'duena@x.com'); assert.equal(llamadas, 2);
});
console.log(`\n${pass} pruebas OK (memoria del estado de pago)`);
