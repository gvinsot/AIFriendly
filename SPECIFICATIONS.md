# AI Friendly — Spécifications techniques et fonctionnelles

**Version** : 3.0
**Date** : Mars 2026
**URL** : https://aifriendly.fr
**Licence** : MIT

---

## 1. Vue d'ensemble

AI Friendly est une plateforme de monitoring web complète qui évalue trois dimensions essentielles d'un site web :

1. **Accessibilité IA** — Lisibilité du site par les intelligences artificielles (ChatGPT, Claude, Gemini, Perplexity, etc.)
2. **Disponibilité** — Surveillance continue avec mesure du ping et de la vitesse de chargement
3. **Sécurité** — Audit automatisé basé sur les tests OWASP

Chaque dimension fournit un **score sur 10**, des détails consultables au clic, et un suivi dans le temps via le dashboard utilisateur.

### 1.1 Objectifs

- Permettre à tout propriétaire de site de vérifier si son contenu est bien interprétable par les LLMs et assistants IA
- **Surveiller la disponibilité** de ses sites en continu (ping, temps de chargement)
- **Évaluer la sécurité** de ses sites avec des audits OWASP automatisés
- Fournir des recommandations concrètes et actionnables pour améliorer chaque dimension
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
│               ├── analyze/route.ts # POST /api/sites/:id/analyze (IA)
│               ├── history/
│               │   ├── route.ts     # GET /api/sites/:id/history
│               │   └── [analysisId]/route.ts  # GET détail analyse
│               ├── availability/
│               │   ├── route.ts     # GET /api/sites/:id/availability (historique)
│               │   ├── check/route.ts # POST /api/sites/:id/availability/check
│               │   └── [checkId]/route.ts  # GET détail d'un check
│               └── security/
│                   ├── route.ts     # GET /api/sites/:id/security (historique)
│                   ├── scan/route.ts # POST /api/sites/:id/security/scan
│                   └── [scanId]/route.ts  # GET détail d'un scan
├── components/
│   ├── DashboardNav.tsx            # Navigation dashboard
│   └── ShareSection.tsx            # Boutons de partage social
├── lib/
│   ├── analyzer.ts                 # Moteur d'analyse IA (utilisé par API + worker)
│   ├── availability-checker.ts     # Moteur de check disponibilité (ping + vitesse)
│   ├── security-scanner.ts         # Moteur de scan sécurité (tests OWASP)
│   ├── types.ts                    # Types TypeScript partagés
│   ├── prisma.ts                   # Client Prisma singleton
│   ├── rateLimit.ts                # Rate limiting en mémoire (par IP)
│   ├── urlSecurity.ts              # Validation URL + protection SSRF
│   └── auth-types.ts               # Types d'authentification
├── worker/
│   ├── index.ts                    # Worker principal (orchestrateur)
│   ├── availability-worker.ts      # Worker disponibilité (cycle toutes les minutes)
│   ├── security-worker.ts          # Worker sécurité (cycle toutes les heures)
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
- **3 onglets** : Accessibilité IA | Disponibilité | Sécurité
- Chaque onglet affiche :
  - **Score actuel** sur 10 avec code couleur
  - **Graphique d'évolution** du score (barres verticales, 30 dernières entrées)
  - **Historique** des analyses/checks/scans avec navigation
  - **Détail au clic** sur chaque élément (voir sections 5, 6, 7)
- **Actions manuelles** : boutons "Analyser", "Checker", "Scanner"

### 4.4 Monitoring de disponibilité

#### 4.4.1 Principe

- Check automatique **toutes les minutes** pour chaque site actif
- Mesure du **ping** (latence réseau en ms)
- Mesure du **temps de chargement** complet de la page (ms)
- Calcul d'un **score de disponibilité sur 10**

#### 4.4.2 Critères de scoring disponibilité

Le score démarre à 10 et des points sont déduits :

| Critère | Condition | Points déduits |
|---------|-----------|----------------|
| Site inaccessible | HTTP error / timeout | Score = 0 |
| Ping élevé | > 500ms | -3.0 |
| Ping moyen | 200-500ms | -1.5 |
| Ping acceptable | 100-200ms | -0.5 |
| Chargement très lent | > 10s | -3.0 |
| Chargement lent | 5-10s | -2.0 |
| Chargement moyen | 2-5s | -1.0 |
| Chargement correct | 1-2s | -0.5 |
| Code HTTP non-200 | 3xx, 4xx, 5xx | -1.0 à -3.0 |
| Certificat SSL expiré/invalide | Erreur TLS | -2.0 |

