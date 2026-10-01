// Reglas y mensajes de las contrasenas que elige cada persona.
//
// Las comparten el cambio obligatorio del primer ingreso y el cambio que se
// hace despues desde la barra superior: si cada pantalla tuviera las suyas, una
// podria aceptar una contrasena que la otra rechaza.

export const REGLAS_PASSWORD = 'Al menos 8 caracteres, con una letra y un número.';

/** Lo que le falta a la contrasena para cumplir las reglas; vacio si las cumple. */
export function revisarPassword(p: string): string[] {
  const faltas: string[] = [];
  if (p.length < 8) faltas.push('al menos 8 caracteres');
  if (!/[a-zA-Z]/.test(p)) faltas.push('al menos una letra');
  if (!/[0-9]/.test(p)) faltas.push('al menos un número');
  return faltas;
}

/** Supabase contesta en ingles; el profesor no tiene por que leer eso. */
export function traducirErrorAuth(mensaje: string): string {
  const m = mensaje.toLowerCase();
  if (m.includes('invalid login credentials')) {
    return 'El correo o la contraseña no son correctos.';
  }
  if (m.includes('email not confirmed')) {
    return 'Tu cuenta todavía no está confirmada. Avisale al administrador del sistema.';
  }
  if (m.includes('too many requests') || m.includes('rate limit')) {
    return 'Demasiados intentos seguidos. Esperá un momento y volvé a probar.';
  }
  if (m.includes('user not found')) return 'El correo o la contraseña no son correctos.';
  if (m.includes('failed to fetch') || m.includes('network')) {
    return 'No se pudo conectar. Revisá tu conexión a internet.';
  }
  if (m.includes('should be different')) {
    return 'La contraseña nueva tiene que ser distinta de la actual.';
  }
  return mensaje;
}
