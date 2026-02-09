#!/usr/bin/env bash
# Exécuté avant le déploiement de la stack.
# Exemple : charger .env pour que les variables soient disponibles au déploiement.
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
if [ -f .env ]; then
  set -a
  # shellcheck source=/dev/null
  . ./.env
  set +a
  echo "Variables chargées depuis .env (TRAEFIK_HOST=${TRAEFIK_HOST:-non défini})"
fi
# Optionnel : build et push de l'image vers la registry
# docker compose -f docker-compose.swarm.yml build
# docker compose -f docker-compose.swarm.yml push
