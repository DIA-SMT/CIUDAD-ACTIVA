// Capa de acceso a datos.
//
// Se usa el modulo nativo node:sqlite (Node >= 22.5) para no arrastrar
// dependencias binarias. Todo el resto del sistema habla solo con las
// funciones exportadas aca: si en algun momento se migra a MySQL o
// PostgreSQL, este es el unico archivo que cambia.

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';

let db = null;

/** Devuelve la conexion, creandola y aplicando el esquema la primera vez. */
export function conectar() {
  if (db) return db;

  fs.mkdirSync(path.dirname(config.rutaDB), { recursive: true });
  db = new DatabaseSync(config.rutaDB);

  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');

  const esquema = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
  db.exec(esquema);

  return db;
}

export function cerrar() {
  if (db) { db.close(); db = null; }
}

/** Filas de una consulta. */
export function consultar(sql, params = []) {
  return conectar().prepare(sql).all(...params);
}

/** Primera fila de una consulta, o undefined. */
export function consultarUna(sql, params = []) {
  return conectar().prepare(sql).get(...params);
}

/** INSERT / UPDATE / DELETE. Devuelve { changes, lastInsertRowid }. */
export function ejecutar(sql, params = []) {
  return conectar().prepare(sql).run(...params);
}

/**
 * Corre fn dentro de una transaccion. Si fn lanza, se revierte todo.
 * node:sqlite es sincronico, asi que fn debe serlo tambien.
 */
export function enTransaccion(fn) {
  const base = conectar();
  base.exec('BEGIN');
  try {
    const resultado = fn();
    base.exec('COMMIT');
    return resultado;
  } catch (error) {
    try { base.exec('ROLLBACK'); } catch { /* la transaccion ya se cerro */ }
    throw error;
  }
}

/**
 * Arma la clausula WHERE de los filtros del REQ 8 sobre la vista v_registros.
 * Devuelve { where, params } con los marcadores posicionales ya ordenados.
 * Es la unica definicion de los filtros: la usan tanto el listado como todas
 * las estadisticas, de modo que ambos siempre miran el mismo subconjunto.
 */
export function filtrosRegistros(f = {}) {
  const cond = [];
  const params = [];

  if (f.desde)        { cond.push('fecha >= ?');          params.push(f.desde); }
  if (f.hasta)        { cond.push('fecha <= ?');          params.push(f.hasta); }
  if (f.profesor_id)  { cond.push('profesor_id = ?');     params.push(Number(f.profesor_id)); }
  if (f.lugar_id)     { cond.push('lugar_id = ?');        params.push(Number(f.lugar_id)); }
  if (f.estado)       { cond.push('estado_codigo = ?');   params.push(String(f.estado)); }

  if (f.solo_suspendidas) cond.push('es_suspension = 1');
  if (f.solo_normales)    cond.push('es_suspension = 0');

  if (f.q) {
    cond.push('(observaciones LIKE ? OR profesor_nombre LIKE ? OR lugar_nombre LIKE ?)');
    const t = `%${f.q}%`;
    params.push(t, t, t);
  }

  return { where: cond.length ? `WHERE ${cond.join(' AND ')}` : '', params };
}

export default { conectar, cerrar, consultar, consultarUna, ejecutar, enTransaccion, filtrosRegistros };
