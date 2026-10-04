import { siteUrl } from '../../_lib/util.js';
import { PLATFORMS, CHANNELS, hasR2, latestForUpdate, urlArchivo } from '../../_lib/releases.js';
import { hasDB } from '../../_lib/db.js';
import { cidIsPrivileged } from '../../_lib/devices.js';

const esc = (s) => String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
const xml = (body, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'no-store' } });
const sparkleVersion = (v) => String(v).replace('+', '.');
const head = '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel><title>Nodo Sur</title>';

// Feed en formato Sparkle / WinSparkle (paquete auto_updater de Flutter para Windows y macOS).
//   /api/update/appcast.xml?platform=windows|macos|linux&channel=stable&cid=<id de instalación>
export async function onRequestGet({ request, env }) {
  const q = new URL(request.url).searchParams;
  const platform = q.get('platform'), channel = q.get('channel') || 'stable';
  const cid = (q.get('cid') || '').slice(0, 64);
  if (!PLATFORMS.includes(platform) || !CHANNELS.includes(channel)) return xml('<error>bad_request</error>', 400);
  if (!hasDB(env) || !hasR2(env)) return xml(head + '</channel></rss>');
  const r = await latestForUpdate(env, platform, channel, null, cid, { conBeta: await cidIsPrivileged(env, cid) });
  if (!r) return xml(head + '</channel></rss>');
  const os = platform === 'macos' ? 'macos' : platform;
  // La dirección termina en un nombre con extensión (la del archivo publicado): sin eso, WinSparkle guarda el
  // instalador como "file" y Windows no lo puede ejecutar.
  const ext = (String(r.file_key || '').match(/\.([A-Za-z0-9]{2,5})$/) || [])[0] || ({ windows: '.exe', macos: '.dmg', linux: '.AppImage' }[platform] || '');
  const url = await urlArchivo(env, `${siteUrl(env)}/api/update/file/NodoSurPOS-Actualizacion${ext}?id=${r.id}`, r);
  const item = `<item><title>Versión ${esc(r.version)}</title><pubDate>${new Date(r.published_at * 1000).toUTCString()}</pubDate>`
    + `<sparkle:version>${esc(sparkleVersion(r.version))}</sparkle:version><sparkle:shortVersionString>${esc(String(r.version).split('+')[0])}</sparkle:shortVersionString>`
    + (r.mandatory ? '<sparkle:criticalUpdate></sparkle:criticalUpdate>' : '')
    + (r.notes ? `<description><![CDATA[${String(r.notes).replace(/]]>/g, ']]]]><![CDATA[>')}]]></description>` : '')
    + `<enclosure url="${esc(url)}" length="${r.size}" type="application/octet-stream" sparkle:os="${os}"${r.signature ? ` sparkle:${r.sig_type === 'dsa' ? 'dsaSignature' : 'edSignature'}="${esc(r.signature)}"` : ''}/></item>`;
  return xml(head + item + '</channel></rss>');
}
