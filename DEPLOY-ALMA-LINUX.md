# Déploiement Spawner sur VPS IONOS (AlmaLinux)

## 📋 Votre Configuration

**OS** : AlmaLinux (RHEL-based)
**Projet** : 2 APIs + 2 Fronts + 2 DBs

---

## 🚀 Étapes de Déploiement

### 1. Prérequis sur le VPS AlmaLinux

```bash
# SSH sur votre VPS
ssh root@votre-ip-ionos

# Mettre à jour le système (AlmaLinux utilise dnf/yum)
dnf update -y

# Installer des outils de base
dnf install -y git curl wget nano

# Installer Docker
dnf config-manager --add-repo=https://download.docker.com/linux/centos/docker-ce.repo
dnf install -y docker-ce docker-ce-cli containerd.io

# Démarrer Docker
systemctl start docker
systemctl enable docker

# Installer Docker Compose (plugin)
dnf install -y docker-compose-plugin

# Vérifier l'installation
docker --version
docker compose version
```

**Résultat attendu** :
```
Docker version 24.x.x
Docker Compose version v2.x.x
```

### 2. Configuration du Firewall (AlmaLinux utilise firewalld)

```bash
# Vérifier le statut du firewall
systemctl status firewalld

# Ouvrir les ports nécessaires
firewall-cmd --permanent --add-service=http
firewall-cmd --permanent --add-service=https
firewall-cmd --permanent --add-port=8080/tcp  # Spawner Web
firewall-cmd --permanent --add-port=3000/tcp  # Spawner API

# Recharger le firewall
firewall-cmd --reload

# Vérifier les règles
firewall-cmd --list-all
```

### 3. Désactiver SELinux (optionnel mais recommandé pour Docker)

```bash
# Vérifier le statut
getenforce

# Désactiver temporairement
setenforce 0

# Désactiver définitivement
nano /etc/selinux/config
# Changer SELINUX=enforcing en SELINUX=permissive

# OU configurer SELinux pour Docker (méthode avancée)
setsebool -P container_manage_cgroup on
```

### 4. Cloner Spawner sur le VPS

```bash
# Créer le dossier principal
mkdir -p /opt/spawner
cd /opt/spawner

# Option A : Copier depuis votre machine locale
# Depuis votre Mac :
scp -r /Users/florian/Desktop/spawner/* root@votre-ip-ionos:/opt/spawner/

# Option B : Si Spawner est sur Git
git clone https://github.com/votre-org/spawner.git .
```

### 5. Créer la Configuration du Projet

```bash
cd /opt/spawner

# Copier la config de production
cp project.config.prod.yml project.config.yml

# Éditer avec vos vrais repos et domaine
nano project.config.yml
```

**Remplacez** :
```yaml
baseDomain: "preview.votredomaine.com"  # ← Votre vrai domaine

resources:
  - name: "main-api"
    type: "laravel-api"
    gitRepo: "git@github.com:votre-org/main-api.git"  # ← Vos vrais repos
    defaultBranch: "develop"
    dbResource: "main-db"

  - name: "main-front"
    type: "nextjs-front"
    gitRepo: "git@github.com:votre-org/main-front.git"
    defaultBranch: "develop"
    apiResource: "main-api"

  - name: "main-db"
    type: "mysql-db"

  - name: "micro-api"
    type: "laravel-api"
    gitRepo: "git@github.com:votre-org/micro-api.git"
    defaultBranch: "develop"
    dbResource: "micro-db"

  - name: "micro-front"
    type: "nextjs-front"
    gitRepo: "git@github.com:votre-org/micro-front.git"
    defaultBranch: "develop"
    apiResource: "micro-api"

  - name: "micro-db"
    type: "mysql-db"
```

### 6. Créer les Dossiers de Données

```bash
cd /opt/spawner
mkdir -p data git-keys repos envs

# Permissions
chmod -R 755 data git-keys repos envs
chown -R root:root /opt/spawner
```

### 7. Lancer Spawner

```bash
cd /opt/spawner

# Build et lancer les containers
docker compose up -d --build

# Vérifier que tout tourne
docker compose ps

# Devrait afficher :
# spawner-api    running
# spawner-web    running

# Voir les logs
docker compose logs -f spawner-api
docker compose logs -f spawner-web
```

**Si erreur de port déjà utilisé** :
```bash
# Vérifier les ports
ss -tulpn | grep :8080
ss -tulpn | grep :3000

# Tuer le processus si nécessaire
kill -9 <PID>
```

### 8. Configurer le DNS

Chez votre registrar (OVH, Gandi, Cloudflare, etc.) :

```
Type    Nom                          Valeur
A       spawner                      VOTRE-IP-IONOS
A       *.preview                    VOTRE-IP-IONOS
```

**Exemple concret** :
```
A       spawner.monsite.fr           51.178.40.123
A       *.preview.monsite.fr         51.178.40.123
```

**Tester la propagation DNS** :
```bash
# Depuis votre Mac
dig spawner.monsite.fr
dig test.preview.monsite.fr

# Devrait retourner votre IP IONOS
```

