# Spawner - Évolutions Futures

## 1. Templates de Dockerfile Automatiques

### Problème Actuel
Chaque repo doit avoir son propre Dockerfile. Si le repo n'en a pas, le build échoue.

### Solution Proposée
Spawner génère automatiquement le Dockerfile selon le type de ressource défini dans la config.

### Implémentation

#### 1.1 Nouvelle Structure de Config

```yaml
baseDomain: "preview.mondomaine.com"

resources:
  - name: "main-api"
    type: "laravel-api"
    gitRepo: "git@github.com:org/main-api.git"
    defaultBranch: "develop"
    dbResource: "main-db"

    # NOUVEAU : Options de build
    buildConfig:
      useTemplate: true              # Utiliser le template Spawner
      phpVersion: "8.2"              # Version spécifique
      nodeVersion: "20"              # Si besoin de Node pour assets
      customCommands:                # Commandes custom après install
        - "php artisan migrate"
        - "php artisan db:seed"

    # OU si Dockerfile custom existe
    # buildConfig:
    #   useTemplate: false           # Utiliser le Dockerfile du repo

  - name: "main-front"
    type: "nextjs-front"
    gitRepo: "git@github.com:org/main-front.git"
    defaultBranch: "develop"
    apiResource: "main-api"

    buildConfig:
      useTemplate: true
      nodeVersion: "20"
      buildCommand: "npm run build"  # Custom build command
      startCommand: "npm start"      # Custom start command
```

#### 1.2 Templates Intégrés dans Spawner

```typescript
// backend/src/common/dockerfile-templates/

export const DOCKERFILE_TEMPLATES = {
  'laravel-api': (config: BuildConfig) => `
FROM php:${config.phpVersion || '8.2'}-fpm

WORKDIR /var/www

# Install system dependencies
RUN apt-get update && apt-get install -y \\
    git curl libpng-dev libonig-dev libxml2-dev zip unzip

# Install PHP extensions
RUN docker-php-ext-install pdo_mysql mbstring exif pcntl bcmath gd

# Install Composer
COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

# Copy application
COPY . .

# Install dependencies
RUN composer install --no-dev --optimize-autoloader

# Custom commands
${config.customCommands?.map(cmd => `RUN ${cmd}`).join('\n') || ''}

# Permissions
RUN chown -R www-data:www-data /var/www

EXPOSE 8000

CMD php artisan serve --host=0.0.0.0 --port=8000
`,

  'nextjs-front': (config: BuildConfig) => `
FROM node:${config.nodeVersion || '20'}-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source
COPY . .

# Build
RUN ${config.buildCommand || 'npm run build'}

EXPOSE 3000

CMD ["${config.startCommand || 'npm start'}"]
`,

  'express-api': (config: BuildConfig) => `
FROM node:${config.nodeVersion || '20'}-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE ${config.port || 3000}

CMD ["node", "${config.entrypoint || 'index.js'}"]
`,

  'django-api': (config: BuildConfig) => `
FROM python:${config.pythonVersion || '3.11'}-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY . .

# Custom commands
${config.customCommands?.map(cmd => `RUN ${cmd}`).join('\n') || ''}

EXPOSE ${config.port || 8000}

CMD ["gunicorn", "--bind", "0.0.0.0:8000", "wsgi:application"]
`,
};
```

#### 1.3 Service de Génération

```typescript
// backend/src/common/dockerfile.generator.ts

export class DockerfileGenerator {
  generate(resourceType: string, buildConfig: BuildConfig, repoPath: string): void {
    // Check if Dockerfile already exists
    const dockerfilePath = path.join(repoPath, 'Dockerfile');

    if (buildConfig.useTemplate === false && fs.existsSync(dockerfilePath)) {
      console.log(`✓ Using existing Dockerfile for ${resourceType}`);
      return;
    }

    // Generate from template
    const template = DOCKERFILE_TEMPLATES[resourceType];
    if (!template) {
      throw new Error(`No template available for resource type: ${resourceType}`);
    }

    const dockerfileContent = template(buildConfig);
    fs.writeFileSync(dockerfilePath, dockerfileContent);
    console.log(`✓ Generated Dockerfile for ${resourceType} from template`);
  }
}
```

#### 1.4 Intégration dans EnvironmentService

```typescript
// Dans environment.service.ts

async create(name: string, branches: Record<string, string>) {
  // ... code existant ...

  // NOUVEAU : Générer les Dockerfiles avant docker compose up
  for (const resource of gitResources) {
    const repoPath = this.gitService.getRepoPath(resource.name);

    // Générer Dockerfile si nécessaire
    if (resource.buildConfig?.useTemplate) {
      this.dockerfileGenerator.generate(
        resource.type,
        resource.buildConfig,
        repoPath
      );
    }
  }

  // Générer docker-compose.yml
  const generator = new DockerComposeGenerator(...);
  // ... reste du code ...
}
```

