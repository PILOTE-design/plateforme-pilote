import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

// La protection /admin est gérée par app/admin/layout.tsx (createClient SSR)
// Le check middleware créait une race condition : token expiré → user null → redirect
// même pour l'admin légitime.

export async function middleware(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
