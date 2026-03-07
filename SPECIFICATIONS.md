# AI Friendly — Spécifications techniques et fonctionnelles

**Version** : 2.0
**Date** : Mars 2026
**URL** : https://aifriendly.fr
**Licence** : MIT

---

## 1. Vue d'ensemble

AI Friendly est une application web qui analyse la **lisibilité d'un site web par les intelligences artificielles** (ChatGPT, Claude, Gemini, Perplexity, etc.). Elle fournit un score sur 10, des recommandations d'amélioration, et un aperçu structuré (YAML) de ce qu'une IA "voit" en visitant la page.

### 1.1 Objectifs

- Permettre à tout propriétaire de site de vérifier si son contenu est bien interprétable par les LLMs et assistants IA
- Fournir des recommandations concrètes et actionnables pour améliorer la visibilité IA
- Proposer un suivi dans le temps avec des analyses programmées (dashboard utilisateur)

### 1.2 Public cible

- Propriétaires de sites web, webmasters, SEO
- Développeurs souhaitant optimiser leur site pour l'IA
- Agences digitales

---

## 2. Stack technique

| Composant | Technologie | Version |
|-----------|-------------|---------|
| Framework | Next.js (App Router) | 16.x |
| Langage | TypeScript | 5.x |
| CSS | Tailwind CSS | 3.4.x |
| Parsing HTML | Cheerio | 1.x |
| Base de données | PostgreSQL | — |
| ORM | Prisma | 6.x |
| Authentification | NextAuth.js v5 (beta) | 5.0.0-beta.30 |
| Registry | registry.methodinfo.fr | — |
| Reverse proxy | Traefik v3 + Coraza WAF | — |
| Analytics | Matomo (self-hosted) | — |
| Déploiement | Docker Swarm | — |

---

## 3. Architecture

### 3.1 Structure du projet

```
AIFriendly/
├── app/
│   ├── page.tsx                    # Page d'accueil (analyse publique)
│   ├── layout.tsx                  # Layout racine (fonts, metadata, Matomo)
│   ├── globals.css                 # Variables CSS, thème dark/light
│   ├── auth/signin/page.tsx        # Page de connexion OAuth
│   ├── dashboard/
│   │   ├── layout.tsx              # Layout dashboard (auth guard, nav)
│   │   ├── page.tsx                # Tableau de bord (stats, analyses récentes)
│   │   └── sites/
│   │       ├── page.tsx            # Liste des sites (CRUD)
│   │       └── [id]/page.tsx       # Détail site (historique, graphique, analyse manuelle)
│   └── api/
│       ├── analyze/route.ts        # POST /api/analyze (analyse publique)
│       ├── auth/[...nextauth]/     # Routes NextAuth
│       └── sites/
│           ├── route.ts            # GET/POST /api/sites
│           └── [id]/
│               ├── route.ts        # GET/PUT/DELETE /api/sites/:id
│               ├── analyze/route.ts # POST /api/sites/:id/analyze
│               └── history/
│                   ├── route.ts     # GET /api/sites/:id/history
│                   └── [analysisId]/route.ts  # GET détail analyse
├── components/
│   ├── DashboardNav.tsx            # Navigation dashboard
│   └── ShareSection.tsx            # Boutons de partage social
├── lib/
│   ├── analyzer.ts                 # Moteur d'analyse (utilisé par API + worker)
│   ├── types.ts                    # Types TypeScript partagés
│   ├── prisma.ts                   # Client Prisma singleton
│   ├── rateLimit.ts                # Rate limiting en mémoire (par IP)
│   ├── urlSecurity.ts              # Validation URL + protection SSRF
│   └── auth-types.ts               # Types d'authentification
├── worker/
│   ├── index.ts                    # Worker d'analyses programmées
│   ├── Dockerfile                  # Image Docker du worker
│   ├── package.json                # Dépendances du worker
│   └── tsconfig.json
├── prisma/
│   └── schema.prisma               # Schéma de base de données
├── devops/
│   ├── docker-compose.swarm.yml    # Stack Docker Swarm
│   ├── .env                        # Variables d'environnement
│   └── env.example
├── auth.ts                         # Configuration NextAuth
├── middleware.ts                    # Middleware (protection /dashboard)
├── Dockerfile                      # Image Docker principale
├── package.json
├── tailwind.config.ts
└── next.config.js
```

### 3.2 Services Docker

| Service | Image | Rôle |
|---------|-------|------|
| `ai-friendly` | `registry.methodinfo.fr/ai-friendly:latest` | App Next.js (frontend + API) |
| `ai-friendly-worker` | `registry.methodinfo.fr/ai-friendly-worker:latest` | Worker d'analyses programmées |

Les deux services sont connectés au réseau `proxy` (Traefik).

