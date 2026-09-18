'use client';

import { useState } from 'react';
import { KeyRound, Loader2, Pencil, Plus } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { fmt } from '@/lib/fechas';
import { traerJSON, useRecurso } from '@/lib/usar-recurso';
import type { Perfil, Rol } from '@/lib/tipos';
import { ClaveGenerada } from './clave-generada';

/** Lo que agrega /api/admin/usuarios sobre el perfil. */
export type UsuarioAdmin = Perfil & { registros: number };

const CARGOS = ['Profesor', 'Coordinador', 'Administración'];

interface Formulario {
  nombre: string;
  cargo: string;
  email: string;
  rol: Rol;
  dicta_clases: boolean;
}

const VACIO: Formulario = {
  nombre: '', cargo: 'Profesor', email: '', rol: 'profesor', dicta_clases: true,
};

const deUsuario = (u: UsuarioAdmin): Formulario => ({
  nombre: u.nombre, cargo: u.cargo, email: u.email, rol: u.rol, dicta_clases: u.dicta_clases,
});

/** Alta y edición comparten el mismo formulario: los campos son los mismos. */
function DialogoUsuario({
  editando,
  abierto,
  guardando,
  errores,
  onCerrar,
  onGuardar,
}: {
  editando: UsuarioAdmin | null;
  abierto: boolean;
  guardando: boolean;
  errores: Record<string, string>;
  onCerrar: () => void;
  onGuardar: (datos: Formulario) => void;
}) {
  const [datos, setDatos] = useState<Formulario>(VACIO);

  // key en el padre remonta el diálogo, así el estado arranca del usuario
  // correcto sin sincronizarlo con un efecto.
  const [inicializado, setInicializado] = useState(false);
  if (!inicializado) {
    setInicializado(true);
    setDatos(editando ? deUsuario(editando) : VACIO);
  }

  const esNuevo = editando === null;
  const cambiar = (c: Partial<Formulario>) => setDatos((d) => ({ ...d, ...c }));

  return (
    <Dialog open={abierto} onOpenChange={(a) => !a && onCerrar()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{esNuevo ? 'Agregar persona' : `Editar a ${editando.nombre}`}</DialogTitle>
          <DialogDescription>
            {esNuevo
              ? 'Se crea la cuenta con una contraseña generada, que vas a ver una sola vez.'
              : 'El correo no se puede cambiar: es con lo que ingresa al sistema.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="u-nombre">Nombre y apellido</Label>
            <Input
              id="u-nombre"
              value={datos.nombre}
              onChange={(e) => cambiar({ nombre: e.target.value })}
              aria-invalid={Boolean(errores.nombre)}
            />
            {errores.nombre && <p className="text-rojo-600 text-sm">{errores.nombre}</p>}
            <p className="text-muted-foreground text-xs">
              Es el nombre que aparece en el desplegable del formulario y en el historial.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="u-email">Correo electrónico</Label>
            <Input
              id="u-email"
              type="email"
              value={datos.email}
              onChange={(e) => cambiar({ email: e.target.value })}
              disabled={!esNuevo}
              aria-invalid={Boolean(errores.email)}
            />
            {errores.email && <p className="text-rojo-600 text-sm">{errores.email}</p>}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="u-cargo">Cargo</Label>
              <Select value={datos.cargo} onValueChange={(v) => cambiar({ cargo: v ?? 'Profesor' })}>
                <SelectTrigger id="u-cargo" className="w-full">
                  <SelectValue>{(v: string | null) => v ?? 'Profesor'}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {CARGOS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="u-rol">Rol en el sistema</Label>
              <Select
                value={datos.rol}
                onValueChange={(v) => cambiar({ rol: (v as Rol) ?? 'profesor' })}
              >
                <SelectTrigger id="u-rol" className="w-full">
                  <SelectValue>
                    {(v: string | null) => (v === 'admin' ? 'Administrador' : 'Profesor')}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="profesor">Profesor</SelectItem>
                  <SelectItem value="admin">Administrador</SelectItem>
                </SelectContent>
              </Select>
              {errores.rol && <p className="text-rojo-600 text-sm">{errores.rol}</p>}
            </div>
          </div>

          <div className="bg-muted/50 rounded-lg border p-3 text-sm">
            <p className="text-muted-foreground">
              Un <strong>profesor</strong> carga sus clases y consulta el tablero.
              Un <strong>administrador</strong> además revisa y aprueba las cargas, corrige
              cualquier registro y gestiona esta sección.
            </p>
          </div>

          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              className="mt-0.5"
              checked={datos.dicta_clases}
              onCheckedChange={(v) => cambiar({ dicta_clases: Boolean(v) })}
            />
            <span>
              Aparece en el listado de profesores del formulario
              <span className="text-muted-foreground block text-xs">
                Destildalo para las cuentas administrativas que no dictan clases.
              </span>
            </span>
          </label>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onCerrar}>Cancelar</Button>
          <Button
            onClick={() => onGuardar(datos)}
            disabled={guardando || !datos.nombre.trim() || (esNuevo && !datos.email.trim())}
          >
            {guardando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {esNuevo ? 'Crear la cuenta' : 'Guardar los cambios'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function Profesores({ perfil }: { perfil: Perfil }) {
  const [dialogo, setDialogo] = useState<{ abierto: boolean; editando: UsuarioAdmin | null }>({
    abierto: false, editando: null,
  });
  const [guardando, setGuardando] = useState(false);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [clave, setClave] = useState<{ clave: string; nombre: string } | null>(null);

  const { datos: listado, refrescar: traer } = useRecurso(
    '/api/admin/usuarios',
    () => traerJSON<{ usuarios: UsuarioAdmin[] }>('/api/admin/usuarios'),
  );
  const usuarios = listado?.usuarios ?? null;

  const cerrar = () => { setDialogo({ abierto: false, editando: null }); setErrores({}); };

  async function guardar(datos: Formulario) {
    const editando = dialogo.editando;
    setGuardando(true);
    setErrores({});

    const r = await fetch(
      editando ? `/api/admin/usuarios/${editando.id}` : '/api/admin/usuarios',
      {
        method: editando ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(datos),
      },
    );
    const d = await r.json().catch(() => null);
    setGuardando(false);

    if (!r.ok) {
      if (d?.errores) setErrores(d.errores);
      toast.error(d?.error ?? 'No se pudo guardar.');
      return;
    }

    cerrar();
    if (d?.password) setClave({ clave: d.password, nombre: datos.nombre });
    else toast.success(editando ? 'Cambios guardados' : 'Cuenta creada');
    traer();
  }

  async function cambiar(u: UsuarioAdmin, cambios: Partial<Perfil>) {
    const r = await fetch(`/api/admin/usuarios/${u.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cambios),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok) {
      toast.error(d?.error ?? 'No se pudo guardar el cambio.');
      return;
    }
    toast.success('Cambio guardado', d?.mensaje ? { description: d.mensaje } : undefined);
    traer();
  }

  async function resetear(u: UsuarioAdmin) {
    const r = await fetch(`/api/admin/usuarios/${u.id}/password`, { method: 'POST' });
    const d = await r.json().catch(() => null);
    if (!r.ok) {
      toast.error(d?.error ?? 'No se pudo restablecer la contraseña.');
      return;
    }
    if (d?.password) setClave({ clave: d.password, nombre: u.nombre });
  }

  if (!usuarios) return <Skeleton className="h-64 w-full" />;

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          <span className="cifra">{usuarios.filter((u) => u.activo).length}</span> activas
          {' · '}
          <span className="cifra">{usuarios.filter((u) => u.rol === 'admin').length}</span>{' '}
          con rol de administrador
        </p>
        <Button size="sm" onClick={() => setDialogo({ abierto: true, editando: null })}>
          <Plus className="h-4 w-4" aria-hidden />
          Agregar persona
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Correo</TableHead>
              <TableHead>Cargo</TableHead>
              <TableHead>Rol</TableHead>
              <TableHead>En el formulario</TableHead>
              <TableHead className="text-right">Clases</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="w-px" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {usuarios.map((u) => {
              const yoMismo = u.id === perfil.id;
              return (
                <TableRow key={u.id} className={u.activo ? undefined : 'opacity-60'}>
                  <TableCell className="font-medium">
                    {u.nombre}
                    {yoMismo && (
                      <span className="text-muted-foreground ml-1 text-xs">(vos)</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{u.email}</TableCell>
                  <TableCell>{u.cargo}</TableCell>
                  <TableCell>
                    <Badge variant={u.rol === 'admin' ? 'default' : 'secondary'}>
                      {u.rol === 'admin' ? 'Administrador' : 'Profesor'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Checkbox
                      checked={u.dicta_clases}
                      onCheckedChange={(v) => void cambiar(u, { dicta_clases: Boolean(v) })}
                      aria-label={`${u.nombre} aparece en el listado de profesores`}
                    />
                  </TableCell>
                  <TableCell className="cifra text-right">
                    {u.registros > 0 ? fmt.numero(u.registros) : '—'}
                  </TableCell>
                  <TableCell>
                    {u.activo ? (
                      <span className="text-verde-600 text-sm">Activa</span>
                    ) : (
                      <span className="text-muted-foreground text-sm">Inactiva</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDialogo({ abierto: true, editando: u })}
                        aria-label={`Editar a ${u.nombre}`}
                      >
                        <Pencil className="h-4 w-4" aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void resetear(u)}
                        aria-label={`Restablecer la contraseña de ${u.nombre}`}
                        title="Restablecer contraseña"
                      >
                        <KeyRound className="h-4 w-4" aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={yoMismo}
                        title={yoMismo ? 'No podés desactivarte a vos mismo' : undefined}
                        onClick={() => void cambiar(u, { activo: !u.activo })}
                      >
                        {u.activo ? 'Desactivar' : 'Activar'}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <p className="text-muted-foreground mt-2 text-xs text-balance">
        Las cuentas no se eliminan: se desactivan. La persona deja de poder entrar y sale
        del formulario, pero las clases que cargó siguen contando en las estadísticas.
      </p>

      {dialogo.abierto && (
        <DialogoUsuario
          key={dialogo.editando?.id ?? 'nuevo'}
          editando={dialogo.editando}
          abierto={dialogo.abierto}
          guardando={guardando}
          errores={errores}
          onCerrar={cerrar}
          onGuardar={guardar}
        />
      )}

      {clave && (
        <ClaveGenerada
          clave={clave.clave}
          nombre={clave.nombre}
          onCerrar={() => setClave(null)}
        />
      )}
    </>
  );
}
