# Guide de Déploiement VPS - Spawner

Ce guide vous accompagne pas à pas pour déployer Spawner sur un VPS IONOS (ou tout autre VPS Ubuntu).

---

## 🚀 Installation Automatique (Recommandé)

**La méthode la plus simple !**

```bash
curl -fsSL https://raw.githubusercontent.com/votre-org/spawner/main/install.sh | bash
```

**C'est tout!** Le script s'occupe de tout :

- Installation de Docker, Node.js, pnpm
- Configuration du firewall
- Installation de Spawner
- Configuration interactive (domaine, GitHub OAuth, etc.)
- Démarrage automatique

**Durée:** 10-15 minutes

### Que fait le script ?

1. ✅ Vérifie le système (Ubuntu 22.04+)
2. ✅ Installe Docker & Docker Compose
3. ✅ Installe Node.js 20 & pnpm
4. ✅ Configure le firewall (UFW)
5. ✅ Clone Spawner depuis GitHub
6. ✅ Build les packages
7. ✅ Crée les répertoires nécessaires
8. ✅ Configuration interactive (domaine, OAuth, secrets)
9. ✅ Démarre Spawner avec Traefik + SSL

### Prérequis

- **VPS:** Ubuntu 22.04+ (2 vCPU, 4GB RAM min)
- **Domaine:** Configuré avec DNS
- **Accès:** SSH en tant qu'utilisateur non-root avec sudo

---

## 📋 Prérequis Détaillés

### 1.1 VPS Requirements

**Spécifications minimales:**

- **OS:** Ubuntu 22.04 LTS
- **CPU:** 2 vCPU (4 recommandé)
- **RAM:** 4 GB (8 GB recommandé)
- **Stockage:** 50 GB minimum
- **Réseau:** IPv4 publique

### 1.2 Configuration DNS (À Faire AVANT)

Vous DEVEZ configurer votre DNS avant de lancer le script :

| Type | Nom        | Valeur    | TTL  |
| ---- | ---------- | --------- | ---- |
| A    | spawner    | IP_DU_VPS | 3600 |
| A    | \*.preview | IP_DU_VPS | 3600 |

**Vérifier la propagation:**

```bash
nslookup spawner.example.com
# Doit retourner l'IP de votre VPS
```

### 1.3 GitHub OAuth App (Créer AVANT ou PENDANT)

Le script vous guidera, mais vous pouvez créer l'app avant :

1. Aller sur: `https://github.com/organizations/VOTRE_ORG/settings/applications`
2. Cliquer "New OAuth App"
3. Remplir:
   - **Name:** Spawner
   - **Homepage:** `https://spawner.example.com`
   - **Callback:** `https://spawner.example.com/api/auth/github/callback`
4. Noter Client ID et générer Client Secret

---

## 🛠️ Installation Automatique - Étape par Étape

### 1. Connexion au VPS

```bash
ssh votre_user@IP_DU_VPS
```

### 2. Lancer le Script

```bash
curl -fsSL https://raw.githubusercontent.com/votre-org/spawner/main/install.sh | bash
```

### 3. Répondre aux Questions

Le script vous demandera :

- ✅ Nom de domaine (ex: `example.com`)
- ✅ Email pour Let's Encrypt
- ✅ GitHub OAuth Client ID
- ✅ GitHub OAuth Client Secret
- ✅ GitHub Organization
- ✅ GitHub Team slug
- ✅ Mot de passe Traefik Dashboard

### 4. Attendre la Fin

Le script va :

1. Installer toutes les dépendances (3-5 min)
2. Build Spawner (2-3 min)
3. Démarrer les services (2-3 min)

**Total:** ~10-15 minutes

### 5. Accéder à Spawner

Une fois terminé :

```
https://spawner.example.com
```

---

## 🔧 Reconfiguration

Si vous devez changer la configuration plus tard :

```bash
cd ~/spawner
./configure.sh
```

Ce script permet de :

- Changer le domaine
- Mettre à jour les identifiants OAuth
- Régénérer les secrets
- Redémarrer avec la nouvelle config

---

## 📚 Installation Manuelle (Mode Avancé)

Si vous préférez tout faire manuellement ou si vous voulez comprendre chaque étape, suivez le guide détaillé ci-dessous.

**⚠️ Réservé aux utilisateurs avancés - le script automatique est recommandé.**

