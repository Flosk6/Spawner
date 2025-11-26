# Scripts Utilitaires Spawner

Ce dossier contient des scripts pour la maintenance et l'administration de Spawner en production.

## Scripts Disponibles

### 1. backup-db.sh
**Backup automatique de la base de données PostgreSQL**

```bash
./scripts/backup-db.sh
```

**Ce que fait ce script:**
- Crée un dump compressé de PostgreSQL
- Sauvegarde dans `/opt/spawner/backups/`
- Format: `spawner_backup_YYYYMMDD_HHMMSS.sql.gz`
- Nettoie automatiquement les backups > 30 jours
- Affiche la taille du backup

**Configuration automatique (cron):**
```bash
# Backup quotidien à 2h du matin
crontab -e
# Ajouter:
0 2 * * * /path/to/spawner/scripts/backup-db.sh >> /var/log/spawner-backup.log 2>&1
```

### 2. restore-db.sh
**Restauration de la base de données depuis un backup**

```bash
./scripts/restore-db.sh /opt/spawner/backups/spawner_backup_20241127_020000.sql.gz
```

**⚠️ ATTENTION:**
- Cette commande **ÉCRASE** la base de données actuelle
- Toutes les données non sauvegardées seront **PERDUES**
- Le script demande confirmation avant d'agir
- L'API est automatiquement arrêtée puis redémarrée

**Workflow:**
1. Arrêt de spawner-api
2. Drop + recreate database
3. Import du backup
4. Redémarrage de spawner-api

**Usage recommandé:**
- Tester sur un backup récent d'abord
- Faire un backup avant de restore un vieux backup
- Vérifier l'intégrité après restore

### 3. health-check.sh
**Vérification de l'état de santé de Spawner**

```bash
./scripts/health-check.sh
```

**Ce que vérifie ce script:**
- ✅ Status des containers Docker
- ✅ Health checks des services
- ✅ API health endpoint
- ✅ Web interface accessible
- ✅ Connexion PostgreSQL
- ✅ Utilisation disque (/opt/spawner)
- ✅ Volumes Docker
- ✅ Logs récents

**Output exemple:**
```
======================================
   Spawner Health Check
======================================

✓ PostgreSQL Database: Running
  └─ Health: healthy
✓ API Server: Running
  └─ Health: healthy
✓ Web Interface: Running
  └─ Health: healthy

--- Service Status ---
API Health Endpoint: OK
Web Interface: OK
PostgreSQL Connection: OK

--- Disk Usage ---
[Détails...]
```

**Configuration monitoring (cron):**
```bash
# Health check toutes les 15 minutes
crontab -e
# Ajouter:
*/15 * * * * /path/to/spawner/scripts/health-check.sh >> /var/log/spawner-health.log 2>&1
```

## Installation

Tous les scripts sont déjà exécutables. Si ce n'est pas le cas :

```bash
chmod +x scripts/*.sh
```

## Logs

**Centraliser les logs des scripts:**

```bash
# Créer les fichiers de logs
sudo touch /var/log/spawner-backup.log
sudo touch /var/log/spawner-health.log
sudo chown $(whoami):$(whoami) /var/log/spawner-*.log
```

**Rotation des logs (logrotate):**

Créer `/etc/logrotate.d/spawner` :

```
/var/log/spawner-*.log {
    daily
    rotate 30
    compress
    delaycompress
    notifempty
    create 0644 spawner spawner
    sharedscripts
}
```

## Alerting

**Exemple d'alerting simple par email (requiert mailutils):**

```bash
#!/bin/bash
# /path/to/spawner/scripts/health-check-alert.sh

OUTPUT=$(/path/to/spawner/scripts/health-check.sh)

if echo "$OUTPUT" | grep -q "FAIL"; then
    echo "$OUTPUT" | mail -s "ALERT: Spawner Health Check Failed" admin@example.com
fi
```

**Cron:**
```bash
*/15 * * * * /path/to/spawner/scripts/health-check-alert.sh
```

## Troubleshooting Scripts

### backup-db.sh échoue

**Problème:** `Cannot connect to database`

**Solution:**
```bash
# Vérifier que PostgreSQL tourne
docker ps | grep postgres

# Vérifier les logs
docker logs spawner-postgres
```

### restore-db.sh échoue

**Problème:** `Restore failed`

**Solution:**
```bash
# Vérifier que le backup existe
ls -lh /opt/spawner/backups/

# Tester l'intégrité du backup
gunzip -t /opt/spawner/backups/spawner_backup_XXX.sql.gz
```

### health-check.sh rapporte des erreurs

**Problème:** Certains services ne répondent pas

**Solution:**
```bash
# Redémarrer les services
docker-compose restart

# Vérifier les logs spécifiques
docker logs spawner-api
docker logs spawner-postgres
```

## Best Practices

1. **Backups:**
   - Toujours avoir au moins 7 jours de backups
   - Tester restore mensuellement
   - Stocker backups critiques hors serveur

2. **Health Checks:**
   - Exécuter régulièrement (15-30 min)
   - Logger les résultats
   - Alerter en cas d'échec

3. **Monitoring:**
   - Surveiller l'espace disque
   - Surveiller l'utilisation CPU/RAM
   - Surveiller les erreurs dans les logs

## Support

Pour plus d'informations :
- [VPS-DEPLOYMENT-GUIDE.md](../VPS-DEPLOYMENT-GUIDE.md)
- [PRODUCTION-CHECKLIST.md](../PRODUCTION-CHECKLIST.md)
- [CLAUDE.md](../CLAUDE.md)