#### 4.4.3 Détail d'un check (au clic)

- **Statut HTTP** : code de réponse
- **Ping** : latence en ms avec indicateur visuel
- **Temps de chargement** : durée totale en ms
- **TTFB** (Time To First Byte) : en ms
- **Certificat SSL** : validité, expiration, émetteur
- **Taille de la réponse** : en Ko
- **Timestamp** du check
- **Historique des incidents** : périodes d'indisponibilité détectées

### 4.5 Audit de sécurité

#### 4.5.1 Principe

- Scan automatique **toutes les heures** pour chaque site actif
- Tests basés sur les **OWASP Top 10** et bonnes pratiques de sécurité web
- Calcul d'un **score de sécurité sur 10**

#### 4.5.2 Tests OWASP et critères de scoring

Le score démarre à 10 et des points sont déduits :

| Test | Description | Points déduits | Sévérité |
|------|-------------|----------------|----------|
| **Headers de sécurité** | | | |
| Content-Security-Policy absent | Pas de CSP configuré | -1.5 | Critique |
| X-Frame-Options absent | Vulnérable au clickjacking | -1.0 | Critique |
| X-Content-Type-Options absent | Pas de `nosniff` | -0.5 | Warning |
| Strict-Transport-Security absent | Pas de HSTS | -1.0 | Critique |
| X-XSS-Protection absent | Pas de protection XSS navigateur | -0.3 | Warning |
| Referrer-Policy absent | Fuite d'informations de navigation | -0.3 | Info |
| Permissions-Policy absent | Pas de restriction des API navigateur | -0.3 | Info |
| **Configuration SSL/TLS** | | | |
| HTTP sans redirection HTTPS | Trafic non chiffré | -2.0 | Critique |
| TLS < 1.2 | Protocole obsolète | -1.5 | Critique |
| Certificat expiré ou invalide | Certificat non valide | -2.0 | Critique |
| HSTS max-age < 6 mois | Durée HSTS trop courte | -0.5 | Warning |
| **Fuites d'information** | | | |
| Header `Server` exposé | Révèle la technologie serveur | -0.3 | Info |
| Header `X-Powered-By` exposé | Révèle le framework | -0.5 | Warning |
| Pages d'erreur verbeuses | Stack traces visibles | -1.0 | Critique |
| Répertoires listables | Directory listing activé | -1.0 | Critique |
| **Cookies** | | | |
| Cookies sans flag `Secure` | Envoyés en HTTP | -1.0 | Critique |
| Cookies sans flag `HttpOnly` | Accessibles via JS (XSS) | -0.5 | Warning |
| Cookies sans flag `SameSite` | Vulnérable au CSRF | -0.5 | Warning |
| **Injection et XSS** | | | |
| Formulaires sans CSRF token | Vulnérable au CSRF | -1.0 | Critique |
| Entrées non-escapées réfléchies | Potentiel XSS réfléchi | -1.5 | Critique |
| **Autres** | | | |
| robots.txt expose des chemins sensibles | `/admin`, `/api/internal`, etc. | -0.5 | Warning |
| Fichiers sensibles accessibles | `.env`, `.git/`, `wp-config.php` | -2.0 | Critique |
| Open redirect détecté | Redirection non validée | -1.0 | Critique |

#### 4.5.3 Détail d'un scan (au clic)

- **Score global** sur 10 avec répartition par catégorie
- **Liste des tests** effectués avec résultat (pass/fail/warning)
- **Détail par catégorie** :
  - Headers de sécurité : tableau des headers présents/absents avec valeurs
  - SSL/TLS : version, cipher suite, validité certificat, chaîne de confiance
  - Cookies : liste avec flags analysés
  - Fuites d'information : headers et fichiers exposés
  - Injection/XSS : résultats des tests de réflexion
- **Recommandations** classées par sévérité (critique / warning / info)
- **Timestamp** du scan

### 4.6 Worker (orchestrateur multi-tâches)

