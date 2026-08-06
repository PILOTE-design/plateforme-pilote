import { redirect } from 'next/navigation'

// L'écran a été rangé sous le planning : `/dashboard/planning/paie`. Les deux
// travaillent sur la même matière — les heures de la semaine —, et c'est depuis
// le planning qu'on corrige ce que la paie révèle.
//
// Cette page reste, en redirection : un lien mis en favori ou collé dans un
// courriel doit continuer d'ouvrir le bon écran. Une adresse qu'on a donnée à
// quelqu'un ne se supprime pas, elle se réoriente.

export default function AncienneRoutePaie() {
  redirect('/dashboard/planning/paie')
}
