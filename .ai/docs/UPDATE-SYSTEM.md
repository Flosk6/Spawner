# Spawner Update System

Ce document explique comment Spawner gère les mises à jour automatiques, les patches système, et les déploiements.

## Vue d'Ensemble

Spawner inclut un système complet de gestion des mises à jour:

1. **Auto-Update de Spawner** - Mise à jour automatique depuis GitHub
2. **Gestion des Patches Système** - Surveillance et application des mises à jour de packages OS
3. **Webhooks GitHub** - Déploiement automatique sur push
4. **API de Déploiement Manuel** - Endpoint sécurisé pour déclencher des mises à jour

---

## 1. Auto-Update de Spawner

### Configuration

Ajoutez ces variables dans `.env` ou `.env.production`:

```bash
# GitHub Repository
GITHUB_REPO=your-org/spawner

# Auto-Update Settings
AUTO_UPDATE_ENABLED=false           # true pour activer l'auto-update
UPDATE_CHECK_CRON=0 * * * *        # Vérifier toutes les heures
AUTO_UPDATE_CRON=0 0 * * *         # Appliquer à minuit

# Webhook Settings (optionnel)
WEBHOOK_SECRET=your_webhook_secret_here
AUTO_DEPLOY_ENABLED=false          # true pour déployer sur push GitHub
AUTO_DEPLOY_BRANCH=main            # Branche à surveiller

# Manual Deploy Token (optionnel)
DEPLOY_TOKEN=your_secure_token_here
```

### Comment ça Marche

#### Vérification Automatique (Toutes les Heures par Défaut)

```
┌─────────────────┐
│  Cron Scheduler │
│   (hourly)      │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────┐
│  GitHub API                     │
│  /repos/{org}/{repo}/releases   │
│         /latest                 │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  Comparer version actuelle      │
│  avec latest release            │
└────────┬────────────────────────┘
         │
         ├─── Nouvelle version ? ──→ Sauvegarder dans DB
         │                            Notifier dans l'UI
         │
         └─── Déjà à jour ────────→ Rien faire
```

#### Application Automatique (Minuit par Défaut)

Si `AUTO_UPDATE_ENABLED=true`:

```bash
1. Vérifier si une mise à jour est disponible
2. Arrêter les services Docker
3. Backup du fichier .env
4. Pull du code depuis GitHub
5. Installation des dépendances (pnpm install)
6. Build de l'application (pnpm build)
7. Exécution des migrations (pnpm run migration:run)
8. Redémarrage des conteneurs Docker
9. Vérification de la santé (health check)
```

### Script `scripts/update.sh`

Le script d'update suit ce processus:

```bash
#!/bin/bash
# 1. Backup de .env
tar -czf backup.tar.gz .env .env.production

# 2. Arrêt des services
docker-compose down

# 3. Pull du code
git fetch origin
git checkout <version>
git pull

# 4. Install + Build
pnpm install --frozen-lockfile
pnpm build

# 5. Migrations
cd apps/api
pnpm run migration:run

# 6. Redémarrage
docker-compose up -d --force-recreate

# 7. Health check (60s timeout)
```

### Interface Utilisateur

Accessible via `/system/settings`:

**Fonctionnalités:**

- Affichage de la version actuelle et dernière version disponible
- Bouton "Check for Updates" - Vérification manuelle
- Bouton "Apply Update" - Application immédiate
- Toggle "Enable Auto-Update"
- Configuration des crons pour checks et updates
- Sauvegarde des paramètres

---

## 2. Gestion des Patches Système

### Vérification des Packages (Hebdomadaire)

```
┌─────────────────┐
│  Cron Scheduler │
│   (weekly)      │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────┐
│  Détecter Package Manager       │
│  (apt / dnf / zypper)           │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  apt list --upgradable          │
│  dnf check-update               │
│  zypper list-updates            │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  Parser les résultats           │
│  Classifier par type:           │
│   - security (openssl, ssh...)  │
│   - bugfix                      │
│   - feature                     │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  Sauvegarder dans DB            │
│  (table: server_patches)        │
└─────────────────────────────────┘
```

### Classification des Patches

Le système classe automatiquement les packages:

- **SECURITY** - Packages contenant: `security`, `cve`, `vulnerability`, `openssl`, `openssh`
- **FEATURE** - Tous les autres packages

