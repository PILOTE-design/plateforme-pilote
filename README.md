# PILOTE — plateforme-pilote

Plateforme de pilotage pour boucheries artisanales : rapport hebdomadaire, marges par famille, facturation fournisseurs (Pennylane + e-mail), mercuriale des prix d'achat, fiches recettes, planning CCN 992, production et valorisation carcasse.

**Production : [getpilote.app](https://getpilote.app)** — déployée par Vercel à chaque merge sur `main`.

## Stack

- Next.js 14 (App Router) · TypeScript · Tailwind
- Supabase (Postgres + RLS, service role côté serveur)
- Vercel (hébergement, crons)
- Anthropic (lecture des factures PDF)

## Discipline de livraison

Un lot = une branche = une PR squash-mergée sur `main`. Avant tout merge : `npx tsc -p tsconfig.check.json` (aucune erreur nouvelle par rapport à la baseline) et build complet hors ligne (`_buildcheck/run.sh`, EXIT 0). Chaque fichier poussé est vérifié octet à octet (blob SHA = hash local).
