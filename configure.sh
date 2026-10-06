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

# GitHub OAuth Configuration (optional)
echo ""
echo -e "${BLUE}[2/2] Connexion avec GitHub (facultatif)${NC}"
echo ""
echo "Les comptes se créent par invitation et se connectent avec une passkey."
echo "La connexion GitHub est en plus, et se configure aussi plus tard depuis"
echo "le tableau de bord (System, Settings)."
echo ""
read -p "Configurer GitHub maintenant? (y/N) " -n 1 -r
echo
GITHUB_CLIENT_ID=""
GITHUB_CLIENT_SECRET=""
GITHUB_ORG=""
GITHUB_TEAM=""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    echo -e "${YELLOW}Créez une OAuth App sur GitHub:${NC}"
    echo "1. Organisation, Settings, Developer settings, OAuth Apps, New OAuth App"
    echo "2. Homepage URL: https://spawner.$DOMAIN"
    echo "3. Callback URL: https://spawner.$DOMAIN/api/v1/auth/github/callback"
    echo ""
    read -p "GitHub Client ID: " GITHUB_CLIENT_ID
    read -sp "GitHub Client Secret: " GITHUB_CLIENT_SECRET
    echo ""
    read -p "Organisation GitHub dont les membres peuvent se connecter (vide: aucune): " GITHUB_ORG
    read -p "Équipe de cette organisation (slug, vide: toute l'organisation): " GITHUB_TEAM
fi

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
if [ -n "$GITHUB_CLIENT_ID" ]; then
    echo -e "GitHub: ${GREEN}configuré${NC}"
else
    echo -e "GitHub: ${GREEN}non configuré (passkeys seulement)${NC}"
fi
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
    echo -e "${YELLOW}Attente du démarrage de Spawner...${NC}"
    INVITE=""
    for _ in $(seq 1 60); do
        INVITE=$(sg docker -c "docker exec -u node spawner node dist/admin.js invite --role admin --hours 1 --note 'premier admin'" 2>/dev/null) && break
        sleep 5
    done

    echo ""
    echo -e "${GREEN}=== Spawner est démarré ===${NC}"
    echo ""
    echo -e "Tableau de bord: ${GREEN}https://spawner.$DOMAIN${NC}"
    if [ -n "$INVITE" ]; then
        echo ""
        echo "Créez le compte admin avec ce lien, valable une heure:"
        echo -e "  ${GREEN}$INVITE${NC}"
    else
        echo ""
        echo "Pour obtenir le lien du compte admin une fois Spawner démarré:"
        echo "  docker exec -u node spawner node dist/admin.js invite --role admin --hours 1"
    fi
    echo ""
    echo "Logs:"
    echo "  docker compose -f docker-compose.production.yml --env-file .env.production logs -f"
    echo ""
else
    echo ""
    echo "Pour démarrer Spawner plus tard, puis obtenir le lien du compte admin:"
    echo "  docker compose -f docker-compose.production.yml --env-file .env.production up -d --build"
    echo "  docker exec -u node spawner node dist/admin.js invite --role admin --hours 1"
fi

echo ""
echo "Le jeton d'API (SPAWNER_BOOTSTRAP_TOKEN) est dans .env.production."
echo ""
echo -e "${CYAN}Configuration terminée!${NC}"
echo ""
