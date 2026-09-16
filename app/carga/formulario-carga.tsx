'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, TriangleAlert, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { fmt, hoyISO } from '@/lib/fechas';
import { validarRegistro, type ErroresCampo } from '@/lib/validacion';
import type { Catalogos, CuerpoRegistro, Perfil, Registro } from '@/lib/tipos';

type Campo = keyof CuerpoRegistro;

const VACIO = {
  fecha: hoyISO(),
  profesor_id: '',
  lugar_id: '',
  estado_codigo: 'normal',
  alumnos_total: '',
  alumnos_nuevos: '0',
  varones: '',
  mujeres: '',
  observaciones: '',
  email_responsable: '',
};

type Borrador = typeof VACIO;

const aEntero = (v: string) => (v.trim() === '' ? null : Number(v));

/** 'Prof. Juarez Jessica' / 'Coord. Adolfo Steimberg' */
const tratamiento = (cargo: string) => (cargo === 'Coordinador' ? 'Coord.' : 'Prof.');

function deRegistro(r: Registro): Borrador {
  return {
    fecha: r.fecha,
    profesor_id: r.profesor_id,
    lugar_id: String(r.lugar_id),
    estado_codigo: r.estado_codigo,
    alumnos_total: String(r.alumnos_total),
    alumnos_nuevos: String(r.alumnos_nuevos),
    varones: String(r.varones),
    mujeres: String(r.mujeres),
    observaciones: r.observaciones,
    email_responsable: r.email_responsable,
  };
}

