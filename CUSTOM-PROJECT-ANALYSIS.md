# Analyse des Repositories du Projet

Cette analyse examine les 4 repositories du projet Iris pour créer une configuration Spawner sur mesure.

## Architecture Globale

Votre projet contient **2 stacks complètes** :

### Stack IRIS
1. **iris-front** : Interface Next.js 15.1.6
2. **iris-api** : API Laravel 11 (PHP 8.3)
3. **iris-db** : Base de données MySQL

### Stack MODE DE VIE (MDV)
1. **mdv-front** : Interface Next.js 14 (quizz-mode-de-vie)
2. **mdv-api** : API Laravel 11 (PHP 8.3)
3. **mdv-db** : Base de données MySQL

---

## 1. iris-front (Frontend Iris)

**Localisation** : `/Users/florian/Desktop/Iris temp/iris-prevention`

### Technologies
- **Framework** : Next.js 15.1.6
- **Node.js** : v22
- **Port** : 3000
- **Build** : Multi-stage optimisé

### Dockerfile
**Statut** : ✅ Production-ready

Le Dockerfile utilise une approche multi-stage moderne avec Node 22-slim :
- **Stage 1 (deps)** : Installation des dépendances avec npm ci
- **Stage 2 (builder)** : Build Next.js avec standalone output
- **Stage 3 (runner)** : Image de production minimale avec utilisateur non-root

**Particularités** :
- Custom override pour next-auth : `./docker/replace/client.js` → `next-auth/core/lib/oauth/client.js`
- Copie de `.env` vers `.env.production` pour le build
- Utilise `.next/standalone` pour réduire la taille de l'image
- Support de yarn, npm, ou pnpm selon le lockfile présent

### Dépendances Clés
- next-auth (authentification)
- next-intl (internationalisation)
- radix-ui (composants UI)
- tailwindcss (styling)

### Configuration Spawner
```yaml
- name: "iris-front"
  type: "nextjs-front"
  gitRepo: "git@github.com:VOTRE-ORG/iris-prevention.git"
  defaultBranch: "main"  # À confirmer
  apiResource: "iris-api"
```

### Variables d'environnement requises
Spawner devra injecter automatiquement :
- `NEXT_PUBLIC_API_URL` : URL de l'API iris-api (ex: `https://iris-api.env-name.preview.domain.com`)
- `NODE_ENV=production`

---

## 2. iris-api (API Iris)

**Localisation** : `/Users/florian/Desktop/Iris temp/api-iris`
**Branche actuelle** : `feat/docker` ✅

### Technologies
- **Framework** : Laravel 11
- **PHP** : 8.3
- **Port** : 8000
- **Serveur** : php artisan serve (dev) ou php-fpm + nginx (prod)

### Dockerfile
**Statut** : ✅ Fonctionnel

Le Dockerfile est basé sur `php:8.3-fpm` avec :
- Extensions PHP : pdo_mysql, mbstring, zip, exif, pcntl, bcmath, intl, fileinfo
- Composer intégré
- Optimisation avec `composer dump-autoload --optimize`
- Permissions correctes pour storage et bootstrap/cache

**Notes** :
- Utilise `php artisan serve` en mode développement (pratique pour preview environments)
- Pas d'extension GD installée (si manipulation d'images nécessaire, ajouter libgd-dev)

### Dépendances Clés
- Laravel Fortify (authentification)
- Laravel Sanctum (API tokens)
- Spatie Laravel Health (health checks)
- Rollbar (error tracking)
- SendGrid driver (emails)

### Configuration Spawner
```yaml
- name: "iris-api"
  type: "laravel-api"
  gitRepo: "git@github.com:VOTRE-ORG/api-iris.git"
  defaultBranch: "feat/docker"
  dbResource: "iris-db"
```

