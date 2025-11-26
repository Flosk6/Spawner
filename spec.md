# Spawner – Spécification Fonctionnelle & Technique (POC)

> Objectif du POC :  
> Installer Spawner sur un VPS, configurer un seul projet (main + micro, 2 fronts, 2 APIs, 2 MySQL),
> et permettre, via une interface web, de créer / lister / supprimer des environnements de preview
> basés sur des branches Git, avec génération automatique de `docker-compose`
> et récupération du code via SSH (deploy keys).

---

## 1. Vision & Périmètre

### 1.1 Problème adressé

- Plusieurs repos (front/back + microservice) à faire tourner ensemble pour tester une feature.
- Aujourd’hui : création manuelle des environnements (Plesk, VPS, DB, URLs…) → lent, fragile, non reproductible.
- Besoin : pouvoir créer un environnement complet "feature-X" en quelques clics, avec :
  - 2 APIs (Laravel),
  - 2 fronts (Next.js),
  - 2 bases MySQL,
  - wiring auto (URLs, DB_HOST, etc.),
  - URLs accessibles pour PO / QA.

### 1.2 Solution POC

Spawner est une app self-hosted qui :

1. Lit la configuration d’un projet dans un fichier `project.config.yml`.
2. Permet via une UI :
   - de définir un nom d’environnement (`feature-auth-123`),
   - de choisir les branches Git pour chaque ressource applicative,
   - de lancer la création d’un environnement complet (Docker Compose),
   - d’obtenir les URLs des services.
3. Gère le cycle de vie des environnements :
   - création,
   - listing,
   - suppression (containers + volumes + fichiers).
4. Gère les accès Git via **deploy key SSH** :
   - génération d’une paire,
   - affichage de la clé publique,
   - test de connexion avec les repos configurés.

### 1.3 Inclus dans le POC

- 1 seul projet géré.
- Types de ressources supportés :
  - `laravel-api`
  - `nextjs-front`
  - `mysql-db`
- Configuration projet via un fichier YAML.
- Génération d’un `docker-compose.yml` par environnement.
- Création / listing / suppression d’environnements.
- Statut basique (creating / running / failed / deleting).
- Consultation de logs (simple).
- Gestion d’une deploy key SSH (génération + affichage + test).

### 1.4 Exclusions (pour le POC)

- Multi-projets.
- Authentification / gestion utilisateurs.
- UI pour éditer la config projet (YAML seulement).
- Templating avancé (expressions complexes dans les env vars).
- Import automatique de dumps SQL.
- Intégration PR (GitHub/GitLab) et auto-trigger.
- Auto-expiration des environnements.
- Monitoring / métriques avancées.

---

## 2. Architecture globale

### 2.1 Stack technique

Backend :

- NestJS (TypeScript)
- SQLite (TypeORM ou Prisma)
- Accès Docker : CLI (`docker`, `docker compose`) + socket `/var/run/docker.sock`
- Lecture `project.config.yml` (YAML)
- Gestion SSH (deploy key, `ssh-keygen`, `git ls-remote`, etc.)

Frontend :

- Vue.js 3 (Composition API)
- Vite
- Tailwind (ou équivalent) pour le styling

Infrastructure :

- VPS Linux (Ubuntu 22.04+)
- Docker + Docker Compose
- Spawner packagé en containers :
  - `spawner-api`
  - `spawner-web`
- Reverse proxy (Traefik ou Nginx) configuré à la main avec :
  - une route pour Spawner : `spawner.mondomaine.com`
  - un wildcard pour les envs : `*.ENV_NAME.baseDomain` (baseDomain défini dans la config projet)

### 2.2 Organisation sur le serveur

- Répertoire principal : `/opt/spawner`
  - `project.config.yml` : configuration projet
  - `envs/<envName>/` : dossiers par environnement, contenant au minimum :
    - `docker-compose.yml`
    - éventuels `.env` générés
  - `repos/<resourceName>/` : clones Git des différents repos
  - `git-keys/` :
    - `id_spawner` (clé privée)
    - `id_spawner.pub` (clé publique)
- Containers :
  - `spawner-api` (NestJS)
  - `spawner-web` (Vue.js)
  - containers des environnements générés (via docker-compose spécifique à chaque env)

---

## 3. Configuration projet (`project.config.yml`)

Spawner ne gère qu’un seul projet dans le POC, décrit dans un fichier YAML.