### Application des Patches

**Approche Manuelle-First:**

L'admin doit **cliquer pour appliquer** (pas d'auto-patching):

```bash
# Un seul package
POST /api/system/patches/:id/apply

# Tous les patches en attente
POST /api/system/patches/apply-all
```

**Pourquoi manuel?**

- Évite les surprises en production
- Permet de tester en staging d'abord
- Contrôle total sur le timing des updates

### UI des Patches

Dans `/system/settings`, section "System Patches":

```
┌────────────────────────────────────────┐
│  System Patches                        │
│  [Check for Patches]                   │
├────────────────────────────────────────┤
│  📦 openssl                            │
│  🔴 security                           │
│  1.1.1f → 1.1.1w            [Apply]   │
├────────────────────────────────────────┤
│  📦 nodejs                             │
│  🔵 feature                            │
│  18.0.0 → 20.0.0            [Apply]   │
├────────────────────────────────────────┤
│  [Apply All Patches]                   │
└────────────────────────────────────────┘
```

---

## 3. Webhooks GitHub

### Configuration GitHub

**Étape 1:** Aller dans Settings → Webhooks de votre repo

**Étape 2:** Add webhook avec:

```
Payload URL: https://spawner.yourdomain.com/api/webhooks/github
Content type: application/json
Secret: <votre WEBHOOK_SECRET>

Events:
  ☑ Just the push event
```

**Étape 3:** Configurer `.env.production`:

```bash
WEBHOOK_SECRET=your_webhook_secret_here
AUTO_DEPLOY_ENABLED=true
AUTO_DEPLOY_BRANCH=main
```

### Flux de Déploiement Automatique

```
┌─────────────────────┐
│  Git Push sur main  │
└──────────┬──────────┘
           │
           ▼
┌───────────────────────────────────┐
│  GitHub envoie webhook            │
│  POST /api/webhooks/github        │
└──────────┬────────────────────────┘
           │
           ▼
┌───────────────────────────────────┐
│  Vérification signature HMAC      │
│  (sécurité)                       │
└──────────┬────────────────────────┘
           │
           ├── Signature invalide ──→ 401 Unauthorized
           │
           ▼
┌───────────────────────────────────┐
│  Vérifier:                        │
│  - AUTO_DEPLOY_ENABLED=true?      │
│  - Branch === AUTO_DEPLOY_BRANCH? │
└──────────┬────────────────────────┘
           │
           ├── Conditions non remplies → Ignorer
           │
           ▼
┌───────────────────────────────────┐
│  Déclencher update.sh             │
│  (asynchrone, timeout 1s)         │
└──────────┬────────────────────────┘
           │
           ▼
┌───────────────────────────────────┐
│  Répondre 200 OK immédiatement    │
│  (GitHub attend max 10s)          │
└───────────────────────────────────┘
```

### Test du Webhook

```bash
# Test avec curl
curl -X POST https://spawner.yourdomain.com/api/webhooks/github \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: ping" \
  -H "X-Hub-Signature-256: sha256=..." \
  -d '{"zen": "Test webhook"}'

# Réponse attendue:
{
  "success": true,
  "message": "Webhook configured successfully"
}
```

---

## 4. API de Déploiement Manuel

Pour déclencher un déploiement depuis CI/CD ou scripts:

### Configuration

```bash
# .env.production
DEPLOY_TOKEN=your_secure_random_token
```

Générer un token sécurisé:

```bash
openssl rand -hex 32
```

### Utilisation

```bash
# Déployer la dernière version
curl -X POST https://spawner.yourdomain.com/api/webhooks/manual-deploy \
  -H "Authorization: Bearer your_secure_random_token" \
  -H "Content-Type: application/json" \
  -d '{}'

# Déployer une version spécifique
curl -X POST https://spawner.yourdomain.com/api/webhooks/manual-deploy \
  -H "Authorization: Bearer your_secure_random_token" \
  -H "Content-Type: application/json" \
  -d '{"version": "v1.2.3"}'
```

### Intégration CI/CD

**GitHub Actions:**

```yaml
name: Deploy to Production

on:
  release:
    types: [published]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Spawner Deployment
        run: |
          curl -X POST ${{ secrets.SPAWNER_URL }}/api/webhooks/manual-deploy \
            -H "Authorization: Bearer ${{ secrets.DEPLOY_TOKEN }}" \
            -H "Content-Type: application/json" \
            -d '{"version": "${{ github.event.release.tag_name }}"}'
```

