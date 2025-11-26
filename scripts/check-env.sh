#!/bin/bash

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}   Environment Configuration Check${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

ENV_FILE=".env"
if [ "$1" = "prod" ] || [ "$1" = "production" ]; then
    ENV_FILE=".env.production"
fi

echo -e "Checking: ${BLUE}${ENV_FILE}${NC}"
echo ""

if [ ! -f "$ENV_FILE" ]; then
    echo -e "${RED}❌ $ENV_FILE file not found!${NC}"
    echo ""
    if [ "$ENV_FILE" = ".env" ]; then
        echo -e "${YELLOW}To fix: cp .env.example .env${NC}"
    else
        echo -e "${YELLOW}To fix: cp .env.production.example .env.production${NC}"
    fi
    exit 1
fi

echo -e "${GREEN}✅ $ENV_FILE file exists${NC}"
echo ""

REQUIRED_VARS=(
    "GITHUB_CLIENT_ID"
    "GITHUB_CLIENT_SECRET"
    "GITHUB_ORG"
    "GITHUB_TEAM"
    "SESSION_SECRET"
)

OPTIONAL_VARS=(
    "GITHUB_REPO"
    "WEBHOOK_SECRET"
    "DEPLOY_TOKEN"
)

PRODUCTION_VARS=(
    "DOMAIN"
    "ACME_EMAIL"
    "DB_PASSWORD"
)

echo -e "${BLUE}Required Variables:${NC}"
MISSING_COUNT=0

for var in "${REQUIRED_VARS[@]}"; do
    VALUE=$(grep "^${var}=" "$ENV_FILE" | cut -d'=' -f2-)

    if [ -z "$VALUE" ]; then
        echo -e "  ${RED}❌ $var${NC} - Not set"
        MISSING_COUNT=$((MISSING_COUNT + 1))
    elif [[ "$VALUE" =~ (CHANGE|GENERATE|your_|example) ]]; then
        echo -e "  ${YELLOW}⚠️  $var${NC} - Still using default/example value"
        MISSING_COUNT=$((MISSING_COUNT + 1))
    else
        echo -e "  ${GREEN}✅ $var${NC} - Configured"
    fi
done

echo ""
echo -e "${BLUE}Optional Variables (Update System):${NC}"

for var in "${OPTIONAL_VARS[@]}"; do
    VALUE=$(grep "^${var}=" "$ENV_FILE" | cut -d'=' -f2-)

    if [ -z "$VALUE" ] || [[ "$VALUE" =~ (CHANGE|GENERATE|your_|example) ]]; then
        echo -e "  ${YELLOW}⚠️  $var${NC} - Not configured (optional)"
    else
        echo -e "  ${GREEN}✅ $var${NC} - Configured"
    fi
done

if [ "$ENV_FILE" = ".env.production" ]; then
    echo ""
    echo -e "${BLUE}Production-Specific Variables:${NC}"

    for var in "${PRODUCTION_VARS[@]}"; do
        VALUE=$(grep "^${var}=" "$ENV_FILE" | cut -d'=' -f2-)

        if [ -z "$VALUE" ]; then
            echo -e "  ${RED}❌ $var${NC} - Not set"
            MISSING_COUNT=$((MISSING_COUNT + 1))
        elif [[ "$VALUE" =~ (CHANGE|yourdomain|example) ]]; then
            echo -e "  ${YELLOW}⚠️  $var${NC} - Still using default value"
            MISSING_COUNT=$((MISSING_COUNT + 1))
        else
            echo -e "  ${GREEN}✅ $var${NC} - Configured"
        fi
    done
fi

echo ""
echo -e "${BLUE}Security Checks:${NC}"

SESSION_SECRET=$(grep "^SESSION_SECRET=" "$ENV_FILE" | cut -d'=' -f2-)
if [ -n "$SESSION_SECRET" ] && [ ${#SESSION_SECRET} -ge 32 ]; then
    echo -e "  ${GREEN}✅ SESSION_SECRET${NC} - Length OK (${#SESSION_SECRET} chars)"
else
    echo -e "  ${RED}❌ SESSION_SECRET${NC} - Too short or not set"
    echo -e "     ${YELLOW}Generate with: openssl rand -base64 32${NC}"
    MISSING_COUNT=$((MISSING_COUNT + 1))
fi

if [ "$ENV_FILE" = ".env.production" ]; then
    DB_PASSWORD=$(grep "^DB_PASSWORD=" "$ENV_FILE" | cut -d'=' -f2-)
    if [[ "$DB_PASSWORD" =~ CHANGE ]]; then
        echo -e "  ${RED}❌ DB_PASSWORD${NC} - Using default value!"
        echo -e "     ${YELLOW}Generate with: openssl rand -base64 32${NC}"
        MISSING_COUNT=$((MISSING_COUNT + 1))
    elif [ -n "$DB_PASSWORD" ] && [ ${#DB_PASSWORD} -ge 16 ]; then
        echo -e "  ${GREEN}✅ DB_PASSWORD${NC} - Configured"
    else
        echo -e "  ${YELLOW}⚠️  DB_PASSWORD${NC} - Too short"
        MISSING_COUNT=$((MISSING_COUNT + 1))
    fi
fi

echo ""
echo -e "${BLUE}File Permissions:${NC}"
PERMS=$(stat -f "%A" "$ENV_FILE" 2>/dev/null || stat -c "%a" "$ENV_FILE" 2>/dev/null)
if [ "$PERMS" = "600" ] || [ "$PERMS" = "400" ]; then
    echo -e "  ${GREEN}✅ Permissions${NC} - $PERMS (secure)"
elif [ "$ENV_FILE" = ".env.production" ]; then
    echo -e "  ${YELLOW}⚠️  Permissions${NC} - $PERMS (should be 600)"
    echo -e "     ${YELLOW}Fix with: chmod 600 $ENV_FILE${NC}"
else
    echo -e "  ${YELLOW}⚠️  Permissions${NC} - $PERMS (consider: chmod 600 $ENV_FILE)"
fi

echo ""
echo -e "${BLUE}========================================${NC}"

if [ $MISSING_COUNT -eq 0 ]; then
    echo -e "${GREEN}✅ Configuration looks good!${NC}"
    echo ""
    exit 0
else
    echo -e "${YELLOW}⚠️  Found $MISSING_COUNT issue(s)${NC}"
    echo ""
    echo -e "Next steps:"
    echo -e "  1. Edit $ENV_FILE"
    echo -e "  2. Fill in missing values"
    echo -e "  3. Generate secrets with: openssl rand -base64 32"
    echo -e "  4. Run this check again: ./scripts/check-env.sh"
    echo ""
    exit 1
fi
