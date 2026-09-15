// Carga inicial de la base.
//
//   npm run init-db     crea lo que falte, respeta lo que ya existe
//   npm run reset-db    borra el archivo y lo reconstruye desde cero
//
// Los catalogos de profesores y lugares salen completos de la planilla
// "Asistencia Ciudad Activa.xlsx". De los registros se cargan los primeros
// 10 de cada hoja, como muestra para probar el sistema.

import fs from 'node:fs';
import { conectar, consultarUna, ejecutar, enTransaccion, cerrar } from './index.js';
import { config } from '../config.js';
import { hashPassword } from '../lib/passwords.js';
import { ahora } from '../lib/fechas.js';

const semilla = JSON.parse(fs.readFileSync(new URL('./seed-data.json', import.meta.url), 'utf8'));

// --- estados de clase --------------------------------------------------------
// Los tres primeros son los que aparecen en la planilla; el cuarto se agrega
// para que el REQ 7 (motivos de suspension) pueda cubrir el resto de los casos.
const ESTADOS = [
  { codigo: 'normal',        nombre: 'Clase normal',                       es_suspension: 0, orden: 1 },
  { codigo: 'susp_clima',    nombre: 'Suspendida por factores climaticos', es_suspension: 1, orden: 2 },
  { codigo: 'susp_feriado',  nombre: 'Suspendida por feriado',             es_suspension: 1, orden: 3 },
  { codigo: 'susp_otro',     nombre: 'Suspendida por otro motivo',         es_suspension: 1, orden: 4 },
];

const porNombreEstado = new Map(ESTADOS.map((e) => [e.nombre.toLowerCase(), e.codigo]));

const sinAcentos = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

function generarUsuario(nombre, usados) {
  const base = sinAcentos(String(nombre).toLowerCase())
    .replace(/[^a-z0-9\s]/g, '')
    .trim().split(/\s+/).slice(0, 2).join('.') || 'usuario';
  let candidato = base;
  let n = 2;
  while (usados.has(candidato)) candidato = `${base}${n++}`;
  usados.add(candidato);
  return candidato;
}

