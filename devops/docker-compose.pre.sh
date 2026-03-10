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

# ═══════════════════════════════════════════════════════════════
# MIGRATIONS PRISMA
# ═══════════════════════════════════════════════════════════════
# Les migrations doivent être créées en local avant le build:
#   npx prisma migrate dev --name <description>
#
# Le service ai-friendly-migrate applique automatiquement les
# migrations au déploiement. Il s'exécute une fois puis s'arrête.
# ═══════════════════════════════════════════════════════════════

# Optionnel : build et push de l'image vers la registry
# docker compose -f docker-compose.swarm.yml build
# docker compose -f docker-compose.swarm.yml push
