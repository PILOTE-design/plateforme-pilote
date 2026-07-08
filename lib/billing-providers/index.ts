export { pennylane } from './pennylane'
export { sage }      from './sage'
export { cegid }     from './cegid'
export { ebp }       from './ebp'
export type { BillingProvider, ProviderInvoice, SyncResult } from './types'

import { pennylane } from './pennylane'
import { sage }      from './sage'
import { cegid }     from './cegid'
import { ebp }       from './ebp'
import type { BillingProvider } from './types'

export const PROVIDERS: Record<string, BillingProvider> = {
  pennylane,
  sage,
  cegid,
  ebp,
}
