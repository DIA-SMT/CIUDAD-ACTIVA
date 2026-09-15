// Pruebas de integracion contra el servidor real.
//
// Levanta el servidor como proceso aparte, sobre una base temporal recien
// sembrada, y le pega por HTTP. No hay mocks: lo que pasa la prueba es el
// sistema tal como corre en produccion.
//
//   npm test

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUERTO = 3917;
const BASE_URL = `http://127.0.0.1:${PUERTO}`;
const PASSWORD = 'ciudadactiva2026';

const dirTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ciudad-activa-test-'));
const rutaDB = path.join(dirTmp, 'prueba.db');

const entorno = {
  ...process.env,
  PORT: String(PUERTO),
  DB_PATH: rutaDB,
  SESSION_SECRET: 'clave-de-prueba',
  SEED_PASSWORD: PASSWORD,
  NODE_ENV: 'test',
};

let servidor;

// --- ayudas ------------------------------------------------------------------

function crearCliente() {
  let cookie = '';
  return async function pedir(metodo, ruta, cuerpo) {
    const r = await fetch(BASE_URL + ruta, {
      method: metodo,
      headers: {
        ...(cuerpo === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      redirect: 'manual',
    });
    const set = r.headers.getSetCookie?.() ?? [];
    for (const c of set) {
      const par = c.split(';')[0];
      if (par.startsWith('ca_sesion=')) cookie = par;
    }
    const tipo = r.headers.get('content-type') || '';
    if (tipo.includes('json')) {
      return { estado: r.status, datos: await r.json().catch(() => null), headers: r.headers };
    }
    // Se lee como bytes y se decodifica a mano: Response.text() aplica el
    // "UTF-8 decode" del estandar, que se come el BOM, y el BOM es justamente
    // lo que hay que verificar en la exportacion a CSV.
    const bytes = Buffer.from(await r.arrayBuffer());
    return { estado: r.status, datos: bytes.toString('utf8'), bytes, headers: r.headers };
  };
}

async function esperarServidor(intentos = 60) {
  for (let i = 0; i < intentos; i += 1) {
    try {
      const r = await fetch(`${BASE_URL}/api/salud`);
      if (r.ok) return;
    } catch { /* todavia no levanto */ }
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error('El servidor no respondio a tiempo en /api/salud');
}

before(async () => {
  const semilla = spawnSync(process.execPath, ['--no-warnings', 'src/db/seed.js', '--reset'],
    { cwd: RAIZ, env: entorno, encoding: 'utf8' });
  assert.equal(semilla.status, 0, `Fallo la carga inicial:\n${semilla.stdout}\n${semilla.stderr}`);

  servidor = spawn(process.execPath, ['--no-warnings', 'src/server.js'],
    { cwd: RAIZ, env: entorno, stdio: ['ignore', 'pipe', 'pipe'] });
  let salida = '';
  servidor.stdout.on('data', (d) => { salida += d; });
  servidor.stderr.on('data', (d) => { salida += d; });
  servidor.on('exit', (code) => {
    if (code !== 0 && code !== null) console.error(`Servidor termino con codigo ${code}:\n${salida}`);
  });

  await esperarServidor();
});

after(() => {
  servidor?.kill();
  try { fs.rmSync(dirTmp, { recursive: true, force: true }); } catch { /* ya no esta */ }
});

// --- salud y sesion ----------------------------------------------------------

test('GET /api/salud responde sin sesion', async () => {
  const c = crearCliente();
  const { estado, datos } = await c('GET', '/api/salud');
  assert.equal(estado, 200);
  assert.equal(datos.ok, true);
  assert.equal(datos.registros, 20, 'la carga inicial deja 20 registros de muestra');
});

test('sin sesion, la API responde 401', async () => {
  const c = crearCliente();
  assert.equal((await c('GET', '/api/auth/sesion')).estado, 401);
  assert.equal((await c('GET', '/api/registros')).estado, 401);
  assert.equal((await c('GET', '/api/estadisticas/resumen')).estado, 401);
  assert.equal((await c('GET', '/api/catalogos')).estado, 401);
});

test('login rechaza credenciales incorrectas sin revelar si el usuario existe', async () => {
  const c = crearCliente();
  const inexistente = await c('POST', '/api/auth/login', { usuario: 'no.existe', password: 'x' });
  const malPass = await c('POST', '/api/auth/login', { usuario: 'admin', password: 'incorrecta' });
  assert.equal(inexistente.estado, 401);
  assert.equal(malPass.estado, 401);
  assert.equal(inexistente.datos.error, malPass.datos.error,
    'el mensaje debe ser identico en ambos casos');
});

test('login funciona con nombre de usuario y con correo', async () => {
  const porUsuario = crearCliente();
  const a = await porUsuario('POST', '/api/auth/login', { usuario: 'admin', password: PASSWORD });
  assert.equal(a.estado, 200);
  assert.equal(a.datos.usuario.rol, 'admin');
  assert.ok(!('password_hash' in a.datos.usuario), 'nunca se devuelve el hash');

  const porCorreo = crearCliente();
  const b = await porCorreo('POST', '/api/auth/login', {
    usuario: 'deportes@smt.gob.ar', password: PASSWORD,
  });
  assert.equal(b.estado, 200);
});

// --- catalogos: REQ 2 y REQ 3 -------------------------------------------------

test('los catalogos traen los profesores autorizados y los espacios definidos', async () => {
  const c = crearCliente();
  await c('POST', '/api/auth/login', { usuario: 'admin', password: PASSWORD });
  const { estado, datos } = await c('GET', '/api/catalogos');

  assert.equal(estado, 200);
  assert.equal(datos.profesores.length, 11, 'los 11 profesores de la planilla');
  assert.equal(datos.lugares.length, 11, 'los 11 espacios de la planilla');
  assert.equal(datos.estados.length, 4);
  assert.ok(datos.estados.some((e) => e.es_suspension === 1 || e.es_suspension === true));
  assert.ok(datos.lugares.some((l) => l.nombre === 'Plaza Urquiza'));
});

// --- REQ 4: validacion --------------------------------------------------------

async function sesionAdmin() {
  const c = crearCliente();
  await c('POST', '/api/auth/login', { usuario: 'admin', password: PASSWORD });
  const { datos } = await c('GET', '/api/catalogos');
  return { c, cat: datos };
}

test('REQ 4: rechaza cuando varones + mujeres no coincide con el total', async () => {
  const { c, cat } = await sesionAdmin();
  const { estado, datos } = await c('POST', '/api/registros', {
    fecha: '2026-09-10',
    profesor_id: cat.profesores[0].id,
    lugar_id: cat.lugares[0].id,
    estado_codigo: 'normal',
    alumnos_total: 50, varones: 10, mujeres: 30, alumnos_nuevos: 0,
    observaciones: 'prueba', email_responsable: 'prueba@smt.gob.ar',
  });
  assert.equal(estado, 422);
  assert.ok(datos.errores?.alumnos_total, 'el error tiene que venir apuntado al campo');
  assert.match(datos.errores.alumnos_total, /40|coincid/i);
});

test('REQ 4: rechaza negativos, fecha futura y alumnos nuevos mayores al total', async () => {
  const { c, cat } = await sesionAdmin();
  const base = {
    profesor_id: cat.profesores[0].id, lugar_id: cat.lugares[0].id,
    estado_codigo: 'normal', email_responsable: 'prueba@smt.gob.ar', observaciones: '',
  };

  const negativo = await c('POST', '/api/registros', {
    ...base, fecha: '2026-09-10', alumnos_total: 10, varones: -1, mujeres: 11, alumnos_nuevos: 0,
  });
  assert.equal(negativo.estado, 422);

  const futura = await c('POST', '/api/registros', {
    ...base, fecha: '2099-01-01', alumnos_total: 10, varones: 5, mujeres: 5, alumnos_nuevos: 0,
  });
  assert.equal(futura.estado, 422);
  assert.ok(futura.datos.errores?.fecha);

  const nuevos = await c('POST', '/api/registros', {
    ...base, fecha: '2026-09-10', alumnos_total: 10, varones: 5, mujeres: 5, alumnos_nuevos: 99,
  });
  assert.equal(nuevos.estado, 422);
  assert.ok(nuevos.datos.errores?.alumnos_nuevos);
});

test('REQ 2 y 3: rechaza profesores y lugares fuera del listado', async () => {
  const { c, cat } = await sesionAdmin();
  const comun = {
    fecha: '2026-09-10', estado_codigo: 'normal', alumnos_total: 10,
    varones: 5, mujeres: 5, alumnos_nuevos: 0, observaciones: '',
    email_responsable: 'prueba@smt.gob.ar',
  };
  const profesor = await c('POST', '/api/registros', { ...comun, profesor_id: 99999, lugar_id: cat.lugares[0].id });
  assert.equal(profesor.estado, 422);
  assert.ok(profesor.datos.errores?.profesor_id);

  const lugar = await c('POST', '/api/registros', { ...comun, profesor_id: cat.profesores[0].id, lugar_id: 99999 });
  assert.equal(lugar.estado, 422);
  assert.ok(lugar.datos.errores?.lugar_id);
});

// --- alta, duplicados e historial ---------------------------------------------

test('alta valida, aviso de duplicado y confirmacion explicita', async () => {
  const { c, cat } = await sesionAdmin();
  const registro = {
    fecha: '2026-09-11',
    profesor_id: cat.profesores[0].id,
    lugar_id: cat.lugares[0].id,
    estado_codigo: 'normal',
    alumnos_total: 42, varones: 2, mujeres: 40, alumnos_nuevos: 3,
    observaciones: 'Clase de prueba automatizada',
    email_responsable: 'prueba@smt.gob.ar',
  };

  const alta = await c('POST', '/api/registros', registro);
  assert.equal(alta.estado, 201);
  assert.equal(alta.datos.registro.alumnos_total, 42);
  assert.equal(alta.datos.registro.lugar_nombre, cat.lugares[0].nombre);

  const duplicado = await c('POST', '/api/registros', registro);
  assert.equal(duplicado.estado, 409, 'mismo dia, profesor y lugar debe avisar');
  assert.ok(Array.isArray(duplicado.datos.duplicados) && duplicado.datos.duplicados.length >= 1);

  const confirmado = await c('POST', '/api/registros', { ...registro, confirmar_duplicado: true });
  assert.equal(confirmado.estado, 201, 'con confirmacion se graba igual');
});

test('REQ 6: la edicion deja una fila de historial por campo modificado', async () => {
  const { c, cat } = await sesionAdmin();
  const alta = await c('POST', '/api/registros', {
    fecha: '2026-09-12',
    profesor_id: cat.profesores[1].id,
    lugar_id: cat.lugares[1].id,
    estado_codigo: 'normal',
    alumnos_total: 20, varones: 5, mujeres: 15, alumnos_nuevos: 1,
    observaciones: 'Original', email_responsable: 'prueba@smt.gob.ar',
  });
  assert.equal(alta.estado, 201);
  const id = alta.datos.registro.id;

  const edicion = await c('PUT', `/api/registros/${id}`, {
    fecha: '2026-09-12',
    profesor_id: cat.profesores[1].id,
    lugar_id: cat.lugares[2].id,
    estado_codigo: 'normal',
    alumnos_total: 30, varones: 10, mujeres: 20, alumnos_nuevos: 1,
    observaciones: 'Corregido', email_responsable: 'prueba@smt.gob.ar',
  });
  assert.equal(edicion.estado, 200);

  const { estado, datos } = await c('GET', `/api/registros/${id}/historial`);
  assert.equal(estado, 200);
  const h = datos.historial;
  assert.ok(h.some((x) => x.accion === 'creacion'), 'el alta deja asiento');

  const modificados = h.filter((x) => x.accion === 'modificacion').map((x) => x.campo);
  for (const campo of ['lugar_id', 'alumnos_total', 'varones', 'mujeres', 'observaciones']) {
    assert.ok(modificados.includes(campo), `falta el asiento del campo ${campo}`);
  }
  assert.ok(!modificados.includes('fecha'), 'no debe asentar campos que no cambiaron');

  const lugar = h.find((x) => x.campo === 'lugar_id');
  assert.ok(!/^\d+$/.test(String(lugar.valor_nuevo)),
    'el historial guarda el nombre legible del lugar, no el id');
});

// --- REQ 6: permisos ----------------------------------------------------------

test('REQ 6: un profesor no puede cargar a nombre de otro ni eliminar', async () => {
  const { cat } = await sesionAdmin();
  const p = crearCliente();
  const login = await p('POST', '/api/auth/login', { usuario: 'carrizo.eugenia', password: PASSWORD });
  assert.equal(login.estado, 200);
  const yo = login.datos.usuario.id;
  const otro = cat.profesores.find((x) => x.id !== yo);

  const ajeno = await p('POST', '/api/registros', {
    fecha: '2026-09-13', profesor_id: otro.id, lugar_id: cat.lugares[0].id,
    estado_codigo: 'normal', alumnos_total: 10, varones: 5, mujeres: 5,
    alumnos_nuevos: 0, observaciones: '', email_responsable: 'prueba@smt.gob.ar',
  });
  assert.ok([403, 422].includes(ajeno.estado), `esperaba 403 o 422, vino ${ajeno.estado}`);

  const propio = await p('POST', '/api/registros', {
    fecha: '2026-09-13', profesor_id: yo, lugar_id: cat.lugares[0].id,
    estado_codigo: 'normal', alumnos_total: 10, varones: 5, mujeres: 5,
    alumnos_nuevos: 0, observaciones: '', email_responsable: 'prueba@smt.gob.ar',
  });
  assert.equal(propio.estado, 201, 'a su nombre si puede');

  const borrado = await p('DELETE', `/api/registros/${propio.datos.registro.id}`);
  assert.equal(borrado.estado, 403, 'un profesor no elimina');

  const gestion = await p('GET', '/api/admin/usuarios');
  assert.equal(gestion.estado, 403, 'un profesor no entra a gestion');
});

test('REQ 6: el administrador elimina y queda asentado', async () => {
  const { c, cat } = await sesionAdmin();
  const alta = await c('POST', '/api/registros', {
    fecha: '2026-09-14', profesor_id: cat.profesores[2].id, lugar_id: cat.lugares[3].id,
    estado_codigo: 'normal', alumnos_total: 8, varones: 3, mujeres: 5,
    alumnos_nuevos: 0, observaciones: 'A eliminar', email_responsable: 'prueba@smt.gob.ar',
  });
  const id = alta.datos.registro.id;

  assert.equal((await c('DELETE', `/api/registros/${id}`)).estado, 200);
  assert.equal((await c('GET', `/api/registros/${id}`)).estado, 404);

  const { datos } = await c('GET', '/api/admin/historial', undefined);
  assert.ok(datos.datos.some((x) => x.accion === 'eliminacion'),
    'la baja queda en la auditoria global');
});

// --- REQ 7: indicadores -------------------------------------------------------

test('REQ 7: el resumen es internamente coherente', async () => {
  const { c } = await sesionAdmin();
  const { estado, datos: r } = await c('GET', '/api/estadisticas/resumen');
  assert.equal(estado, 200);

  assert.equal(r.clases_registradas, r.clases_realizadas + r.clases_suspendidas,
    'realizadas + suspendidas debe dar el total registrado');
  assert.equal(r.varones + r.mujeres, r.alumnos_total,
    'la distribucion por sexo debe cerrar con el total de alumnos');

  for (const [k, v] of Object.entries(r)) {
    if (typeof v === 'number') assert.ok(Number.isFinite(v), `${k} no es un numero finito: ${v}`);
  }
  if (r.clases_realizadas > 0) {
    const esperado = Number((r.alumnos_total / r.clases_realizadas).toFixed(1));
    assert.ok(Math.abs(r.promedio_por_clase - esperado) < 0.15,
      `promedio ${r.promedio_por_clase} no coincide con ${esperado}`);
  }
});

test('REQ 7: el tablero trae las seis secciones y los cortes cierran con el resumen', async () => {
  const { c } = await sesionAdmin();
  const { estado, datos: t } = await c('GET', '/api/estadisticas/tablero');
  assert.equal(estado, 200);

  for (const k of ['resumen', 'por_profesor', 'por_lugar', 'evolucion', 'sexo', 'suspensiones']) {
    assert.ok(k in t, `falta la seccion ${k}`);
  }

  const sumaLugares = t.por_lugar.reduce((a, x) => a + x.alumnos, 0);
  assert.equal(sumaLugares, t.resumen.alumnos_total,
    'los alumnos por lugar deben sumar el total del resumen');

  const clasesProfesores = t.por_profesor.reduce((a, x) => a + x.clases, 0);
  assert.equal(clasesProfesores, t.resumen.clases_realizadas,
    'las clases por profesor deben sumar las clases realizadas');

  const evolucion = t.evolucion.reduce((a, x) => a + x.alumnos, 0);
  assert.equal(evolucion, t.resumen.alumnos_total,
    'la evolucion por periodo debe sumar el total del resumen');

  assert.ok(t.por_lugar.every((l) => 'ultima_clase' in l),
    'por-lugar necesita ultima_clase para el nivel de actividad del espacio');
});

test('REQ 7: las suspensiones informan cantidad, porcentaje y motivo', async () => {
  const { c, cat } = await sesionAdmin();
  await c('POST', '/api/registros', {
    fecha: '2026-09-15', profesor_id: cat.profesores[3].id, lugar_id: cat.lugares[4].id,
    estado_codigo: 'susp_clima', alumnos_total: 0, varones: 0, mujeres: 0, alumnos_nuevos: 0,
    observaciones: 'Tormenta durante toda la tarde', email_responsable: 'prueba@smt.gob.ar',
  });

  const { estado, datos: s } = await c('GET', '/api/estadisticas/suspensiones');
  assert.equal(estado, 200);
  assert.ok(s.total >= 1);
  assert.ok(s.por_motivo.some((m) => m.codigo === 'susp_clima' && m.cantidad >= 1));
  assert.ok(s.detalle.some((d) => d.observaciones?.includes('Tormenta')),
    'el motivo concreto que escribio el profesor tiene que llegar al indicador');
  assert.ok(s.porcentaje >= 0 && s.porcentaje <= 100);
});

test('una clase suspendida no puede declarar alumnos', async () => {
  const { c, cat } = await sesionAdmin();
  const { estado, datos } = await c('POST', '/api/registros', {
    fecha: '2026-09-15', profesor_id: cat.profesores[4].id, lugar_id: cat.lugares[5].id,
    estado_codigo: 'susp_feriado', alumnos_total: 30, varones: 10, mujeres: 20,
    alumnos_nuevos: 0, observaciones: 'Feriado', email_responsable: 'prueba@smt.gob.ar',
  });
  assert.equal(estado, 422);
  assert.ok(datos.errores?.alumnos_total);
});

// --- REQ 8: filtros -----------------------------------------------------------

test('REQ 8: los filtros afectan por igual al listado y a los indicadores', async () => {
  const { c, cat } = await sesionAdmin();
  const lugar = cat.lugares.find((l) => l.nombre === 'Barrio Kennedy') ?? cat.lugares[0];
  const filtro = `?lugar_id=${lugar.id}&desde=2026-01-01&hasta=2026-12-31`;

  const lista = await c('GET', `/api/registros${filtro}&por_pagina=200`);
  const resumen = await c('GET', `/api/estadisticas/resumen${filtro}`);

  assert.equal(lista.estado, 200);
  assert.equal(resumen.estado, 200);
  assert.ok(lista.datos.datos.every((r) => r.lugar_id === lugar.id), 'el listado respeta el filtro');
  assert.equal(lista.datos.total, resumen.datos.clases_registradas,
    'el listado y el resumen tienen que ver exactamente el mismo subconjunto');

  const porFecha = await c('GET', '/api/registros?desde=2026-09-01&hasta=2026-09-30&por_pagina=200');
  assert.ok(porFecha.datos.datos.every((r) => r.fecha >= '2026-09-01' && r.fecha <= '2026-09-30'));

  const porEstado = await c('GET', '/api/registros?estado=susp_clima&por_pagina=200');
  assert.ok(porEstado.datos.datos.every((r) => r.estado_codigo === 'susp_clima'));
});

test('el listado pagina y acota por_pagina', async () => {
  const { c } = await sesionAdmin();
  const p1 = await c('GET', '/api/registros?por_pagina=5&pagina=1');
  assert.equal(p1.datos.datos.length, 5);
  assert.equal(p1.datos.por_pagina, 5);
  assert.ok(p1.datos.paginas >= 2);

  const p2 = await c('GET', '/api/registros?por_pagina=5&pagina=2');
  assert.notEqual(p1.datos.datos[0].id, p2.datos.datos[0].id, 'la segunda pagina trae otras filas');

  const tope = await c('GET', '/api/registros?por_pagina=9999');
  assert.ok(tope.datos.por_pagina <= 200, 'por_pagina se recorta a 200');

  const ordenInvalido = await c('GET', '/api/registros?orden=; DROP TABLE registros');
  assert.equal(ordenInvalido.estado, 200, 'un orden invalido cae al por defecto, no rompe');
});

test('la exportacion CSV sale lista para abrir en Excel', async () => {
  const { c } = await sesionAdmin();
  const { estado, datos, headers } = await c('GET', '/api/registros/exportar.csv?desde=2026-01-01');
  assert.equal(estado, 200);
  assert.match(headers.get('content-type') || '', /text\/csv/);
  assert.match(headers.get('content-disposition') || '', /attachment/);
  const { bytes } = await c('GET', '/api/registros/exportar.csv?desde=2026-01-01');
  assert.deepEqual([...bytes.subarray(0, 3)], [0xEF, 0xBB, 0xBF],
    'necesita BOM para que Excel respete los acentos');
  assert.ok(datos.split('\n')[0].includes(';'), 'separador punto y coma');
  assert.ok(datos.includes('Observaciones'), 'cabeceras en espanol');
});

// --- sesion -------------------------------------------------------------------

test('el cambio de contrasena limpia el aviso y el logout corta el acceso', async () => {
  const c = crearCliente();
  await c('POST', '/api/auth/login', { usuario: 'rojas.david', password: PASSWORD });
  const antes = await c('GET', '/api/auth/sesion');
  assert.ok(antes.datos.usuario.debe_cambiar_password, 'la carga inicial obliga a cambiarla');

  const debil = await c('POST', '/api/auth/password', { actual: PASSWORD, nueva: '123' });
  assert.equal(debil.estado, 422, 'rechaza contrasenas debiles');

  // 422 y no 401: el usuario tiene sesion valida, lo que esta mal es un campo
  // del formulario. Con 401 el cliente lo interpretaria como sesion vencida y
  // lo expulsaria al ingreso por haber tecleado mal su contrasena actual.
  const mal = await c('POST', '/api/auth/password', { actual: 'no-es-la-mia', nueva: 'Plaza2026seg' });
  assert.equal(mal.estado, 422, 'exige la contrasena actual sin cerrar la sesion');
  assert.ok(mal.datos.errores?.actual, 'el error apunta al campo de la contrasena actual');

  const ok = await c('POST', '/api/auth/password', { actual: PASSWORD, nueva: 'Plaza2026seg' });
  assert.equal(ok.estado, 200);

  const despues = await c('GET', '/api/auth/sesion');
  assert.ok(!despues.datos.usuario.debe_cambiar_password);

  assert.equal((await c('POST', '/api/auth/logout')).estado, 200);
  assert.equal((await c('GET', '/api/registros')).estado, 401, 'despues del logout no hay acceso');

  const nueva = crearCliente();
  assert.equal((await nueva('POST', '/api/auth/login', { usuario: 'rojas.david', password: 'Plaza2026seg' })).estado, 200);
});

test('las paginas se sirven y no filtran la base', async () => {
  const c = crearCliente();
  for (const ruta of ['/', '/carga.html', '/admin.html', '/css/estilos.css', '/js/api.js']) {
    const { estado } = await c('GET', ruta);
    assert.equal(estado, 200, `no se sirve ${ruta}`);
  }
  const fuga = await fetch(`${BASE_URL}/../data/ciudad-activa.db`);
  assert.ok(fuga.status >= 400, 'no se puede bajar el archivo de la base');
});
