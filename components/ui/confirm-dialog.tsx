'use client'

import * as React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AlertTriangle, HelpCircle } from 'lucide-react'

// ─── Dialogue de confirmation PILOTE — remplace les confirm() natifs ─────────
// Usage : const { confirm } = useConfirm()
//         if (!(await confirm({ title: 'Supprimer ?', variant: 'danger' }))) return

export interface ConfirmOptions {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  /** 'danger' = action destructrice (bouton rouge) ; 'default' = bouton navy */
  variant?: 'danger' | 'default'
}

type PendingConfirm = ConfirmOptions & { resolve: (value: boolean) => void }

const ConfirmContext = React.createContext<{ confirm: (opts: ConfirmOptions) => Promise<boolean> } | null>(null)

export function useConfirm() {
  const ctx = React.useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm doit être utilisé à l’intérieur de <ConfirmProvider>')
  return ctx
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = React.useState<PendingConfirm | null>(null)

  const confirm = React.useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>(resolve => setPending({ ...opts, resolve }))
  }, [])

  function close(result: boolean) {
    pending?.resolve(result)
    setPending(null)
  }

  const danger = pending?.variant !== 'default'
  const Icon = danger ? AlertTriangle : HelpCircle

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {pending && (
        <Dialog.Root open onOpenChange={open => { if (!open) close(false) }}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 animate-[fade-in_150ms_ease-out]" />
            <Dialog.Content
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6 animate-[dialog-in_180ms_ease-out] focus:outline-none"
              onOpenAutoFocus={e => e.preventDefault()}
            >
              <div className="flex items-start gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${danger ? 'bg-red-50' : 'bg-pilote-50'}`}>
                  <Icon className={`w-5 h-5 ${danger ? 'text-red-500' : 'text-pilote'}`} />
                </div>
                <div className="min-w-0 pt-0.5">
                  <Dialog.Title className="text-base font-bold text-gray-900 leading-snug">{pending.title}</Dialog.Title>
                  {pending.description && (
                    <Dialog.Description className="text-sm text-gray-500 mt-1 leading-relaxed">
                      {pending.description}
                    </Dialog.Description>
                  )}
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => close(false)}
                  className="flex-1 h-9 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  {pending.cancelLabel ?? 'Annuler'}
                </button>
                <button
                  onClick={() => close(true)}
                  className={`flex-1 h-9 rounded-lg text-sm font-semibold text-white transition-colors ${
                    danger ? 'bg-red-600 hover:bg-red-700' : 'bg-pilote hover:bg-pilote-hover'
                  }`}
                >
                  {pending.confirmLabel ?? 'Confirmer'}
                </button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </ConfirmContext.Provider>
  )
}
