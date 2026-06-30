export type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'unpaid'

export interface Profile {
  id: string
  user_id: string
  business_name: string
  city: string
  delivery_email: string
  google_drive_folder: string | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  subscription_status: SubscriptionStatus | null
  onboarding_completed: boolean
  created_at: string
  updated_at: string
}

export interface Report {
  id: string
  profile_id: string
  title: string
  week_number: number
  year: number
  file_url: string
  created_at: string
}
