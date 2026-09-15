// /api/catalogos — los desplegables del formulario de carga.
//
// REQ 2: el profesor se elige de un listado de autorizados, nunca se escribe.
// REQ 3: el lugar se elige de los espacios previamente definidos.
//
// Devuelve solo elementos activos: lo dado de baja deja de ofrecerse aca, pero
// sigue existiendo en el historico (REQ 5), por eso nada se elimina de verdad.

import { Router } from 'express';
import { consultar } from '../db/index.js';
import { requiereSesion } from '../middleware/auth.js';
import { asyncH } from '../middleware/errores.js';

const router = Router();

router.use(requiereSesion);

router.get('/', asyncH((req, res) => {
  // REQ 2: solo quienes estan habilitados para dictar clases.
  const profesores = consultar(
    `SELECT id, nombre, cargo, email
       FROM usuarios
      WHERE activo = 1 AND dicta_clases = 1
      ORDER BY nombre COLLATE NOCASE`,
  );

  // REQ 3: espacios habilitados.
  const lugares = consultar(
    `SELECT id, nombre
       FROM lugares
      WHERE activo = 1
      ORDER BY nombre COLLATE NOCASE`,
  );

  // Los estados van en el orden en que se quieren mostrar, no alfabetico:
  // 'Clase normal' primero y despues los motivos de suspension.
  const estados = consultar(
    `SELECT codigo, nombre, es_suspension
       FROM estados_clase
      WHERE activo = 1
      ORDER BY orden, nombre COLLATE NOCASE`,
  );

  res.json({ profesores, lugares, estados });
}));

export default router;