### 3.1 Exemple

    baseDomain: "preview.mondomaine.com"

    resources:
      - name: "main-api"
        type: "laravel-api"
        gitRepo: "git@github.com:org/main-api.git"
        defaultBranch: "develop"
        dbResource: "main-db"

      - name: "main-front"
        type: "nextjs-front"
        gitRepo: "git@github.com:org/main-front.git"
        defaultBranch: "develop"
        apiResource: "main-api"

      - name: "micro-api"
        type: "laravel-api"
        gitRepo: "git@github.com:org/micro-api.git"
        defaultBranch: "develop"
        dbResource: "micro-db"

      - name: "micro-front"
        type: "nextjs-front"
        gitRepo: "git@github.com:org/micro-front.git"
        defaultBranch: "develop"
        apiResource: "micro-api"

      - name: "main-db"
        type: "mysql-db"

      - name: "micro-db"
        type: "mysql-db"

### 3.2 Contraintes

- `baseDomain` obligatoire.
- Chaque `name` doit être unique.
- `gitRepo` obligatoire pour `laravel-api` et `nextjs-front`.
- `dbResource` obligatoire pour `laravel-api` (référence à une ressource `mysql-db`).
- `apiResource` obligatoire pour `nextjs-front` (référence à une ressource `laravel-api`).
- `defaultBranch` utilisée comme branche par défaut dans l’UI.

---

## 4. Modèle de données (SQLite)

### 4.1 Table `settings`

    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

Utilisation typique :

- git_ssh_private_key_path
- git_ssh_public_key_path
- git_ssh_configured (true/false)

### 4.2 Table `environments`

    CREATE TABLE environments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL, -- 'creating' | 'running' | 'failed' | 'deleting'
      config_json TEXT NOT NULL, -- JSON : { "branches": { "main-api": "feature/auth", ... } }
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

### 4.3 Table `environment_resources`

    CREATE TABLE environment_resources (
      id TEXT PRIMARY KEY,
      environment_id TEXT NOT NULL,
      resource_name TEXT NOT NULL,
      resource_type TEXT NOT NULL, -- 'laravel-api' | 'nextjs-front' | 'mysql-db'
      branch TEXT, -- null pour 'mysql-db'
      url TEXT,    -- URL publique si applicable
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (environment_id) REFERENCES environments(id) ON DELETE CASCADE
    );

---

## 5. Gestion SSH & Deploy Key

### 5.1 Objectif

Permettre à Spawner de cloner / puller des repos privés en SSH, via une clé unique (deploy key).

### 5.2 Stockage

- Clé privée : `/opt/spawner/git-keys/id_spawner`
- Clé publique : `/opt/spawner/git-keys/id_spawner.pub`
- Entrées dans `settings` pour référencer ces chemins et marquer la clé comme configurée.

### 5.3 Fonctionnalités côté backend

- Génération de la clé si absente :
  - commande type : `ssh-keygen -t ed25519 -f /opt/spawner/git-keys/id_spawner -N ""`
- Utilisation de cette clé pour :
  - `git clone`
  - `git pull`
  - `git ls-remote` (pour test de connexion)

### 5.4 Endpoints API pour Git

- `GET /api/git/key`
  - Retour :
    - exists: boolean
    - publicKey: string (si existe)
- `POST /api/git/key/generate`
  - Génère une paire si aucune n’existe.
- `POST /api/git/test`
  - Body : { "resourceName": "main-api" }
  - Utilise `gitRepo` de la ressource pour tester l’accès via `git ls-remote`.
  - Retourne ok: true/false + éventuel message d’erreur.

---

## 6. API (NestJS)

Base : `/api`

### 6.1 Projet

- `GET /api/project`
  - Renvoie :
    - `baseDomain`
    - la liste des `resources` (sans exposer les `gitRepo` si besoin de limiter les infos côté front).

Exemple de réponse :

    {
      "baseDomain": "preview.mondomaine.com",
      "resources": [
        { "name": "main-api", "type": "laravel-api", "defaultBranch": "develop" },
        { "name": "main-front", "type": "nextjs-front", "defaultBranch": "develop" },
        { "name": "micro-api", "type": "laravel-api", "defaultBranch": "develop" },
        { "name": "micro-front", "type": "nextjs-front", "defaultBranch": "develop" },
        { "name": "main-db", "type": "mysql-db" },
        { "name": "micro-db", "type": "mysql-db" }
      ]
    }

---

### 6.2 Environnements

#### 6.2.1 `GET /api/environments`

Liste tous les environnements connus.