### Avantages

✅ **Simplicité** : Les devs n'ont plus besoin de créer des Dockerfiles
✅ **Standardisation** : Tous les environnements utilisent les mêmes bonnes pratiques
✅ **Flexibilité** : Possibilité d'override avec un Dockerfile custom
✅ **Maintenance** : Un seul endroit pour mettre à jour les templates
✅ **Rapidité** : Clone + déploiement sans configuration Docker

### Cas d'Usage

```yaml
# Cas 1 : Template auto (95% des cas)
resources:
  - name: "api"
    type: "laravel-api"
    buildConfig:
      useTemplate: true
      phpVersion: "8.2"

# Cas 2 : Dockerfile custom si setup complexe
resources:
  - name: "legacy-api"
    type: "laravel-api"
    buildConfig:
      useTemplate: false  # Utilise le Dockerfile du repo
```

---

## 2. Autres Évolutions Possibles

### 2.1 Détection Automatique du Type

Spawner pourrait **détecter automatiquement** le type de projet :

```typescript
function detectProjectType(repoPath: string): string {
  if (fs.existsSync(path.join(repoPath, 'composer.json'))) {
    return 'laravel-api';
  }
  if (fs.existsSync(path.join(repoPath, 'package.json'))) {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    if (pkg.dependencies?.next) return 'nextjs-front';
    if (pkg.dependencies?.express) return 'express-api';
  }
  if (fs.existsSync(path.join(repoPath, 'requirements.txt'))) {
    return 'django-api';
  }
  return 'unknown';
}
```

**Config simplifiée** :
```yaml
resources:
  - name: "mon-api"
    gitRepo: "git@github.com:org/mon-api.git"
    # type détecté automatiquement !
```

### 2.2 Templates de Variables d'Environnement

Chaque type pourrait avoir ses variables par défaut :

```typescript
const ENV_TEMPLATES = {
  'laravel-api': {
    APP_ENV: 'local',
    APP_DEBUG: 'true',
    LOG_CHANNEL: 'stack',
    CACHE_DRIVER: 'file',
    SESSION_DRIVER: 'file',
  },
  'nextjs-front': {
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
  },
};
```

### 2.3 Hooks de Build

```yaml
resources:
  - name: "api"
    type: "laravel-api"
    hooks:
      postClone:
        - "composer install"
        - "cp .env.example .env"
      postBuild:
        - "php artisan key:generate"
        - "php artisan migrate --force"
      preStart:
        - "php artisan cache:clear"
```

### 2.4 Support de Plus de Types

- ✅ `laravel-api`
- ✅ `nextjs-front`
- ✅ `mysql-db`
- 🔜 `express-api`
- 🔜 `nestjs-api`
- 🔜 `django-api`
- 🔜 `fastapi-api`
- 🔜 `react-front` (Vite, CRA)
- 🔜 `vue-front`
- 🔜 `postgres-db`
- 🔜 `mongodb-db`
- 🔜 `redis-cache`
- 🔜 `rabbitmq-queue`

### 2.5 Marketplace de Templates

Les utilisateurs pourraient contribuer des templates :

```yaml
resources:
  - name: "worker"
    type: "custom"
    template: "community/laravel-horizon"  # Template depuis le marketplace
    buildConfig:
      workers: 3
```

---

## 3. Roadmap

### Phase 1 : POC (✅ ACTUEL)
- [x] Clone Git
- [x] Génération docker-compose
- [x] Support Laravel/Next.js/MySQL
- [x] CRUD environnements
- [x] Interface web

### Phase 2 : Templates Auto
- [ ] Templates Dockerfile intégrés
- [ ] Génération automatique selon type
- [ ] Support buildConfig dans YAML
- [ ] Variables d'env par défaut

### Phase 3 : Intelligence
- [ ] Détection auto du type de projet
- [ ] Suggestions de configuration
- [ ] Validation des dépendances

### Phase 4 : Écosystème
- [ ] Plus de types supportés (10+)
- [ ] Hooks de lifecycle
- [ ] Marketplace de templates
- [ ] Plugins personnalisés

---

## Conclusion

Votre idée est **excellente** et c'est exactement le genre d'évolution qui rendrait Spawner **beaucoup plus simple** à utiliser.

**Bénéfice majeur** : Les développeurs pourraient juste pointer vers leur repo, et Spawner s'occupe du reste !

```yaml
# Config ultra-simple du futur
resources:
  - name: "api"
    gitRepo: "git@github.com:org/api.git"  # Spawner fait tout auto !
```

Cette approche est utilisée par des outils comme :
- **Heroku** : Buildpacks qui détectent et buildent auto
- **Railway** : Templates pour différents frameworks
- **Render** : Détection auto du type d'app

C'est une **évolution naturelle** pour Spawner ! 🚀
