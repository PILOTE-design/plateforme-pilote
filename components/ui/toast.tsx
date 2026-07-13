'use client'

import * as React from 'react'
import * as ToastPrimitive from '@radix-ui/react-toast'
import { CheckCircle, AlertTriangle, Info, X } from 'lucide-react'

// ─── Toasts PILOTE — remplace les alert() natifs ─────────────────────────────
// Usage : const { toast } = useToast()
//         toast({ variant: 'error', title: 'Enregistrement impossible', description: '...' })

export type ToastVariant = 'success' | 'error' | 'info'

export interface ToastOptions {
  title: string
  description?: string
  variant?: ToastVariant
  duration?: number
}

type ToastItem = ToastOptions & { id: number }

const ToastContext = React.createContext<{ toast: (opts: ToastOptions) => void } | null>(null)

export function useToast() {
  const ctx = React.useContext(ToastContext)
  if (!ctx) throw new Error('useToast doit être utilisé à l’intérieur de <ToastProvider>')
  return ctx
}

const VARIANT_META: Record<ToastVariant, { icon: React.ElementType; iconClass: string; barClass: string }> = {
  success: { icon: CheckCircle,   iconClass: 'text-green-600', barClass: 'bg-green-500' },
  error:   { icon: AlertTriangle, iconClass: 'text-red-500',   barClass: 'bg-red-500'   },
  info:    { icon: Info,          iconClass: 'text-pilote',    barClass: 'bg-pilote'    },
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([])
  const idRef = React.useRef(0)

  const toast = React.useCallback((opts: ToastOptions) => {
    idRef.current += 1
    setToasts(prev => [...prev, { variant: 'info', ...opts, id: idRef.current }])
  }, [])

  const dismiss = React.useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ toast }}>
      <ToastPrimitive.Provider swipeDirection="right">
        {children}
        {toasts.map(t => {
          const meta = VARIANT_META[t.variant ?? 'info']
          const Icon = meta.icon
          return (
            <ToastPrimitive.Root
              key={t.id}
              duration={t.duration ?? 5000}
              onOpenChange={open => { if (!open) dismiss(t.id) }}
              className="relative overflow-hidden bg-white border border-gray-100 rounded-xl shadow-card-hover p-4 pl-5 pr-10 flex items-start gap-3
                data-[state=open]:animate-[toast-in_180ms_ease-out]
                data-[state=closed]:animate-[toast-out_150ms_ease-in]
                data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)]
                data-[swipe=cancel]:translate-x-0 data-[swipe=cancel]:transition-transform
                data-[swipe=end]:animate-[toast-out_120ms_ease-in]"
            >
              <span className={`absolute inset-y-0 left-0 w-1 ${meta.barClass}`} aria-hidden />
              <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${meta.iconClass}`} />
              <div className="min-w-0">
                <ToastPrimitive.Title className="text-sm font-semibold text-gray-900">{t.title}</ToastPrimitive.Title>
                {t.description && (
                  <ToastPrimitive.Description className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                    {t.description}
                  </ToastPrimitive.Description>
                )}
              </div>
              <ToastPrimitive.Close
                aria-label="Fermer"
                className="absolute top-3 right-3 p-1 rounded-lg text-gray-300 hover:text-gray-500 hover:bg-gray-50 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </ToastPrimitive.Close>
            </ToastPrimitive.Root>
          )
        })}
        <ToastPrimitive.Viewport className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-[360px] max-w-[calc(100vw-2rem)] outline-none" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  )
}
