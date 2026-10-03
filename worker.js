// Worker único del sitio: atiende /api/* (login, cuenta, admin) y el resto lo sirve como archivos estáticos.
// Además corre la limpieza diaria (cron). Ver wrangler.jsonc y README.
import * as google from './functions/api/auth/google.js';
import * as callback from './functions/api/auth/callback.js';
import * as logout from './functions/api/auth/logout.js';
import * as me from './functions/api/me.js';
import * as cancel from './functions/api/subscription/cancel.js';
import * as adminOverview from './functions/api/admin/overview.js';
import * as adminUser from './functions/api/admin/user.js';
import * as adminSubscription from './functions/api/admin/subscription.js';
import * as adminSweep from './functions/api/admin/sweep.js';
import * as checkout from './functions/api/checkout.js';
import * as download from './functions/api/download.js';
import * as downloads from './functions/api/downloads.js';
import * as updLatest from './functions/api/update/latest.js';
import * as updAppcast from './functions/api/update/appcast.js';
import * as updFile from './functions/api/update/file.js';
import * as adminReleases from './functions/api/admin/releases.js';
import * as deviceWhoami from './functions/api/device/whoami.js';
import * as deviceAuthorize from './functions/api/device/authorize.js';
import * as deviceToken from './functions/api/device/token.js';
import * as devicePing from './functions/api/device/ping.js';
import * as deviceMe from './functions/api/device/me.js';
import * as devicePcLocal from './functions/api/device/pc_local.js';
import * as mpConexion from './functions/api/mp/conexion.js';
import * as mpOrden from './functions/api/mp/orden.js';
import * as devices from './functions/api/devices.js';
import * as backup from './functions/api/backup.js';
import * as backups from './functions/api/backups.js';
import * as orgInvitations from './functions/api/org/invitations.js';
import * as orgMembers from './functions/api/org/members.js';
import * as orgBranches from './functions/api/org/branches.js';
import * as orgTransfer from './functions/api/org/transfer.js';
import * as orgBilling from './functions/api/org/billing.js';
import * as adminOrg from './functions/api/admin/org.js';
import * as sync from './functions/api/sync.js';
import * as promo from './functions/api/promo.js';
import * as adminPromo from './functions/api/admin/promo.js';
import { sweep } from './functions/_lib/sweep.js';
import { hasDB } from './functions/_lib/db.js';
import { purgeBackups, backupsReady } from './functions/_lib/backups.js';
import { backfillOrgs } from './functions/_lib/orgs.js';
import { listAllSubscribers } from './functions/_lib/mp.js';

export { SyncHub } from './functions/_lib/sync_hub.js';

