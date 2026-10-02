// Permisos del negocio: UN solo lugar donde se decide qué puede hacer cada rol. Ningún endpoint ni página
// compara roles a mano: todos preguntan acá, así cambiar un permiso (se van a ajustar más adelante) es tocar
// esta tabla y nada más.
//
// Dos clases de acción:
//  * de negocio (facturación, miembros, sucursales, vincular PC, transferir la propiedad): no dependen de la sucursal.
//  * de sucursal (operar, descargar, copias): hay que indicar en cuál, y la persona tiene que tener esa
//    sucursal asignada (o `all_branches`). Un empleado solo ve lo de su sucursal.
export const ROLES = ['owner', 'manager', 'employee'];
export const ACCIONES = ['facturacion', 'miembros', 'sucursales', 'vincular_pc', 'transferir', 'descargar', 'copias', 'operar', 'vincular_celular', 'mercadopago'];

const DE_NEGOCIO = new Set(['facturacion', 'miembros', 'sucursales', 'vincular_pc', 'transferir', 'mercadopago']);

// Qué acciones permite cada rol. El dueño tiene todas.
const POR_ROL = {
  owner: new Set(ACCIONES),
  manager: new Set(['descargar', 'copias', 'operar', 'vincular_celular']),
  // El celular es personal: cada quien lo vincula con SU cuenta, en SU sucursal, y ahí queda su perfil (no hay selector).
  employee: new Set(['operar', 'vincular_celular']),
};

// `miembro` = { role, all_branches, branches: [ids] } (lo que devuelve getMembership). `sucursalId` solo para
// acciones de sucursal. Ante cualquier dato raro, se niega.
export function puede(miembro, accion, sucursalId) {
  if (!miembro || !POR_ROL[miembro.role] || !ACCIONES.includes(accion)) return false;
  if (!POR_ROL[miembro.role].has(accion)) return false;
  if (miembro.role === 'owner' || DE_NEGOCIO.has(accion)) return true;
  if (miembro.all_branches) return true;
  // Sin sucursal indicada no se asume "todas": un permiso por sucursal siempre se pregunta por una.
  return sucursalId !== undefined && sucursalId !== null && (miembro.branches || []).includes(Number(sucursalId));
}

// ¿Puede hacer esta acción en AL MENOS una sucursal? Sirve para lo que no es de una sucursal en particular
// (por ejemplo descargar el instalador). Sin sucursales asignadas no puede nada de sucursal.
export function puedeEnAlguna(miembro, accion) {
  if (!miembro || !POR_ROL[miembro.role] || !ACCIONES.includes(accion) || !POR_ROL[miembro.role].has(accion)) return false;
  if (miembro.role === 'owner' || DE_NEGOCIO.has(accion) || miembro.all_branches) return true;
  return (miembro.branches || []).length > 0;
}

// Todo lo que puede hacer en al menos una sucursal: { facturacion: true, operar: false, ... }. Las pantallas lo usan
// para mostrar u ocultar secciones sin repetir la tabla de arriba.
export const permisosDe = (miembro) => Object.fromEntries(ACCIONES.map((a) => [a, puedeEnAlguna(miembro, a)]));
