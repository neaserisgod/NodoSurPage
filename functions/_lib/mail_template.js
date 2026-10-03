// Plantilla de los mails de Nodo Sur (invitaciones, transferencias, avisos). Un solo diseño para todos: tarjeta blanca sobre fondo
// gris, marca arriba, un botón claro y la versión de texto plano (que es la que ven los clientes de mail que bloquean el HTML).
//
// Pensada para que se vea igual en Gmail, Outlook y el celular: tablas y estilos en línea (los clientes de mail ignoran casi todo
// el CSS), el botón es un enlace con relleno (no una imagen) y la marca está armada con HTML, sin imágenes que se puedan bloquear.
// Todo lo que viene de personas (nombres de negocio, de quien invita) se escapa: nunca entra HTML ajeno al mail.
const TINTA = '#121317', GRIS = '#566070', SUAVE = '#7b8494', FONDO = '#f3f4f7', LINEA = '#e4e6ec', AZUL = '#2f5fe0', VERDE = '#34a853';
const FUENTE = "Figtree,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Solo enlaces http(s): un `javascript:` o un dato raro nunca llega a un href.
const urlSegura = (u) => (/^https?:\/\/[^\s"'<>]+$/.test(String(u || '')) ? String(u) : null);

// opciones: { preheader, titulo, intro, filas: [[etiqueta, valor]], boton: { texto, url }, nota, sitio }
export function plantillaMail({ preheader = '', titulo, intro = '', filas = [], boton = null, nota = '', sitio = 'https://horsepos.com' }) {
  const url = boton && urlSegura(boton.url);
  const web = urlSegura(sitio) || 'https://horsepos.com';
  const marca = `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td width="40" height="40" align="center" valign="middle" bgcolor="${TINTA}" style="width:40px;height:40px;border-radius:12px;background:#1f1f1f;color:#ffffff;font:800 16px/40px ${FUENTE};letter-spacing:-.4px">NS<span style="color:${VERDE}">&#8226;</span></td>
      <td style="padding-left:12px;font:700 20px/1 ${FUENTE};letter-spacing:-.02em;color:${TINTA}">Nodo Sur</td></tr></table>`;
  const datos = filas.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 4px;border:1px solid ${LINEA};border-radius:14px">${
    filas.map(([k, v], i) => `<tr><td style="padding:12px 16px;${i ? `border-top:1px solid ${LINEA};` : ''}font:600 13px/1.4 ${FUENTE};color:${SUAVE};width:34%">${esc(k)}</td>
      <td style="padding:12px 16px;${i ? `border-top:1px solid ${LINEA};` : ''}font:500 15px/1.4 ${FUENTE};color:${TINTA}">${esc(v)}</td></tr>`).join('')}</table>` : '';
  const cta = url ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 6px"><tr>
      <td align="center" bgcolor="${TINTA}" style="border-radius:12px"><a href="${esc(url)}" style="display:inline-block;padding:14px 26px;font:600 16px/1 ${FUENTE};color:#ffffff;text-decoration:none;border-radius:12px;background:${TINTA}">${esc(boton.texto)}</a></td></tr></table>
    <p style="margin:12px 0 0;font:400 13px/1.5 ${FUENTE};color:${SUAVE}">Si el botón no anda, copiá este enlace en tu navegador:<br><a href="${esc(url)}" style="color:${AZUL};word-break:break-all">${esc(url)}</a></p>` : '';
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${esc(titulo)}</title></head>
<body style="margin:0;padding:0;background:${FONDO};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(preheader || titulo)}&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${FONDO}" style="background:${FONDO}"><tr><td align="center" style="padding:28px 14px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">
    <tr><td style="padding:0 6px 18px">${marca}</td></tr>
    <tr><td bgcolor="#ffffff" style="background:#ffffff;border-radius:22px;padding:34px 30px;font-family:${FUENTE}">
      <h1 style="margin:0 0 14px;font:600 26px/1.2 ${FUENTE};letter-spacing:-.03em;color:${TINTA}">${esc(titulo)}</h1>
      ${intro ? `<p style="margin:0;font:400 16px/1.6 ${FUENTE};color:${GRIS}">${esc(intro)}</p>` : ''}
      ${datos}${cta}
      ${nota ? `<p style="margin:26px 0 0;padding-top:18px;border-top:1px solid ${LINEA};font:400 14px/1.6 ${FUENTE};color:${GRIS}">${esc(nota)}</p>` : ''}
    </td></tr>
    <tr><td style="padding:20px 8px 0;font:400 12px/1.6 ${FUENTE};color:${SUAVE};text-align:center">Nodo Sur · Bariloche, Río Negro<br><a href="${esc(web)}" style="color:${SUAVE}">${esc(web.replace(/^https?:\/\//, ''))}</a></td></tr>
  </table>
</td></tr></table></body></html>`;
  const text = [titulo, '', intro, ...(filas.length ? ['', ...filas.map(([k, v]) => `${k}: ${v}`)] : []), ...(url ? ['', `${boton.texto}: ${url}`] : []), ...(nota ? ['', nota] : []), '', 'Nodo Sur · Bariloche, Río Negro', web]
    .filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n');
  return { html, text };
}