---

## 5. Endpoints API

### Version & Updates

```bash
# Obtenir version actuelle et dernière disponible
GET /api/system/version

# Vérifier les mises à jour manuellement
GET /api/system/updates/check

# Appliquer une mise à jour
POST /api/system/updates/apply
Body: { "version": "v1.2.3" }  # Optionnel, sinon "latest"
```

### Patches Système

```bash
# Lister les patches en attente
GET /api/system/patches

# Vérifier les nouveaux patches
POST /api/system/patches/check

# Appliquer un patch spécifique
POST /api/system/patches/:id/apply

# Appliquer tous les patches
POST /api/system/patches/apply-all
```

### Configuration

```bash
# Obtenir les paramètres actuels
GET /api/system/settings

# Mettre à jour les paramètres
POST /api/system/settings
Body: {
  "autoUpdateEnabled": true,
  "updateCheckCron": "0 * * * *",
  "autoUpdateCron": "0 0 * * *"
}
```

### Webhooks

```bash
# Webhook GitHub (signature requise)
POST /api/webhooks/github

# Déploiement manuel (token requis)
POST /api/webhooks/manual-deploy
Headers: Authorization: Bearer <DEPLOY_TOKEN>
Body: { "version": "v1.2.3" }  # Optionnel
```

---

## 6. Base de Données

### Table: system_settings

```sql
CREATE TABLE system_settings (
  id SERIAL PRIMARY KEY,
  key VARCHAR(255) UNIQUE NOT NULL,
  value TEXT,
  description TEXT,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Valeurs par défaut
INSERT INTO system_settings (key, value, description) VALUES
  ('AUTO_UPDATE_ENABLED', 'false', 'Enable automatic updates'),
  ('UPDATE_CHECK_CRON', '0 * * * *', 'Cron for update checks (hourly)'),
  ('AUTO_UPDATE_CRON', '0 0 * * *', 'Cron for auto-updates (midnight)'),
  ('LATEST_VERSION', NULL, 'Latest version available'),
  ('LATEST_VERSION_CHANGELOG', NULL, 'Changelog for latest version');
```

### Table: server_patches

```sql
CREATE TABLE server_patches (
  id SERIAL PRIMARY KEY,
  packageName VARCHAR(255) NOT NULL,
  currentVersion VARCHAR(255) NOT NULL,
  latestVersion VARCHAR(255) NOT NULL,
  type VARCHAR(50) DEFAULT 'feature',  -- security, bugfix, feature
  status VARCHAR(50) DEFAULT 'pending', -- pending, applied, failed
  changelog TEXT,
  appliedAt TIMESTAMP,
  detectedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_server_patches_status ON server_patches(status);
CREATE INDEX idx_server_patches_type ON server_patches(type);
```

---

## 7. Sécurité

### Webhook GitHub

**Vérification HMAC SHA-256:**

```typescript
const signature = headers["x-hub-signature-256"];
const hmac = crypto.createHmac("sha256", WEBHOOK_SECRET);
const digest = "sha256=" + hmac.update(payload).digest("hex");

// Comparaison timing-safe
crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
```

### API de Déploiement Manuel

**Bearer Token:**

```typescript
const token = headers["authorization"]?.replace("Bearer ", "");
if (token !== process.env.DEPLOY_TOKEN) {
  throw new UnauthorizedException();
}
```

### Exécution des Commandes

**Utilisation de dockerode (pas de shell):**

Le système utilise l'API Docker directement via `dockerode` pour éviter les injections de commandes shell.

---

## 8. Logs & Monitoring

### Logs du Système

```bash
# Logs du service update
docker logs spawner-api | grep UpdateService

# Logs du scheduler
docker logs spawner-api | grep SchedulerService

# Logs des webhooks
docker logs spawner-api | grep WebhookController
```

### Fichiers de Log

```bash
# Logs d'installation
/tmp/spawner-install-*.log

# Logs de mise à jour
/tmp/spawner-update-*.log

# Backups
/opt/spawner/backups/env-backup-*.tar.gz
```

### Audit Trail

Toutes les actions sont loguées dans `audit_logs`:

