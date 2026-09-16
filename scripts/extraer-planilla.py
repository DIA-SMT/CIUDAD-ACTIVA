# -*- coding: utf-8 -*-
"""Extrae la planilla completa a supabase/datos-planilla.json."""
import openpyxl, collections, json, sys, unicodedata, os
sys.stdout.reconfigure(encoding='utf-8')

SRC = r'C:\Users\Matías Lujan\Downloads\Asistencia Ciudad Activa.xlsx'
DST = r'C:\Users\Matías Lujan\ciudad-activa\supabase\datos-planilla.json'
wb = openpyxl.load_workbook(SRC, data_only=True)


def norm(s):
    s = unicodedata.normalize('NFD', str(s))
    return ''.join(c for c in s if unicodedata.category(c) != 'Mn').lower().strip()


def leer(hoja):
    ws = wb[hoja]
    rows = list(ws.iter_rows(values_only=True))
    hdr = rows[0]

    def col(k):
        for i, h in enumerate(hdr):
            if h and k in norm(h):
                return i
        return None

    ix = {k: col(k) for k in ['marca', 'correo', 'fecha', 'profesor', 'lugar',
                              'cantidad de alumnos', 'alumnos nuevos', 'varones',
                              'mujeres', 'observaciones', 'estado']}
    out = []
    for r in rows[1:]:
        if not any(c is not None and str(c).strip() != '' for c in r):
            continue
        out.append({k: (r[i] if i is not None else None) for k, i in ix.items()})
    return out


# "BD" es un subconjunto de "Respuestas de formulario": se unen las dos y se
# deduplica por marca temporal, que es la identidad de cada envio del formulario.
todas = leer('Respuestas de formulario') + leer('BD')
vistas, U = set(), []
for r in todas:
    m = str(r['marca'])[:19] if r['marca'] else None
    if not m or m in vistas:
        continue
    vistas.add(m)
    U.append(r)
U.sort(key=lambda r: (str(r['fecha'])[:10], str(r['marca'])))

CANON = {'prof. nicolas suaya': 'Prof. Nicolás Suaya'}


def canon_prof(p):
    return CANON.get(norm(p), str(p).strip())


def split_cargo(l):
    if l.startswith('Prof. '):
        return 'Profesor', l[6:].strip()
    if l.startswith('Coordinador '):
        return 'Coordinador', l[12:].strip()
    return 'Profesor', l


def ent(v):
    if v is None or str(v).strip() == '':
        return None
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


FERIADO = ['feriado', 'patria', 'asueto', 'no laborable', 'semana santa', 'jueves santo',
           'viernes santo', 'san miguel', 'navidad', 'ano nuevo', 'carnaval',
           'dia del trabajador']
CLIMA = ['clima', 'lluvia', 'llovi', 'tormenta', 'viento', 'granizo', 'inclemencia',
         'mal tiempo', 'diluvi']
NO_DICT = ['suspend', 'no se dicto', 'no se dio', 'no hubo clase', 'cancel', 'no realizada',
           'no se realizo', 'sin clases', 'sin clase', 'no se pudo dar', 'no se dictaron']


def clasificar(r):
    """Devuelve (codigo, inferido, conflicto).

    La columna "Estado de la clase" se agrego al formulario el 11/05/2026. En los
    registros anteriores hay que deducirla de las observaciones: sin esto, 57
    clases suspendidas entrarian como realizadas y el tablero mostraria cero
    suspensiones en todo el primer ano del programa.
    """
    e = r['estado']
    total = ent(r['cantidad de alumnos'])
    o = norm(r['observaciones'] or '')

    if e:
        n = norm(e)
        cod = ('susp_clima' if 'climatic' in n
               else 'susp_feriado' if 'feriado' in n
               else 'susp_otro' if 'suspend' in n
               else 'normal')
        # Lo declarado manda, pero si dice normal con cero alumnos y la observacion
        # habla de una suspension, se marca para que alguien lo revise.
        conflicto = (cod == 'normal' and (total or 0) == 0
                     and any(s in o for s in NO_DICT + CLIMA + FERIADO))
        return cod, False, conflicto

    # Con gente presente, la clase se dio, diga lo que diga la observacion.
    if total is not None and total > 0:
        return 'normal', True, False

    if any(f in o for f in FERIADO):
        return 'susp_feriado', True, False
    if any(c in o for c in CLIMA):
        return 'susp_clima', True, False
    if any(s in o for s in NO_DICT):
        return 'susp_otro', True, False

    # Sin total declarado y sin pistas: no se puede afirmar que se haya dictado.
    if total is None:
        return 'susp_otro', True, False
    # Total cero sin explicacion: la clase se dio y no fue nadie.
    return 'normal', True, False