### Variables d'environnement requises
Spawner devra injecter automatiquement :
- `DB_HOST` : Nom du service MySQL (ex: `iris-db-env-name`)
- `DB_DATABASE` : Nom de la base de données (ex: `iris`)
- `DB_USERNAME` : Utilisateur MySQL (ex: `iris_user`)
- `DB_PASSWORD` : Mot de passe généré par Spawner
- `APP_KEY` : Clé Laravel (générer avec `php artisan key:generate`)
- `APP_URL` : URL de l'API (ex: `https://iris-api.env-name.preview.domain.com`)

---

## 3. mdv-front (Frontend Mode de Vie)

**Localisation** : `/Users/florian/Desktop/iris/quizz-mode-de-vie`
**Branche actuelle** : `iris-widget` ✅

### Technologies
- **Framework** : Next.js 14.2.23
- **Node.js** : v22
- **Port** : 3000
- **Build** : Multi-stage optimisé

### Dockerfile
**Statut** : ✅ Production-ready

Le Dockerfile utilise une approche similaire à iris-front avec `node:22-alpine` :
- **Stage 1 (deps)** : Installation avec npm ci
- **Stage 2 (builder)** : Build Next.js
- **Stage 3 (runner)** : Image de production avec utilisateur non-root

**Différences avec iris-front** :
- Utilise Alpine Linux (plus léger)
- Pas de custom override pour next-auth
- Configuration plus standard

### Dépendances Clés
- react-pdf/renderer (génération de PDF)
- chart.js (graphiques)
- formik (formulaires)
- next-i18next et next-intl (internationalisation)
- framer-motion (animations)
- rollbar (error tracking)

### Configuration Spawner
```yaml
- name: "mdv-front"
  type: "nextjs-front"
  gitRepo: "git@github.com:VOTRE-ORG/quizz-mode-de-vie.git"
  defaultBranch: "iris-widget"
  apiResource: "mdv-api"
```

### Variables d'environnement requises
Spawner devra injecter automatiquement :
- `NEXT_PUBLIC_API_URL` : URL de l'API mdv-api (ex: `https://mdv-api.env-name.preview.domain.com`)
- `NODE_ENV=production`

---

## 4. mdv-api (API Mode de Vie)

**Localisation** : `/Users/florian/Desktop/iris/api-mdv`
**Branche actuelle** : `develop-isos` ✅

### Technologies
- **Framework** : Laravel 11
- **PHP** : 8.3
- **Port** : 8000
- **Serveur** : php artisan serve (dev) ou php-fpm + nginx (prod)

### Dockerfile
**Statut** : ✅ **CRÉÉ PAR SPAWNER**

J'ai créé un Dockerfile identique à celui de iris-api pour assurer la cohérence :
- Base image : `php:8.3-fpm`
- Extensions PHP : pdo_mysql, mbstring, zip, exif, pcntl, bcmath, intl, fileinfo
- Composer intégré
- Permissions correctes pour Laravel

**Fichier créé** : `/Users/florian/Desktop/iris/api-mdv/Dockerfile`

### Dépendances Clés
- Laravel Fortify (authentification)
- Laravel Sanctum (API tokens)
- Spatie Laravel Data (DTOs)
- Spatie Laravel Health (health checks)
- Rollbar (error tracking)
- SendGrid driver (emails)

### Configuration Spawner
```yaml
- name: "mdv-api"
  type: "laravel-api"
  gitRepo: "git@github.com:VOTRE-ORG/api-mdv.git"
  defaultBranch: "develop-isos"
  dbResource: "mdv-db"
```

### Variables d'environnement requises
Spawner devra injecter automatiquement :
- `DB_HOST` : Nom du service MySQL (ex: `mdv-db-env-name`)
- `DB_DATABASE` : Nom de la base de données (ex: `mdv`)
- `DB_USERNAME` : Utilisateur MySQL (ex: `mdv_user`)
- `DB_PASSWORD` : Mot de passe généré par Spawner
- `APP_KEY` : Clé Laravel (générer avec `php artisan key:generate`)
- `APP_URL` : URL de l'API (ex: `https://mdv-api.env-name.preview.domain.com`)

