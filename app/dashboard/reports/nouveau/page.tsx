import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isAdminEmail } from '@/lib/admins'

// Cette page redirige :
// - Admin → /admin/reports/nouveau (espace dédié à la génération)
// - Client → /dashboard/reports (lecture seule)
export default async function NouveauRapportPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (isAdminEmail(user.email)) redirect('/admin/reports/nouveau')
  redirect('/dashboard/reports')
}