const ROUTES = {
  'GET /api/auth/google': google.onRequestGet,
  'GET /api/auth/callback': callback.onRequestGet,
  'POST /api/auth/logout': logout.onRequestPost,
  'GET /api/me': me.onRequestGet,
  'POST /api/subscription/cancel': cancel.onRequestPost,
  'GET /api/admin/overview': adminOverview.onRequestGet,
  'POST /api/admin/user': adminUser.onRequestPost,
  'POST /api/admin/sweep': adminSweep.onRequestPost,
  'POST /api/admin/subscription': adminSubscription.onRequestPost,
  'GET /api/checkout': checkout.onRequestGet,
  'GET /api/device/whoami': deviceWhoami.onRequestGet,
  'POST /api/device/authorize': deviceAuthorize.onRequestPost,
  'POST /api/device/token': deviceToken.onRequestPost,
  'POST /api/device/ping': devicePing.onRequestPost,
  'GET /api/device/me': deviceMe.onRequestGet,
  'POST /api/device/pc-local': devicePcLocal.onRequestPost,
  'GET /api/device/pc-local': devicePcLocal.onRequestGet,
  'POST /api/device/revoke': devices.onRequestRevoke,
  'GET /api/devices': devices.onRequestGet,
  'PUT /api/backup': backup.onRequestPut,
  'GET /api/backup': backup.onRequestGet,
  'DELETE /api/backup': backup.onRequestDelete,
  'GET /api/backups': backups.onRequestGet,
  'GET /api/org/members': orgMembers.onRequestGet,
  'POST /api/org/member/update': orgMembers.onRequestUpdate,
  'POST /api/org/member/remove': orgMembers.onRequestRemove,
  'POST /api/org/invite': orgInvitations.onRequestPost,
  'GET /api/org/invitation': orgInvitations.onRequestGet,
  'POST /api/org/invite/revoke': orgInvitations.onRequestRevoke,
  'POST /api/org/accept': orgInvitations.onRequestAccept,
  'GET /api/org/branches': orgBranches.onRequestGet,
  'POST /api/org/branch': orgBranches.onRequestPost,
  'POST /api/org/branch/update': orgBranches.onRequestUpdate,
  'GET /api/org/transfer': orgTransfer.onRequestGet,
  'POST /api/org/transfer': orgTransfer.onRequestPost,
  'POST /api/org/transfer/accept': orgTransfer.onRequestAccept,
  'POST /api/org/transfer/decline': orgTransfer.onRequestDecline,
  'POST /api/org/transfer/cancel': orgTransfer.onRequestCancel,
  'GET /api/org/billing': orgBilling.onRequestGet,
  'POST /api/org/billing': orgBilling.onRequestPost,
  'POST /api/admin/org': adminOrg.onRequestPost,
  'GET /api/mp/estado': mpConexion.onRequestGet,
  'POST /api/mp/conectar': mpConexion.onRequestConnect,
  'GET /api/mp/callback': mpConexion.onRequestCallback,
  'POST /api/mp/desconectar': mpConexion.onRequestDisconnect,
  'GET /api/mp/terminales': mpConexion.onRequestTerminales,
  'POST /api/mp/terminal': mpConexion.onRequestElegirTerminal,
  'POST /api/mp/probar': mpConexion.onRequestProbar,
  'POST /api/mp/probar/cancelar': mpConexion.onRequestProbarCancelar,
  'POST /api/mp/orden': mpOrden.onRequestPost,
  'GET /api/mp/orden': mpOrden.onRequestGet,
  'POST /api/mp/orden/cancelar': mpOrden.onRequestCancelar,
  'POST /api/mp/imprimir': mpOrden.onRequestImprimir,
  'GET /api/mp/cobros': mpOrden.onRequestCobros,
  'GET /api/mp/actividad': mpConexion.onRequestActividad,
  'POST /api/sync': sync.onRequestPost,
  'GET /api/sync': sync.onRequestGet,
  'GET /api/sync/escuchar': sync.onRequestEscuchar,
  'GET /api/download': download.onRequestGet,
  'GET /api/downloads': downloads.onRequestGet,
  'GET /api/update/latest.json': updLatest.onRequestGet,
  'GET /api/update/appcast.xml': updAppcast.onRequestGet,
  'GET /api/update/file': updFile.onRequest,
  'HEAD /api/update/file': updFile.onRequest,
  'GET /api/admin/releases': adminReleases.onRequestGet,
  'POST /api/admin/releases': adminReleases.onRequestPost,
  'GET /api/promo': promo.onRequestGet,
  'POST /api/admin/promo': adminPromo.onRequestPost,
};
const NO_STORE = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    // El feed de actualizaciones apunta a /api/update/file/<nombre>.exe?id=N: WinSparkle guarda el instalador con el
    // último tramo de la dirección, y sin extensión Windows no sabe cómo ejecutarlo ("Abrir con"). El nombre es solo
    // decorativo: el archivo sale del id.
    const path = url.pathname.startsWith('/api/update/file/') ? '/api/update/file' : url.pathname;
    const handler = ROUTES[`${request.method} ${path}`];
    if (!handler) {
      const known = Object.keys(ROUTES).some((k) => k.endsWith(` ${path}`));
      return new Response(JSON.stringify({ error: known ? 'method_not_allowed' : 'not_found' }), { status: known ? 405 : 404, headers: NO_STORE });
    }
    try {
      return await handler({ request, env, ctx });
    } catch (e) {
      console.error('api_error', url.pathname, e && e.message);
      return new Response(JSON.stringify({ error: 'server' }), { status: 500, headers: NO_STORE });
    }
  },

  // Cron diario: avisa y limpia cuentas inactivas sin suscripción (apagado por defecto, ver README).
  async scheduled(_event, env, ctx) {
    if (!hasDB(env)) return;
    // Completa el negocio y la sucursal de lo que se vinculó/subió antes del modelo de negocios (idempotente).
    ctx.waitUntil(backfillOrgs(env).then((r) => (r.orgsCreadas || r.filasActualizadas) && console.log(`backfill_negocios:${r.orgsCreadas}:${r.filasActualizadas}`)).catch((e) => console.error('backfill_error', e && e.message)));
    if (!env.MP_ACCESS_TOKEN) return;
    if (backupsReady(env)) ctx.waitUntil(listAllSubscribers(env, { fresh: true }).then((subs) => purgeBackups(env, subs)).then((ids) => ids.length && console.log(`backups_purgadas:${ids.length}`)).catch(() => { /* sin Mercado Pago no se borra nada */ }));
    ctx.waitUntil(sweep(env, { apply: true }).then((r) =>
      console.log(JSON.stringify({ ok: r.ok, autoDelete: r.autoDelete, notifier: r.notifier, deletionNotices: r.deletionNotices, actions: (r.actions || []).map((a) => `${a.action}:${a.email}:${a.applied ?? ''}`) }))));
  },
};