## Table des Matières (Mode Manuel)

1. [Prérequis](#1-prérequis)
2. [Préparation du VPS](#2-préparation-du-vps)
3. [Configuration DNS](#3-configuration-dns)
4. [Installation de Spawner](#4-installation-de-spawner)
5. [Configuration GitHub OAuth](#5-configuration-github-oauth)
6. [Configuration Production](#6-configuration-production)
7. [Traefik & SSL](#7-traefik--ssl)
8. [Premier Lancement](#8-premier-lancement)
9. [Configuration Post-Installation](#9-configuration-post-installation)
10. [Tests de Validation](#10-tests-de-validation)
11. [Monitoring & Logs](#11-monitoring--logs)
12. [Backup & Maintenance](#12-backup--maintenance)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. Prérequis

### 1.1 VPS Requirements

**Spécifications minimales:**

- **OS:** Ubuntu 22.04 LTS (recommandé)
- **CPU:** 2 vCPU minimum (4 vCPU recommandé)
- **RAM:** 4 GB minimum (8 GB recommandé)
- **Stockage:** 50 GB minimum (100 GB recommandé)
- **Réseau:** IPv4 publique

**Pourquoi ces specs ?**

- Spawner API + PostgreSQL: ~1 GB RAM
- Environnements créés: 1-2 GB RAM chacun
- Buffer pour Docker builds: 1-2 GB RAM
- Stockage des repositories Git clonés
- Backups PostgreSQL

### 1.2 Domaine & DNS

Vous devez posséder un nom de domaine avec accès aux DNS.

**Configuration requise:**

- **Domaine principal:** `spawner.example.com`
- **Wildcard:** `*.preview.example.com`

### 1.3 GitHub Organization

- Une organisation GitHub
- Une équipe (team) dans cette organisation
- Droits admin sur l'organisation

### 1.4 Accès VPS

- Accès SSH root ou sudo
- Clé SSH configurée (recommandé vs password)

---

## 2. Préparation du VPS

### 2.1 Connexion SSH

```bash
# Connexion au VPS
ssh root@VOTRE_IP_VPS

# Ou si vous avez créé un user
ssh votre_user@VOTRE_IP_VPS
```

### 2.2 Mise à Jour Système

```bash
# Mise à jour des packages
sudo apt update && sudo apt upgrade -y

# Installer outils de base
sudo apt install -y curl wget git vim htop ufw ca-certificates gnupg lsb-release
```

### 2.3 Installation Docker

```bash
# Ajouter la clé GPG officielle de Docker
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Ajouter le repository Docker
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Installer Docker
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Vérifier l'installation
docker --version
docker compose version
```

**Résultat attendu:**

```
Docker version 24.0.x
Docker Compose version v2.21.x
```

### 2.4 Configuration Docker (Optionnel mais Recommandé)

```bash
# Créer utilisateur non-root pour Docker
sudo adduser spawner
sudo usermod -aG docker spawner
sudo usermod -aG sudo spawner

# Passer à l'utilisateur spawner
sudo su - spawner
```

### 2.5 Installation Node.js & pnpm

```bash
# Installer Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Vérifier
node --version  # v20.x.x
npm --version   # 10.x.x

# Installer pnpm globalement
sudo npm install -g pnpm

# Vérifier
pnpm --version  # 8.x.x
```

### 2.6 Configuration Firewall

```bash
# Activer UFW si pas déjà fait
sudo ufw status

# Autoriser SSH (IMPORTANT - sinon vous serez déconnecté!)
sudo ufw allow 22/tcp

# Autoriser HTTP et HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Activer le firewall
sudo ufw --force enable

# Vérifier
sudo ufw status
```

**Résultat attendu:**

```
Status: active

To                         Action      From
--                         ------      ----
22/tcp                     ALLOW       Anywhere
80/tcp                     ALLOW       Anywhere
443/tcp                    ALLOW       Anywhere
```

---

## 3. Configuration DNS

### 3.1 Récupérer l'IP du VPS

```bash
# Sur le VPS
curl ifconfig.me
```

Notez l'IP publique (ex: `123.45.67.89`)

### 3.2 Configurer les Enregistrements DNS

Dans votre panel DNS (IONOS, Cloudflare, etc.), ajoutez :

| Type | Nom        | Valeur       | TTL  |
| ---- | ---------- | ------------ | ---- |
| A    | spawner    | 123.45.67.89 | 3600 |
| A    | \*.preview | 123.45.67.89 | 3600 |

**⚠️ IMPORTANT:** Remplacez `123.45.67.89` par l'IP de votre VPS.

**Exemple complet:**

- `spawner.example.com` → `123.45.67.89`
- `*.preview.example.com` → `123.45.67.89`

### 3.3 Vérifier la Propagation DNS

```bash
# Tester depuis votre machine locale (pas le VPS)
nslookup spawner.example.com
nslookup api.preview.example.com

# Ou avec dig
dig spawner.example.com +short
dig test.preview.example.com +short
```

**Résultat attendu:** Doit retourner l'IP de votre VPS.

**⏱️ Temps de propagation:** 5 minutes à 24 heures selon votre provider DNS.

---

## 4. Installation de Spawner

### 4.1 Cloner le Repository

```bash
# Aller dans le home directory
cd ~

# Cloner Spawner (remplacez par votre repo)
git clone https://github.com/votre-org/spawner.git
cd spawner
```

### 4.2 Installer les Dépendances

```bash
# Installer toutes les dépendances du monorepo
pnpm install

# Build des packages partagés
pnpm build
```

**⏱️ Durée:** 2-5 minutes selon la vitesse du VPS.

### 4.3 Créer les Répertoires de Données

```bash
# Créer la structure de données
sudo mkdir -p /opt/spawner/{data,git-keys,repos,envs,backups}

# Donner les permissions à l'utilisateur actuel
sudo chown -R $(whoami):$(whoami) /opt/spawner

# Vérifier
ls -la /opt/spawner/
```

---

## 5. Configuration GitHub OAuth

### 5.1 Créer l'OAuth App

1. **Aller sur GitHub:**

   ```
   https://github.com/organizations/VOTRE_ORG/settings/applications
   ```

2. **Cliquer sur "New OAuth App"**

3. **Remplir le formulaire:**
   - **Application name:** `Spawner Production`
   - **Homepage URL:** `https://spawner.example.com`
   - **Authorization callback URL:** `https://spawner.example.com/api/auth/github/callback`
   - **Description:** (optionnel) `Self-hosted preview environments`

4. **Créer l'application**

5. **Noter le Client ID** (visible immédiatement)

6. **Générer un Client Secret:**
   - Cliquer sur "Generate a new client secret"
   - **⚠️ IMPORTANT:** Copier le secret immédiatement, il ne sera plus visible!

### 5.2 Créer l'Équipe GitHub

1. **Aller dans votre organisation:**

   ```
   https://github.com/orgs/VOTRE_ORG/teams
   ```

2. **Créer une nouvelle équipe:**
   - Nom: `spawner-users` (ou autre)
   - Description: Utilisateurs autorisés à accéder à Spawner
   - Visibilité: **Secret** (recommandé)

3. **Noter le slug de l'équipe** (URL):

   ```
   https://github.com/orgs/VOTRE_ORG/teams/spawner-users
                                              ^^^^^^^^^^^^^^
                                              Votre team slug
   ```

4. **Ajouter des membres** à l'équipe

---

## 6. Configuration Production

### 6.1 Copier le Fichier d'Environnement

```bash
# Dans le répertoire spawner
cd ~/spawner

# Copier le template
cp .env.production.example .env.production
```

### 6.2 Générer les Secrets

```bash
# Générer le secret de session
openssl rand -base64 32

# Générer le mot de passe PostgreSQL
openssl rand -base64 32

# Générer l'auth Traefik (remplacez 'votre_password')
htpasswd -nb admin votre_password | sed -e s/\\$/\\$\\$/g
```

**📝 Notez ces valeurs quelque part de sécurisé!**

### 6.3 Éditer .env.production

```bash
nano .env.production
```

**Remplir TOUTES les variables:**

```bash
# ====================
# DOMAIN CONFIGURATION
# ====================
DOMAIN=example.com  # ← VOTRE domaine (sans "spawner.")

# Email pour Let's Encrypt
ACME_EMAIL=admin@example.com  # ← VOTRE email

# Auth Traefik (résultat de htpasswd ci-dessus)
TRAEFIK_AUTH=admin:$$apr1$$...  # ← Résultat htpasswd

# ====================
# DATABASE CONFIGURATION
# ====================
DB_NAME=spawner
DB_USER=spawner
DB_PASSWORD=RESULT_openssl_rand_base64_32  # ← Mot de passe généré

# ====================
# GITHUB OAUTH
# ====================
GITHUB_CLIENT_ID=votre_client_id  # ← De l'étape 5.1
GITHUB_CLIENT_SECRET=votre_client_secret  # ← De l'étape 5.1
GITHUB_ORG=votre_org_name  # ← Nom de votre organisation
GITHUB_TEAM=spawner-users  # ← Slug de l'équipe créée

# ====================
# SESSION
# ====================
SESSION_SECRET=RESULT_openssl_rand_base64_32  # ← Secret généré
```

**Sauvegarder:** `Ctrl+O`, `Enter`, `Ctrl+X`

### 6.4 Sécuriser le Fichier

```bash
# Permissions strictes (lisible seulement par vous)
chmod 600 .env.production

# Vérifier
ls -la .env.production
```

**Résultat attendu:** `-rw------- 1 spawner spawner`

---

## 7. Traefik & SSL

### 7.1 Créer le Réseau Traefik

```bash
# Créer le réseau externe pour Traefik
docker network create traefik-public

# Vérifier
docker network ls | grep traefik
```

### 7.2 Comprendre la Configuration Traefik

Le fichier `docker-compose.production.yml` inclut Traefik avec :

- **Reverse proxy automatique** pour Spawner
- **SSL/TLS avec Let's Encrypt** (certificats automatiques)
- **Redirection HTTP → HTTPS** automatique
- **Dashboard Traefik** accessible (protégé par basic auth)

**URLs qui seront disponibles:**

- `https://spawner.example.com` - Interface Spawner
- `https://traefik.example.com` - Dashboard Traefik
- `https://*.preview.example.com` - Environnements créés

---

## 8. Premier Lancement

### 8.1 Build et Démarrage

```bash
# Dans le répertoire spawner
cd ~/spawner

# Build et lancement en production
docker-compose -f docker-compose.production.yml up -d --build
```

**⏱️ Durée:** 5-10 minutes pour le premier build.

**Étapes du build:**

1. Build de l'image API (multi-stage avec pnpm)
2. Build de l'image Web (Vite + nginx)
3. Pull de PostgreSQL 15
4. Pull de Traefik v2.10
5. Création des volumes
6. Démarrage des containers

### 8.2 Suivre les Logs

```bash
# Logs de tous les services
docker-compose -f docker-compose.production.yml logs -f

# Ou par service
docker logs -f spawner-api
docker logs -f spawner-postgres
docker logs -f spawner-traefik
docker logs -f spawner-web
```

**⏱️ Attendre 2-3 minutes** que tout démarre complètement.

### 8.3 Vérifier que Tout Tourne

```bash
# Vérifier les containers
docker ps

# Health check
~/spawner/scripts/health-check.sh
```

**Résultat attendu:**

```
✓ PostgreSQL Database: Running
  └─ Health: healthy
✓ API Server: Running
  └─ Health: healthy
✓ Web Interface: Running
  └─ Health: healthy
✓ Traefik Reverse Proxy: Running
```

### 8.4 Premier Accès

Ouvrez votre navigateur et allez sur :

```
https://spawner.example.com
```

**⚠️ Première visite:**

- Traefik génère le certificat SSL (10-30 secondes)
- Vous pouvez voir "Service Unavailable" pendant ce temps
- Rafraîchir après 30 secondes

**✅ Succès:** Vous voyez la page de login GitHub!

---

## 9. Configuration Post-Installation

### 9.1 Login Initial

1. Cliquer sur "Login with GitHub"
2. Autoriser l'application OAuth
3. Vous devriez être connecté

**🔴 Problème "Access Denied"?**
→ Vérifiez que votre user GitHub est membre de l'équipe configurée.

### 9.2 Générer la Clé SSH Deploy

1. **Dans Spawner, aller dans "Settings" → "Git SSH Key"**
2. **Cliquer sur "Generate SSH Key"**
3. **Copier la clé publique** affichée

### 9.3 Ajouter les Deploy Keys sur GitHub

Pour chaque repository que vous voulez déployer :

1. **Aller dans le repository GitHub:**

   ```
   https://github.com/votre-org/votre-repo/settings/keys
   ```

2. **Cliquer "Add deploy key"**

3. **Remplir:**
   - **Title:** `Spawner Production`
   - **Key:** Coller la clé publique de l'étape 9.2
   - **Allow write access:** ❌ **DÉCOCHÉ** (read-only!)

4. **Cliquer "Add key"**

5. **Répéter pour tous vos repositories**

### 9.4 Tester la Connexion Git

1. **Dans Spawner, aller dans "Settings" → "Git SSH Key"**
2. **Entrer un nom de resource** (ex: "main-api")
3. **Cliquer "Test Connection"**

**✅ Succès:** Message "Connection successful"
**🔴 Échec:** Vérifier que la deploy key est bien ajoutée sur GitHub

### 9.5 Créer le Premier Projet

1. **Aller dans "Projects"**
2. **Cliquer "New Project"**
3. **Remplir le formulaire:**
   - **Name:** `mon-app` (alphanumeric + hyphens uniquement)
   - **Base Domain:** `preview.example.com`
   - **Resources:** Ajouter vos services (API, Frontend, DB)

4. **Cliquer "Create Project"**

---

## 10. Tests de Validation

### 10.1 Test Création Environnement

1. **Sélectionner votre projet**
2. **Cliquer "New Environment"**
3. **Remplir:**
   - **Name:** `test` (minuscules, chiffres, hyphens uniquement)
   - **Branches:** Sélectionner les branches pour chaque resource

4. **Cliquer "Create"**

**⏱️ Durée:** 2-5 minutes selon la taille des repos.

**Suivre la progression:**

- Status passe de "creating" à "running"
- Containers apparaissent dans la liste
- URLs deviennent cliquables

### 10.2 Test des URLs

Une fois l'environnement "running" :

1. **Cliquer sur les URLs** des resources
2. **Vérifier que les applications répondent**

**URLs générées automatiquement:**

- API: `https://main-api.test.preview.example.com`
- Front: `https://main-front.test.preview.example.com`

### 10.3 Test Terminal Interactif

1. **Dans l'environnement, cliquer sur une resource**
2. **Cliquer "Open Terminal"**
3. **Taper des commandes:**
   ```bash
   pwd
   ls -la
   whoami
   ```

**✅ Succès:** Terminal répond et exécute les commandes

### 10.4 Test Logs

1. **Cliquer sur "Logs"** pour une resource
2. **Vérifier que les logs s'affichent**
3. **Scroller pour voir l'historique**

### 10.5 Test Suppression

1. **Cliquer sur "Delete Environment"**
2. **Confirmer**
3. **Vérifier que l'environnement disparaît**

---

## 11. Monitoring & Logs

### 11.1 Logs Docker

```bash
# Tous les logs
docker-compose -f docker-compose.production.yml logs -f

# API uniquement
docker logs -f spawner-api

# Base de données
docker logs -f spawner-postgres

# Traefik
docker logs -f spawner-traefik
```

### 11.2 Health Check Manuel

```bash
cd ~/spawner
./scripts/health-check.sh
```

### 11.3 Dashboard Traefik

Accéder au dashboard :

```
https://traefik.example.com
```

**Login:** `admin` / `votre_password` (configuré dans TRAEFIK_AUTH)

**Ce que vous verrez:**

- Liste des routers actifs
- Certificats SSL
- Backends (services)

### 11.4 Monitoring Disk Space

```bash
# Espace global
df -h

# Spawner spécifiquement
du -sh /opt/spawner/*
```

**⚠️ ALERTE:** Si `/opt/spawner` > 80%, nettoyer les vieux environnements.

---

## 12. Backup & Maintenance

### 12.1 Backup Manuel

```bash
cd ~/spawner
./scripts/backup-db.sh
```

**Résultat:** Fichier dans `/opt/spawner/backups/spawner_backup_YYYYMMDD_HHMMSS.sql.gz`

### 12.2 Backup Automatique (Cron)

```bash
# Éditer crontab
crontab -e

# Ajouter cette ligne (backup tous les jours à 2h du matin)
0 2 * * * /home/spawner/spawner/scripts/backup-db.sh >> /var/log/spawner-backup.log 2>&1
```

### 12.3 Test de Restore

**⚠️ À faire sur un backup de test d'abord!**

```bash
cd ~/spawner
./scripts/restore-db.sh /opt/spawner/backups/spawner_backup_20241127_020000.sql.gz
```

### 12.4 Mise à Jour de Spawner

```bash
cd ~/spawner

# Pull derniers changements
git pull

# Rebuild et redémarrage
docker-compose -f docker-compose.production.yml up -d --build

# Vérifier logs
docker logs -f spawner-api
```

### 12.5 Rotation des Logs

Les logs Docker peuvent grossir. Configurer la rotation :

```bash
# Éditer daemon.json
sudo nano /etc/docker/daemon.json
```

Ajouter :

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
```

Redémarrer Docker :

```bash
sudo systemctl restart docker
docker-compose -f docker-compose.production.yml up -d
```

---

## 13. Troubleshooting

### 13.1 API ne Démarre Pas

**Symptôme:** Container spawner-api redémarre en boucle

```bash
docker logs spawner-api
```

**Problèmes courants:**

1. **PostgreSQL pas prêt**

   ```
   Solution: Attendre 30 secondes
   ```

2. **Variables d'environnement manquantes**

   ```bash
   # Vérifier .env.production
   cat .env.production | grep SESSION_SECRET
   ```

3. **Migrations échouées**
   ```bash
   # Logs pour voir l'erreur TypeORM
   docker logs spawner-api | grep -i migration
   ```

### 13.2 OAuth ne Fonctionne Pas

**Symptôme:** "Access Denied" après login GitHub

**Vérifications:**

```bash
# 1. Callback URL correcte dans GitHub OAuth App
# Doit être: https://spawner.example.com/api/auth/github/callback

# 2. User membre de l'équipe
# Aller sur: https://github.com/orgs/VOTRE_ORG/teams/VOTRE_TEAM

# 3. Variables correctes
docker exec spawner-api env | grep GITHUB
```

### 13.3 SSL ne Fonctionne Pas

**Symptôme:** "Your connection is not private" ou "Certificate invalid"

**Vérifications:**

```bash
# 1. DNS propagé?
dig spawner.example.com +short
# Doit retourner l'IP du VPS

# 2. Traefik a généré le certificat?
docker logs spawner-traefik | grep -i acme

# 3. Forcer régénération
docker-compose -f docker-compose.production.yml restart spawner-traefik
```

### 13.4 Environnements ne Démarrent Pas

**Symptôme:** Status reste "creating" ou passe à "failed"

**Vérifications:**

```bash
# 1. Logs API pour voir l'erreur
docker logs spawner-api | tail -50

# 2. Docker socket accessible?
docker ps

# 3. Espace disque?
df -h /opt/spawner

# 4. Deploy key configurée?
# Tester dans Settings > Git SSH Key
```

### 13.5 Terminal ne Fonctionne Pas

**Symptôme:** "Connection failed" lors de l'ouverture du terminal

**Vérifications:**

```bash
# 1. WebSocket configuré dans nginx?
docker exec spawner-web cat /etc/nginx/conf.d/default.conf | grep socket.io

# 2. Container de l'environnement running?
docker ps | grep env-

# 3. Logs terminal gateway
docker logs spawner-api | grep -i terminal
```

### 13.6 Performance Dégradée

**Symptôme:** Spawner lent, timeouts

**Diagnostics:**

```bash
# 1. CPU/RAM du VPS
htop

# 2. Nombre de containers
docker ps -q | wc -l

# 3. Espace disque
df -h

# 4. Logs PostgreSQL
docker logs spawner-postgres | grep -i slow
```

**Solutions:**

- Supprimer vieux environnements
- Augmenter resources VPS
- Optimiser queries PostgreSQL

---

## ✅ Félicitations!

Si vous êtes arrivé ici, Spawner est déployé et fonctionnel en production! 🎉

**Prochaines étapes recommandées:**

1. Former votre équipe à l'utilisation
2. Configurer monitoring avancé (Uptime, Prometheus)
3. Documenter vos procédures internes
4. Planifier maintenance régulière

**Besoin d'aide?**

- Consulter [PRODUCTION-CHECKLIST.md](PRODUCTION-CHECKLIST.md)
- Lire [CLAUDE.md](CLAUDE.md) pour l'architecture
- Ouvrir une issue GitHub

---

**Date de dernière mise à jour:** 27 Novembre 2024
**Version:** 1.0.0 (PostgreSQL + Traefik)
