import { now, siteUrl } from '../_lib/util.js';
import { currentUser } from '../_lib/auth.js';
import { downloadAccess } from '../_lib/access.js';
import { PLATFORMS, hasR2, latestForInstall, logDownload, streamRelease } from '../_lib/releases.js';
import { hasDB } from '../_lib/db.js';

const go = (l) => new Response(null, { status: 302, headers: { Location: l, 'Cache-Control': 'no-store' } });

// Descarga del instalador: solo con sesión y suscripción vigente (o cuenta eximida / administrador).
//   /api/download?platform=windows|macos|linux|android[&channel=beta]   (beta: solo administradores y cuentas eximidas)
export async function onRequestGet({ request, env }) {
  const site = siteUrl(env);
  const q = new URL(request.url).searchParams;
  const platform = q.get('platform');
  if (!PLATFORMS.includes(platform)) return go(`${site}/descargar/`);

  const cu = await currentUser(request, env);
  if (!cu.session || cu.gone) return go(`${site}/ingresar/`);
  const acc = await downloadAccess(env, cu);
  if (!acc.ok) return go(`${site}/descargar/?e=${acc.reason}`);

  const channel = q.get('channel') === 'beta' && acc.privileged ? 'beta' : 'stable';
  if (!hasDB(env) || !hasR2(env)) return go(`${site}/descargar/?e=no_disponible`);
  const rel = await latestForInstall(env, platform, channel);
  if (!rel) return go(`${site}/descargar/?e=no_disponible`);

  // Se registra solo el inicio de la descarga (no los pedidos parciales de continuación).
  if (cu.user && !request.headers.get('Range')) await logDownload(env, cu.user.id, rel.id, now()).catch(() => {});
  return streamRelease(env, request, rel, { attachment: true });
}
