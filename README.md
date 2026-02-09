# IA Friendly

Application web qui permet de **vérifier si un site est browsable par l'IA** : score de lisibilité, recommandations d'amélioration et aperçu de ce qu’un assistant IA (type ChatGPT) pourrait “voir” de la page.

## Fonctionnalités

- **Saisie d’une URL** et analyse en un clic
- **Score sur 10** selon la lisibilité pour l’IA
- **Liste d’éléments à modifier** (métadonnées, structure, contenu, images) avec niveau de sévérité (critique / attention / info)
- **Aperçu IA** au format YAML : titre, meta, structure (headings), extrait de contenu, infos images/liens
- **Partage** : Twitter/X, LinkedIn, Facebook, partage natif (Web Share API), copier le lien

## Stack

- **Next.js 14** (App Router)
- **TypeScript**
- **Tailwind CSS**
- **Cheerio** (côté serveur) pour récupérer et parser le HTML

## Démarrage

```bash
npm install
npm run dev
```

Ouvrir [http://localhost:3000](http://localhost:3000).

## Build production

```bash
npm run build
npm start
```

## API

- **POST /api/analyze**  
  Body : `{ "url": "https://exemple.com" }`  
  Réponse : score, `improvements`, `aiPreview`, `aiPreviewYaml`, etc.

## Critères d’analyse (score)

- Présence et qualité du titre (`<title>`)
- Meta description
- Titre H1 unique
- Contenu texte (priorité à `<main>` / `<article>`)
- Attributs `alt` sur les images
- Attribut `lang` sur `<html>`
- Données structurées (JSON-LD) suggérées en info

## Licence

MIT
