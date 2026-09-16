import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Rutas que se pueden ver sin sesion iniciada.
const PUBLICAS = ['/ingresar', '/auth'];

/**
 * Corre en cada pedido (en Next 16 esto es proxy.ts; antes era middleware.ts).
 * Hace dos cosas:
 *  1. Refresca el token de Supabase y reescribe las cookies, para que la
 *     sesion no se caiga sola mientras el profesor completa el formulario.
 *  2. Manda al ingreso a quien no tenga sesion.
 */
export default async function proxy(pedido: NextRequest) {
  let respuesta = NextResponse.next({ request: pedido });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => pedido.cookies.getAll(),
        setAll: (galletas) => {
          for (const { name, value } of galletas) pedido.cookies.set(name, value);
          respuesta = NextResponse.next({ request: pedido });
          for (const { name, value, options } of galletas) {
            respuesta.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser() valida el token contra Supabase. No reemplazarlo por getSession():
  // ese lee la cookie sin verificar y no sirve para decidir un permiso.
  const { data: { user } } = await supabase.auth.getUser();

  const ruta = pedido.nextUrl.pathname;
  const esPublica = PUBLICAS.some((p) => ruta === p || ruta.startsWith(`${p}/`));

  if (!user && !esPublica) {
    // La API contesta en JSON: un redirect 307 haria que fetch reciba HTML.
    if (ruta.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'Necesitás iniciar sesión.' },
        { status: 401 },
      );
    }
    const destino = pedido.nextUrl.clone();
    destino.pathname = '/ingresar';
    destino.searchParams.set('volver', ruta);
    return NextResponse.redirect(destino);
  }

  // Con sesion activa, el ingreso no tiene sentido.
  if (user && ruta === '/ingresar') {
    const destino = pedido.nextUrl.clone();
    destino.pathname = '/';
    destino.search = '';
    return NextResponse.redirect(destino);
  }

  return respuesta;
}

export const config = {
  // Se excluyen los archivos estaticos: no necesitan sesion y encarecerian
  // cada pedido con una verificacion de token al pedazo.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
