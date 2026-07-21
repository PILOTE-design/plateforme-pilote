import { resend } from '@/lib/resend'

// ─── Envoi du planning individuel par email ───────────────────────────
// Partagé entre le bouton « Envoyer aux employés » (page planning) et le cron
// du dimanche soir. Chaque employé reçoit UNIQUEMENT ses propres horaires —
// aucune donnée financière (taux, coûts, salaires) n'apparaît dans l'email.

const JOURS_DB = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const
const JOURS_LABEL = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']
const POSTES: Record<string, string> = {
  boucherie: 'Boucherie', charcuterie: 'Charcuterie', traiteur: 'Traiteur',
  vente: 'Vente', administratif: 'Administratif', livraison: 'Livraison',
}

function getWeekDates(week: number, year: number): Date[] {
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const dow = jan4.getUTCDay() || 7
  const mon = new Date(jan4)
  mon.setUTCDate(jan4.getUTCDate() - dow + 1 + (week - 1) * 7)
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(mon); d.setUTCDate(mon.getUTCDate() + i); return d })
}

function fmtH(h: number): string {
  const hInt = Math.floor(h)
  const min = Math.round((h - hInt) * 60)
  return min === 0 ? `${hInt}h` : `${hInt}h${String(min).padStart(2, '0')}`
}

/** Libellé d'un créneau : horaires + poste, ex. « 8h30 – 12h30 (Boucherie) » */
function slotLabel(sd: any, slot: 'matin' | 'apmidi'): string {
  const debut = sd?.[`${slot}_debut`]
  const fin = sd?.[`${slot}_fin`]
  const cat = POSTES[sd?.[`categorie_${slot}`] || sd?.categorie || '']
  if (!debut && !cat) return ''
  const horaire = debut ? `${debut} – ${fin || '?'}` : ''
  return [horaire, cat ? `(${cat})` : ''].filter(Boolean).join(' ')
}

function dayCell(entry: any, j: string, idx: number): string {
  const type = entry?.[`${j}_type`] || (idx >= 5 ? 'repos' : 'travail')
  if (type === 'conges') return '<span style="color:#0369a1;font-weight:600;">Congé payé</span>'
  if (type === 'maladie') return '<span style="color:#b91c1c;font-weight:600;">Arrêt maladie</span>'
  if (type === 'repos') return '<span style="color:#94a3b8;">Repos</span>'
  const sd = ((entry?.schedule_details || {}) as any)[j] || {}
  const m = slotLabel(sd, 'matin')
  const a = slotLabel(sd, 'apmidi')
  const h = Number(entry?.[j]) || 0
  const lines: string[] = []
  if (m) lines.push(`Matin&nbsp;: ${m}`)
  if (a) lines.push(`A-midi&nbsp;: ${a}`)
  if (lines.length === 0) return h > 0 ? `<strong>${fmtH(h)}</strong>` : '<span style="color:#94a3b8;">—</span>'
  return lines.join('<br>') + (h > 0 ? `<br><strong>${fmtH(h)}</strong>` : '')
}

/** Horodatage de l'envoi (heure de Paris) — rend chaque email UNIQUE :
 *  sans lui, Gmail regroupe les renvois dans une même conversation (1, 2, 3…). */
function sendStamp(): string {
  const now = new Date()
  const d = now.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Paris' })
  const t = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' })
  return `${d} ${t.replace(':', 'h')}`
}

function buildHtml(empName: string, businessName: string, week: number, entry: any, dates: Date[], stamp: string): string {
  const fmtD = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  let totalH = 0
  const rows = JOURS_DB.map((j, idx) => {
    const type = entry?.[`${j}_type`] || (idx >= 5 ? 'repos' : 'travail')
    if (type === 'travail') totalH += Number(entry?.[j]) || 0
    const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc'
    return `<tr style="background:${bg};">
      <td style="padding:9px 12px;font-weight:700;color:#1E3A5F;white-space:nowrap;border-bottom:1px solid #e2e8f0;">${JOURS_LABEL[idx]} ${fmtD(dates[idx])}</td>
      <td style="padding:9px 12px;color:#334155;border-bottom:1px solid #e2e8f0;font-size:14px;">${dayCell(entry, j, idx)}</td>
    </tr>`
  }).join('')
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1e293b;">
    <div style="background:#1E3A5F;border-radius:12px 12px 0 0;padding:20px 24px;">
      <p style="margin:0;color:#ffffff;font-size:18px;font-weight:800;">Votre planning — Semaine ${week}</p>
      <p style="margin:4px 0 0;color:rgba(255,255,255,.7);font-size:13px;">${businessName} · du ${fmtD(dates[0])} au ${fmtD(dates[6])}</p>
    </div>
    <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;overflow:hidden;">
      <p style="margin:0;padding:14px 24px 6px;font-size:14px;">Bonjour ${empName},</p>
      <p style="margin:0;padding:0 24px 12px;font-size:13px;color:#64748b;">Voici vos horaires pour la semaine ${week} :</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">${rows}</table>
      <p style="margin:0;padding:12px 24px;font-size:13px;background:#f8fafc;border-top:2px solid #1E3A5F;">
        <strong>Total travaillé prévu : ${fmtH(totalH)}</strong>
      </p>
      <p style="margin:0;padding:10px 24px 16px;font-size:11px;color:#94a3b8;">
        Version envoyée le ${stamp} — elle remplace tout planning reçu précédemment pour la semaine ${week}.
        Planning transmis via PILOTE — en cas de question, adressez-vous à votre responsable.
      </p>
    </div>
  </div>`
}

/** Envoie à chaque employé (ayant un email) son planning individuel de la semaine.
 *  Les employés sans entrée de planning cette semaine-là ne reçoivent rien.
 *  La coche « Recevoir le planning par email » de la fiche employé est respectée :
 *  décochée → aucun envoi (compté dans `disabled`). */
export async function sendPlanningEmails(
  service: any,
  clientId: string,
  week: number,
  year: number,
  businessName: string
): Promise<{ sent: number; noEmail: number; noPlanning: number; disabled: number }> {
  const { data: emps } = await service.from('employees').select('id, name, email, receive_planning_email').eq('client_id', clientId)
  const employees = emps || []
  if (employees.length === 0) return { sent: 0, noEmail: 0, noPlanning: 0, disabled: 0 }

  const { data: entries } = await service
    .from('planning_entries')
    .select('*')
    .in('employee_id', employees.map((e: any) => e.id))
    .eq('week_number', week)
    .eq('year', year)
  const byEmp = new Map((entries || []).map((e: any) => [e.employee_id, e]))
  const dates = getWeekDates(week, year)
  // Objet unique par envoi : chaque renvoi apparaît comme un NOUVEAU mail bien distinct
  const stamp = sendStamp()

  let sent = 0, noEmail = 0, noPlanning = 0, disabled = 0
  for (const emp of employees) {
    if (emp.receive_planning_email === false) { disabled++; continue }
    const email = String(emp.email || '').trim()
    if (!email) { noEmail++; continue }
    const entry = byEmp.get(emp.id)
    if (!entry) { noPlanning++; continue }
    try {
      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL!,
        to: email,
        subject: `Votre planning S${week} — ${businessName} · ${stamp}`,
        html: buildHtml(String(emp.name || '').split(' ')[0] || 'bonjour', businessName, week, entry, dates, stamp),
      })
      sent++
    } catch {
      // un échec individuel ne bloque pas les autres envois
    }
  }
  return { sent, noEmail, noPlanning, disabled }
}
