# Démarrage Rapide - Instructions

## ✅ Étape 1 : Installer dotenv (une seule fois)

Si vous avez déjà lancé `npm install` avant, installez juste dotenv :

```bash
cd backend
npm install dotenv
cd ..
```

Sinon, installez tout :

```bash
cd backend
npm install
cd ..
```

## ✅ Étape 2 : Lancer le Backend

**Terminal 1 :**
```bash
cd backend
npm run start:dev
```

Attendez de voir :
```
✓ Project config loaded: 3 resources
Spawner API running on port 3000
```

## ✅ Étape 3 : Lancer le Frontend

**Terminal 2 :**
```bash
cd frontend
npm run dev
```

Attendez de voir :
```
➜  Local:   http://localhost:5173/
```

## ✅ Étape 4 : Ouvrir l'Interface

Ouvrez dans votre navigateur :
**http://localhost:5173**

## 🎯 Que Tester ?

### 1. Dashboard
- Voir la section "Git Deploy Key"
- Voir la liste des environnements (vide)

### 2. Créer un environnement
- Cliquer "Create Environment"
- Nom : `test-001`
- Branches pré-remplies (demo-api: 10.x, demo-front: canary)
- Cliquer "Create Environment"

⚠️ **Note** : La création va essayer de cloner les repos. Cela peut prendre 1-2 minutes.

### 3. Voir les fichiers générés

**Docker Compose :**
```bash
cat local-data/envs/test-001/docker-compose.yml
```

**Base de données :**
```bash
sqlite3 local-data/data/spawner.db "SELECT * FROM environments;"
```

**Repos clonés :**
```bash
ls -la local-data/repos/
```

## 🧪 Test API Direct

```bash
# Config projet
curl http://localhost:3000/api/project | jq

# Liste environnements
curl http://localhost:3000/api/environments | jq

# Créer un environnement
curl -X POST http://localhost:3000/api/environments \
  -H "Content-Type: application/json" \
  -d '{
    "name": "test-api-001",
    "branches": {
      "demo-api": "10.x",
      "demo-front": "canary"
    }
  }' | jq
```

## ❌ Problèmes Courants

### Backend ne démarre pas

**Erreur : Cannot find module 'dotenv'**
```bash
cd backend
npm install dotenv
```

**Erreur : Permission denied /opt/spawner**
```bash
# Le .env n'est pas chargé
cat backend/.env  # Vérifier que le fichier existe
./setup-local.sh  # Relancer le setup
```

### Frontend : Erreur de connexion API

Vérifiez que le backend tourne sur le port 3000 :
```bash
curl http://localhost:3000/api/project
```

### Environnement : Erreur de création

**"SSH key not configured"** → Normal avec HTTPS, ignorez
**"Failed to clone"** → Vérifiez votre connexion internet
**"Docker error"** → Normal si Docker Desktop n'est pas lancé

## 🧹 Nettoyer et Recommencer

```bash
# Arrêter les serveurs (Ctrl+C dans chaque terminal)

# Nettoyer les données
rm -rf local-data

# Recommencer
./setup-local.sh
cd backend && npm run start:dev
```

## 🚀 Tout va bien ?

Vous devriez voir :
- ✅ Interface Spawner sur http://localhost:5173
- ✅ API qui répond sur http://localhost:3000/api/project
- ✅ Possibilité de créer des environnements
- ✅ Génération de docker-compose.yml

Amusez-vous bien ! 🎉