```sql
SELECT * FROM audit_logs
WHERE action IN ('UPDATE_APPLIED', 'PATCH_APPLIED', 'WEBHOOK_RECEIVED')
ORDER BY createdAt DESC
LIMIT 50;
```

---

## 9. Rollback en Cas de Problème

### Restaurer une Version Précédente

```bash
cd /path/to/spawner

# 1. Arrêter les services
docker-compose down

# 2. Revenir à une version précédente
git fetch --tags
git checkout v1.2.0  # Remplacer par la version souhaitée

# 3. Restaurer le .env si besoin
tar -xzf /opt/spawner/backups/env-backup-20241127_120000.tar.gz

# 4. Rebuild et redémarrer
pnpm install --frozen-lockfile
pnpm build
docker-compose up -d --force-recreate
```

### Rollback de Base de Données

```bash
cd apps/api

# Revenir une migration en arrière
pnpm run migration:revert

# Vérifier l'état
pnpm run typeorm migration:show -d src/data-source.ts
```

---

### Avantages de Spawner

1. **GitHub-First** - Pas de dépendance à un CDN externe
2. **Webhooks Natifs** - Déploiement automatique sur push
3. **API de Déploiement** - Intégration CI/CD facile
4. **Rollback Git** - Revenir à n'importe quelle version taggée
5. **Migrations TypeORM** - Rollback de base de données

---

## 11. Best Practices

### Environnement de Production

**Recommandations:**

```bash
# Désactiver auto-update en prod (appliquer manuellement)
AUTO_UPDATE_ENABLED=false

# Garder les checks actifs (notifications seulement)
UPDATE_CHECK_CRON=0 * * * *

# Activer webhook pour auto-deploy depuis main
AUTO_DEPLOY_ENABLED=true
AUTO_DEPLOY_BRANCH=main

# Utiliser un staging avant prod
# git push origin feature → staging
# Test → Merge to main → prod auto-deploy
```

### Staging Environment

```bash
# Staging: auto-update activé pour tester
AUTO_UPDATE_ENABLED=true
AUTO_DEPLOY_BRANCH=develop

# Production: manuel seulement
AUTO_UPDATE_ENABLED=false
AUTO_DEPLOY_BRANCH=main
```

### Monitoring

```bash
# Configurer des alertes pour:
- Mises à jour disponibles (LATEST_VERSION changed)
- Patches de sécurité détectés (type=security)
- Échecs de déploiement (check logs)
```

---

## 12. Troubleshooting

### Update Échoue

```bash
# 1. Vérifier les logs
tail -f /tmp/spawner-update-*.log

# 2. Vérifier Docker
docker ps -a
docker logs spawner-api

# 3. Vérifier la base de données
psql -U spawner -d spawner
SELECT * FROM system_settings WHERE key LIKE '%VERSION%';

# 4. Rollback manuel si nécessaire (voir section 9)
```

### Webhook ne Fonctionne Pas

```bash
# 1. Vérifier le secret
echo $WEBHOOK_SECRET

# 2. Tester localement
curl -X POST http://localhost:3000/api/webhooks/github \
  -H "X-GitHub-Event: ping" \
  -d '{"zen": "test"}'

# 3. Vérifier les logs GitHub
# Repo → Settings → Webhooks → Recent Deliveries
```

### Patches Non Détectés

```bash
# 1. Vérifier manuellement
apt list --upgradable
dnf check-update
zypper list-updates

# 2. Forcer une vérification
curl -X POST http://localhost:3000/api/system/patches/check \
  -H "Cookie: connect.sid=..."

# 3. Vérifier les permissions
# Le conteneur doit avoir accès au package manager de l'hôte
```

---

## Conclusion

Le système de mise à jour de Spawner offre:

✅ **Automatisation complète** - De la détection au déploiement
✅ **Sécurité** - Signatures HMAC, tokens, audit trail
✅ **Flexibilité** - Manuel, auto, ou webhook-triggered
✅ **Monitoring** - Patches système, versions, logs
✅ **Rollback** - Git tags + migrations TypeORM

**Pour commencer:**

1. Configurer les variables d'environnement
2. Activer les checks automatiques
3. Tester en staging d'abord
4. Déployer en prod avec auto-deploy=false
5. Appliquer manuellement après validation