---

## Configuration Spawner Complète

### Fichier : `project.config.custom.yml`

```yaml
baseDomain: "preview.votre-domaine.com"

resources:
  # === IRIS STACK ===

  - name: "iris-db"
    type: "mysql-db"

  - name: "iris-api"
    type: "laravel-api"
    gitRepo: "git@github.com:VOTRE-ORG/api-iris.git"
    defaultBranch: "feat/docker"
    dbResource: "iris-db"

  - name: "iris-front"
    type: "nextjs-front"
    gitRepo: "git@github.com:VOTRE-ORG/iris-prevention.git"
    defaultBranch: "main"
    apiResource: "iris-api"

  # === MODE DE VIE (MDV) STACK ===

  - name: "mdv-db"
    type: "mysql-db"

  - name: "mdv-api"
    type: "laravel-api"
    gitRepo: "git@github.com:VOTRE-ORG/api-mdv.git"
    defaultBranch: "develop-isos"
    dbResource: "mdv-db"

  - name: "mdv-front"
    type: "nextjs-front"
    gitRepo: "git@github.com:VOTRE-ORG/quizz-mode-de-vie.git"
    defaultBranch: "iris-widget"
    apiResource: "mdv-api"
```

### Actions Requises

1. **Remplacer les URLs Git** :
   - Remplacer `VOTRE-ORG` par le nom de votre organisation GitHub/GitLab
   - Exemple : `git@github.com:iris-team/api-iris.git`

2. **Vérifier les branches par défaut** :
   - iris-front : Confirmer si `main` ou `develop`
   - Autres branches sont déjà identifiées

3. **Configurer le domaine de base** :
   - Remplacer `preview.votre-domaine.com` par votre domaine wildcard
   - Exemple : `preview.iris-project.com`

---

## URLs Générées par Environnement

Pour un environnement nommé `feature-auth-123` :

### Stack IRIS
- `https://iris-db.feature-auth-123.preview.domain.com` (interne uniquement)
- `https://iris-api.feature-auth-123.preview.domain.com`
- `https://iris-front.feature-auth-123.preview.domain.com`

### Stack MDV
- `https://mdv-db.feature-auth-123.preview.domain.com` (interne uniquement)
- `https://mdv-api.feature-auth-123.preview.domain.com`
- `https://mdv-front.feature-auth-123.preview.domain.com`

---

## Communication Inter-Services

### Réseau Docker

Chaque environnement aura son propre réseau isolé : `net-feature-auth-123`

Tous les services d'un même environnement peuvent communiquer entre eux via leurs noms de service :
- `iris-api-feature-auth-123` peut être contacté par `iris-front-feature-auth-123`
- `mdv-api-feature-auth-123` peut être contacté par `mdv-front-feature-auth-123`

### Communication entre stacks (Iris ↔ MDV)

**Question importante** : Les 2 stacks doivent-elles communiquer entre elles ?

#### Scénario 1 : Stacks indépendantes
Si iris et mdv sont complètement indépendants, la configuration actuelle est suffisante.

#### Scénario 2 : Communication inter-stacks
Si iris-api doit appeler mdv-api (ou vice-versa), vous aurez besoin de :

1. **Variables d'environnement supplémentaires** :
   ```env
   # Dans iris-api
   MDV_API_URL=https://mdv-api.feature-auth-123.preview.domain.com

   # Dans mdv-api
   IRIS_API_URL=https://iris-api.feature-auth-123.preview.domain.com
   ```

2. **Modification du générateur Docker Compose** :
   Il faudra ajouter ces variables dans `docker-compose.generator.ts` pour les ressources Laravel.

---

## Améliorations Recommandées

### 1. Extensions PHP manquantes (api-iris et api-mdv)

Si vos APIs manipulent des images, ajoutez l'extension GD :

