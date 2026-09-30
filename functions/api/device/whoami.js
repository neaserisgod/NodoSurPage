import { json } from '../../_lib/util.js';
import { currentUser } from '../../_lib/auth.js';

// La página /vincular/ pregunta con quién entró la persona antes de pedir confirmación.
export async function onRequestGet({ request, env }) {
  const cu = await currentUser(request, env);
  if (!cu.session || cu.gone) return json({ error: 'no_session' }, 401);
  return json({ email: cu.session.email, name: cu.session.name });
}
