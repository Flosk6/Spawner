#!/bin/bash
#
# Spawner PostgreSQL Backup Script
# Backs up the PostgreSQL database to /opt/spawner/backups
#

set -e

# Configuration
BACKUP_DIR="/opt/spawner/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="spawner_backup_${TIMESTAMP}.sql.gz"
RETENTION_DAYS=30

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

echo -e "${GREEN}Starting PostgreSQL backup...${NC}"

# Run backup using docker exec
docker exec spawner-postgres pg_dump -U spawner spawner | gzip > "${BACKUP_DIR}/${BACKUP_FILE}"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}Backup completed successfully: ${BACKUP_FILE}${NC}"

    # Get file size
    SIZE=$(du -h "${BACKUP_DIR}/${BACKUP_FILE}" | cut -f1)
    echo -e "${GREEN}Backup size: ${SIZE}${NC}"

    # Clean up old backups (older than RETENTION_DAYS)
    echo -e "${YELLOW}Cleaning up backups older than ${RETENTION_DAYS} days...${NC}"
    find "$BACKUP_DIR" -name "spawner_backup_*.sql.gz" -mtime +${RETENTION_DAYS} -delete

    # List remaining backups
    echo -e "${GREEN}Current backups:${NC}"
    ls -lh "$BACKUP_DIR"/spawner_backup_*.sql.gz 2>/dev/null || echo "No backups found"
else
    echo -e "${RED}Backup failed!${NC}"
    exit 1
fi