Réponse (exemple) :

    [
      {
        "id": "env_123",
        "name": "feature-auth-123",
        "status": "running",
        "createdAt": "2025-11-14T10:30:00Z",
        "branches": {
          "main-api": "feature/auth",
          "main-front": "feature/auth",
          "micro-api": "develop",
          "micro-front": "develop"
        }
      }
    ]

#### 6.2.2 `POST /api/environments`

Crée un nouvel environnement.

Body :

    {
      "name": "feature-auth-123",
      "branches": {
        "main-api": "feature/auth",
        "main-front": "feature/auth",
        "micro-api": "develop",
        "micro-front": "develop"
      }
    }

Règles :

- `name` doit respecter la regex : `^[a-z0-9-]+$`
- Les ressources `laravel-api` et `nextjs-front` doivent toutes avoir une branche définie.
- 409 si un env avec ce `name` existe déjà.

Process (backend) :

1. Valider l’entrée.
2. Créer un enregistrement dans `environments` (status = "creating").
3. Créer le dossier `/opt/spawner/envs/<name>/`.
4. Pour chaque ressource applicative (`laravel-api`, `nextjs-front`) :
   - cloner le repo si absent dans `/opt/spawner/repos/<resourceName>/`,
   - sinon `git fetch` + `git checkout <branch>`.
5. Générer `docker-compose.yml` dans `/opt/spawner/envs/<name>/`.
6. Lancer `docker compose -p env-<name> -f /opt/spawner/envs/<name>/docker-compose.yml up -d`.
7. Vérifier l’état des services (via `docker ps`).
8. Remplir `environment_resources` avec :
   - resource_name
   - type
   - branch (si applicable)
   - url (calculée)
9. Mettre à jour le status de l’environnement : `running` ou `failed`.

Réponse (simplifiée) :

    {
      "id": "env_123",
      "name": "feature-auth-123",
      "status": "running",
      "urls": {
        "main-front": "https://main-front.feature-auth-123.preview.mondomaine.com",
        "micro-front": "https://micro-front.feature-auth-123.preview.mondomaine.com"
      }
    }

#### 6.2.3 `GET /api/environments/:id`

Détail d’un environnement.

Réponse exemple :

    {
      "id": "env_123",
      "name": "feature-auth-123",
      "status": "running",
      "branches": {
        "main-api": "feature/auth",
        "main-front": "feature/auth",
        "micro-api": "develop",
        "micro-front": "develop"
      },
      "resources": [
        {
          "name": "main-api",
          "type": "laravel-api",
          "branch": "feature/auth",
          "url": "https://main-api.feature-auth-123.preview.mondomaine.com",
          "containerStatus": "running"
        },
        {
          "name": "main-db",
          "type": "mysql-db",
          "branch": null,
          "url": null,
          "containerStatus": "running"
        }
      ]
    }

#### 6.2.4 `DELETE /api/environments/:id`

Supprime un environnement.

Actions :

- Exécuter : `docker compose -p env-<name> -f /opt/spawner/envs/<name>/docker-compose.yml down -v`
- Supprimer le dossier `/opt/spawner/envs/<name>/`
- Supprimer les lignes de `environments` + `environment_resources`

Réponse :

    { "success": true }

#### 6.2.5 `GET /api/environments/:id/logs/:resourceName`

Retourne les logs d’un service de l’environnement (via `docker logs <serviceName>`).

Réponse :

    {
      "logs": "2025-11-14 10:35:00 [INFO] Application started...\n..."
    }

---

## 7. Génération de `docker-compose.yml`

### 7.1 Convention de nommage

Pour un env `feature-auth-123` et une ressource `main-api` :

- Nom d’environnement : `envName = feature-auth-123`
- Service Docker : `main-api-feature-auth-123`
- Service DB associé : `main-db-feature-auth-123`
- Network : `net-feature-auth-123`
- Volume DB : `main-db-feature-auth-123-data`
- Hostname externe (via reverse proxy global) :
  - `main-api.feature-auth-123.preview.mondomaine.com`