- Processus long-running (Node.js, pas de dépendance Next.js)
- **3 boucles parallèles** :
  - **Analyse IA** : vérification toutes les 5 minutes, exécution selon la fréquence configurée du site
  - **Check disponibilité** : exécution **toutes les minutes** pour chaque site actif
  - **Scan sécurité** : exécution **toutes les heures** pour chaque site actif
- **Rétention** : suppression automatique des résultats > 60 jours (pour les 3 types)
- Délai de 2s entre chaque analyse IA (politesse), pas de délai pour les checks de disponibilité
- Gestion des erreurs : retry avec backoff exponentiel en cas d'échec

---

## 5. Moteur d'analyse — Accessibilité IA

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
| POST | `/api/analyze` | Analyse IA d'une URL (body: `{ "url": "..." }`) |

### 6.2 Endpoints authentifiés — Sites

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/sites` | Liste des sites de l'utilisateur |
| POST | `/api/sites` | Créer un site |
| GET | `/api/sites/:id` | Détail d'un site |
| PUT | `/api/sites/:id` | Modifier un site |
| DELETE | `/api/sites/:id` | Supprimer un site et tout son historique |

### 6.3 Endpoints authentifiés — Analyse IA

| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/api/sites/:id/analyze` | Lancer une analyse IA manuelle |
| GET | `/api/sites/:id/history` | Historique des analyses IA (liste) |
| GET | `/api/sites/:id/history/:analysisId` | Détail d'une analyse IA |

### 6.4 Endpoints authentifiés — Disponibilité

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/sites/:id/availability` | Historique des checks de disponibilité |
| POST | `/api/sites/:id/availability/check` | Lancer un check de disponibilité manuel |
| GET | `/api/sites/:id/availability/:checkId` | Détail d'un check (ping, TTFB, chargement, SSL) |

### 6.5 Endpoints authentifiés — Sécurité

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/sites/:id/security` | Historique des scans de sécurité |
| POST | `/api/sites/:id/security/scan` | Lancer un scan de sécurité manuel |
| GET | `/api/sites/:id/security/:scanId` | Détail d'un scan (tests OWASP, recommandations) |

---

## 7. Modèle de données (PostgreSQL / Prisma)

### 7.1 Tables NextAuth

- **User** : id, name, email (unique), emailVerified, image
- **Account** : OAuth provider, tokens (unique par [provider, providerAccountId])
- **Session** : sessionToken (unique), userId, expires
- **VerificationToken** : identifier, token, expires

### 7.2 Tables applicatives

- **Site** : id, userId (FK User), name, url, frequency (`6h|daily|weekly|monthly`), isActive, availabilityEnabled (bool, default true), securityEnabled (bool, default true), timestamps
  - Index sur `userId`

- **AnalysisResult** : id, siteId (FK Site), score, maxScore (default 10), details (JSON), createdAt
  - Stocke les résultats d'analyse d'accessibilité IA
  - Index sur `[siteId, createdAt]`
  - Index sur `[createdAt]` (nettoyage)
  - Cascade delete depuis Site

- **AvailabilityCheck** : id, siteId (FK Site), score, httpStatus, pingMs, ttfbMs, loadTimeMs, responseSize, sslValid, sslExpiry, details (JSON), createdAt
  - Stocke les résultats de check de disponibilité (1 par minute)
  - Index sur `[siteId, createdAt]`
  - Index sur `[createdAt]` (nettoyage)
  - Cascade delete depuis Site

- **SecurityScan** : id, siteId (FK Site), score, headersScore, sslScore, cookiesScore, infoLeakScore, injectionScore, details (JSON), createdAt
  - Stocke les résultats de scan de sécurité (1 par heure)
  - Sous-scores par catégorie pour visualisation radar/breakdown
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

- Maximum **20 sites** par utilisateur
- Rétention de toutes les données (analyses, checks, scans) : **60 jours**
- Taille max de page analysée : 5 Mo
- Rate limiting : 10 requêtes/minute par IP
- Timeout d'analyse IA : 15 secondes
- Timeout check disponibilité : 30 secondes
- Timeout scan sécurité : 60 secondes
- Pas d'analyse des pages non-HTML (PDF, images, etc.)
- Fréquence checks disponibilité : **1 par minute** (non configurable)
- Fréquence scans sécurité : **1 par heure** (non configurable)
- Les scans sécurité sont passifs (pas d'exploitation active, uniquement détection)
