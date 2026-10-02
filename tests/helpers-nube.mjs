// Ayudas compartidas por las pruebas de dispositivos y copias: base D1 y bucket R2 simulados.
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { sign } from '../functions/_lib/util.js';
import { clearMpCache } from '../functions/_lib/mp.js';

export const nowS = () => Math.floor(Date.now() / 1000);
export function fakeD1() {
  const db = new DatabaseSync(':memory:'); db.exec(readFileSync(new URL('../migrations/0001_users.sql', import.meta.url), 'utf8'));
  return { raw: db, prepare(sql) { let a = []; const st = db.prepare(sql); const o = { bind(...x) { a = x; return o }, first() { return st.get(...a) ?? null }, all() { return { results: st.all(...a) } }, run() { const r = st.run(...a); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } } } }; return o } };
}
export function fakeR2() {
  const files = new Map();
  return { files,
    async put(k, bytes) { files.set(k, Buffer.from(bytes)); },
    async delete(k) { files.delete(k); },
    async head(k) { return files.has(k) ? { size: files.get(k).length } : null; },
    async get(k) { const b = files.get(k); if (!b) return null; return { size: b.length, httpEtag: '"e"', writeHttpMetadata() {}, body: new Blob([b]).stream(), async arrayBuffer() { return new Uint8Array(b).buffer; } }; },
  };
}
export const BACKUP_KEY = Buffer.alloc(32, 7).toString('base64');
export const mkEnv = (extra = {}) => (clearMpCache(), {
  SESSION_SECRET: 'x'.repeat(48), SITE_URL: 'https://horsepos.com', MP_ACCESS_TOKEN: 'tok', ADMIN_EMAILS: 'admin@x.com',
  RELEASE_TOKEN: 'r'.repeat(40), BACKUP_KEY, DB: fakeD1(), RELEASES: fakeR2(), ...extra });
export const addUser = (env, email, sub, exempt = 0) => env.DB.raw.prepare('INSERT INTO users (sub,email,name,created_at,last_seen,login_count,exempt) VALUES (?,?,?,?,?,1,?)').run(sub, email, email, nowS(), nowS(), exempt);
export const sess = async (env, email, sub) => `ns_session=${await sign({ sub, email, name: 'X', iat: nowS(), exp: nowS() + 999 }, env.SESSION_SECRET)}`;
export const req = (path, { method = 'GET', body, raw, cookie, headers = {} } = {}) => new Request('https://horsepos.com' + path, {
  method, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body), headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers } });
export const web = { Origin: 'https://horsepos.com', 'X-Requested-With': 'fetch' };

// Mercado Pago simulado: suscripciones por mail.
export const PLAN = '6fe282d944ef4c018cb7904ce9e122f8';
export const mp = { subs: [], fail: false };
export const mpSub = (email, status, modifiedDaysAgo = 1) => ({ id: 'id_' + email, status, reason: 'x', payer_email: email, preapproval_plan_id: PLAN,
  auto_recurring: { transaction_amount: 35000, currency_id: 'ARS', frequency: 1, frequency_type: 'months' },
  date_created: new Date(Date.now() - 400 * 86400000).toISOString(), last_modified: new Date(Date.now() - modifiedDaysAgo * 86400000).toISOString() });
export const mockMP = () => { globalThis.fetch = async (url) => { const u = new URL(url);
  if (u.pathname === '/preapproval/search') { if (mp.fail) return new Response('x', { status: 500 });
    const em = u.searchParams.get('payer_email'); return new Response(JSON.stringify({ results: mp.subs.filter((s) => !em || s.payer_email === em) }), { status: 200 }); }
  return new Response('{}', { status: 404 }); }; };
