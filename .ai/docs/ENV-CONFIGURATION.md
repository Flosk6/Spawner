# Configuration des Variables d'Environnement

## Architecture Centralisée

Spawner utilise une **configuration centralisée** avec tous les fichiers `.env` à la racine du projet.

```
spawner/
├── .env.example              # Template développement (copier vers .env)
├── .env.production.example   # Template production (copier vers .env.production)
├── .env                      # Config dev (créé par toi, gitignored)
├── .env.production          # Config prod (créé par toi, gitignored)
└── apps/
    ├── api/   # Lit /.env automatiquement
    └── web/   # Lit /.env automatiquement
```

**Pourquoi à la racine?**
- ✅ Une seule source de vérité
- ✅ Pas de duplication
- ✅ Pas de risque de désynchronisation
- ✅ Plus simple à maintenir
- ✅ Docker compose lit directement `.env`

## Setup Développement

### 1. Créer ton fichier `.env`

```bash
# À la racine du projet
cp .env.example .env
```

### 2. Configurer les valeurs minimales

```bash
# Générer les secrets
openssl rand -base64 32  # Pour SESSION_SECRET

# Éditer .env
nano .env
```

**Variables requises pour le dev:**

```bash
# GitHub OAuth (créer une OAuth App sur GitHub)
GITHUB_CLIENT_ID=ton_client_id_ici
GITHUB_CLIENT_SECRET=ton_client_secret_ici
GITHUB_ORG=ton_org
GITHUB_TEAM=ton_team

# Session
SESSION_SECRET=ton_secret_genere_avec_openssl

# Le reste peut rester par défaut
```

### 3. Démarrer

```bash
pnpm install
pnpm build
pnpm dev
```

## Setup Production

### 1. Créer ton fichier `.env.production`

```bash
# À la racine du projet (sur le VPS)
cp .env.production.example .env.production
chmod 600 .env.production  # Sécurité
```

### 2. Remplir TOUTES les valeurs

```bash
# Générer les secrets
openssl rand -base64 32  # SESSION_SECRET
openssl rand -hex 32     # WEBHOOK_SECRET
openssl rand -hex 32     # DEPLOY_TOKEN

# Éditer
nano .env.production
```

**Variables critiques à configurer:**

```bash
# Domaine
DOMAIN=ton-domaine.com
ACME_EMAIL=admin@ton-domaine.com

# Database (générer un mot de passe fort!)
DB_PASSWORD=$(openssl rand -base64 32)

# GitHub OAuth (créer une NOUVELLE OAuth App pour la prod)
GITHUB_CLIENT_ID=prod_client_id
GITHUB_CLIENT_SECRET=prod_client_secret
GITHUB_CALLBACK_URL=https://spawner.ton-domaine.com/api/auth/github/callback
GITHUB_ORG=ton_org
GITHUB_TEAM=ton_team

# Session (générer un NOUVEAU secret, différent du dev!)
SESSION_SECRET=$(openssl rand -base64 32)

# Update System
GITHUB_REPO=ton-org/spawner
WEBHOOK_SECRET=$(openssl rand -hex 32)
DEPLOY_TOKEN=$(openssl rand -hex 32)

# Traefik
TRAEFIK_AUTH=$(echo $(htpasswd -nb admin ton_password) | sed -e s/\\$/\\$\\$/g)
```

### 3. Démarrer

```bash
docker-compose -f docker-compose.production.yml up -d
```

## Comment les Apps Lisent le .env?

### Backend (NestJS)

Le fichier `apps/api/src/app.module.ts` charge `.env` depuis la racine:

```typescript
import { config } from "dotenv";
import { join } from "path";

// Charge /.env
config({ path: join(__dirname, "..", "..", "..", ".env") });

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      envFilePath: join(__dirname, "..", "..", "..", ".env"),
    }),
    // ...
  ],
})
```

**En production**, Docker Compose passe les variables automatiquement:

```yaml
# docker-compose.production.yml
services:
  spawner-api:
    env_file:
      - .env.production  # Lit depuis la racine
```

### Frontend (Vite)

Vite cherche automatiquement `.env` à la racine du workspace:

```javascript
// vite.config.ts
export default defineConfig({
  // Vite lit automatiquement /.env
  // Variables avec préfixe VITE_ sont exposées au frontend
})
```

**Variables Vite disponibles:**
- `VITE_API_URL` - URL de l'API

**En production**, les variables sont injectées au build:

```dockerfile
# apps/web/Dockerfile
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm run build
```

## Variables par Environnement

### Développement (.env)

| Variable | Valeur Dev | Description |
|----------|-----------|-------------|
| `NODE_ENV` | `development` | Mode développement |
| `DB_HOST` | `localhost` | DB locale ou container |
| `FRONTEND_URL` | `http://localhost:8080` | URL frontend dev |
| `VITE_API_URL` | `http://localhost:3000` | API dev |
| `AUTO_UPDATE_ENABLED` | `false` | Désactivé en dev |

### Production (.env.production)

| Variable | Valeur Prod | Description |
|----------|-------------|-------------|
| `NODE_ENV` | `production` | Mode production |
| `DB_HOST` | `postgres` | Service Docker |
| `FRONTEND_URL` | `https://spawner.ton-domaine.com` | URL publique |
| `VITE_API_URL` | `/api` | Proxy nginx |
| `AUTO_UPDATE_ENABLED` | `false` | Manuel recommandé |

## Secrets à Ne JAMAIS Commiter

⚠️ **IMPORTANT:** Ces fichiers sont dans `.gitignore`:

```
.env
.env.production
.env.local
.env.*.local
```

