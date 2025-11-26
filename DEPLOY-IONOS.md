# Déploiement Spawner sur VPS IONOS

## 📋 Votre Configuration

**Projet** : 2 APIs + 2 Fronts + 2 DBs
- Main Stack : main-api, main-front, main-db
- Micro Stack : micro-api, micro-front, micro-db

**URLs générées** (exemple pour env `feature-123`) :
```
https://main-api.feature-123.preview.votredomaine.com
https://main-front.feature-123.preview.votredomaine.com
https://micro-api.feature-123.preview.votredomaine.com
https://micro-front.feature-123.preview.votredomaine.com
```

---

## 🚀 Étapes de Déploiement

### 1. Prérequis sur le VPS IONOS

```bash
# SSH sur votre VPS
ssh root@votre-ip-ionos

# Mettre à jour le système
apt update && apt upgrade -y

# Installer Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Installer Docker Compose
apt install docker-compose-plugin -y

# Vérifier
docker --version
docker compose version
```

### 2. Cloner Spawner sur le VPS

```bash
# Créer le dossier principal
mkdir -p /opt/spawner
cd /opt/spawner

# Cloner le repo Spawner (ou copier les fichiers)
# Option A : Si vous avez mis Spawner sur Git
git clone https://github.com/votre-org/spawner.git .

# Option B : Copier depuis votre machine locale
# Depuis votre machine :
scp -r /Users/florian/Desktop/spawner/* root@votre-ip-ionos:/opt/spawner/
```

### 3. Créer la Configuration du Projet

```bash
cd /opt/spawner

# Copier la config de production
cp project.config.prod.yml project.config.yml

# Éditer avec vos vrais repos et domaine
nano project.config.yml
```

**Remplacez** :
- `preview.votredomaine.com` → Votre vrai domaine
- `git@github.com:votre-org/main-api.git` → Vos vrais repos

**Exemple complet** :
```yaml
baseDomain: "preview.monsite.fr"

resources:
  - name: "main-api"
    type: "laravel-api"
    gitRepo: "git@github.com:acme/main-api.git"
    defaultBranch: "develop"
    dbResource: "main-db"

  - name: "main-front"
    type: "nextjs-front"
    gitRepo: "git@github.com:acme/main-front.git"
    defaultBranch: "develop"
    apiResource: "main-api"

  - name: "main-db"
    type: "mysql-db"

  - name: "micro-api"
    type: "laravel-api"
    gitRepo: "git@github.com:acme/micro-api.git"
    defaultBranch: "develop"
    dbResource: "micro-db"

  - name: "micro-front"
    type: "nextjs-front"
    gitRepo: "git@github.com:acme/micro-front.git"
    defaultBranch: "develop"
    apiResource: "micro-api"

  - name: "micro-db"
    type: "mysql-db"
```

### 4. Créer les Dossiers de Données

```bash
cd /opt/spawner
mkdir -p data git-keys repos envs
chmod -R 755 data git-keys repos envs
```

### 5. Lancer Spawner

```bash
cd /opt/spawner

# Build et lancer
docker compose up -d --build

# Vérifier que tout tourne
docker compose ps

# Voir les logs
docker compose logs -f
```

**Résultat attendu** :
```
spawner-api       running
spawner-web       running
```

### 6. Configurer le DNS

Chez votre registrar (OVH, Gandi, etc.), ajoutez ces enregistrements DNS :

```
Type    Nom                          Valeur
A       spawner                      VOTRE-IP-IONOS
A       *.preview                    VOTRE-IP-IONOS
```

**Exemple** :
```
A       spawner.monsite.fr           51.178.40.123
A       *.preview.monsite.fr         51.178.40.123
```

⏱️ **Attendre 5-30 minutes** pour la propagation DNS.

### 7. Configurer Nginx (Reverse Proxy)

```bash
# Installer Nginx
apt install nginx -y

# Créer la config Spawner UI
nano /etc/nginx/sites-available/spawner
```

**Contenu** :
```nginx
server {
    listen 80;
    server_name spawner.monsite.fr;

    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**Activer** :
```bash
ln -s /etc/nginx/sites-available/spawner /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

### 8. Installer Traefik (pour les Environnements)

Traefik gère automatiquement les URLs `*.preview.monsite.fr`.

**Créer** `/opt/spawner/traefik/docker-compose.yml` :
```yaml
version: '3.9'

services:
  traefik:
    image: traefik:v2.11
    container_name: traefik
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./traefik.yml:/etc/traefik/traefik.yml:ro
      - ./acme.json:/acme.json
    networks:
      - traefik-network

networks:
  traefik-network:
    external: true
```

**Créer** `/opt/spawner/traefik/traefik.yml` :
```yaml
api:
  dashboard: true
  insecure: true

entryPoints:
  web:
    address: ":80"
  websecure:
    address: ":443"

providers:
  docker:
    exposedByDefault: false
    network: traefik-network

certificatesResolvers:
  letsencrypt:
    acme:
      email: votre-email@example.com
      storage: /acme.json
      httpChallenge:
        entryPoint: web
```

**Lancer Traefik** :
```bash
cd /opt/spawner/traefik
touch acme.json
chmod 600 acme.json
docker network create traefik-network
docker compose up -d
```

### 9. Installer HTTPS (Let's Encrypt)

