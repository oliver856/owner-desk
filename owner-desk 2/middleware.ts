import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { clientIp, officeAllowed } from './lib/net';

// Phone pages work from anywhere (they only ever receive a call a laptop in the office started).
// Everything else, the owner list and unit pages, only works from the office IP.
const ANYWHERE = ['/login', '/phone', '/api/phone', '/api/logout'];

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const anywhere = ANYWHERE.some((p) => path === p || path.startsWith(p + '/'));
  const ip = clientIp(req.headers);

  if (!anywhere && !officeAllowed(ip)) {
    return new NextResponse('The Owner Desk only works from the Apex office network.', { status: 403 });
  }

  let res = NextResponse.next({ request: req });
  const sb = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => req.cookies.set(name, value));
          res = NextResponse.next({ request: req });
          list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
        },
      },
    },
  );
  // Checks the session token's signature (locally where possible) and refreshes it when it expires
  const { data } = await sb.auth.getClaims();
  const signedIn = !!data?.claims?.sub;

  if (!signedIn && path !== '/login') {
    if (path.startsWith('/api/')) return NextResponse.json({ error: 'Signed out' }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = path.startsWith('/phone') ? '?next=/phone' : '';
    return NextResponse.redirect(url);
  }
  return res;
}

export const config = {
  // Static files the phone needs before signing in are never gated
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sw.js|icon.svg|manifest.webmanifest).*)'],
};
