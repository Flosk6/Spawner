#!/bin/bash
#
# Spawner - Configuration Interactive
# Configure ou reconfigure Spawner après installation
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

clear
echo -e "${BLUE}"
cat << "EOF"
   _____ ____  ___  _       ___   ____________
  / ___// __ \/   | | |     / / | / / ____/ __ \
  \__ \/ /_/ / /| | | | /| / /  |/ / __/ / /_/ /
 ___/ / ____/ ___ | | |/ |/ / /|  / /___/ _, _/
/____/_/   /_/  |_| |__/|__/_/ |_/_____/_/ |_|

Configuration Interactive
EOF
echo -e "${NC}"
echo ""

# Check if .env.production exists
if [ -f ".env.production" ]; then
    echo -e "${YELLOW}Un fichier .env.production existe déjà.${NC}"
    echo ""
    read -p "Voulez-vous le reconfigurer? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${RED}Configuration annulée.${NC}"
        exit 0
    fi
    # Backup existing config
    cp .env.production .env.production.backup.$(date +%Y%m%d_%H%M%S)
    echo -e "${GREEN}OK Backup créé${NC}"
fi

echo -e "${CYAN}=== Configuration de Spawner ===${NC}"
echo ""

# Domain Configuration
echo -e "${BLUE}[1/2] Configuration du domaine${NC}"
echo ""
echo "Les environnements sont servis sous un domaine dédié, par exemple"
echo "preview.example.com, avec un enregistrement DNS *.preview.example.com"
echo "qui pointe vers ce serveur. Le tableau de bord sera sur spawner.<domaine>."
echo ""
read -p "Domaine des previews (ex: preview.example.com): " DOMAIN
while [ -z "$DOMAIN" ]; do
    echo -e "${RED}Le domaine est requis!${NC}"
    read -p "Domaine des previews: " DOMAIN
done

# Verify DNS: the dashboard and any other name must reach this server
echo ""
echo -e "${YELLOW}Vérification DNS...${NC}"
EXPECTED_IP=$(curl -s ifconfig.me)
DNS_IP=$(dig +short spawner.$DOMAIN | tail -n1)
WILDCARD_IP=$(dig +short "check-$RANDOM.$DOMAIN" | tail -n1)

if [ "$DNS_IP" = "$EXPECTED_IP" ] && [ "$WILDCARD_IP" = "$EXPECTED_IP" ]; then
    echo -e "${GREEN}OK DNS correctement configuré${NC}"
    echo "  *.$DOMAIN -> $EXPECTED_IP"
else
    echo -e "${YELLOW}WARNING DNS pas encore propagé ou mal configuré${NC}"
    echo "  Attendu: $EXPECTED_IP"
    echo "  Trouvé: spawner.$DOMAIN -> ${DNS_IP:-N/A}, *.$DOMAIN -> ${WILDCARD_IP:-N/A}"
    echo ""
    read -p "Continuer quand même? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${RED}Configuration annulée.${NC}"
        echo "Configurez votre DNS et relancez ce script."
        exit 1
    fi
fi

read -p "Email pour Let's Encrypt: " ACME_EMAIL
while [ -z "$ACME_EMAIL" ]; do
    echo -e "${RED}L'email est requis!${NC}"
    read -p "Email: " ACME_EMAIL
done

# GitHub OAuth Configuration
echo ""
echo -e "${BLUE}[2/2] Configuration GitHub OAuth${NC}"
echo ""
echo -e "${YELLOW}Vous devez créer une OAuth App sur GitHub:${NC}"
echo ""
echo "1. Allez sur: https://github.com/organizations/VOTRE_ORG/settings/applications"
echo "2. Cliquez sur 'New OAuth App'"
echo "3. Remplissez:"
echo "   - Application name: Spawner"
echo "   - Homepage URL: https://spawner.$DOMAIN"
echo "   - Callback URL: https://spawner.$DOMAIN/api/auth/github/callback"
echo ""
read -p "Appuyez sur Entrée quand l'app est créée..."

read -p "GitHub Client ID: " GITHUB_CLIENT_ID
while [ -z "$GITHUB_CLIENT_ID" ]; do
    echo -e "${RED}Le Client ID est requis!${NC}"
    read -p "GitHub Client ID: " GITHUB_CLIENT_ID
done

