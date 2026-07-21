'use client'

import { useState, useEffect } from 'react'
import { X, Save, User, Phone, Mail, FileText, Calendar, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// ─── Types ────────────────────────────────────────────────────────────────────────

export interface EmployeeProfile {
  id: string
  name: string
  hourly_rate: number
  contract_type: string
  contract_hours: number
  cp_initial: number
  charges_patronales: number
  hs_cumules: number
  // Champs RH
  position: string | null
  hire_date: string | null
  contract_end_date: string | null
  phone: string | null
  email: string | null
  notes: string | null
  is_minor: boolean
  is_gerant: boolean
  receive_planning_email: boolean
}

interface Props {
  employee: EmployeeProfile | null
  onClose: () => void
  onSaved: (updated: EmployeeProfile) => void
}

const CONTRACT_OPTS = [
  { value: 'CDI_35', label: 'CDI · 35h' },
  { value: 'CDI_39', label: 'CDI · 39h' },
  { value: 'CDD_35', label: 'CDD · 35h' },
  { value: 'CDD_39', label: 'CDD · 39h' },
  { value: 'APPRENTI', label: 'Apprenti' },
  { value: 'INTERIM', label: 'Intérim' },
]

const POSITIONS = [
  'boucher', 'charcutier', 'traiteur', 'vendeur', 'apprenti boucher',
  'apprenti charcutier', 'manager', 'responsable rayon',
]

// ─── Modal Component ────────────────────────────────────────────────────────────────

export default function EmployeeProfileModal({ employee, onClose, onSaved }: Props) {
  const [form, setForm] = useState<EmployeeProfile | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (employee) setForm({ ...employee })
  }, [employee])

  if (!employee || !form) return null

  const set = (field: keyof EmployeeProfile, value: string | number | boolean | null) => {
    setForm(prev => prev ? { ...prev, [field]: value } : prev)
  }

  const handleSave = async () => {
    if (!form) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/employees/${form.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:               form.name,
          hourly_rate:        form.hourly_rate,
          contract_type:      form.contract_type,
          contract_hours:     form.contract_hours,
          cp_initial:         form.cp_initial,
          charges_patronales: form.charges_patronales,
          hs_cumules:         form.hs_cumules,
          position:           form.position || null,
          hire_date:          form.hire_date || null,
          contract_end_date:  form.contract_end_date || null,
          phone:              form.phone || null,
          email:              form.email || null,
          notes:              form.notes || null,
          is_minor:           form.is_minor,
          is_gerant:          form.is_gerant,
          receive_planning_email: form.receive_planning_email,
        }),
      })
      if (!res.ok) {
        const d = await res.json() as { error?: string }
        throw new Error(d.error ?? 'Erreur sauvegarde')
      }
      const updated = await res.json() as EmployeeProfile
      onSaved(updated)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue')
    } finally {
      setSaving(false)
    }
  }

  // Calcul ancienneté
  const seniority = form.hire_date
    ? (() => {
        const diff = Date.now() - new Date(form.hire_date).getTime()
        const years = Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25))
        const months = Math.floor((diff % (1000 * 60 * 60 * 24 * 365.25)) / (1000 * 60 * 60 * 24 * 30.5))
        if (years === 0) return `${months} mois`
        return `${years} an${years > 1 ? 's' : ''} ${months > 0 ? `${months} mois` : ''}`
      })()
    : null

  // Alerte CDD expiration
  const cddAlert = form.contract_end_date && (form.contract_type.startsWith('CDD'))
    ? (() => {
        const diff = new Date(form.contract_end_date).getTime() - Date.now()
        const days = Math.ceil(diff / (1000 * 60 * 60 * 24))
        return days
      })()
    : null

  // Coût réel/h chargé
  const coutCharge = form.hourly_rate * (1 + (form.charges_patronales ?? 45) / 100)

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="bg-[#1E3A5F] rounded-t-2xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center">
              <User className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-white font-bold text-base leading-tight">{employee.name}</p>
              <p className="text-blue-200 text-xs">{form.position || 'Poste non renseigné'}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
            <X className="w-4 h-4 text-white" />
          </button>
        </div>

        {/* Alertes */}
        {form.is_minor && (
          <div className="mx-6 mt-4 flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
            <p className="text-xs text-amber-700 font-medium">Employé mineur — max 8h/jour, 35h/semaine, pas de nuit</p>
          </div>
        )}
        {cddAlert !== null && cddAlert <= 30 && (
          <div className="mx-6 mt-4 flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
            <p className="text-xs text-red-700 font-medium">
              {cddAlert <= 0 ? 'CDD expiré' : `CDD expire dans ${cddAlert} jour${cddAlert > 1 ? 's' : ''}`}
            </p>
          </div>
        )}

        <div className="p-6 space-y-6">

          {/* Section Identité */}
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Identité & Poste
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Nom complet</label>
                <Input
                  value={form.name}
                  onChange={e => set('name', e.target.value)}
                  className="h-9 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Poste</label>
                <select
                  value={form.position ?? ''}
                  onChange={e => set('position', e.target.value || null)}
                  className="w-full h-9 rounded-lg border border-gray-200 bg-white text-sm px-3 focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]/30"
                >
                  <option value="">Sélectionner...</option>
                  {POSITIONS.map(p => (
                    <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2 pt-5">
                <input
                  type="checkbox"
                  id="is_minor"
                  checked={form.is_minor}
                  onChange={e => set('is_minor', e.target.checked)}
                  className="w-4 h-4 rounded accent-[#1E3A5F]"
                />
                <label htmlFor="is_minor" className="text-sm text-gray-700 cursor-pointer">Employé mineur (&lt;18 ans)</label>
              </div>
              <div className="col-span-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_gerant"
                  checked={form.is_gerant}
                  onChange={e => set('is_gerant', e.target.checked)}
                  className="w-4 h-4 rounded accent-[#1E3A5F]"
                />
                <label htmlFor="is_gerant" className="text-sm text-gray-700 cursor-pointer">
                  Gérant / propriétaire — <span className="text-gray-500">heures payées au taux normal, sans majoration d&apos;heures sup ni primes dimanche/férié</span>
                </label>
              </div>
            </div>
          </section>

          {/* Section Contrat */}
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Contrat de Travail
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Type de contrat</label>
                <select
                  value={form.contract_type}
                  onChange={e => {
                    const opt = CONTRACT_OPTS.find(o => o.value === e.target.value)
                    const hours = e.target.value.includes('39') ? 39 : 35
                    set('contract_type', e.target.value)
                    if (opt) set('contract_hours', hours)
                  }}
                  className="w-full h-9 rounded-lg border border-gray-200 bg-white text-sm px-3 focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]/30"
                >
                  {CONTRACT_OPTS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Heures/semaine</label>
                <Input
                  type="number"
                  min={1} max={48}
                  value={form.contract_hours}
                  onChange={e => set('contract_hours', parseFloat(e.target.value) || 35)}
                  className="h-9 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Taux horaire brut (€)</label>
                <Input
                  type="number"
                  min={0} step={0.01}
                  value={form.hourly_rate}
                  onChange={e => set('hourly_rate', parseFloat(e.target.value) || 0)}
                  className="h-9 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Charges patronales (%)</label>
                <Input
                  type="number"
                  min={0} max={100} step={0.5}
                  value={form.charges_patronales}
                  onChange={e => set('charges_patronales', parseFloat(e.target.value) || 45)}
                  className="h-9 text-sm"
                />
              </div>
              <div className="col-span-2">
                <div className="flex items-center gap-2 bg-orange-50 border border-orange-100 rounded-lg px-3 py-2">
                  <span className="text-xs text-orange-700">Coût réel employeur :</span>
                  <span className="text-sm font-bold text-orange-800">{coutCharge.toFixed(2)} €/h chargé</span>
                  <span className="text-xs text-orange-500 ml-auto">({form.hourly_rate.toFixed(2)} € brut × {(1 + (form.charges_patronales ?? 45) / 100).toFixed(2)})</span>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">CP initial (jours)</label>
                <Input
                  type="number"
                  min={0}
                  value={form.cp_initial}
                  onChange={e => set('cp_initial', parseFloat(e.target.value) || 0)}
                  className="h-9 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Solde heures supp (h)</label>
                <Input
                  type="number"
                  step={0.5}
                  value={form.hs_cumules}
                  onChange={e => set('hs_cumules', parseFloat(e.target.value) || 0)}
                  className="h-9 text-sm"
                />
                <p className="text-[10px] text-gray-400 mt-1">Heures HS cumulées (positif = crédit, négatif = dette)</p>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1 flex items-center gap-1">
                  <Calendar className="w-3 h-3" />Date d'embauche
                </label>
                <Input
                  type="date"
                  value={form.hire_date ?? ''}
                  onChange={e => set('hire_date', e.target.value || null)}
                  className="h-9 text-sm"
                />
                {seniority && (
                  <p className="text-xs text-gray-400 mt-1">Ancienneté : {seniority}</p>
                )}
              </div>
              {form.contract_type.startsWith('CDD') && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1 flex items-center gap-1">
                    <Calendar className="w-3 h-3" />Fin de contrat
                  </label>
                  <Input
                    type="date"
                    value={form.contract_end_date ?? ''}
                    onChange={e => set('contract_end_date', e.target.value || null)}
                    className="h-9 text-sm"
                  />
                </div>
              )}
            </div>
          </section>

          {/* Section Coordonnées */}
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Coordonnées
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1 flex items-center gap-1">
                  <Phone className="w-3 h-3" />Téléphone
                </label>
                <Input
                  type="tel"
                  placeholder="06 00 00 00 00"
                  value={form.phone ?? ''}
                  onChange={e => set('phone', e.target.value || null)}
                  className="h-9 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1 flex items-center gap-1">
                  <Mail className="w-3 h-3" />Email
                </label>
                <Input
                  type="email"
                  placeholder="prenom.nom@email.com"
                  value={form.email ?? ''}
                  onChange={e => set('email', e.target.value || null)}
                  className="h-9 text-sm"
                />
              </div>
              <div className="col-span-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="receive_planning_email"
                  checked={form.receive_planning_email}
                  onChange={e => set('receive_planning_email', e.target.checked)}
                  className="w-4 h-4 rounded accent-[#1E3A5F]"
                />
                <label htmlFor="receive_planning_email" className="text-sm text-gray-700 cursor-pointer">
                  Recevoir le planning par email <span className="text-gray-500">(envoi manuel et envoi automatique du dimanche)</span>
                </label>
              </div>
            </div>
          </section>

          {/* Section Notes */}
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5" />Notes
            </h3>
            <textarea
              placeholder="Notes internes, compétences particulières, restrictions médicales, observations..."
              value={form.notes ?? ''}
              onChange={e => set('notes', e.target.value || null)}
              rows={3}
              className="w-full rounded-lg border border-gray-200 bg-white text-sm px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]/30"
            />
          </section>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
              <p className="text-xs text-red-700">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2 border-t border-gray-100">
            <Button
              variant="outline"
              className="flex-1 h-9 text-sm"
              onClick={onClose}
              disabled={saving}
            >
              Annuler
            </Button>
            <Button
              className="flex-1 h-9 text-sm bg-[#1E3A5F] hover:bg-[#2a4f7c] text-white flex items-center justify-center gap-2"
              onClick={handleSave}
              disabled={saving}
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? 'Enregistrement...' : 'Enregistrer'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
