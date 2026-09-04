# Agent Replay — Roadmap

## Positionnement

Agent Replay n'est plus un simple viewer. C'est un outil d'analytics local pour agents de code, dont la thèse est simple : les logs de session disent ce que l'agent a fait, seul git dit ce qui en est resté. Tout ce qui est mesurable de façon déterministe l'est avant qu'un LLM intervienne, et le LLM ne fait que lire ces mesures.

Ce qui distingue le projet des fonctions intégrées aux agents (`/insights` de Claude Code, par exemple) :

1. **Multi-agents** : cinq providers dans un même modèle d'événements.
2. **Survie du code** : mesure contre git, hors de la session, inaccessible à l'agent lui-même.
3. **Audit d'overhead** : coût des CLAUDE.md, skills et serveurs MCP, avec attribution par skill.

---

## Fait

### v0.1 — Viewer
- Timeline, diffs, sortie bash, tokens, coût par session
- Providers Claude Code, Cursor, Windsurf, Aider, Copilot
- Export HTML / Markdown / JSON, annotations, tags, bookmarks, SQLite local
- Corrélation commits git par fenêtre temporelle et fichiers touchés
- Hook post-session Claude Code
- Audit d'overhead (CLAUDE.md, skills, MCP) avec attribution de coût par skill

### v0.2 — Outcome
- **Survie du code** (`code-survival.ts`) : chaque ligne écrite par l'agent est suivie dans HEAD et l'arbre de travail ; committed / uncommitted / gone / self-revised, par fichier, par session, agrégé sur le dashboard
- **Post-mortem LLM** (`postmortem.ts`) : pack de preuves cité par identifiants d'événements, schéma de sortie strict, citations invalides supprimées et comptées, Claude API ou Ollama local, génération à la demande uniquement
- Grille tarifaire corrigée (Opus 4.5+ à 5/25, Sonnet 5 à 2/10, Haiku 4.5 à 1/5, Fable/Mythos à 10/50) ; l'ancienne grille surfacturait Opus d'un facteur 3
- Node 22+, better-sqlite3 13, matrice CI 22/24
- README honnête sur la couverture réelle par provider

---

## À faire

### Survie du code, phase 2
- Distinguer « réécrit par l'humain » de « réécrit par une session ultérieure » en croisant les sessions qui touchent le même fichier
- Détecter les lignes reformatées (au-delà des espaces) via similarité plutôt qu'égalité stricte
- Survie à horizon fixe (J+7, J+30) en plus de « maintenant », pour comparer des sessions d'âges différents
- Mesurer aussi la survie des suppressions : le code que l'agent a retiré est-il revenu ?

### Scores
- Retirer ou reléguer `difficultyScore` et `wastedCost`, qui reposent sur des pondérations arbitraires, au profit de la survie et des détecteurs bruts
- Remplacer le « taux de succès par modèle » (sessions sans erreur d'outil) par la survie par modèle

### Post-mortem
- Comparaison de deux sessions sur la même tâche
- Post-mortem hebdomadaire agrégé : patterns récurrents, fichiers qui reviennent, prompts qui coûtent

### Providers
- Cursor : extraire le texte des éditions quand il est présent dans la base, pour rendre la survie mesurable
- Codex CLI

### Non prioritaire
- Dashboard équipe, annotations collaboratives, export Slack/GitHub