### 7.2 Exemple de compose généré (concept)

    version: "3.9"

    networks:
      net-feature-auth-123: {}

    services:
      main-db-feature-auth-123:
        image: mysql:8
        environment:
          MYSQL_DATABASE: main_feature_auth_123
          MYSQL_USER: main_user
          MYSQL_PASSWORD: main_password
          MYSQL_ROOT_PASSWORD: root_password
        volumes:
          - main-db-feature-auth-123-data:/var/lib/mysql
        networks:
          - net-feature-auth-123

      main-api-feature-auth-123:
        build:
          context: /opt/spawner/repos/main-api
        env_file:
          - .env.main-api
        environment:
          DB_HOST: main-db-feature-auth-123
          DB_DATABASE: main_feature_auth_123
          DB_USERNAME: main_user
          DB_PASSWORD: main_password
        depends_on:
          - main-db-feature-auth-123
        labels:
          - "traefik.enable=true"
          - "traefik.http.routers.main-api-feature-auth-123.rule=Host(`main-api.feature-auth-123.preview.mondomaine.com`)"
          - "traefik.http.services.main-api-feature-auth-123.loadbalancer.server.port=8000"
        networks:
          - net-feature-auth-123

      main-front-feature-auth-123:
        build:
          context: /opt/spawner/repos/main-front
        environment:
          NEXT_PUBLIC_API_URL: "https://main-api.feature-auth-123.preview.mondomaine.com"
        labels:
          - "traefik.enable=true"
          - "traefik.http.routers.main-front-feature-auth-123.rule=Host(`main-front.feature-auth-123.preview.mondomaine.com`)"
          - "traefik.http.services.main-front-feature-auth-123.loadbalancer.server.port=3000"
        networks:
          - net-feature-auth-123

    volumes:
      main-db-feature-auth-123-data: {}

Pour le POC :

- Pas de moteur de templating générique, on génère directement avec des conventions simples.
- Les variables d’environnement Laravel / Next sont codées directement côté backend (algo simple, opinionated).

---

## 8. Frontend (Vue.js)

### 8.1 Pages

1. Dashboard (`/`)

   - Section "Git deploy key" :
     - affiche si une clé existe,
     - affiche la clé publique si présente (textarea + bouton "copier"),
     - bouton "Générer une clé" si aucune,
     - bouton "Tester un repo" (sélection d’une ressource puis appel `/api/git/test`).
   - Liste des environnements :
     - nom
     - statut
     - date de création
     - branches résumées
     - actions : "Voir", "Supprimer"

2. Création d’un environnement (`/environments/new`)

   - Champ "Nom de l’environnement".
   - Pour chaque ressource de type `laravel-api` ou `nextjs-front` :
     - input texte pour la branche, pré-rempli par `defaultBranch`.
   - Bouton "Créer".
   - Redirection ensuite vers la page de détail.

3. Détail d’un environnement (`/environments/:id`)
   - Infos globales : nom, statut, date, branches.
   - Tableau des ressources :
     - nom, type, branche, URL (clicable si non null), statut container.
     - bouton "Voir logs".
   - Bouton "Supprimer l’environnement".

### 8.2 Composants

- Composant "GitKeyCard":
  - utilise `/api/git/key`, `/api/git/key/generate`, `/api/git/test`.
- Composant "EnvironmentList":
  - utilise `/api/environments`.
- Composant "EnvironmentForm":
  - utilise `/api/project` + `POST /api/environments`.
- Composant "EnvironmentDetail":
  - utilise `/api/environments/:id` + `/api/environments/:id/logs/:resourceName` + `DELETE`.

---

## 9. Sécurité & Contraintes

- L’API NestJS doit être exposée uniquement derrière un reverse proxy (HTTPS).
- L’accès à l’UI Spawner doit être restreint (au moins via Basic Auth ou IP allowlist au niveau du proxy).
- La clé SSH privée ne doit jamais être exposée par l’API.
- Les noms d’environnement doivent être strictement validés (pas de caractères spéciaux) pour éviter l’injection dans les hostnames, noms de services ou chemins.
- Toutes les exécutions de commandes (docker, git, ssh) doivent être encapsulées et protégées contre l’injection (pas de concat string brute avec des variables non validées).

---

## 10. Déploiement du POC

Pré-requis :

- VPS Ubuntu 22.04+
- Docker + Docker Compose installés
- Domaine configuré :
  - `spawner.mondomaine.com` → IP du VPS
  - `*.preview.mondomaine.com` → IP du VPS

Étapes :

1. Cloner le repo Spawner sur le VPS.
2. Placer `project.config.yml` dans `/opt/spawner/`.
3. Lancer la stack Spawner (docker-compose pour `spawner-api` + `spawner-web`).
4. Configurer le reverse proxy (Traefik/Nginx) pour :
   - exposer `spawner.mondomaine.com` vers `spawner-web`,
   - gérer le wildcard `*.preview.mondomaine.com` vers Traefik ou vers les services des envs selon la stratégie choisie.
5. Ouvrir Spawner dans le navigateur :
   - générer la deploy key,
   - l’ajouter en "Deploy Key" (read-only) sur chaque repo Git,
   - tester les accès,
   - créer un premier environnement pour validation.

---