```bash
# Installer Certbot
apt install certbot python3-certbot-nginx -y

# Générer le certificat pour Spawner UI
certbot --nginx -d spawner.monsite.fr

# Générer le wildcard pour les environnements
certbot certonly --manual --preferred-challenges dns \
  -d *.preview.monsite.fr
```

Certbot vous demandera d'ajouter un enregistrement TXT DNS. Suivez les instructions.

### 10. Générer la Clé SSH Deploy Key

```bash
# Ouvrir Spawner UI
http://spawner.monsite.fr

# 1. Cliquer "Generate SSH Key"
# 2. Copier la clé publique affichée
```

**Ajouter la clé** sur GitHub :
- Aller sur chaque repo (main-api, main-front, micro-api, micro-front)
- Settings → Deploy keys → Add deploy key
- Coller la clé publique
- ✅ Cocher "Read-only"

### 11. Tester la Connexion Git

Dans Spawner UI :
- Section "Git Deploy Key"
- Sélectionner "main-api"
- Cliquer "Test"
- Répéter pour chaque ressource

**Résultat attendu** : ✅ "Connection successful"

---

## 🎯 Test de Création d'Environnement

### 1. Créer un Environnement Test

```
Nom : test-001
Branches :
  - main-api : develop
  - main-front : develop
  - micro-api : develop
  - micro-front : develop
```

### 2. Attendre le Build (5-10 min)

Spawner va :
1. Cloner les 4 repos
2. Générer le docker-compose.yml
3. Builder les 4 images Docker
4. Lancer les 6 containers (4 apps + 2 DBs)

### 3. Accéder aux URLs

Une fois status = "running" :
```
✅ https://main-api.test-001.preview.monsite.fr
✅ https://main-front.test-001.preview.monsite.fr
✅ https://micro-api.test-001.preview.monsite.fr
✅ https://micro-front.test-001.preview.monsite.fr
```

---

## 🔗 Communication entre Services

### Variables d'Environnement Auto-Injectées

Spawner configure automatiquement les connexions :

**main-front** reçoit :
```env
NEXT_PUBLIC_API_URL=https://main-api.test-001.preview.monsite.fr
```

**micro-front** reçoit :
```env
NEXT_PUBLIC_API_URL=https://micro-api.test-001.preview.monsite.fr
```

**main-api** reçoit :
```env
DB_HOST=main-db-test-001
DB_DATABASE=main_db_test_001
DB_USERNAME=main-db_user
DB_PASSWORD=main-db_password
```

**micro-api** reçoit :
```env
DB_HOST=micro-db-test-001
DB_DATABASE=micro_db_test_001
DB_USERNAME=micro-db_user
DB_PASSWORD=micro-db_password
```

### Si main-front doit aussi appeler micro-api

Si vous avez besoin que `main-front` appelle `micro-api`, vous devrez **ajouter manuellement** cette variable dans votre `.env` :

```env
# Dans votre repo main-front/.env.example
NEXT_PUBLIC_MICRO_API_URL=
```

Puis **modifier le générateur** pour l'injecter. Voulez-vous que je vous montre comment ?

---

## 📊 Architecture Complète Générée

Pour l'environnement `test-001` :

```
┌────────────────────────────────────────────────────────┐
│  Network: net-test-001                                 │
├────────────────────────────────────────────────────────┤
│                                                         │
│  main-api-test-001      ←→  main-db-test-001          │
│  main-front-test-001    ←→  main-api-test-001         │
│  micro-api-test-001     ←→  micro-db-test-001         │
│  micro-front-test-001   ←→  micro-api-test-001        │
│                                                         │
└────────────────────────────────────────────────────────┘
```

**6 containers isolés, communiquant entre eux** !

---

## ✅ Checklist de Déploiement

- [ ] VPS IONOS configuré (Docker + Docker Compose)
- [ ] Spawner cloné dans `/opt/spawner`
- [ ] `project.config.yml` avec vos vrais repos
- [ ] Dossiers créés (data, git-keys, repos, envs)
- [ ] Spawner lancé (`docker compose up -d`)
- [ ] DNS configuré (spawner + *.preview)
- [ ] Nginx installé et configuré
- [ ] Traefik installé et lancé
- [ ] HTTPS activé (Certbot)
- [ ] Clé SSH générée dans Spawner
- [ ] Clé SSH ajoutée sur GitHub (4 repos)
- [ ] Test de connexion Git réussi
- [ ] Premier environnement créé et fonctionnel

---

## 🐛 Troubleshooting

### Spawner ne démarre pas
```bash
docker compose logs spawner-api
docker compose logs spawner-web
```

### Build Docker échoue
- Vérifier que les Dockerfiles existent dans vos repos
- Regarder les logs dans Spawner UI → Environnement → Logs

### URLs ne fonctionnent pas
- Vérifier DNS : `dig spawner.monsite.fr`
- Vérifier Traefik : `docker logs traefik`

### Git clone échoue
- Vérifier la clé SSH est bien ajoutée sur GitHub
- Tester : Spawner UI → Test Connection

---

## 🎉 Vous êtes Prêt !

Votre équipe peut maintenant créer des environnements de preview en quelques clics !

**Workflow** :
1. Dev push sur `feature/new-login`
2. QA crée un env dans Spawner avec cette branche
3. 5 minutes plus tard → URLs prêtes à tester
4. Après validation → Supprimer l'environnement

**Gain de temps** : De 2h à 5min par environnement ! 🚀