NOMBRE_ESTADO = {
    'normal': 'Clase normal',
    'susp_clima': 'Suspendida por factores climaticos',
    'susp_feriado': 'Suspendida por feriado',
    'susp_otro': 'Suspendida por otro motivo',
}


def obs(v, estado_nombre):
    if v is None:
        return ''
    s = str(v).strip()
    if s in ('0', '0.0', '-', 'Nada', 'nada', 'Ninguna', 'Ninguno', 'ninguna', 'ninguno'):
        return ''
    if estado_nombre and norm(s) == norm(estado_nombre):
        return ''
    return s


# --- catalogos sobre el universo completo ---
pe = collections.Counter()
places = collections.Counter()
for r in U:
    if r['profesor'] and r['correo']:
        pe[(canon_prof(r['profesor']), str(r['correo']).strip().lower())] += 1
    if r['lugar']:
        places[str(r['lugar']).strip()] += 1

best = {}
for (p, e), c in pe.items():
    if p not in best or c > best[p][1]:
        best[p] = (e, c)

profesores = []
for label in sorted(best):
    email, _ = best[label]
    cargo, nombre = split_cargo(label)
    profesores.append({'etiqueta': label, 'nombre': nombre, 'cargo': cargo, 'email': email})

lugares = [{'nombre': n, 'registros_historicos': c} for n, c in places.most_common()]

registros = []
inferidos = conflictos = 0
for r in U:
    cod, inferido, conflicto = clasificar(r)
    inferidos += 1 if inferido else 0
    conflictos += 1 if conflicto else 0
    registros.append({
        'marca_temporal': str(r['marca'])[:19],
        'email_responsable': str(r['correo']).strip().lower() if r['correo'] else None,
        'profesor': canon_prof(r['profesor']) if r['profesor'] else None,
        'fecha': str(r['fecha'])[:10] if r['fecha'] else None,
        'lugar': str(r['lugar']).strip() if r['lugar'] else None,
        'alumnos_total': ent(r['cantidad de alumnos']) or 0,
        'alumnos_nuevos': ent(r['alumnos nuevos']) or 0,
        'varones': ent(r['varones']) or 0,
        'mujeres': ent(r['mujeres']) or 0,
        'estado_codigo': cod,
        'estado_inferido': inferido,
        'estado_en_conflicto': conflicto,
        'observaciones': obs(r['observaciones'], NOMBRE_ESTADO[cod]),
    })

seed = {
    '_origen': 'Asistencia Ciudad Activa.xlsx',
    '_nota': ('Planilla completa. La hoja "BD" resulto ser un subconjunto de "Respuestas de '
              'formulario": se unen las dos y se deduplica por marca temporal, que identifica '
              'cada envio. La columna "Estado de la clase" se agrego al formulario el '
              '11/05/2026; en los registros anteriores se deduce de las observaciones y queda '
              'marcado con estado_inferido.'),
    'profesores': profesores,
    'lugares': lugares,
    'estados_clase': list(NOMBRE_ESTADO.values()),
    'registros': registros,
}

with open(DST, 'w', encoding='utf-8') as f:
    json.dump(seed, f, ensure_ascii=False, indent=1)

print(f'registros:  {len(registros)}   (estado inferido en {inferidos}, conflictos {conflictos})')
print(f'profesores: {len(profesores)}   lugares: {len(lugares)}')
print('estados:   ', dict(collections.Counter(x['estado_codigo'] for x in registros)))
malos = [x for x in registros if x['varones'] + x['mujeres'] != x['alumnos_total']]
print(f'filas que la base rechazara por el CHECK del REQ 4: {len(malos)}')
for x in malos:
    print(f"   {x['fecha']}  {x['lugar'][:24]:24s} total={x['alumnos_total']:>4} "
          f"v={x['varones']:>3} m={x['mujeres']:>3}")
print(f'tamaño del archivo: {os.path.getsize(DST) // 1024} KB')