read -sp "GitHub Client Secret: " GITHUB_CLIENT_SECRET
echo ""
while [ -z "$GITHUB_CLIENT_SECRET" ]; do
    echo -e "${RED}Le Client Secret est requis!${NC}"
    read -sp "GitHub Client Secret: " GITHUB_CLIENT_SECRET
    echo ""
done

read -p "GitHub Organization (nom): " GITHUB_ORG
while [ -z "$GITHUB_ORG" ]; do
    echo -e "${RED}L'organisation est requise!${NC}"
    read -p "GitHub Organization: " GITHUB_ORG
done

read -p "GitHub Team (slug, ex: developers): " GITHUB_TEAM
while [ -z "$GITHUB_TEAM" ]; do
    echo -e "${RED}La team est requise!${NC}"
    read -p "GitHub Team: " GITHUB_TEAM
done

# Generate secrets
echo ""
echo -e "${YELLOW}Génération des secrets sécurisés...${NC}"
DB_PASSWORD=$(openssl rand -hex 24)
SESSION_SECRET=$(openssl rand -base64 32)
SPAWNER_BOOTSTRAP_TOKEN=$(openssl rand -hex 24)
echo -e "${GREEN}OK Secrets générés${NC}"

# Create .env.production
echo ""
echo -e "${YELLOW}Création du fichier de configuration...${NC}"

cat > .env.production << EOF
# ====================
# SPAWNER PRODUCTION CONFIGURATION
# Généré le: $(date)
# ====================

# DOMAIN CONFIGURATION
SPAWNER_PREVIEW_DOMAIN=$DOMAIN
ACME_EMAIL=$ACME_EMAIL

# ENGINE
SPAWNER_DATA_DIR=/opt/spawner
SPAWNER_BOOTSTRAP_TOKEN=$SPAWNER_BOOTSTRAP_TOKEN

# DATABASE CONFIGURATION
DB_NAME=spawner
DB_USER=spawner
DB_PASSWORD=$DB_PASSWORD

# GITHUB OAUTH CONFIGURATION
GITHUB_CLIENT_ID=$GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET=$GITHUB_CLIENT_SECRET
GITHUB_ORG=$GITHUB_ORG
GITHUB_TEAM=$GITHUB_TEAM

# SESSION CONFIGURATION
SESSION_SECRET=$SESSION_SECRET
SESSION_MAX_AGE=86400000
EOF

chmod 600 .env.production

echo -e "${GREEN}OK Configuration sauvegardée${NC}"

# Summary
echo ""
echo -e "${CYAN}=== Récapitulatif ===${NC}"
echo ""
echo -e "Tableau de bord: ${GREEN}https://spawner.$DOMAIN${NC}"
echo -e "Environnements: ${GREEN}https://<env>--<projet>.$DOMAIN${NC}"
echo -e "Email: ${GREEN}$ACME_EMAIL${NC}"
echo -e "GitHub Org: ${GREEN}$GITHUB_ORG${NC}"
echo -e "GitHub Team: ${GREEN}$GITHUB_TEAM${NC}"
echo ""

# Ask to deploy
echo -e "${YELLOW}Voulez-vous démarrer Spawner maintenant? (y/n)${NC}"
read -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    echo -e "${BLUE}Démarrage de Spawner...${NC}"
    echo -e "${YELLOW}Cela peut prendre 5-10 minutes (build des images)...${NC}"
    echo ""
    # Use sg to run with docker group permissions (user was just added to docker group)
    sg docker -c "docker compose -f docker-compose.production.yml --env-file .env.production up -d --build"

    echo ""
    echo -e "${GREEN}=== Démarrage en cours! ===${NC}"
    echo ""
    echo "Suivez les logs avec:"
    echo "  docker compose -f docker-compose.production.yml --env-file .env.production logs -f"
    echo ""
    echo "Une fois démarré, accédez à:"
    echo -e "  ${GREEN}https://spawner.$DOMAIN${NC}"
    echo ""
else
    echo ""
    echo "Pour démarrer Spawner plus tard:"
    echo "  docker compose -f docker-compose.production.yml --env-file .env.production up -d"
fi

echo ""
echo "Le jeton d'API (SPAWNER_BOOTSTRAP_TOKEN) est dans .env.production."
echo ""
echo -e "${CYAN}Configuration terminée!${NC}"
echo ""
