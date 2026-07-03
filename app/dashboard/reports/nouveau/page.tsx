import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

const ADMIN_EMAIL = 'nouvion.theo51@gmail.com'

// Cette page redirige :
// - Admin → /admin/reports/nouveau (espace dédié à la génération)
// - Client → /dashboard/reports (lecture seule)
export default async function NouveauRapportPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (user.email === ADMIN_EMAIL) redirect('/admin/reports/nouveau')
  redirect('/dashboard/reports')
}