export function FormularioCarga({
  perfil,
  catalogos,
  editando,
  onGuardado,
  onCancelar,
}: {
  perfil: Perfil;
  catalogos: Catalogos;
  editando?: Registro | null;
  onGuardado: () => void;
  onCancelar?: () => void;
}) {
  const esAdmin = perfil.rol === 'admin';

  const inicial = useMemo<Borrador>(
    () =>
      editando
        ? deRegistro(editando)
        : { ...VACIO, profesor_id: perfil.id, email_responsable: perfil.email },
    [editando, perfil],
  );

  const [datos, setDatos] = useState<Borrador>(inicial);
  const [tocados, setTocados] = useState<Set<Campo>>(new Set());
  const [enviado, setEnviado] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [erroresServidor, setErroresServidor] = useState<ErroresCampo>({});
  const [duplicados, setDuplicados] = useState<Registro[] | null>(null);

  const formulario = useRef<HTMLFormElement>(null);
  const primerCampo = useRef<HTMLInputElement>(null);

  useEffect(() => setDatos(inicial), [inicial]);

  const estado = catalogos.estados.find((e) => e.codigo === datos.estado_codigo);
  const suspendida = Boolean(estado?.es_suspension);

  // --- REQ 4: la suma, en vivo ----------------------------------------------
  const varones = aEntero(datos.varones);
  const mujeres = aEntero(datos.mujeres);
  const total = aEntero(datos.alumnos_total);
  const haySuma = varones !== null && mujeres !== null;
  const suma = (varones ?? 0) + (mujeres ?? 0);
  const coincide = haySuma && total !== null && suma === total;

  const cuerpo: Partial<CuerpoRegistro> = {
    fecha: datos.fecha,
    profesor_id: datos.profesor_id,
    lugar_id: aEntero(datos.lugar_id) ?? undefined,
    estado_codigo: datos.estado_codigo,
    alumnos_total: total ?? undefined,
    alumnos_nuevos: aEntero(datos.alumnos_nuevos) ?? undefined,
    varones: varones ?? undefined,
    mujeres: mujeres ?? undefined,
    observaciones: datos.observaciones,
    email_responsable: datos.email_responsable,
  };

  const validacion = validarRegistro(cuerpo, catalogos);
  const errores: ErroresCampo = { ...validacion.errores, ...erroresServidor };

  /** Un error se muestra recien cuando el campo se toco o se intento enviar. */
  const verError = (campo: Campo) =>
    (enviado || tocados.has(campo)) && errores[campo] && errores[campo]!.trim()
      ? errores[campo]
      : null;

  function cambiar(campo: Campo, valor: string) {
    setDatos((d) => ({ ...d, [campo]: valor }));
    setErroresServidor((e) => ({ ...e, [campo]: undefined }));
  }

  function tocar(campo: Campo) {
    setTocados((t) => new Set(t).add(campo));
  }

  /** Al suspender la clase no hubo asistentes: se ponen en cero y se bloquean. */
  // Base UI puede entregar null si se deselecciona; el estado nunca queda vacio.
  function cambiarEstado(valor: string | null) {
    const codigo = valor ?? 'normal';
    const nuevo = catalogos.estados.find((e) => e.codigo === codigo);
    setDatos((d) => ({
      ...d,
      estado_codigo: codigo,
      ...(nuevo?.es_suspension
        ? { alumnos_total: '0', varones: '0', mujeres: '0', alumnos_nuevos: '0' }
        : {}),
    }));
    setErroresServidor({});
  }

  function usarLaSuma() {
    setDatos((d) => ({ ...d, alumnos_total: String(suma) }));
    setTocados((t) => new Set(t).add('alumnos_total'));
  }

  async function enviar(confirmarDuplicado = false) {
    setEnviado(true);
    setErroresServidor({});

    if (!validacion.valido || !validacion.datos) {
      // Llevar el foco al primer campo con problema ahorra buscarlo a mano.
      const primero = Object.keys(validacion.errores)[0];
      formulario.current
        ?.querySelector<HTMLElement>(`[name="${primero}"]`)
        ?.focus();
      return;
    }

    setGuardando(true);
    setDuplicados(null);

    const ruta = editando ? `/api/registros/${editando.id}` : '/api/registros';
    const respuesta = await fetch(ruta, {
      method: editando ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...validacion.datos,
        ...(confirmarDuplicado ? { confirmar_duplicado: true } : {}),
      }),
    });

    const cuerpoRespuesta = await respuesta.json().catch(() => null);
    setGuardando(false);

    if (respuesta.status === 409 && cuerpoRespuesta?.duplicados) {
      setDuplicados(cuerpoRespuesta.duplicados as Registro[]);
      return;
    }

    if (!respuesta.ok) {
      if (cuerpoRespuesta?.errores) setErroresServidor(cuerpoRespuesta.errores);
      toast.error(cuerpoRespuesta?.error ?? 'No se pudo guardar la clase.');
      return;
    }

    const guardado = cuerpoRespuesta.registro as Registro;
    toast.success(
      editando ? 'Clase actualizada' : 'Clase registrada',
      {
        description:
          `${fmt.fecha(guardado.fecha)} · ${guardado.lugar_nombre} · ` +
          `${guardado.alumnos_total} alumnos`,
      },
    );

    if (editando) {
      onCancelar?.();
    } else {
      // Se deja fecha y lugar: normalmente cargan varias clases seguidas.
      setDatos((d) => ({
        ...VACIO,
        fecha: d.fecha,
        lugar_id: d.lugar_id,
        profesor_id: esAdmin ? d.profesor_id : perfil.id,
        email_responsable: d.email_responsable,
      }));
      setTocados(new Set());
      setEnviado(false);
      primerCampo.current?.focus();
    }
    onGuardado();
  }

  const claseNumero = (campo: Campo) =>
    verError(campo) ? 'border-rojo-600 focus-visible:ring-rojo-600' : '';

  return (
    <>
      <form
        ref={formulario}
        onSubmit={(e) => {
          e.preventDefault();
          void enviar();
        }}
        className="space-y-5"
        noValidate
      >
        {/* 1. correo del responsable */}
        <div className="space-y-2">
          <Label htmlFor="email_responsable">Correo electrónico del responsable</Label>
          <Input
            id="email_responsable"
            name="email_responsable"
            type="email"
            inputMode="email"
            value={datos.email_responsable}
            onChange={(e) => cambiar('email_responsable', e.target.value)}
            onBlur={() => tocar('email_responsable')}
            aria-invalid={Boolean(verError('email_responsable'))}
          />
          {verError('email_responsable') && (
            <p className="text-rojo-600 text-sm">{verError('email_responsable')}</p>
          )}
        </div>

        {/* 2. REQ 2: profesor del listado de autorizados */}
        <div className="space-y-2">
          <Label htmlFor="profesor_id">Profesor</Label>
          <Select
            value={datos.profesor_id}
            onValueChange={(v) => cambiar('profesor_id', v ?? '')}
            disabled={!esAdmin}
          >
            <SelectTrigger id="profesor_id" className="w-full">
              <SelectValue placeholder="Elegí el profesor">
                {(v: string | null) => {
                  const p = catalogos.profesores.find((x) => x.id === v);
                  return p ? `${tratamiento(p.cargo)} ${p.nombre}` : 'Elegí el profesor';
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {catalogos.profesores.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {tratamiento(p.cargo)} {p.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!esAdmin && (
            <p className="text-muted-foreground text-xs">
              Las clases se cargan a tu nombre. Si cargás por un colega, pedile a la
              Dirección que lo registre.
            </p>
          )}
          {verError('profesor_id') && (
            <p className="text-rojo-600 text-sm">{verError('profesor_id')}</p>
          )}
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          {/* 3. fecha */}
          <div className="space-y-2">
            <Label htmlFor="fecha">Fecha de la actividad</Label>
            <Input
              id="fecha"
              name="fecha"
              type="date"
              max={hoyISO()}
              value={datos.fecha}
              onChange={(e) => cambiar('fecha', e.target.value)}
              onBlur={() => tocar('fecha')}
              aria-invalid={Boolean(verError('fecha'))}
            />
            {verError('fecha') && (
              <p className="text-rojo-600 text-sm">{verError('fecha')}</p>
            )}
          </div>

          {/* 4. REQ 3: lugar de los espacios definidos */}
          <div className="space-y-2">
            <Label htmlFor="lugar_id">Lugar</Label>
            <Select
              value={datos.lugar_id}
              onValueChange={(v) => {
                cambiar('lugar_id', v ?? '');
                tocar('lugar_id');
              }}
            >
              <SelectTrigger id="lugar_id" className="w-full">
                <SelectValue placeholder="Elegí el lugar">
                  {(v: string | null) =>
                    catalogos.lugares.find((l) => String(l.id) === v)?.nombre ??
                    'Elegí el lugar'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {catalogos.lugares.map((l) => (
                  <SelectItem key={l.id} value={String(l.id)}>
                    {l.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {verError('lugar_id') && (
              <p className="text-rojo-600 text-sm">{verError('lugar_id')}</p>
            )}
          </div>
        </div>

        {/* 5. estado de la clase */}
        <div className="space-y-2">
          <Label htmlFor="estado_codigo">Estado de la clase</Label>
          <Select value={datos.estado_codigo} onValueChange={cambiarEstado}>
            <SelectTrigger id="estado_codigo" className="w-full">
              <SelectValue>
                {(v: string | null) =>
                  catalogos.estados.find((e) => e.codigo === v)?.nombre ?? 'Clase normal'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {catalogos.estados.map((e) => (
                <SelectItem key={e.codigo} value={e.codigo}>
                  {e.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* 6-9. REQ 4: las cantidades */}
        <fieldset
          disabled={suspendida}
          className="space-y-4 disabled:opacity-60"
          aria-describedby="control-suma"
        >
          <legend className="sr-only">Cantidad de alumnos</legend>

          <div className="grid gap-4 sm:grid-cols-3">
            {(
              [
                ['varones', 'Varones'],
                ['mujeres', 'Mujeres'],
                ['alumnos_total', 'Total de alumnos'],
              ] as [Campo, string][]
            ).map(([campo, etiqueta]) => (
              <div key={campo} className="space-y-2">
                <Label htmlFor={campo}>{etiqueta}</Label>
                <Input
                  id={campo}
                  name={campo}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  className={`cifra ${claseNumero(campo)}`}
                  value={datos[campo as keyof Borrador]}
                  onChange={(e) => cambiar(campo, e.target.value)}
                  onBlur={() => tocar(campo)}
                  aria-invalid={Boolean(verError(campo))}
                />
              </div>
            ))}
          </div>

          {/* El control que evita la causa mas frecuente de error de carga. */}
          <div
            id="control-suma"
            aria-live="polite"
            className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
              !haySuma
                ? 'text-muted-foreground'
                : coincide
                  ? 'border-verde-100 bg-verde-50 text-verde-900'
                  : 'border-rojo-600/30 bg-rojo-600/5 text-rojo-600'
            }`}
          >
            {!haySuma ? (
              'Completá varones y mujeres para ver si la suma cierra.'
            ) : coincide ? (
              <>
                <Check className="h-4 w-4 shrink-0" aria-hidden />
                <span className="cifra">
                  {varones} + {mujeres} = {suma}
                </span>
                <span>coincide con el total.</span>
              </>
            ) : (
              <>
                <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
                {/* Una sola pieza de texto: separado en dos, el gap del flex
                    mete un espacio justo antes de la coma. */}
                <span>
                  <span className="cifra">
                    {varones} + {mujeres} = {suma}
                  </span>
                  {total === null
                    ? ', falta el total.'
                    : `, pero el total dice ${total}.`}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={usarLaSuma}
                  className="ml-auto"
                >
                  Usar {suma} como total
                </Button>
              </>
            )}
          </div>

          <div className="space-y-2 sm:max-w-48">
            <Label htmlFor="alumnos_nuevos">Alumnos nuevos</Label>
            <Input
              id="alumnos_nuevos"
              name="alumnos_nuevos"
              type="number"
              inputMode="numeric"
              min={0}
              className={`cifra ${claseNumero('alumnos_nuevos')}`}
              value={datos.alumnos_nuevos}
              onChange={(e) => cambiar('alumnos_nuevos', e.target.value)}
              onBlur={() => tocar('alumnos_nuevos')}
              aria-invalid={Boolean(verError('alumnos_nuevos'))}
            />
            {verError('alumnos_nuevos') && (
              <p className="text-rojo-600 text-sm">{verError('alumnos_nuevos')}</p>
            )}
          </div>
        </fieldset>

        {verError('alumnos_total') && (
          <p className="text-rojo-600 text-sm">{verError('alumnos_total')}</p>
        )}

        {/* 10. observaciones */}
        <div className="space-y-2">
          <Label htmlFor="observaciones">
            {suspendida ? 'Motivo de la suspensión' : 'Observaciones'}
          </Label>
          <Textarea
            id="observaciones"
            name="observaciones"
            rows={3}
            value={datos.observaciones}
            onChange={(e) => cambiar('observaciones', e.target.value)}
            onBlur={() => tocar('observaciones')}
            placeholder={
              suspendida
                ? 'Por qué no se pudo dar la clase'
                : 'Cómo estuvo la clase, si pasó algo para destacar'
            }
            aria-invalid={Boolean(verError('observaciones'))}
          />
          {verError('observaciones') && (
            <p className="text-rojo-600 text-sm">{verError('observaciones')}</p>
          )}
        </div>

        <div className="flex flex-col gap-2 pt-2 sm:flex-row-reverse">
          <Button type="submit" className="h-11 flex-1" disabled={guardando}>
            {guardando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {editando ? 'Guardar los cambios' : 'Registrar la clase'}
          </Button>
          {editando && onCancelar && (
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={onCancelar}
              disabled={guardando}
            >
              <X className="h-4 w-4" aria-hidden />
              Cancelar
            </Button>
          )}
        </div>
      </form>

      {/* Duplicado: hay dias con dos clases reales, asi que se avisa y se confirma. */}
      <Dialog open={duplicados !== null} onOpenChange={(a) => !a && setDuplicados(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ya hay una clase cargada</DialogTitle>
            <DialogDescription>
              Para esa fecha, ese profesor y ese lugar ya existe un registro. Puede ser
              que la estés cargando dos veces, o que ese día hubiera dos clases.
            </DialogDescription>
          </DialogHeader>

          <ul className="space-y-2">
            {(duplicados ?? []).map((d) => (
              <li key={d.id} className="bg-muted rounded-lg border p-3 text-sm">
                <p className="font-medium">
                  {fmt.fecha(d.fecha)} · {d.lugar_nombre}
                </p>
                <p className="text-muted-foreground">
                  {d.profesor_nombre} · <span className="cifra">{d.alumnos_total}</span>{' '}
                  alumnos · cargada el {fmt.fechaHora(d.creado_en)}
                </p>
                {d.observaciones && (
                  <p className="text-muted-foreground mt-1 italic">
                    «{d.observaciones}»
                  </p>
                )}
              </li>
            ))}
          </ul>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setDuplicados(null)}>
              Volver a revisar
            </Button>
            <Button onClick={() => void enviar(true)} disabled={guardando}>
              {guardando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Sí, fue otra clase: guardala
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