### 9. Installer Nginx (AlmaLinux)

```bash
# Installer Nginx
dnf install -y nginx

# Démarrer et activer
systemctl start nginx
systemctl enable nginx

# Vérifier
systemctl status nginx
curl localhost
```

**Créer la config Spawner** :
```bash
nano /etc/nginx/conf.d/spawner.conf
```

**Contenu** :
```nginx
server {
    listen 80;
    server_name spawner.monsite.fr;  # ← Remplacer par votre domaine

    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**Tester et recharger** :
```bash
nginx -t
systemctl reload nginx
```

### 10. Installer Traefik (pour les Environnements de Preview)

```bash
# Créer le dossier Traefik
mkdir -p /opt/spawner/traefik
cd /opt/spawner/traefik
```

**Créer** `docker-compose.yml` :
```yaml
version: '3.9'

services:
  traefik:
    image: traefik:v2.11
    container_name: traefik
    restart: unless-stopped
    command:
      - "--api.dashboard=true"
      - "--api.insecure=true"
      - "--providers.docker=true"
      - "--providers.docker.exposedbydefault=false"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.websecure.address=:443"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge=true"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web"
      - "--certificatesresolvers.letsencrypt.acme.email=votre-email@example.com"
      - "--certificatesresolvers.letsencrypt.acme.storage=/acme.json"
    ports:
      - "80:80"
      - "443:443"
      - "8081:8080"  # Dashboard
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./acme.json:/acme.json
    networks:
      - traefik-network

networks:
  traefik-network:
    name: traefik-network
```

**Lancer Traefik** :
```bash
cd /opt/spawner/traefik
touch acme.json
chmod 600 acme.json

# Créer le réseau
docker network create traefik-network

# Lancer
docker compose up -d