function sembrar({ reset = false } = {}) {
  if (reset && fs.existsSync(config.rutaDB)) {
    for (const sufijo of ['', '-wal', '-shm', '-journal']) {
      const f = config.rutaDB + sufijo;
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    console.log('Base anterior eliminada.');
  }

  conectar();
  const t = ahora();
  const resumen = { estados: 0, lugares: 0, usuarios: 0, registros: 0, omitidos: [] };

  enTransaccion(() => {
    // --- estados ------------------------------------------------------------
    for (const e of ESTADOS) {
      const r = ejecutar(
        `INSERT INTO estados_clase (codigo, nombre, es_suspension, activo, orden)
         VALUES (?, ?, ?, 1, ?) ON CONFLICT (codigo) DO NOTHING`,
        [e.codigo, e.nombre, e.es_suspension, e.orden],
      );
      resumen.estados += r.changes;
    }

    // --- REQ 3: espacios de actividad ---------------------------------------
    semilla.lugares.forEach((l, i) => {
      const r = ejecutar(
        `INSERT INTO lugares (nombre, descripcion, activo, orden, creado_en, actualizado_en)
         VALUES (?, '', 1, ?, ?, ?) ON CONFLICT (nombre) DO NOTHING`,
        [l.nombre, i + 1, t, t],
      );
      resumen.lugares += r.changes;
    });

    // --- REQ 2: profesores autorizados --------------------------------------
    const hash = hashPassword(config.passwordSemilla);
    const usados = new Set();

    // Cuenta institucional para la Gerencia de Datos / Direccion.
    const admin = {
      nombre: 'Administrador del sistema', cargo: 'Administracion',
      email: 'deportes@smt.gob.ar', usuario: 'admin', rol: 'admin', dicta_clases: 0,
    };
    usados.add('admin');

    const cuentas = [
      admin,
      ...semilla.profesores.map((p) => ({
        nombre: p.nombre,
        cargo: p.cargo,
        email: p.email,
        usuario: generarUsuario(p.nombre, usados),
        // El coordinador administra ademas de dictar clases.
        rol: p.cargo === 'Coordinador' ? 'admin' : 'profesor',
        dicta_clases: 1,
      })),
    ];

    for (const c of cuentas) {
      const r = ejecutar(
        `INSERT INTO usuarios (nombre, cargo, email, usuario, password_hash, rol,
                               dicta_clases, activo, debe_cambiar_password, creado_en, actualizado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)
         ON CONFLICT (email) DO NOTHING`,
        [c.nombre, c.cargo, c.email, c.usuario, hash, c.rol, c.dicta_clases, t, t],
      );
      resumen.usuarios += r.changes;
    }

    // --- registros de muestra ------------------------------------------------
    const idProfesor = new Map();
    for (const p of semilla.profesores) {
      const fila = consultarUna('SELECT id FROM usuarios WHERE email = ?', [p.email]);
      if (fila) idProfesor.set(p.etiqueta, fila.id);
    }
    const idLugar = new Map(
      semilla.lugares.map((l) => [l.nombre, consultarUna('SELECT id FROM lugares WHERE nombre = ?', [l.nombre])?.id]),
    );

    for (const r of semilla.registros) {
      const profesorId = idProfesor.get(r.profesor);
      const lugarId = idLugar.get(r.lugar);
      const estadoCodigo = porNombreEstado.get(String(r.estado_clase).toLowerCase());

      if (!profesorId || !lugarId || !estadoCodigo) {
        resumen.omitidos.push(`${r.fecha} ${r.lugar} (catalogo no resuelto)`);
        continue;
      }
      // REQ 4: el mismo control que aplica la API. Los historicos incoherentes
      // no entran silenciosamente: se informan.
      if (r.varones + r.mujeres !== r.alumnos_total) {
        resumen.omitidos.push(
          `${r.fecha} ${r.lugar}: varones+mujeres=${r.varones + r.mujeres} != total=${r.alumnos_total}`);
        continue;
      }

      const yaEsta = consultarUna(
        `SELECT id FROM registros WHERE fecha = ? AND profesor_id = ? AND lugar_id = ? AND origen = 'importacion'`,
        [r.fecha, profesorId, lugarId],
      );
      if (yaEsta) continue;

      const creado = r.marca_temporal || t;
      const ins = ejecutar(
        `INSERT INTO registros (fecha, profesor_id, lugar_id, estado_codigo,
                                alumnos_total, alumnos_nuevos, varones, mujeres,
                                observaciones, email_responsable, cargado_por,
                                origen, creado_en, actualizado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'importacion', ?, ?)`,
        [r.fecha, profesorId, lugarId, estadoCodigo,
         r.alumnos_total, r.alumnos_nuevos, r.varones, r.mujeres,
         r.observaciones ?? '', r.email_responsable ?? '', profesorId, creado, creado],
      );

      // REQ 5 y 6: toda fila nace con su asiento en el historial.
      ejecutar(
        `INSERT INTO registros_historial (registro_id, accion, campo, valor_anterior, valor_nuevo,
                                          usuario_id, usuario_nombre, fecha_hora)
         VALUES (?, 'creacion', '', '', ?, NULL, ?, ?)`,
        [ins.lastInsertRowid, `Importado de ${r.origen}`, 'Importacion inicial', creado],
      );
      resumen.registros += 1;
    }
  });

  return resumen;
}

const reset = process.argv.includes('--reset');
const r = sembrar({ reset });

console.log('');
console.log('  Ciudad Activa - carga inicial');
console.log('  ------------------------------------------');
console.log(`  Base de datos : ${config.rutaDB}`);
console.log(`  Estados       : ${r.estados} nuevos`);
console.log(`  Lugares       : ${r.lugares} nuevos`);
console.log(`  Usuarios      : ${r.usuarios} nuevos`);
console.log(`  Registros     : ${r.registros} nuevos`);
if (r.omitidos.length) {
  console.log(`  Omitidos      : ${r.omitidos.length}`);
  for (const o of r.omitidos) console.log(`                  - ${o}`);
}

if (r.usuarios > 0) {
  console.log('');
  console.log('  Usuarios creados (contrasena inicial comun, se pide cambiarla al entrar):');
  console.log(`  contrasena: ${config.passwordSemilla}`);
  console.log('');
  const filas = conectar()
    .prepare('SELECT usuario, nombre, cargo, rol, email FROM usuarios ORDER BY rol DESC, nombre')
    .all();
  for (const u of filas) {
    console.log(`    ${String(u.usuario).padEnd(20)} ${String(u.rol).padEnd(9)} ${u.nombre} <${u.email}>`);
  }
}
console.log('');

cerrar();
