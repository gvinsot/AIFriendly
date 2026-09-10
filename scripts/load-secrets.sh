#!/bin/sh
# Charge les secrets Docker montés sous /run/secrets/ dans l'environnement,
# puis exécute la commande passée en argument.
#
# PulsarCD convertit automatiquement les variables sensibles du compose
# (suffixes _CONNECTION_STRING, _SECRET, _KEY, _TOKEN, _PASSWORD) en secrets
# Docker Swarm : elles sont retirées de `environment:` et montées comme
# fichiers sous /run/secrets/<NOM_VARIABLE>.
#
# Une variable déjà présente dans l'environnement a priorité et n'est jamais
# écrasée (permet le dev local avec un simple .env).
set -e

SECRETS_DIR="${SECRETS_DIR:-/run/secrets}"

if [ -d "$SECRETS_DIR" ]; then
  for secret_file in "$SECRETS_DIR"/*; do
    [ -f "$secret_file" ] || continue

    name=$(basename "$secret_file")

    # Ignorer les noms qui ne sont pas des identifiants d'environnement valides
    case "$name" in
      *[!A-Za-z0-9_]* | [0-9]*) continue ;;
    esac

    # Ne pas écraser une variable déjà définie
    eval "current=\${$name:-}"
    if [ -z "$current" ]; then
      export "$name=$(cat "$secret_file")"
    fi
  done
fi

exec "$@"
