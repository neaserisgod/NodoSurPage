import { json } from '../../_lib/util.js';
import { currentUser } from '../../_lib/auth.js';
import { hasDB } from '../../_lib/db.js';
import { membershipsOf, orgsWith, describirOrgs } from '../../_lib/orgs.js';

// La página /vincular/ pregunta con quién entró la persona antes de pedir confirmación, y a qué negocio y sucursal
// puede vincular la PC (solo el dueño vincula). Quien todavía no tiene ningún negocio puede vincular: se le crea el suyo.
// Con `?tipo=celular` se ofrece lo que puede vincular un CELULAR: cada miembro (empleado, encargado o dueño) puede, en las
// sucursales que tiene asignadas. La PC sigue siendo solo del dueño. Con `?tipo=bot`, el bot de WhatsApp: dueño o encargado.
export async function onRequestGet({ request, env }) {
  const cu = await currentUser(request, env);
  if (!cu.session || cu.gone) return json({ error: 'no_session' }, 401);
  const tipo = new URL(request.url).searchParams.get('tipo');
  const celular = tipo === 'celular', bot = tipo === 'bot';
  let orgs = [], canLink = true;
  if (hasDB(env)) {
    orgs = await describirOrgs(env, (await orgsWith(env, cu.session.sub, bot ? 'configurar_bot' : celular ? 'vincular_celular' : 'vincular_pc')).map((x) => x.membership));
    // El bot de WhatsApp se vincula a un negocio que ya existe (dueño o encargado): no crea uno.
    canLink = orgs.length > 0 || (!bot && (await membershipsOf(env, cu.session.sub)).length === 0);
  }
  return json({ email: cu.session.email, name: cu.session.name, canLink, orgs: orgs.map((o) => ({ id: o.id, name: o.name, branches: o.branches })) });
}
