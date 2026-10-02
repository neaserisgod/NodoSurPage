import assert from 'node:assert/strict';
import { puede, ROLES, ACCIONES } from '../functions/_lib/permisos.js';

let pass = 0; const t = (n, f) => { f(); pass++; console.log('ok  ', n); };
const m = (role, { all = 0, branches = [] } = {}) => ({ role, all_branches: all, branches });

t('hay tres roles y un conjunto cerrado de acciones', () => {
  assert.deepEqual([...ROLES].sort(), ['employee', 'manager', 'owner']);
  assert.ok(ACCIONES.includes('facturacion') && ACCIONES.includes('operar'));
});
t('el dueño puede todo, en cualquier sucursal, sin importar la lista', () => {
  for (const a of ACCIONES) assert.equal(puede(m('owner'), a, 99), true, a);
});
t('acciones de negocio (facturación, miembros, sucursales, vincular PC): solo el dueño', () => {
  for (const a of ['facturacion', 'miembros', 'sucursales', 'vincular_pc']) {
    assert.equal(puede(m('manager', { all: 1 }), a), false, a);
    assert.equal(puede(m('employee', { all: 1 }), a), false, a);
  }
});
t('encargado: descarga, ve copias y opera, pero solo en sus sucursales', () => {
  const enc = m('manager', { branches: [1] });
  for (const a of ['descargar', 'copias', 'operar']) {
    assert.equal(puede(enc, a, 1), true, a);
    assert.equal(puede(enc, a, 2), false, a + ' en otra sucursal');
  }
});
t('empleado: solo opera, y solo en su sucursal; no descarga ni ve copias', () => {
  const emp = m('employee', { branches: [3] });
  assert.equal(puede(emp, 'operar', 3), true);
  assert.equal(puede(emp, 'operar', 4), false);
  assert.equal(puede(emp, 'descargar', 3), false);
  assert.equal(puede(emp, 'copias', 3), false);
});
t('all_branches abre todas las sucursales (pero no cambia lo que el rol permite)', () => {
  assert.equal(puede(m('manager', { all: 1 }), 'copias', 7), true);
  assert.equal(puede(m('employee', { all: 1 }), 'copias', 7), false);
});
t('una acción por sucursal sin indicar sucursal se niega (no se asume "todas")', () => {
  assert.equal(puede(m('employee', { branches: [1] }), 'operar'), false);
});
t('entradas inválidas se niegan: sin membresía, rol raro, acción desconocida', () => {
  assert.equal(puede(null, 'operar', 1), false);
  assert.equal(puede(m('jefe', { all: 1 }), 'operar', 1), false);
  assert.equal(puede(m('owner'), 'volar', 1), false);
});
console.log(`${pass} pruebas de permisos ok`);
