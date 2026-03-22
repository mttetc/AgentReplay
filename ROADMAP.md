# Agent Replay — Roadmap

## Diagnostic

L'app est un bon viewer de sessions AI, mais un viewer ne suffit pas — il faut qu'elle **change le comportement** de l'utilisateur pour qu'il la garde installée.

---

## P0 — Raison de revenir ✅

### Onboarding "wow moment"
La page d'accueil montre immédiatement les insights les plus percutants :
- Session la plus coûteuse (lien direct)
- Fichier le plus problématique (score + recommandation)
- Tendance coût vs période précédente (% change)
- Résumé "headline" contextuel en une phrase
- Stats cards: sessions, total cost, avg/session, errors

### Trends temporels
Graphiques Chart.js sur la page d'accueil :
- Coût par jour (line chart avec fill)
- Sessions & erreurs par jour (dual axis)
- Comparaison période courante vs précédente (% dans les cards)

## P1 — Workflow & partage ✅

### Export HTML statique partageable
- Bouton "Export .html" dans le menu Export de la vue session
- Génère un fichier HTML self-contained (CSS inline, données embarquées)
- Ouvrable dans n'importe quel navigateur sans serveur
- `src/lib/utils/export-html.ts`

### Hook post-session Claude Code
- Script `hooks/post-session-summary.sh`
- Affiche: tool calls, errors, tokens, estimated cost
- Instructions d'installation dans le script
- Compatible avec Claude Code Stop hook

### Lien session → Git
- Corrélation session ↔ commits git par timestamp + fichiers touchés
- Section pliable "Related commits" dans la vue session
- `src/lib/server/git-integration.ts`
- Composant réutilisable `GitCommits.svelte`

## P2 — Écosystème & persistence ✅

### Support Aider
- Provider `src/lib/server/providers/aider.ts`
- Parse `.aider.chat.history.md` (markdown format)
- Détection de fichiers référencés dans les commandes
- Scan des répertoires courants (~/Projects, ~/code, etc.)

### Support GitHub Copilot
- Provider `src/lib/server/providers/copilot.ts`
- Parse les JSON de `github.copilot-chat` dans VS Code globalStorage
- Support macOS, Linux, Windows + VS Code Insiders
- Support formats messages et turns

### SQLite local pour persistence
- `src/lib/server/db.ts` — module complet avec:
  - Annotations (remplace localStorage)
  - Bookmarks (nouveau)
  - Tags par session (nouveau)
  - Cache d'analyse (persistant)
- API endpoint `/api/annotations` (GET/POST)
- Migration automatique depuis localStorage
- Fallback localStorage si l'API échoue
- WAL mode pour la performance

---

## P3 — Équipe (futur, non priorisé)

Dashboard équipe, annotations collaboratives, export Slack/GitHub.

---

## Architecture

### Fichiers créés
```
hooks/post-session-summary.sh     — Hook Claude Code
src/lib/server/db.ts              — SQLite persistence layer
src/lib/server/git-integration.ts — Git commit correlation
src/lib/utils/export-html.ts      — Static HTML export
src/lib/server/providers/aider.ts  — Aider provider
src/lib/server/providers/copilot.ts — GitHub Copilot provider
src/components/GitCommits.svelte   — Git commits component
src/routes/api/annotations/+server.ts — Annotations API
```

### Fichiers modifiés
```
src/lib/server/codebase-analysis.ts — +TrendDataPoint, +Insights, daily trends
src/lib/server/providers/types.ts   — +aider, +copilot provider types
src/lib/server/providers/index.ts   — Register new providers
src/lib/stores/annotations.svelte.ts — SQLite API + migration
src/routes/+page.svelte             — Insights hero + trend charts
src/routes/sessions/[sessionId]/*   — HTML export + git commits
src/components/SessionCard.svelte   — New provider badges
src/components/SessionList.svelte   — New provider filters
```
