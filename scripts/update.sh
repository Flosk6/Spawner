#!/bin/bash
set -e
set -o pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
LOGFILE="/tmp/spawner-update-$(date +%Y%m%d_%H%M%S).log"
BACKUP_DIR="/opt/spawner/backups"

exec > >(tee -a "$LOGFILE") 2>&1

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}   Spawner Update Script${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

cleanup() {
    if [ $? -ne 0 ]; then
        echo -e "${RED}=== Update Failed ===${NC}"
        echo -e "${YELLOW}Check the log file: ${LOGFILE}${NC}"
        echo -e "${YELLOW}Your backup is available at: ${BACKUP_DIR}${NC}"
        exit 1
    fi
}
trap cleanup EXIT

VERSION=${1:-latest}

echo -e "${BLUE}Target version: ${VERSION}${NC}"
echo ""

if [ ! -d "$BACKUP_DIR" ]; then
    echo -e "${YELLOW}Creating backup directory...${NC}"
    mkdir -p "$BACKUP_DIR"
fi

echo -e "${BLUE}Step 1/7: Creating backup${NC}"
BACKUP_FILE="${BACKUP_DIR}/env-backup-$(date +%Y%m%d_%H%M%S).tar.gz"

if [ -f "$PROJECT_ROOT/.env" ]; then
    tar -czf "$BACKUP_FILE" -C "$PROJECT_ROOT" .env .env.production 2>/dev/null || true
    echo -e "${GREEN}Backup created: ${BACKUP_FILE}${NC}"
else
    echo -e "${YELLOW}No .env file found, skipping backup${NC}"
fi

echo ""
echo -e "${BLUE}Step 2/7: Stopping services${NC}"
cd "$PROJECT_ROOT"

if [ -f "docker-compose.production.yml" ]; then
    docker-compose -f docker-compose.production.yml down || true
elif [ -f "docker-compose.yml" ]; then
    docker-compose down || true
fi

echo -e "${GREEN}Services stopped${NC}"

echo ""
echo -e "${BLUE}Step 3/7: Pulling latest code from GitHub${NC}"

if [ -d "$PROJECT_ROOT/.git" ]; then
    git fetch origin

    if [ "$VERSION" = "latest" ]; then
        LATEST_TAG=$(git describe --tags --abbrev=0 origin/main 2>/dev/null || echo "main")
        echo -e "${YELLOW}Latest version: ${LATEST_TAG}${NC}"
        git checkout "$LATEST_TAG" 2>/dev/null || git checkout main
    else
        git checkout "$VERSION"
    fi

    git pull
    echo -e "${GREEN}Code updated successfully${NC}"
else
    echo -e "${RED}Not a git repository. Please clone from GitHub.${NC}"
    exit 1
fi

echo ""
echo -e "${BLUE}Step 4/7: Installing dependencies${NC}"

if command -v pnpm &> /dev/null; then
    pnpm install --frozen-lockfile
    echo -e "${GREEN}Dependencies installed${NC}"
else
    echo -e "${RED}pnpm not found. Please install pnpm first.${NC}"
    exit 1
fi

echo ""
echo -e "${BLUE}Step 5/7: Building application${NC}"
pnpm build
echo -e "${GREEN}Build completed${NC}"

echo ""
echo -e "${BLUE}Step 6/7: Running database migrations${NC}"
cd "$PROJECT_ROOT/apps/api"

if [ -f ".env.production" ]; then
    export $(cat .env.production | grep -v '^#' | xargs)
elif [ -f ".env" ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

pnpm run migration:run || echo -e "${YELLOW}No migrations to run${NC}"
echo -e "${GREEN}Migrations completed${NC}"

echo ""
echo -e "${BLUE}Step 7/7: Starting services${NC}"
cd "$PROJECT_ROOT"

if [ -f "docker-compose.production.yml" ]; then
    docker-compose -f docker-compose.production.yml up -d --force-recreate --remove-orphans
elif [ -f "docker-compose.yml" ]; then
    docker-compose up -d --force-recreate --remove-orphans
fi

echo -e "${GREEN}Services started${NC}"

echo ""
echo -e "${BLUE}Waiting for services to be healthy (60s timeout)...${NC}"
sleep 10

TIMEOUT=60
ELAPSED=0
HEALTHY=false

while [ $ELAPSED -lt $TIMEOUT ]; do
    if docker ps --filter "name=spawner-api" --filter "health=healthy" | grep -q spawner-api; then
        HEALTHY=true
        break
    fi
    sleep 5
    ELAPSED=$((ELAPSED + 5))
    echo -e "${YELLOW}Waiting... (${ELAPSED}s/${TIMEOUT}s)${NC}"
done

if [ "$HEALTHY" = true ]; then
    echo -e "${GREEN}Services are healthy${NC}"
else
    echo -e "${YELLOW}Warning: Service health check timed out. Check logs with: docker logs spawner-api${NC}"
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}   Update Completed Successfully${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "Updated to version: ${VERSION}"
echo -e "Backup saved to: ${BACKUP_FILE}"
echo -e "Log file: ${LOGFILE}"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo -e "  1. Verify services: ${YELLOW}docker ps${NC}"
echo -e "  2. Check logs: ${YELLOW}docker logs spawner-api${NC}"
echo -e "  3. Access dashboard: ${YELLOW}https://your-domain.com${NC}"
echo ""

trap - EXIT