---

## 4. Fonctionnalités

### 4.1 Analyse publique (page d'accueil)

- **Saisie d'une URL** avec auto-ajout du préfixe `https://`
- **Analyse en un clic** via `POST /api/analyze`
- Affichage des résultats :
  - **Score sur 10** avec code couleur (vert >= 7, jaune >= 4, rouge < 4)
  - **Liste d'améliorations** classées par sévérité (critique / attention / info)
  - **Aperçu IA** au format YAML
- **Partage des résultats** : Twitter/X, LinkedIn, Facebook, Web Share API, copie du lien
- **URL partageable** : `?url=<encoded_url>` pré-remplit le champ

### 4.2 Authentification

- OAuth via **Google** et **Microsoft** (Entra ID, tenant `consumers`)
- Adapter Prisma pour NextAuth
- Page de connexion personnalisée (`/auth/signin`)
- Middleware protégeant toutes les routes `/dashboard/*`

### 4.3 Dashboard utilisateur

#### 4.3.1 Tableau de bord (`/dashboard`)

- Nombre de sites enregistrés
- Score moyen des 5 dernières analyses
- Liste des analyses récentes avec date et score

#### 4.3.2 Gestion des sites (`/dashboard/sites`)

- **CRUD complet** : ajouter, modifier, supprimer un site
- **Limite** : 20 sites par utilisateur
- Fréquences d'analyse : `6h`, `daily`, `weekly`, `monthly`
- Activation/désactivation d'un site
- Affichage du dernier score et du nombre total d'analyses

#### 4.3.3 Détail d'un site (`/dashboard/sites/[id]`)

- Informations du site (nom, URL, fréquence)
- **Graphique d'évolution** du score (barres verticales, 30 dernières analyses)
- **Historique des analyses** avec navigation et détail au clic
- **Analyse manuelle** à la demande (bouton "Analyser maintenant")
- Détail d'une analyse : améliorations + aperçu YAML

### 4.4 Worker d'analyses programmées

- Processus long-running (Node.js, pas de dépendance Next.js)
- **Cycle** : vérification toutes les 5 minutes
- Analyse les sites actifs dont la dernière analyse dépasse la fréquence configurée
- **Rétention** : suppression automatique des résultats > 60 jours
- Délai de 2s entre chaque analyse (politesse)

---

## 5. Moteur d'analyse

### 5.1 Critères de scoring

Le score démarre à 10 et des points sont déduits selon les critères suivants :

| Critère | Points déduits | Sévérité |
|---------|---------------|----------|
| Titre `<title>` manquant ou < 10 caractères | -1.5 | Critique |
| Meta description absente ou < 50 caractères | -1.0 | Critique/Warning |
| Aucun titre H1 | -1.0 | Critique |
| Page marquée `noindex` | -1.0 | Critique |
| HTML sémantique insuffisant (< 3 balises parmi nav, header, footer, main, article, section) | -0.5 | Warning |
| Crawlers IA bloqués dans robots.txt | -0.5 | Warning |
| Peu de contenu texte (< 100 caractères) | -0.5 | Warning |
| Balises Open Graph manquantes (og:image, og:type) | -0.15 à -0.5 | Warning/Info |
| Images sans attribut alt | -0.2/image (max -0.5) | Warning/Info |
| Fichier robots.txt absent | -0.3 | Warning |
| Sitemap XML absent | -0.3 | Warning |
| Langue `lang` non indiquée | -0.3 | Info |
| Plusieurs H1 détectés | -0.3 | Warning |
| **Bonus** : fichier `llms.txt` présent | +0.2 | — |

### 5.2 Bots IA surveillés

GPTBot, ChatGPT-User, Google-Extended, CCBot, anthropic-ai, Claude-Web, PerplexityBot, Bytespider, Amazonbot, FacebookBot, Applebot-Extended.

### 5.3 Vérifications complémentaires (infos)

- Hiérarchie des titres (H1 -> H2 -> H3 sans saut)
- Données structurées JSON-LD
- Twitter Card
- Balise `nosnippet`
- Balise `noai` / `noimageai`
- Fichier `llms.txt`

### 5.4 Aperçu IA (YAML)

Représentation structurée comprenant :
- URL, titre, métadonnées (description, OG, Twitter Card, canonical)
- Langue
- Structure des headings
- Données structurées (booléen)
- HTML sémantique
- Accès bots (robots.txt, sitemap, llms.txt, bots bloqués, meta robots)
- Aperçu du contenu (1500 premiers caractères)
- Nombre d'images et de liens

---

## 6. API

### 6.1 Endpoints publics

| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/api/analyze` | Analyse une URL (body: `{ "url": "..." }`) |

### 6.2 Endpoints authentifiés (dashboard)

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/sites` | Liste des sites de l'utilisateur |
| POST | `/api/sites` | Créer un site |
| GET | `/api/sites/:id` | Détail d'un site |
| PUT | `/api/sites/:id` | Modifier un site |
| DELETE | `/api/sites/:id` | Supprimer un site et son historique |
| POST | `/api/sites/:id/analyze` | Lancer une analyse manuelle |
| GET | `/api/sites/:id/history` | Historique des analyses (liste) |
| GET | `/api/sites/:id/history/:analysisId` | Détail d'une analyse |

---

## 7. Modèle de données (PostgreSQL / Prisma)

### 7.1 Tables NextAuth

- **User** : id, name, email (unique), emailVerified, image
- **Account** : OAuth provider, tokens (unique par [provider, providerAccountId])
- **Session** : sessionToken (unique), userId, expires
- **VerificationToken** : identifier, token, expires

### 7.2 Tables applicatives

- **Site** : id, userId (FK User), name, url, frequency (`6h|daily|weekly|monthly`), isActive, timestamps
  - Index sur `userId`
- **AnalysisResult** : id, siteId (FK Site), score, maxScore (default 10), details (JSON), createdAt
  - Index sur `[siteId, createdAt]`
  - Index sur `[createdAt]` (nettoyage)
  - Cascade delete depuis Site

---

## 8. Sécurité

### 8.1 Protection SSRF

- Validation stricte des URL (protocole http/https uniquement)
- Blocage des IP privées (RFC 1918), localhost, link-local, IPv6 ULA
- Blocage des domaines `.local`, `.internal`, `.localhost`
- Vérification post-redirect (l'URL finale est aussi validée)
- Pas d'identifiants dans l'URL
- Longueur max URL : 2048 caractères

### 8.2 Rate limiting

- Rate limiting en mémoire par IP (basé sur `X-Forwarded-For` / `X-Real-IP`)
- 10 requêtes par fenêtre de 60 secondes
- Réponse 429 avec header `Retry-After`
- Nettoyage automatique des entrées expirées toutes les 5 minutes

### 8.3 Autres mesures

- Taille HTML max : 5 Mo
- Timeout fetch : 15 secondes
- Validation Content-Type (JSON pour l'API, HTML pour les pages analysées)
- Middleware NextAuth sur toutes les routes `/dashboard/*`
- WAF Coraza via Traefik (global@file)
- HTTPS obligatoire (redirect HTTP -> HTTPS)

---

## 9. Design et UX

### 9.1 Thème

- **Thème sombre par défaut** (palette slate : `#0f172a`, `#1e293b`)
- **Thème clair automatique** via `prefers-color-scheme: light`
- Accent principal : **cyan** (`#22d3ee` en dark, `#0891b2` en light)
- Scores colorés : vert (>= 7), jaune (>= 4), rouge (< 4)
- Effets : gradient subtil, backdrop-blur, ombres

### 9.2 Typographie

- **Display** : Cormorant Garamond (serif, pour titres)
- **Body** : DM Sans (sans-serif)
- **Code** : JetBrains Mono (monospace, aperçu YAML)

### 9.3 Responsive

- Layout max-width `3xl` (page publique) et `5xl` (dashboard)
- Grilles adaptatives `sm:` breakpoints
- Navigation dashboard sticky

---

## 10. Infrastructure et déploiement

### 10.1 Environnement

| Variable | Description |
|----------|-------------|
| `DB_CONNECTION_STRING` | URL PostgreSQL |
| `NEXTAUTH_SECRET` | Secret NextAuth |
| `NEXTAUTH_URL` | URL publique (https://aifriendly.fr) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth Google |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | OAuth Microsoft |
| `TRAEFIK_HOST` | Hostname Traefik (aifriendly.fr) |

### 10.2 Docker Swarm

- Réseau `proxy` (externe, partagé avec Traefik)
- 1 replica par service
- Restart policy : `on-failure` (worker avec délai 30s)
- Contrainte placement : `node.labels.gpu != true`

### 10.3 Traefik

- Entrypoints : `web` (HTTP, redirect) / `websecure` (HTTPS)
- Certificats Let's Encrypt (`certresolver=letsencrypt`)
- Middleware global WAF (`global@file`)

### 10.4 Analytics

- Matomo self-hosted sur `stats.methodinfo.fr`
- Site ID : 2
- Cookie domain : `*.aifriendly.fr`

---

## 11. Limites et contraintes

- Maximum 20 sites par utilisateur
- Rétention des analyses : 60 jours
- Taille max de page analysée : 5 Mo
- Rate limiting : 10 analyses/minute par IP
- Timeout d'analyse : 15 secondes
- Pas d'analyse des pages non-HTML (PDF, images, etc.)
