// Cliente HTTP compartido por las tres pantallas.
// Centraliza el manejo de errores y la expulsion cuando cae la sesion.

export class ErrorAPI extends Error {
  constructor(mensaje, estado, errores) {
    super(mensaje);
    this.name = 'ErrorAPI';
    this.estado = estado;
    this.errores = errores || {};
  }
}

async function pedir(metodo, ruta, cuerpo, opciones = {}) {
  let respuesta;
  try {
    respuesta = await fetch(`/api${ruta}`, {
      method: metodo,
      headers: cuerpo === undefined ? {} : { 'Content-Type': 'application/json' },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      credentials: 'same-origin',
    });
  } catch {
    throw new ErrorAPI('No se pudo conectar con el servidor. Revisa tu conexion.', 0);
  }

  // Sesion vencida: se vuelve al ingreso, salvo que quien llama lo maneje.
  if (respuesta.status === 401 && !opciones.permitirAnonimo) {
    if (!location.pathname.endsWith('/') && !location.pathname.endsWith('index.html')) {
      location.href = '/index.html?vencida=1';
    }
    throw new ErrorAPI('Tu sesion expiro. Volve a ingresar.', 401);
  }

  if (respuesta.status === 204) return null;

  let datos = null;
  const tipo = respuesta.headers.get('content-type') || '';
  if (tipo.includes('application/json')) {
    try { datos = await respuesta.json(); } catch { datos = null; }
  }

  if (!respuesta.ok) {
    throw new ErrorAPI(
      datos?.error || `Error ${respuesta.status} al procesar el pedido.`,
      respuesta.status,
      datos?.errores,
    );
  }
  return datos;
}

/** Arma una query string omitiendo vacios. */
export function qs(filtros = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filtros)) {
    if (v !== '' && v !== null && v !== undefined) p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const api = {
  get: (ruta, opciones) => pedir('GET', ruta, undefined, opciones),
  post: (ruta, cuerpo, opciones) => pedir('POST', ruta, cuerpo ?? {}, opciones),
  put: (ruta, cuerpo) => pedir('PUT', ruta, cuerpo ?? {}),
  del: (ruta) => pedir('DELETE', ruta),

  auth: {
    login: (usuario, password) =>
      pedir('POST', '/auth/login', { usuario, password }, { permitirAnonimo: true }),
    sesion: () => pedir('GET', '/auth/sesion', undefined, { permitirAnonimo: true }),
    logout: () => pedir('POST', '/auth/logout', {}),
    cambiarPassword: (actual, nueva) => pedir('POST', '/auth/password', { actual, nueva }),
  },

  catalogos: () => pedir('GET', '/catalogos'),

  registros: {
    listar: (f) => pedir('GET', `/registros${qs(f)}`),
    obtener: (id) => pedir('GET', `/registros/${id}`),
    crear: (datos) => pedir('POST', '/registros', datos),
    actualizar: (id, datos) => pedir('PUT', `/registros/${id}`, datos),
    eliminar: (id) => pedir('DELETE', `/registros/${id}`),
    historial: (id) => pedir('GET', `/registros/${id}/historial`),
    urlExportar: (f) => `/api/registros/exportar.csv${qs(f)}`,
  },

  estadisticas: {
    tablero: (f) => pedir('GET', `/estadisticas/tablero${qs(f)}`),
    resumen: (f) => pedir('GET', `/estadisticas/resumen${qs(f)}`),
    porProfesor: (f) => pedir('GET', `/estadisticas/por-profesor${qs(f)}`),
    porLugar: (f) => pedir('GET', `/estadisticas/por-lugar${qs(f)}`),
    evolucion: (f) => pedir('GET', `/estadisticas/evolucion${qs(f)}`),
    sexo: (f) => pedir('GET', `/estadisticas/sexo${qs(f)}`),
    suspensiones: (f) => pedir('GET', `/estadisticas/suspensiones${qs(f)}`),
  },

  admin: {
    usuarios: () => pedir('GET', '/admin/usuarios'),
    crearUsuario: (d) => pedir('POST', '/admin/usuarios', d),
    editarUsuario: (id, d) => pedir('PUT', `/admin/usuarios/${id}`, d),
    resetPassword: (id, nueva) => pedir('POST', `/admin/usuarios/${id}/password`, { nueva }),
    lugares: () => pedir('GET', '/admin/lugares'),
    crearLugar: (d) => pedir('POST', '/admin/lugares', d),
    editarLugar: (id, d) => pedir('PUT', `/admin/lugares/${id}`, d),
    historial: (f) => pedir('GET', `/admin/historial${qs(f)}`),
  },
};

// --- ayudas de formato compartidas ------------------------------------------

const NF = new Intl.NumberFormat('es-AR');

export const fmt = {
  numero: (n) => NF.format(Number(n) || 0),
  porcentaje: (n) => `${(Number(n) || 0).toFixed(1).replace('.', ',')} %`,
  decimal: (n) => (Number(n) || 0).toFixed(1).replace('.', ','),
  /** '2026-09-08' -> '08/09/2026' */
  fecha: (iso) => {
    if (!iso) return '';
    const [a, m, d] = String(iso).slice(0, 10).split('-');
    return a && m && d ? `${d}/${m}/${a}` : String(iso);
  },
  /** '2026-09-08 19:56:04' -> '08/09/2026 19:56' */
  fechaHora: (v) => {
    if (!v) return '';
    const s = String(v);
    return `${fmt.fecha(s.slice(0, 10))} ${s.slice(11, 16)}`.trim();
  },
};

/** Escapa texto antes de insertarlo como HTML. */
export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export default api;
