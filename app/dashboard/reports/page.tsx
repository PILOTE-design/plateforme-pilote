import { createClient, createServiceClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import Link from 'next/link'
import { ReportsTree } from './ReportsTree'
import { isAdminEmail } from '@/lib/admins'

export default async function ReportsPage() {
  const supabase = createClient()
  const serviceSupabase = createServiceClient()
  const { data: { user } } = await supabase.auth.getUser()
  const isAdmin = isAdminEmail(user?.email)

  const { data: clientRecord } = await serviceSupabase
    .from('clients')
    .select('id')
    .eq('client_user_id', user?.id ?? '')
    .maybeSingle()
  const isClientUser = !!clientRecord

  let reports: { id: string; title: string; file_url: string; created_at: string }[] = []

  if (isClientUser && clientRecord) {
    const { data } = await serviceSupabase
      .from('reports')
      .select('id, title, file_url, created_at')
      .eq('client_id', clientRecord.id)
      .order('created_at', { ascending: false })
    reports = data ?? []
  } else {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('user_id', user?.id ?? '')
      .single()
    const { data } = await supabase
      .from('reports')
      .select('id, title, file_url, created_at')
      .eq('profile_id', profile?.id ?? '')
      .order('created_at', { ascending: false })
    reports = data ?? []
  }

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">Rapports</h1>
          <p className="text-sm text-gray-500 mt-1">Vos analyses comparatives hebdomadaires</p>
        </div>
        {isAdmin && (
          <Link href="/admin/reports/nouveau">
            <Button className="bg-pilote hover:bg-pilote-hover text-white"><Plus className="w-4 h-4 mr-2" />Nouveau rapport</Button>
          </Link>
        )}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Historique</CardTitle>
          <CardDescription>Naviguez par année et par mois</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ReportsTree reports={reports} />
        </CardContent>
      </Card>
    </div>
  )
}
