#!/bin/bash
#
# Spawner Health Check Script
# Checks the health of all Spawner components
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}======================================${NC}"
echo -e "${BLUE}   Spawner Health Check${NC}"
echo -e "${BLUE}======================================${NC}"
echo ""

# Function to check if container is running
check_container() {
    local container=$1
    local name=$2

    if docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
        echo -e "${GREEN}✓${NC} ${name}: Running"

        # Get container health status if available
        HEALTH=$(docker inspect --format='{{.State.Health.Status}}' "$container" 2>/dev/null || echo "none")
        if [ "$HEALTH" != "none" ]; then
            if [ "$HEALTH" = "healthy" ]; then
                echo -e "  └─ Health: ${GREEN}${HEALTH}${NC}"
            else
                echo -e "  └─ Health: ${YELLOW}${HEALTH}${NC}"
            fi
        fi
        return 0
    else
        echo -e "${RED}✗${NC} ${name}: Not running"
        return 1
    fi
}

# Check containers
check_container "spawner-postgres" "PostgreSQL Database"
check_container "spawner-api" "API Server"
check_container "spawner-web" "Web Interface"

# Check if Traefik is running (production only)
if docker ps --format '{{.Names}}' | grep -q "^spawner-traefik$"; then
    check_container "spawner-traefik" "Traefik Reverse Proxy"
fi

echo ""
echo -e "${BLUE}--- Service Status ---${NC}"

# Check API health endpoint
echo -n "API Health Endpoint: "
if curl -sf http://localhost:3000/api/auth/status > /dev/null 2>&1; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${RED}FAIL${NC}"
fi

# Check Web interface
echo -n "Web Interface: "
if curl -sf http://localhost:8080 > /dev/null 2>&1; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${RED}FAIL${NC}"
fi

# Check PostgreSQL connection
echo -n "PostgreSQL Connection: "
if docker exec spawner-postgres pg_isready -U spawner > /dev/null 2>&1; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${RED}FAIL${NC}"
fi

echo ""
echo -e "${BLUE}--- Disk Usage ---${NC}"

# Check disk usage for /opt/spawner
if [ -d "/opt/spawner" ]; then
    echo "Data directory (/opt/spawner):"
    du -sh /opt/spawner/* 2>/dev/null | sort -h
fi

echo ""
echo -e "${BLUE}--- Docker Volumes ---${NC}"
docker volume ls --filter name=spawner | tail -n +2

echo ""
echo -e "${BLUE}--- Recent Logs (last 10 lines) ---${NC}"
echo -e "${YELLOW}API Logs:${NC}"
docker logs spawner-api --tail 10 2>&1 | tail -10

echo ""
echo -e "${BLUE}======================================${NC}"
echo -e "${GREEN}Health check complete!${NC}"
echo -e "${BLUE}======================================${NC}"
