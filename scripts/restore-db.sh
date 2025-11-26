#!/bin/bash
#
# Spawner PostgreSQL Restore Script
# Restores the PostgreSQL database from a backup file
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if backup file is provided
if [ -z "$1" ]; then
    echo -e "${RED}Error: No backup file specified${NC}"
    echo "Usage: $0 <backup-file>"
    echo "Example: $0 /opt/spawner/backups/spawner_backup_20231127_120000.sql.gz"
    echo ""
    echo "Available backups:"
    ls -1 /opt/spawner/backups/spawner_backup_*.sql.gz 2>/dev/null || echo "No backups found"
    exit 1
fi

BACKUP_FILE="$1"

# Check if backup file exists
if [ ! -f "$BACKUP_FILE" ]; then
    echo -e "${RED}Error: Backup file not found: ${BACKUP_FILE}${NC}"
    exit 1
fi

echo -e "${YELLOW}WARNING: This will replace the current database with the backup!${NC}"
echo -e "${YELLOW}Current database will be PERMANENTLY LOST!${NC}"
echo ""
echo -e "Backup file: ${GREEN}${BACKUP_FILE}${NC}"
echo ""
read -p "Are you sure you want to continue? (yes/no): " -r
echo
if [[ ! $REPLY =~ ^[Yy]es$ ]]; then
    echo "Restore cancelled."
    exit 0
fi

echo -e "${GREEN}Starting database restore...${NC}"

# Stop the API to prevent connections during restore
echo -e "${YELLOW}Stopping spawner-api...${NC}"
docker stop spawner-api

# Drop and recreate database
echo -e "${YELLOW}Dropping and recreating database...${NC}"
docker exec spawner-postgres psql -U spawner -c "DROP DATABASE IF EXISTS spawner;"
docker exec spawner-postgres psql -U spawner -c "CREATE DATABASE spawner;"

# Restore from backup
echo -e "${YELLOW}Restoring from backup...${NC}"
gunzip -c "$BACKUP_FILE" | docker exec -i spawner-postgres psql -U spawner spawner

if [ $? -eq 0 ]; then
    echo -e "${GREEN}Restore completed successfully!${NC}"

    # Restart the API
    echo -e "${YELLOW}Starting spawner-api...${NC}"
    docker start spawner-api

    echo -e "${GREEN}Database restored and API restarted.${NC}"
else
    echo -e "${RED}Restore failed!${NC}"
    echo -e "${YELLOW}Attempting to restart spawner-api...${NC}"
    docker start spawner-api
    exit 1
fi
