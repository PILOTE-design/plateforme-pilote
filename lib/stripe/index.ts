import Stripe from 'stripe'

// Clé de repli au build : le constructeur Stripe lève « Neither apiKey nor config.authenticator
// provided » si la clé est absente, ce qui casse `next build` (« Collecting page data »).
// En prod, l'appel Stripe échoue proprement à l'exécution tant que STRIPE_SECRET_KEY n'est pas définie.
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_missing_build_placeholder', {
  apiVersion: '2026-06-24.dahlia',
  typescript: true,
})

export async function createCheckoutSession(userId: string, email: string) {
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    customer_email: email,
    line_items: [
      {
        price: process.env.STRIPE_PRICE_ID!,
        quantity: 1,
      },
    ],
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/onboarding?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/#pricing`,
    metadata: { userId },
    subscription_data: {
      metadata: { userId },
    },
    locale: 'fr',
    currency: 'eur',
  })

  return session
}

export async function createPortalSession(customerId: string) {
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings`,
  })

  return session
}
