# Scans de sécurité — modification du 8 novembre 2026

Le scan standard applique des contrôles déterministes de configuration HTTP,
cookies, HTML et, lorsque son niveau le permet, de chemins publics connus.
Il n'envoie plus de requêtes PUT/DELETE/TRACE ni de charges SQL, HTML ou de
traversée de chemins. Ce changement s'applique aussi au worker et au serveur MCP,
qui embarquent le même scanner.

Le scan avancé utilise un moteur distinct. Il explore les ressources du site avec
une boucle IA et des outils réels. Il ne relance pas `scanSecurity()` et ne reprend
pas son score. Le dernier scan standard enregistré sert seulement de référence
pour indiquer si une ressource était déjà signalée. Sans référence, la comparaison
est explicitement indisponible. Des résultats identiques restent possibles si
aucune exposition supplémentaire n'est trouvée.

## Outils de l'agent

| Outil | Action |
| --- | --- |
| `discover_resources` | Lit une page, un script, robots.txt, un sitemap, une source map ou une description OpenAPI et extrait les URL autorisées. |
| `inspect_resource` | Lit une ressource et analyse son contenu pour identifier des secrets, clés privées, chaînes de connexion, données personnelles structurées, sauvegardes SQL ou sources embarquées. |
| `probe_sensitive_files` | Lit six noms de fichiers connus à la racine ou dans un répertoire découvert. |

L'agent choisit ses prochaines actions après chaque retour d'outil. Le protocole
est un objet JSON `actions: [{tool, arguments}]`, validé puis exécuté par
l'application. Ce transport utilise le mode `json_object` du vLLM déjà configuré ;
il ne nécessite pas le parseur de tool calls natif, qui dépend des options de
[configuration de vLLM](https://docs.vllm.ai/en/latest/features/tool_calling/).
Une action non reconnue ou contenant des arguments supplémentaires est refusée.

## Limites et traitement des données

- GET uniquement, sans corps, cookie ni authentification. Aucune soumission de
  formulaire, exécution JavaScript, connexion avec les identifiants trouvés ou
  validation d'un secret auprès d'un tiers.
- Même origine, avec seule exception d'une redirection HTTP vers HTTPS sur le
  même hôte et les ports standards. Les autres redirections sont bloquées avant
  contact. Les URL avec paramètres, identifiants ou chemins évoquant une mutation
  sont refusées. La validation DNS/IP reste celle de `scanFetch`, avec la sortie
  réseau configurée pour les scans et sans repli sur une connexion directe.
- Au maximum 40 requêtes, redirections et contrôles négatifs inclus ; 128 Kio par
  réponse, 2 Mio au total, 8 secondes par lecture et 8 minutes par scan.
- Requêtes séquentielles espacées d'au moins 150 ms ; au plus 6 tours d'exploration
  et 3 actions par tour. Le timer reste actif pendant la lecture du corps.
- Les signatures sont analysées dans l'application. Le modèle et la base ne
  reçoivent pas les corps bruts ni les valeurs des secrets : uniquement des
  échantillons synthétiques masqués et des URL de ressources autorisées.
- Une détection exige le contenu correspondant, un HTTP 200 et un contrôle
  négatif contre un chemin inexistant. Une 401/403, une page 404 ou le nom d'un
  fichier seul ne constituent pas une preuve.

Le contrôle GET et les exclusions réduisent les risques de modification. Ils ne
peuvent pas garantir qu'un serveur mal conçu n'effectue aucun effet de bord sur
une requête de lecture. Les outils n'essaient pas de contourner une authentification.
Les signatures prouvent l'exposition du contenu détecté, pas la validité d'une clé
ni le caractère confidentiel de toute source map. Une source map seule reste un
constat de faible sévérité. Les secrets non reconnus par les signatures peuvent
ne pas être détectés. Les ressources authentifiées, binaires, hors origine ou
nécessitant des paramètres ne sont pas explorées.

## Rapport et persistance

Chaque constat confirmé contient un identifiant de preuve, son URL, le statut
HTTP, le type de données, un échantillon masqué et sa comparaison au scan standard
de référence. L'IA peut ajouter des hypothèses, affichées séparément comme non
vérifiées. Elle ne peut ni inventer une preuve confirmée ni supprimer une preuve
vérifiée. Tous les enregistrements de preuve sont conservés ; aucun JSON n'est
tronqué à 6 000 caractères.

Le score d'exposition part de 10. Chaque ressource enlève la pénalité de son
constat le plus sévère : critique 5, élevé 3, moyen 1, faible 0,3, information 0.
Le résultat est borné à 0. Les hypothèses ne modifient pas le score. Un scan
incomplet sans preuve a un score nul en base (`null`), plutôt qu'un 10 rassurant.
Un score de 10 indique seulement l'absence de fuite confirmée dans le périmètre
exploré. Il n'est pas comparable directement au score de configuration standard.

Le champ JSON `coverage` enregistre les budgets, le journal des lectures, les
limitations et la référence standard. Les anciens rapports restent lisibles.
Un échec ou une réponse JSON invalide du modèle conserve les preuves déjà
vérifiées et marque le scan comme partiel.

La file utilise une réservation transactionnelle PostgreSQL partagée entre
instances. Elle déduplique les demandes d'un même site, n'autorise qu'un scan en
cours, et vérifie toutes les 30 secondes les travaux à reprendre. Une réservation
expire après 10 minutes ; une écriture tardive ne peut pas remplacer un nouveau
résultat réservé entre-temps.

## Validation et mise en service

Depuis `webapp`, exécuter `npm test`, `npx tsc --noEmit --incremental false` puis
`npm run build`. Les tests utilisent des sites et des réponses de modèle simulés :
ils ne contactent aucun site réel, proxy, modèle ni base de production. Les tests
de concurrence vérifient le contrat de réservation avec une base simulée.

Avant de démarrer la nouvelle version, appliquer la migration Prisma
`20261108210000_add_pentest_coverage` avec les autres migrations en attente et
régénérer le client Prisma. Le Dockerfile régénère déjà le client au build.
Le pipeline existant exécute les migrations de déploiement. Aucun nouveau secret
LLM n'est nécessaire ; `VLLM_API_URL`, `VLLM_API_KEY` et `VLLM_MODEL` sont réutilisés.
`VLLM_PENTEST_TIMEOUT_MS` borne chaque appel de modèle, avec un plafond de 120 s,
à l'intérieur de la limite totale de 8 minutes.
