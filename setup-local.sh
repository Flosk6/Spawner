#!/bin/bash

# Script pour setup l'environnement local de test

echo "🚀 Setting up Spawner local development environment..."

# Get absolute path of current directory
CURRENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Créer les dossiers nécessaires en local
echo "📁 Creating local directories..."
mkdir -p ./local-data/{data,git-keys,repos,envs}

# Copier le fichier de config local (avec repos HTTPS pour tests)
echo "📄 Copying local config..."
cp project.config.local.yml ./local-data/project.config.yml

# Créer un .env pour le backend
echo "🔧 Creating backend .env..."
cat > backend/.env << EOF
PORT=3000
DATABASE_PATH=${CURRENT_DIR}/local-data/data/spawner.db
PROJECT_CONFIG_PATH=${CURRENT_DIR}/local-data/project.config.yml
GIT_KEYS_PATH=${CURRENT_DIR}/local-data/git-keys
REPOS_PATH=${CURRENT_DIR}/local-data/repos
ENVS_PATH=${CURRENT_DIR}/local-data/envs
EOF

# Créer un .env pour le frontend
echo "🔧 Creating frontend .env..."
cat > frontend/.env << EOF
VITE_API_URL=http://localhost:3000
EOF

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Install backend dependencies:"
echo "   cd backend && npm install"
echo ""
echo "2. Install frontend dependencies:"
echo "   cd frontend && npm install"
echo ""
echo "3. Start backend (in one terminal):"
echo "   cd backend && npm run start:dev"
echo ""
echo "4. Start frontend (in another terminal):"
echo "   cd frontend && npm run dev"
echo ""
echo "5. Open http://localhost:5173 in your browser"
echo ""