```dockerfile
# Ajouter dans la section d'installation des dépendances
RUN apt-get install -y \
    libfreetype6-dev \
    libjpeg62-turbo-dev \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install gd
```

### 2. Gestion du .env Laravel

Les Dockerfiles actuels ne créent pas de fichier `.env`. Spawner devra :
1. Copier `.env.example` vers `.env`
2. Injecter les variables d'environnement via Docker Compose (déjà prévu)
3. Ou exécuter `php artisan key:generate` dans le container

### 3. Migrations automatiques

Pour les preview environments, vous pourriez vouloir exécuter automatiquement :
```bash
php artisan migrate --force
php artisan db:seed --force  # optionnel
```

Cela peut être ajouté au CMD du Dockerfile :
```dockerfile
CMD php artisan migrate --force && php artisan serve --host=0.0.0.0 --port=8000
```

### 4. Build Args pour Next.js

Les Dockerfiles Next.js copient `.env` en `.env.production`. Pour les preview environments, Spawner devra :
- Générer un fichier `.env.production` avec les bonnes URLs d'API
- Ou passer les variables via `--build-arg` dans docker compose

---

## Checklist de Déploiement

### Avant le déploiement

- [ ] Remplacer les URLs Git dans `project.config.custom.yml`
- [ ] Vérifier les branches par défaut
- [ ] Configurer le domaine de base (ex: `preview.iris-project.com`)
- [ ] Ajouter les deploy keys SSH aux repositories GitHub/GitLab
- [ ] Configurer le wildcard DNS : `*.preview.iris-project.com` → IP du VPS
- [ ] Installer Traefik ou Nginx sur le VPS pour le reverse proxy

### Après le déploiement

- [ ] Tester la création d'un environnement de test
- [ ] Vérifier que les 6 services démarrent correctement
- [ ] Tester l'accès aux URLs publiques (frontends et APIs)
- [ ] Vérifier les logs de chaque service
- [ ] Tester la suppression d'un environnement

### Tests de connectivité

- [ ] iris-front peut appeler iris-api
- [ ] mdv-front peut appeler mdv-api
- [ ] iris-api peut se connecter à iris-db
- [ ] mdv-api peut se connecter à mdv-db
- [ ] Les migrations Laravel s'exécutent correctement
- [ ] Les seeds Laravel s'exécutent si nécessaire

---

## Support et Dépannage

### Logs des containers

Pour voir les logs d'un service spécifique via l'UI Spawner :
```
GET /api/environments/:id/logs/:resourceName
```

Via Docker CLI sur le VPS :
```bash
docker logs iris-api-feature-auth-123
docker logs mdv-front-feature-auth-123
```

### Accès au container

Pour déboguer directement dans un container :
```bash
docker exec -it iris-api-feature-auth-123 bash
```

### Rebuild d'un service

Si vous modifiez un Dockerfile, vous devrez rebuild :
```bash
cd /opt/spawner/envs/feature-auth-123
docker compose -p env-feature-auth-123 up -d --build iris-api-feature-auth-123
```

---

## Prochaines Étapes

1. **Tester localement** : Utiliser `project.config.custom.yml` en local pour valider la configuration
2. **Déployer sur VPS Ubuntu** : Suivre le guide `DEPLOY-UBUNTU.md` (à créer)
3. **Configurer les deploy keys** : Ajouter la clé publique SSH de Spawner à chaque repository
4. **Créer votre premier environnement** : Via l'UI Spawner
5. **Documenter les spécificités** : Variables d'environnement supplémentaires si nécessaire

---

## Résumé

**Status de préparation Spawner** :

| Repository | Dockerfile | Branche | Status |
|------------|-----------|---------|--------|
| iris-prevention | ✅ | main | Ready |
| api-iris | ✅ | feat/docker | Ready |
| quizz-mode-de-vie | ✅ | iris-widget | Ready |
| api-mdv | ✅ (créé) | develop-isos | Ready |

**Tous les repositories sont maintenant prêts pour Spawner !** 🚀
