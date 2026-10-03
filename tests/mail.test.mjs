// Plantilla de los mails: un diseño para todos, nada de HTML ajeno, enlaces solo http(s) y versión de texto completa.
import assert from 'node:assert/strict';
import { plantillaMail, esc } from '../functions/_lib/mail_template.js';
import { sendInvitation, sendTransferNotice, sendDeletionNotice } from '../functions/_lib/notify.js';

let pass = 0; const t = async (n, f) => { await f(); pass++; console.log('ok  ', n); };
const ENV = { RESEND_API_KEY: 'k', MAIL_FROM: 'Nodo Sur <hola@avisos.horsepos.com>', SITE_URL: 'https://horsepos.com' };
const enviados = [];
const mock = () => { enviados.length = 0; globalThis.fetch = async (url, init = {}) => { if (new URL(url).host === 'api.resend.com') { enviados.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); } return new Response('{}', { status: 404 }); }; };

await t('plantilla: título, datos, botón con su enlace y pie; el texto plano trae lo mismo', () => {
  const { html, text } = plantillaMail({ titulo: 'Te invitaron', intro: 'Hola', filas: [['Negocio', 'La Plazoleta']], boton: { texto: 'Aceptar', url: 'https://horsepos.com/unirse/?t=abc' }, nota: 'Vence en 7 días' });
  assert.match(html, /<h1[^>]*>Te invitaron<\/h1>/); assert.match(html, /La Plazoleta/); assert.match(html, /href="https:\/\/horsepos\.com\/unirse\/\?t=abc"[^>]*>Aceptar</);
  assert.match(html, /lang="es"/); assert.match(html, /name="viewport"/);
  for (const frag of ['Te invitaron', 'Negocio: La Plazoleta', 'Aceptar: https://horsepos.com/unirse/?t=abc', 'Vence en 7 días']) assert.ok(text.includes(frag), frag);
});
await t('plantilla: lo que escriben las personas se escapa y un enlace raro no llega a un href', () => {
  const sucio = '<script>alert(1)</script> "x" & <img src=x onerror=1>';
  const { html } = plantillaMail({ titulo: sucio, intro: sucio, filas: [[sucio, sucio]], boton: { texto: sucio, url: 'javascript:alert(1)' }, nota: sucio });
  assert.ok(!/<script|<img/i.test(html), 'ningún tag ajeno'); assert.ok(!html.includes('javascript:'), 'sin enlace javascript:');
  assert.equal(esc(`<a href="x">'&</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&lt;/a&gt;');
  assert.equal((html.match(/<a /g) || []).length, 1, 'solo el enlace del pie: sin botón si la URL no sirve');
});
await t('plantilla: sin imágenes ni recursos externos que un cliente de mail pueda bloquear', () => {
  const { html } = plantillaMail({ titulo: 'x', boton: { texto: 'Ir', url: 'https://horsepos.com/' } });
  assert.ok(!/<img|<link|<script|url\(/i.test(html));
});
await t('los tres mails salen con html y texto, con el diseño de la plantilla y sus enlaces', async () => {
  mock();
  assert.equal(await sendInvitation(ENV, { to: 'emp@x.com', orgName: 'La Plazoleta', inviterName: 'Bruno', link: 'https://horsepos.com/unirse/?t=abc', role: 'employee' }), true);
  assert.equal(await sendTransferNotice(ENV, { to: 'otra@x.com', orgName: 'La Plazoleta', fromName: 'Bruno', site: 'https://horsepos.com' }), true);
  assert.equal(await sendDeletionNotice(ENV, { email: 'x@x.com', name: 'Ana Gómez' }, Math.floor(Date.now() / 1000) + 3 * 86400), true);
  assert.equal(enviados.length, 3);
  for (const m of enviados) { assert.ok(m.html.startsWith('<!doctype html>') && m.text.length > 40 && m.subject && m.from === ENV.MAIL_FROM); assert.ok(m.html.includes('Nodo Sur')); }
  assert.ok(enviados[0].html.includes('/unirse/?t=abc') && enviados[0].text.includes('/unirse/?t=abc') && enviados[0].text.includes('La Plazoleta'));
  assert.ok(enviados[1].html.includes('https://horsepos.com/negocio/')); assert.ok(enviados[2].html.includes('/ingresar/') && enviados[2].text.includes('Ana'));
});
await t('sin RESEND_API_KEY y MAIL_FROM no se manda nada (como antes)', async () => {
  mock(); assert.equal(await sendInvitation({}, { to: 'a@b.c', orgName: 'x', link: 'https://horsepos.com/u', role: 'manager' }), false); assert.equal(enviados.length, 0);
});
console.log(`\n${pass} pruebas OK (mails)`);
