// Worker programado (Cron Trigger diario): avisa y elimina cuentas inactivas y sin suscripción.
// Comparte D1 y secretos con el sitio. Ver README.
import { sweep } from '../functions/_lib/sweep.js';

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil((async () => {
      const r = await sweep(env, { apply: true });
      console.log(JSON.stringify({ ok: r.ok, autoDelete: r.autoDelete, notifier: r.notifier, actions: r.actions.map((a) => `${a.action}:${a.email}:${a.applied ?? ''}`) }));
    })());
  },
};