**Ne JAMAIS commiter:**
- `SESSION_SECRET`
- `GITHUB_CLIENT_SECRET`
- `DB_PASSWORD`
- `WEBHOOK_SECRET`
- `DEPLOY_TOKEN`
- `TRAEFIK_AUTH`

## Migration depuis l'Ancienne Structure

Si tu avais des `.env` dans `apps/api/` ou `apps/web/`:

### Étape 1: Fusionner les configs

```bash
# Backup
cp apps/api/.env apps/api/.env.backup
cp apps/web/.env apps/web/.env.backup

# Fusionner dans /.env
cat apps/api/.env > .env
cat apps/web/.env >> .env

# Éditer et nettoyer les doublons
nano .env
```

### Étape 2: Supprimer les anciens

```bash
# Les anciens .env ne sont plus utilisés
rm apps/api/.env
rm apps/web/.env
rm apps/api/.env.production
```

### Étape 3: Tester

```bash
pnpm dev
# Vérifier que tout fonctionne
```

## Docker Compose et Variables

### Développement (docker-compose.yml)

```yaml
services:
  spawner-api:
    env_file:
      - .env  # Lit automatiquement /.env
    environment:
      # Ou override spécifique
      NODE_ENV: development
```

### Production (docker-compose.production.yml)

```yaml
services:
  spawner-api:
    env_file:
      - .env.production  # Lit /.env.production
    environment:
      NODE_ENV: production
      DB_HOST: postgres  # Override si besoin
```

## Vérification de la Config

### Script de Vérification

Créer `scripts/check-env.sh`:

```bash
#!/bin/bash

echo "Checking environment configuration..."

# Vérifier que .env existe
if [ ! -f ".env" ]; then
  echo "❌ .env file not found!"
  echo "   Run: cp .env.example .env"
  exit 1
fi

# Vérifier variables critiques
REQUIRED_VARS=(
  "GITHUB_CLIENT_ID"
  "GITHUB_CLIENT_SECRET"
  "SESSION_SECRET"
  "GITHUB_ORG"
  "GITHUB_TEAM"
)

for var in "${REQUIRED_VARS[@]}"; do
  if ! grep -q "^${var}=" .env || grep -q "^${var}=.*CHANGE.*" .env; then
    echo "❌ $var not configured!"
  else
    echo "✅ $var configured"
  fi
done

echo ""
echo "Configuration check complete!"
```

Usage:

```bash
chmod +x scripts/check-env.sh
./scripts/check-env.sh
```

## Troubleshooting

### Problème: Variables non chargées

**Symptôme:** L'app ne voit pas les variables d'environnement.

**Solutions:**

1. Vérifier que `.env` est à la racine (pas dans `apps/api/`)
2. Redémarrer le serveur dev: `pnpm dev`
3. Vérifier les logs: `docker logs spawner-api`
4. Vérifier le chemin dans `app.module.ts`

### Problème: "Cannot find module dotenv"

**Solution:**

```bash
pnpm add dotenv
```

### Problème: Vite ne voit pas VITE_API_URL

**Symptôme:** `import.meta.env.VITE_API_URL` est `undefined`

**Solutions:**

1. Vérifier que la variable commence par `VITE_`
2. Redémarrer Vite: `pnpm web:dev`
3. Vérifier `.env` à la racine

### Problème: Docker ne charge pas les variables

**Solution:**

```yaml
# docker-compose.yml
services:
  spawner-api:
    env_file:
      - .env  # Chemin relatif depuis le docker-compose.yml
```

## Best Practices

### 1. Un Fichier par Environnement

```
.env                 → Développement local
.env.production      → Production
.env.staging         → Staging (optionnel)
.env.test            → Tests (optionnel)
```

### 2. Documentation dans .env.example

Garder `.env.example` à jour avec:
- ✅ Toutes les variables requises
- ✅ Commentaires explicatifs
- ✅ Exemples de valeurs
- ✅ Instructions de génération des secrets

### 3. Validation au Démarrage

Dans `app.module.ts`, valider les variables critiques:

```typescript
const requiredEnvVars = [
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'SESSION_SECRET',
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}
```

### 4. Secrets Rotation

Changer régulièrement:
- `SESSION_SECRET` (tous les 3-6 mois)
- `WEBHOOK_SECRET` (si compromis)
- `DEPLOY_TOKEN` (si compromis)
- `DB_PASSWORD` (annuellement)

### 5. Backup Sécurisé

```bash
# Backup .env.production (sur le VPS)
tar -czf env-backup-$(date +%Y%m%d).tar.gz .env.production
chmod 600 env-backup-*.tar.gz

# Stocker ailleurs (pas sur le VPS!)
scp env-backup-*.tar.gz user@backup-server:/backups/
```

## Résumé

✅ **Un seul `.env` à la racine** pour dev et prod
✅ **`.env.example`** et **`.env.production.example`** comme templates
✅ **Docker Compose** lit automatiquement depuis la racine
✅ **NestJS** configuré pour charger `/.env`
✅ **Vite** cherche automatiquement à la racine
✅ **Plus simple** et **plus sûr**

**Fichiers importants:**
- `/.env.example` - Template dev
- `/.env.production.example` - Template prod
- `/.env` - Config dev (à créer, gitignored)
- `/.env.production` - Config prod (à créer, gitignored)

**Anciens fichiers (à supprimer):**
- ~~`apps/api/.env.example`~~ → Fusionné dans `/.env.example`
- ~~`apps/api/.env.production.example`~~ → Fusionné dans `/.env.production.example`
- ~~`apps/web/.env.example`~~ → Fusionné dans `/.env.example`
