# Intégration — Fiche Employé dans Planning

Le composant `EmployeeProfileModal` est prêt dans `components/EmployeeProfileModal.tsx`.  
Il reste à faire **5 modifications** dans `app/dashboard/planning/page.tsx`.

---

## 1. Ajouter l'import (en haut du fichier, après les imports existants)

```tsx
import EmployeeProfileModal, { EmployeeProfile } from '@/components/EmployeeProfileModal'
```

Ajouter aussi `UserCog` dans l'import lucide-react existant :
```tsx
import { ..., UserCog } from 'lucide-react'
```

---

## 2. Étendre le type `Employee` avec les champs RH

Trouver la définition du type `Employee` et ajouter les champs optionnels :

```tsx
type Employee = {
  id: string
  name: string
  hourly_rate: number
  contract_type: string
  contract_hours: number
  cp_initial: number
  // Champs RH (optionnels — fournis par SELECT *)
  position?: string | null
  hire_date?: string | null
  contract_end_date?: string | null
  phone?: string | null
  email?: string | null
  notes?: string | null
  is_minor?: boolean
}
```

---

## 3. Ajouter le state (dans le corps du composant, avec les autres useState)

```tsx
const [profileEmp, setProfileEmp] = useState<EmployeeProfile | null>(null)
```

---

## 4. Ajouter le bouton "Fiche" à côté du nom de chaque employé

Trouver le bloc où `emp.name` est affiché (dans la liste/colonne des employés) et ajouter un bouton :

```tsx
{/* Avant — affichage du nom uniquement : */}
<span className="...">{emp.name}</span>

{/* Après — ajouter le bouton Fiche : */}
<div className="flex items-center justify-between gap-1">
  <span className="...">{emp.name}</span>
  <button
    onClick={() => setProfileEmp({
      id: emp.id,
      name: emp.name,
      hourly_rate: emp.hourly_rate,
      contract_type: emp.contract_type,
      contract_hours: emp.contract_hours,
      cp_initial: emp.cp_initial ?? 0,
      position: emp.position ?? null,
      hire_date: emp.hire_date ?? null,
      contract_end_date: emp.contract_end_date ?? null,
      phone: emp.phone ?? null,
      email: emp.email ?? null,
      notes: emp.notes ?? null,
      is_minor: emp.is_minor ?? false,
    })}
    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-white/20"
    title="Fiche employé"
  >
    <UserCog className="w-3.5 h-3.5 text-gray-400 hover:text-[#1E3A5F]" />
  </button>
</div>
```

> ⚠️ Le conteneur parent (`<tr>` ou `<div>`) doit avoir la classe `group` pour que le hover fonctionne.

---

## 5. Ajouter la modal avant le `</div>` ou `</main>` fermant du return

```tsx
{/* Fiche employé */}
<EmployeeProfileModal
  employee={profileEmp}
  onClose={() => setProfileEmp(null)}
  onSaved={(updated) => {
    setEmployees(prev => prev.map(e =>
      e.id === updated.id ? { ...e, ...updated } : e
    ))
    setProfileEmp(null)
  }}
/>
```

---

## Résultat attendu

- Clic sur l'icône `UserCog` à côté d'un nom → ouverture de la modal fiche
- Formulaire avec : identité, contrat, dates, coordonnées, notes, statut mineur
- Sauvegarde via `PATCH /api/employees/[id]` (déjà mis à jour pour accepter tous les champs RH)
- Calcul automatique de l'ancienneté, alerte CDD expiration

---

*Composant : `components/EmployeeProfileModal.tsx` — commit `3ead8b6`*  
*API PATCH : `app/api/employees/[id]/route.ts` — commit `c95694a`*
