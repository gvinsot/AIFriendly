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

# Le service de migration est un "replicated-job". Swarm interdit de changer le
# mode d'un service existant : si une version précédente l'a créé en mode
# "replicated", on le supprime pour que `docker stack deploy` le recrée en job.
STACK="${STACK_NAME:-aifriendly}"
MIGRATE_SVC="${STACK}_ai-friendly-migrate"
if docker service inspect "$MIGRATE_SVC" >/dev/null 2>&1; then
  MODE=$(docker service inspect "$MIGRATE_SVC" \
    --format '{{if .Spec.Mode.ReplicatedJob}}job{{else if .Spec.Mode.GlobalJob}}job{{else}}service{{end}}')
  if [ "$MODE" != "job" ]; then
    echo "Suppression de $MIGRATE_SVC (mode replicated -> replicated-job)"
    docker service rm "$MIGRATE_SVC"
    # Attendre la disparition effective du service avant le redéploiement
    for _ in $(seq 1 30); do
      docker service inspect "$MIGRATE_SVC" >/dev/null 2>&1 || break
      sleep 1
    done
  fi
fi

# Optionnel : build et push de l'image vers la registry
# docker compose -f docker-compose.swarm.yml build
# docker compose -f docker-compose.swarm.yml push