# Vérifier
docker logs traefik
```

**⚠️ Conflit de port** : Si Nginx écoute déjà sur 80/443, choisissez une des options :

**Option A : Nginx comme reverse proxy principal** (recommandé)
```nginx
# Dans /etc/nginx/conf.d/preview.conf
server {
    listen 80;
    server_name *.preview.monsite.fr;

    location / {
        proxy_pass http://localhost:8081;  # Port Traefik alternatif
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

**Option B : Arrêter Nginx et utiliser uniquement Traefik**
```bash
systemctl stop nginx
systemctl disable nginx
```

### 11. Installer HTTPS (Let's Encrypt)

```bash
# Installer Certbot pour AlmaLinux
dnf install -y epel-release
dnf install -y certbot python3-certbot-nginx

# Générer le certificat pour Spawner UI
certbot --nginx -d spawner.monsite.fr

# Pour le wildcard (environnements de preview)
certbot certonly --manual --preferred-challenges dns \
  -d "*.preview.monsite.fr" \
  -d "preview.monsite.fr"
```

**Certbot vous demandera** :
```
Please deploy a DNS TXT record under the name
_acme-challenge.preview.monsite.fr with the following value:

xyz123abc456...
```

**Ajouter sur votre DNS** :
```
Type    Nom                                  Valeur
TXT     _acme-challenge.preview              xyz123abc456...
```

Attendez 1-2 minutes, appuyez sur Entrée.

**Auto-renouvellement** :
```bash
# Tester le renouvellement
certbot renew --dry-run

# Le cron est déjà configuré automatiquement
systemctl list-timers | grep certbot
```

### 12. Modifier docker-compose.yml de Spawner (IMPORTANT)

Pour que les containers des environnements se connectent au réseau Traefik :

```bash
nano /opt/spawner/backend/src/common/docker-compose.generator.ts
```

**Trouver la fonction `generate()`** et modifier :
```typescript
generate(): string {
  const config: DockerComposeConfig = {
    version: '3.9',
    networks: {
      [`net-${this.envName}`]: {},
      'traefik-network': {     // ← AJOUTER
        external: true,         // ← AJOUTER
      },                        // ← AJOUTER
    },
    services: {},
    volumes: {},
  };
  // ...
}
```

**Et dans chaque service**, ajouter le réseau Traefik :
```typescript
networks: [networkName, 'traefik-network'],  // ← Au lieu de juste [networkName]
```

**Rebuild Spawner** :
```bash
cd /opt/spawner
docker compose down
docker compose up -d --build
```

### 13. Générer la Clé SSH Deploy Key

```bash
# Ouvrir Spawner UI dans votre navigateur
http://spawner.monsite.fr

# Ou si HTTPS déjà configuré
https://spawner.monsite.fr
```

**Dans l'interface** :
1. Section "Git Deploy Key"
2. Cliquer "Generate SSH Key"
3. Copier la clé publique affichée

**Ajouter sur GitHub** (pour chaque repo) :
1. Aller sur le repo → Settings → Deploy keys
2. Add deploy key
3. Coller la clé publique
4. ✅ Read-only access
5. Save

**Répéter pour** :
- main-api
- main-front
- micro-api
- micro-front

### 14. Tester la Connexion Git

Dans Spawner UI :
1. Sélectionner "main-api" dans le dropdown
2. Cliquer "Test"
3. Attendre le résultat

**Résultat attendu** : ✅ "Connection successful"

**Si échec** :
- Vérifier que la clé SSH est bien ajoutée sur GitHub
- Vérifier le nom du repo dans `project.config.yml`
- Regarder les logs : `docker compose logs spawner-api`

---

## 🎯 Test de Création d'Environnement

### 1. Créer un Environnement Test

Dans Spawner UI :
```
Nom : test-001
Branches :
  - main-api : develop
  - main-front : develop
  - micro-api : develop
  - micro-front : develop
```

Cliquer "Create Environment"

### 2. Suivre la Progression

**Dans le terminal du VPS** :
```bash
# Voir les logs en temps réel
docker compose logs -f spawner-api

# Vous verrez :
⏳ Cloning main-api from git@github...
✅ main-api cloned successfully
🔄 Fetching updates for main-api...
✅ main-api ready on branch develop
# ... etc pour les 4 repos

# Puis Docker va builder les images
# Enfin, lancer les containers
```

**Temps estimé** : 5-15 minutes (selon taille des repos + build Docker)

### 3. Vérifier les Containers

```bash
# Lister tous les containers
docker ps

# Devrait afficher (pour test-001) :
main-api-test-001
main-front-test-001
micro-api-test-001
micro-front-test-001
main-db-test-001
micro-db-test-001
```

### 4. Accéder aux URLs

Une fois le statut "running" dans Spawner UI :
```
✅ https://main-api.test-001.preview.monsite.fr
✅ https://main-front.test-001.preview.monsite.fr
✅ https://micro-api.test-001.preview.monsite.fr
✅ https://micro-front.test-001.preview.monsite.fr
```

---

## 🐛 Troubleshooting AlmaLinux

### Docker ne démarre pas

```bash
# Vérifier le service
systemctl status docker

# Voir les logs
journalctl -u docker -n 50

# Redémarrer
systemctl restart docker
```

### Firewall bloque les connexions

```bash
# Vérifier les règles
firewall-cmd --list-all

# Temporairement tout autoriser (pour debug)
firewall-cmd --set-default-zone=trusted

# Remettre après debug
firewall-cmd --set-default-zone=public
```

### SELinux bloque Docker

```bash
# Vérifier si SELinux bloque
ausearch -m avc -ts recent

# Désactiver temporairement
setenforce 0

# Si ça résout, désactiver définitivement ou configurer les règles
```

### Permission denied pour Docker socket

```bash
# Vérifier les permissions
ls -la /var/run/docker.sock

# Ajouter l'utilisateur au groupe docker
usermod -aG docker $USER

# Se déconnecter/reconnecter
```

### Les containers ne peuvent pas communiquer

```bash
# Vérifier le réseau Docker
docker network ls
docker network inspect traefik-network

# Recréer le réseau
docker network rm traefik-network
docker network create traefik-network
```

### Logs de debug

```bash
# Spawner API
docker compose logs spawner-api

# Spawner Web
docker compose logs spawner-web

# Traefik
docker logs traefik

# Container d'un environnement
docker logs main-api-test-001
```

---

## ✅ Checklist Complète

- [ ] AlmaLinux à jour (`dnf update`)
- [ ] Docker installé et démarré
- [ ] Firewall configuré (ports 80, 443, 8080, 3000)
- [ ] SELinux configuré ou désactivé
- [ ] Spawner cloné dans `/opt/spawner`
- [ ] `project.config.yml` avec vos vrais repos
- [ ] Dossiers créés (data, git-keys, repos, envs)
- [ ] Spawner lancé (`docker compose up -d`)
- [ ] DNS configuré (spawner + *.preview)
- [ ] Nginx installé et configuré
- [ ] Traefik installé et réseau créé
- [ ] HTTPS configuré (Certbot)
- [ ] Clé SSH générée dans Spawner
- [ ] Clé SSH ajoutée sur GitHub (4 repos)
- [ ] Test de connexion Git réussi (4 repos)
- [ ] Premier environnement créé et accessible

---

## 📚 Commandes Utiles AlmaLinux

```bash
# Gestion des services
systemctl status <service>
systemctl start <service>
systemctl stop <service>
systemctl restart <service>
systemctl enable <service>

# Logs système
journalctl -u <service> -f
journalctl -xe

# Firewall
firewall-cmd --list-all
firewall-cmd --permanent --add-port=<port>/tcp
firewall-cmd --reload

# Réseau
ss -tulpn
ip addr
```

---

## 🎉 C'est Prêt !

Votre Spawner est maintenant opérationnel sur AlmaLinux !

**Prochaines étapes** :
1. Former votre équipe à l'utilisation
2. Créer des environnements de preview
3. Tester le workflow dev → preview → validation

**Support** : En cas de problème, regardez les logs et consultez ce guide.
