#!/bin/bash
set -e

ENV=${1:-development}

echo "Deploying SoulLedger ($ENV)..."

case $ENV in
  development)
    cp .env.development .env
    docker-compose up -d
    ;;
  staging)
    cp .env.staging .env
    docker-compose -f docker-compose.yml -f docker-compose.staging.yml up -d
    ;;
  production)
    cp .env.production .env
    docker-compose -f docker-compose.yml -f docker-compose.production.yml up -d
    ;;
  *)
    echo "Usage: $0 {development|staging|production}"
    exit 1
    ;;
esac

echo "Deployment complete ($ENV)"
