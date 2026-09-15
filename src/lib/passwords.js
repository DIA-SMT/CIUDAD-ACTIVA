// Hash de contrasenas con scrypt de node:crypto.
// Se evita una dependencia externa de bcrypt: scrypt viene en el runtime,
// es resistente a hardware dedicado y no requiere compilacion nativa.

import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

const N = 16_384;      // costo de CPU/memoria
const R = 8;
const P = 1;
const LARGO = 64;      // bytes de la clave derivada

/** Devuelve 'scrypt$N$r$p$salt$hash' listo para guardar en la base. */
export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(password), salt, LARGO, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('hex'), hash.toString('hex')].join('$');
}

/** Compara en tiempo constante. Nunca lanza: ante cualquier problema, false. */
export function verificarPassword(password, guardado) {
  try {
    const [algo, n, r, p, saltHex, hashHex] = String(guardado).split('$');
    if (algo !== 'scrypt') return false;

    const esperado = Buffer.from(hashHex, 'hex');
    const calculado = scryptSync(String(password), Buffer.from(saltHex, 'hex'),
      esperado.length, { N: Number(n), r: Number(r), p: Number(p) });

    return esperado.length === calculado.length && timingSafeEqual(esperado, calculado);
  } catch {
    return false;
  }
}

/** Token opaco para el identificador de sesion. */
export function nuevoToken() {
  return randomBytes(32).toString('hex');
}

/**
 * Reglas minimas de contrasena. Devuelve un array de errores (vacio = valida).
 * Deliberadamente simples: el objetivo es evitar '1234', no frustrar al profe.
 */
export function validarPassword(password) {
  const errores = [];
  const p = String(password ?? '');
  if (p.length < 8) errores.push('La contrasena debe tener al menos 8 caracteres.');
  if (!/[a-zA-Z]/.test(p)) errores.push('La contrasena debe incluir al menos una letra.');
  if (!/[0-9]/.test(p)) errores.push('La contrasena debe incluir al menos un numero.');
  return errores;
}
