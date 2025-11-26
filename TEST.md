# Guide de Test Local - Spawner POC

Ce guide vous permet de tester Spawner en local sans déploiement sur VPS.

## Prérequis

- Node.js 20+
- Docker Desktop (pour tester la génération de docker-compose et voir les containers)
- Un terminal

## Installation Rapide

### 1. Setup automatique

```bash
./setup-local.sh
```

Ce script va créer :
- `./local-data/` - Dossiers pour SQLite, SSH keys, repos, envs
- `backend/.env` - Configuration locale du backend
- `frontend/.env` - Configuration locale du frontend

### 2. Installer les dépendances

**Terminal 1 - Backend:**
```bash
cd backend
npm install
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm install
```

### 3. Lancer les serveurs

**Terminal 1 - Backend:**
```bash
cd backend
npm run start:dev
```

Vous devriez voir :
```
Spawner API running on port 3000
✓ Project config loaded: 3 resources
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```

Vous devriez voir :
```
VITE v5.x.x  ready in xxx ms

➜  Local:   http://localhost:5173/
```

### 4. Ouvrir l'interface

Ouvrez votre navigateur sur **http://localhost:5173**

## Tests à Effectuer

### Test 1: Visualisation de la Configuration

✅ **Dashboard**
- Vous devriez voir le dashboard avec 2 sections
- Section "Git Deploy Key"
- Section "Environments" (vide au début)

### Test 2: Génération de Clé SSH (optionnel sans Docker)

⚠️ Ce test nécessite `ssh-keygen` installé sur votre système.

1. Cliquer sur "Generate SSH Key"
2. Une clé publique devrait s'afficher
3. Vous pouvez copier la clé avec le bouton "Copy"
4. Tester la connexion avec "demo-api" (marchera seulement si vous utilisez HTTPS au lieu de SSH)

### Test 3: Création d'Environnement (mode simulation)

1. Cliquer sur "Create Environment"
2. Entrer un nom : `test-env-001`
3. Vous verrez les branches pré-remplies :
   - demo-api: 10.x
   - demo-front: canary
4. Cliquer sur "Create Environment"

⚠️ **Note**: La création échouera probablement car :
- Les repos utilisent HTTPS au lieu de SSH (pour simplifier les tests locaux)
- Docker doit être en cours d'exécution
- Les Dockerfiles doivent exister dans les repos

### Test 4: Tester la Génération de docker-compose.yml

Pour tester uniquement la génération du docker-compose sans l'exécuter :

```bash
cd backend
npm run start:dev
```

Puis dans un autre terminal :

```bash
# Tester l'API de configuration
curl http://localhost:3000/api/project

# Vous devriez voir la config JSON
```

### Test 5: Tester la Génération Manuelle

Créez un petit script de test :

```bash
cd backend
node -e "
const { DockerComposeGenerator } = require('./dist/common/docker-compose.generator');

const resources = [
  { name: 'demo-api', type: 'laravel-api', dbResource: 'demo-db' },
  { name: 'demo-front', type: 'nextjs-front', apiResource: 'demo-api' },
  { name: 'demo-db', type: 'mysql-db' }
];

const generator = new DockerComposeGenerator(
  'test-env-001',
  'localhost',
  resources,
  { 'demo-api': '10.x', 'demo-front': 'canary' },
  './local-data/repos'
);

console.log(generator.generate());
"
```

Ceci affichera le docker-compose.yml généré !

## Tests avec Git SSH (Avancé)

Si vous voulez tester avec de vrais repos privés :

### 1. Modifier project.config.local.yml

Utilisez vos propres repos :

```yaml
baseDomain: "localhost"

resources:
  - name: "my-api"
    type: "laravel-api"
    gitRepo: "git@github.com:votre-org/votre-api.git"
    defaultBranch: "develop"
    dbResource: "my-db"

  - name: "my-front"
    type: "nextjs-front"
    gitRepo: "git@github.com:votre-org/votre-front.git"
    defaultBranch: "develop"
    apiResource: "my-api"

  - name: "my-db"
    type: "mysql-db"
```

### 2. Générer et ajouter la clé SSH

1. Dans l'UI : Générer la clé SSH
2. Copier la clé publique
3. Ajouter aux deploy keys de vos repos GitHub
4. Tester la connexion

### 3. Créer un environnement

Maintenant la création devrait fonctionner complètement :
- Clone des repos
- Génération du docker-compose.yml dans `./local-data/envs/`
- Démarrage des containers (si Docker Desktop est actif)

## Vérifier les Fichiers Générés

Après une tentative de création d'environnement :

```bash
# Voir les environnements créés
ls -la ./local-data/envs/

# Voir un docker-compose généré
cat ./local-data/envs/test-env-001/docker-compose.yml

# Voir les repos clonés
ls -la ./local-data/repos/

# Voir la base de données SQLite
sqlite3 ./local-data/data/spawner.db "SELECT * FROM environments;"
```

## API Endpoints Disponibles

Vous pouvez tester directement les endpoints avec curl :

```bash
# Configuration projet
curl http://localhost:3000/api/project

# Info clé Git
curl http://localhost:3000/api/git/key

# Liste des environnements
curl http://localhost:3000/api/environments

# Créer un environnement
curl -X POST http://localhost:3000/api/environments \
  -H "Content-Type: application/json" \
  -d '{
    "name": "test-001",
    "branches": {
      "demo-api": "10.x",
      "demo-front": "canary"
    }
  }'
```

## Troubleshooting

### Backend ne démarre pas

**Erreur: Cannot find module**
```bash
cd backend
rm -rf node_modules package-lock.json
npm install
```

**Erreur: Failed to load project config**
- Vérifiez que `./local-data/project.config.yml` existe
- Ou modifiez `backend/.env` pour pointer vers `project.config.local.yml`

### Frontend ne démarre pas

**Erreur: Cannot find module 'vue'**
```bash
cd frontend
rm -rf node_modules package-lock.json
npm install
```

### Erreur lors de la création d'environnement

**"SSH key not configured"**
- Normal si vous utilisez HTTPS repos
- Générez une clé SSH dans l'UI

**"Connection failed"**
- Normal avec repos HTTPS et SSH configuré
- Utilisez des repos SSH + deploy keys

**Docker errors**
- Assurez-vous que Docker Desktop est lancé
- Vérifiez : `docker ps`

## Mode Test sans Docker

Si vous voulez juste tester l'UI et la génération de fichiers :

1. Commentez les lignes dans `environment.service.ts` qui lancent Docker :
   - Ligne `await execAsync(upCommand, ...)`
   - Les commandes `docker compose`

2. La création d'environnement générera les fichiers sans lancer les containers

3. Vous pouvez inspecter les docker-compose.yml générés dans `./local-data/envs/`

## Nettoyer

Pour tout recommencer :

```bash
# Supprimer les données locales
rm -rf ./local-data

# Re-setup
./setup-local.sh
```

---

**Note**: Ce mode de test local est parfait pour :
- ✅ Développer l'interface
- ✅ Tester la génération de docker-compose
- ✅ Valider la logique métier
- ✅ Débugger le code

Pour un test complet avec déploiement réel, utilisez un VPS comme décrit dans le README.md principal.
