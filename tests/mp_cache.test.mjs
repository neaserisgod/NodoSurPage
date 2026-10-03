import test from 'node:test';
import assert from 'node:assert/strict';
import { listSubscriptionsCached, clearMpCache } from '../functions/_lib/mp.js';

const PLAN = '6fe282d944ef4c018cb7904ce9e122f8';
const mock = (counter) => { globalThis.fetch = async () => { counter.n++; return new Response(JSON.stringify({ results: [{ id: 1, preapproval_plan_id: PLAN, payer_email: 'a@x.com', status: 'authorized' }] }), { status: 200 }); }; };

test('el control de acceso no vuelve a consultar a Mercado Pago dentro de la ventana', async () => {
  const c = { n: 0 }; mock(c); clearMpCache();
  const env = { MP_ACCESS_TOKEN: 'tok' };
  await listSubscriptionsCached(env, 'a@x.com'); await listSubscriptionsCached(env, 'A@x.com ');
  assert.equal(c.n, 1);
  clearMpCache(); await listSubscriptionsCached(env, 'a@x.com');
  assert.equal(c.n, 2);
  await listSubscriptionsCached({ ...env, MP_ACCESO_TTL_MS: 0 }, 'a@x.com');
  assert.equal(c.n, 3);
});

test('un error de Mercado Pago no queda en memoria', async () => {
  clearMpCache(); globalThis.fetch = async () => new Response('{}', { status: 500 });
  await assert.rejects(listSubscriptionsCached({ MP_ACCESS_TOKEN: 'tok' }, 'b@x.com'));
  const c = { n: 0 }; mock(c);
  assert.equal((await listSubscriptionsCached({ MP_ACCESS_TOKEN: 'tok' }, 'b@x.com')).length, 0); // payer_email distinto: filtrado
  assert.equal(c.n, 1);
});
