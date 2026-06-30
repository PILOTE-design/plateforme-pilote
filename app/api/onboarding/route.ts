import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendWelcomeEmail } from '@/lib/resend'

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

  try {
    await sendWelcomeEmail(deliveryEmail, businessName)
  } catch (emailError) {
    console.error('Erreur envoi email welcome:', emailError)
  }

  return NextResponse.json({ success: true })
}
