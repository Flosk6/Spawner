# Quick Start - Spawner Local Test

Testez Spawner en 5 minutes sur votre machine locale !

## 🚀 Démarrage Rapide

### 1. Setup (1 minute)

```bash
# Depuis le dossier spawner/
./setup-local.sh
```

### 2. Installer les dépendances (2 minutes)

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

### 3. Lancer l'application (1 minute)

**Terminal 1 - Backend:**
```bash
cd backend
npm run start:dev
```

Attendez de voir :
```
✓ Project config loaded: 3 resources
Spawner API running on port 3000
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```

Attendez de voir :
```
➜  Local:   http://localhost:5173/
```

### 4. Ouvrir l'interface (30 secondes)

Ouvrez **http://localhost:5173** dans votre navigateur !

## ✅ Ce que vous pouvez tester

### Interface
- ✅ Dashboard avec Git Key Management
- ✅ Liste des environnements
- ✅ Formulaire de création
- ✅ Détails d'environnement
- ✅ Modal de logs

### API
```bash
# Config projet
curl http://localhost:3000/api/project

# Environnements
curl http://localhost:3000/api/environments
```

### Génération docker-compose
La création d'environnement générera un fichier `docker-compose.yml` dans :
```
./local-data/envs/<nom-env>/docker-compose.yml
```

Vous pouvez l'inspecter pour voir la configuration générée !

## 📝 Exemple de test

1. **Créer un environnement** :
   - Nom : `test-001`
   - demo-api : `10.x`
   - demo-front : `canary`

2. **Résultat attendu** :
   - Fichier généré : `./local-data/envs/test-001/docker-compose.yml`
   - Services : `demo-api-test-001`, `demo-front-test-001`, `demo-db-test-001`
   - Network : `net-test-001`

⚠️ **Note**: La création complète nécessite Docker Desktop en marche. Sans Docker, les fichiers seront générés mais les containers ne démarreront pas.

## 🔍 Consulter les fichiers générés

```bash
# Voir le docker-compose généré
cat ./local-data/envs/test-001/docker-compose.yml

# Voir la base SQLite
sqlite3 ./local-data/data/spawner.db "SELECT * FROM environments;"

# Voir les repos clonés (si la création a réussi)
ls -la ./local-data/repos/
```

## 🧹 Nettoyer et recommencer

```bash
rm -rf ./local-data
./setup-local.sh
```

## 📚 Documentation complète

- [TEST.md](TEST.md) - Guide de test détaillé
- [README.md](README.md) - Documentation complète
- [CLAUDE.md](CLAUDE.md) - Architecture et spécifications

## 🐛 Problèmes ?

**Backend ne démarre pas** :
```bash
cd backend
rm -rf node_modules package-lock.json
npm install
```

**Frontend ne démarre pas** :
```bash
cd frontend
rm -rf node_modules package-lock.json
npm install
```

**"Cannot find project.config.yml"** :
```bash
./setup-local.sh
```

C'est tout ! Vous êtes prêt à explorer Spawner 🎉
