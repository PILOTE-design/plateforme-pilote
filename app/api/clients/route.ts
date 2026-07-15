import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAdminEmails } from '@/lib/admins'
import { Resend } from 'resend'

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { name, email, phone, siret, address } = await req.json()
  if (!name || !email) return NextResponse.json({ error: 'Nom et email requis' }, { status: 400 })

  const { data, error } = await supabase
    .from('clients')
    .insert({ user_id: user.id, name, email, phone: phone || null, siret: siret || null, address: address || null })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Notification email to admin
  try {
    const resend = new Resend(process.env.RESEND_API_KEY ?? '')
    const createdAt = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    await resend.emails.send({
      from: 'PILOTE <onboarding@resend.dev>',
      to: getAdminEmails(),
      subject: `[PILOTE] Nouveau client créé — ${name}`,
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
          <div style="background:#1E3A5F;padding:24px 32px">
            <div style="color:#FF8C00;font-size:10px;letter-spacing:4px;margin-bottom:6px">PILOTE</div>
            <h2 style="color:#fff;margin:0;font-size:18px">Nouveau compte client créé</h2>
          </div>
          <div style="padding:28px 32px;border:1px solid #E0E0E0;border-top:none">
            <table style="width:100%;border-collapse:collapse;font-size:14px">
              <tr style="border-bottom:1px solid #f0f0f0">
                <td style="padding:10px 0;color:#888;width:130px">Nom</td>
                <td style="padding:10px 0;font-weight:600;color:#1a1a1a">${name}</td>
              </tr>
              <tr style="border-bottom:1px solid #f0f0f0">
                <td style="padding:10px 0;color:#888">Email</td>
                <td style="padding:10px 0;color:#1a1a1a">${email}</td>
              </tr>
              ${phone ? `<tr style="border-bottom:1px solid #f0f0f0"><td style="padding:10px 0;color:#888">Téléphone</td><td style="padding:10px 0;color:#1a1a1a">${phone}</td></tr>` : ''}
              ${siret ? `<tr style="border-bottom:1px solid #f0f0f0"><td style="padding:10px 0;color:#888">SIRET</td><td style="padding:10px 0;color:#1a1a1a">${siret}</td></tr>` : ''}
              ${address ? `<tr style="border-bottom:1px solid #f0f0f0"><td style="padding:10px 0;color:#888">Adresse</td><td style="padding:10px 0;color:#1a1a1a">${address}</td></tr>` : ''}
              <tr>
                <td style="padding:10px 0;color:#888">Créé le</td>
                <td style="padding:10px 0;color:#1a1a1a">${createdAt}</td>
              </tr>
            </table>
            <div style="margin-top:24px;text-align:center">
              <a href="https://plateforme-pilote.vercel.app/admin/clients"
                 style="background:#1E3A5F;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:14px">
                Voir le client dans PILOTE
              </a>
            </div>
          </div>
          <p style="text-align:center;color:#bbb;font-size:11px;margin-top:12px">PILOTE · Notification automatique</p>
        </div>
      `,
    })
  } catch (emailErr) {
    // Ne pas bloquer la création si l'email échoue
    console.error('Notification email failed:', emailErr)
  }

  return NextResponse.json(data)
}
