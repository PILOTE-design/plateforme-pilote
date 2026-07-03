import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { sendWelcomeEmail } from '@/lib/resend'
import { Resend } from 'resend'

const ADMIN_EMAIL = 'nouvion.theo51@gmail.com'

export async function POST(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  }

  const { businessName, city, deliveryEmail, googleDriveFolder } = await request.json()

  if (!businessName || !city || !deliveryEmail) {
    return NextResponse.json({ error: 'Champs obligatoires manquants' }, { status: 400 })
  }

  // 1. Update profile
  const { error } = await supabase
    .from('profiles')
    .update({
      business_name: businessName,
      city,
      delivery_email: deliveryEmail,
      google_drive_folder: googleDriveFolder || null,
      onboarding_completed: true,
    })
    .eq('user_id', user.id)

  if (error) {
    console.error('Supabase onboarding error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // 2. Auto-create client record (service client to bypass RLS)
  try {
    const serviceSupabase = createServiceClient()

    // Find admin user ID
    const { data: adminUsers } = await serviceSupabase.auth.admin.listUsers()
    const adminUser = adminUsers?.users?.find((u: { email?: string }) => u.email === ADMIN_EMAIL)

    // Insert client record (skip if email already exists)
    await serviceSupabase
      .from('clients')
      .upsert(
        {
          user_id: adminUser?.id ?? null,
          name: businessName,
          email: deliveryEmail,
          client_user_id: user.id,
        },
        { onConflict: 'email', ignoreDuplicates: true }
      )
  } catch (clientErr) {
    console.error('Auto client creation failed:', clientErr)
  }

  // 3. Welcome email to the new user
  try {
    await sendWelcomeEmail(deliveryEmail, businessName)
  } catch (emailError) {
    console.error('Erreur envoi email welcome:', emailError)
  }

  // 4. Notification email to admin
  try {
    const resend = new Resend(process.env.RESEND_API_KEY ?? '')
    const createdAt = new Date().toLocaleDateString('fr-FR', {
      day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
    await resend.emails.send({
      from: 'PILOTE <onboarding@resend.dev>',
      to: ADMIN_EMAIL,
      subject: `[PILOTE] Nouvelle inscription — ${businessName}`,
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
          <div style="background:#1E3A5F;padding:24px 32px">
            <div style="color:#FF8C00;font-size:10px;letter-spacing:4px;margin-bottom:6px">PILOTE</div>
            <h2 style="color:#fff;margin:0;font-size:18px">Nouvelle inscription sur la plateforme</h2>
          </div>
          <div style="padding:28px 32px;border:1px solid #E0E0E0;border-top:none">
            <table style="width:100%;border-collapse:collapse;font-size:14px">
              <tr style="border-bottom:1px solid #f0f0f0">
                <td style="padding:10px 0;color:#888;width:130px">Commerce</td>
                <td style="padding:10px 0;font-weight:600;color:#1a1a1a">${businessName}</td>
              </tr>
              <tr style="border-bottom:1px solid #f0f0f0">
                <td style="padding:10px 0;color:#888">Ville</td>
                <td style="padding:10px 0;color:#1a1a1a">${city}</td>
              </tr>
              <tr style="border-bottom:1px solid #f0f0f0">
                <td style="padding:10px 0;color:#888">Email compte</td>
                <td style="padding:10px 0;color:#1a1a1a">${user.email}</td>
              </tr>
              <tr style="border-bottom:1px solid #f0f0f0">
                <td style="padding:10px 0;color:#888">Email rapports</td>
                <td style="padding:10px 0;color:#1a1a1a">${deliveryEmail}</td>
              </tr>
              <tr>
                <td style="padding:10px 0;color:#888">Inscrit le</td>
                <td style="padding:10px 0;color:#1a1a1a">${createdAt}</td>
              </tr>
            </table>
            <div style="margin-top:24px;text-align:center">
              <a href="https://plateforme-pilote.vercel.app/admin/clients"
                 style="background:#1E3A5F;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:14px">
                Voir dans PILOTE Admin
              </a>
            </div>
          </div>
          <p style="text-align:center;color:#bbb;font-size:11px;margin-top:12px">PILOTE · Notification automatique</p>
        </div>
      `,
    })
  } catch (notifErr) {
    console.error('Admin notification failed:', notifErr)
  }

  return NextResponse.json({ success: true })
}
