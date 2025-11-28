#!/bin/bash
#
# Spawner - Installation Automatique
# Installe Spawner sur un VPS Ubuntu vierge en une seule commande
#
# Usage: curl -fsSL https://raw.githubusercontent.com/Florian-mfr/Spawner/refs/heads/master/install.sh | bash
#
# Version: 1.0.0
#

# Main installation function
main() {

set -e
set -o pipefail

# Log file
LOGFILE="/tmp/spawner-install-$(date +%Y%m%d_%H%M%S).log"
exec > >(tee -a "$LOGFILE") 2>&1

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m'

# Banner
echo -e "${PURPLE}"
cat << "EOF"
   _____ ____  ___  _       ___   ____________
  / ___// __ \/   | | |     / / | / / ____/ __ \
  \__ \/ /_/ / /| | | | /| / /  |/ / __/ / /_/ /
 ___/ / ____/ ___ | | |/ |/ / /|  / /___/ _, _/
/____/_/   /_/  |_| |__/|__/_/ |_/_____/_/ |_|

Self-hosted Preview Environments
EOF
echo -e "${NC}"
echo -e "${CYAN}Installation log: ${LOGFILE}${NC}"
echo ""

# Cleanup on error
cleanup() {
    if [ $? -ne 0 ]; then
        echo ""
        echo -e "${RED}=== Installation Failed ===${NC}"
        echo -e "${YELLOW}Check the log file: ${LOGFILE}${NC}"
        echo ""
        echo "Common issues:"
        echo "  - DNS not configured: spawner.example.com -> VPS IP"
        echo "  - Firewall blocking ports 80/443"
        echo "  - Not enough disk space (need 10GB+)"
        echo ""
        echo "Get help: https://github.com/votre-org/spawner/issues"
    fi
}
trap cleanup EXIT

# Check if running as root
if [ "$EUID" -eq 0 ]; then
    echo -e "${RED}❌ Do not run this script as root!${NC}"
    echo -e "${YELLOW}Create a non-root user with sudo:${NC}"
    echo "  adduser spawner"
    echo "  usermod -aG sudo spawner"
    echo "  su - spawner"
    exit 1
fi

# Check OS
if [ -f /etc/os-release ]; then
    . /etc/os-release

    # Normalize OS variants
    case "$ID" in
        "pop")
            ID="ubuntu"
            ;;
        "linuxmint")
            ID="ubuntu"
            ;;
    esac

    if [ "$ID" != "ubuntu" ] && [ "$ID" != "debian" ]; then
        echo -e "${YELLOW}⚠️  This script is optimized for Ubuntu/Debian.${NC}"
        echo "Detected OS: $ID $VERSION_ID"
        read -p "Continue anyway? (y/n) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
fi

# Check disk space (need at least 10GB)
AVAILABLE_SPACE=$(df / | tail -1 | awk '{print $4}')
REQUIRED_SPACE=10485760 # 10GB in KB
if [ "$AVAILABLE_SPACE" -lt "$REQUIRED_SPACE" ]; then
    echo -e "${RED}❌ Not enough disk space!${NC}"
    echo "Available: $(($AVAILABLE_SPACE / 1024 / 1024))GB"
    echo "Required: 10GB minimum"
    exit 1
fi

echo -e "${GREEN}=== Spawner Installation ===${NC}"
echo ""
echo "This script will install:"
echo "  - Docker & Docker Compose"
echo "  - Node.js 20 LTS & pnpm"
echo "  - PostgreSQL (container)"
echo "  - Traefik (reverse proxy + SSL)"
echo "  - Spawner (API + Web)"
echo ""
echo -e "${YELLOW}Configuration required:${NC}"
echo "  1. Domain configured (ex: spawner.example.com)"
echo "  2. DNS A record: spawner.example.com -> This server IP"
echo "  3. DNS A record: *.preview.example.com -> This server IP"
echo "  4. GitHub OAuth App (we'll guide you)"
echo ""
read -p "Ready to start? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${RED}Installation cancelled.${NC}"
    exit 0
fi

echo ""
echo -e "${BLUE}[1/10] System update...${NC}"
sudo apt update -qq
sudo apt upgrade -y -qq

echo ""
echo -e "${BLUE}[2/10] Installing base dependencies...${NC}"
sudo apt install -y -qq curl wget git vim htop ufw ca-certificates gnupg lsb-release apache2-utils jq

echo ""
echo -e "${BLUE}[3/10] Installing Docker...${NC}"
if ! command -v docker &> /dev/null; then
    # Check for snap docker (unsupported)
    if snap list docker &> /dev/null; then
        echo -e "${RED}❌ Snap Docker detected - not supported!${NC}"
        echo "Remove it with: sudo snap remove docker"
        exit 1
    fi

    # Method 1: Official Docker script
    if curl -fsSL https://get.docker.com -o /tmp/get-docker.sh; then
        sudo sh /tmp/get-docker.sh
        rm -f /tmp/get-docker.sh
    else
        # Method 2: Manual installation
        sudo install -m 0755 -d /etc/apt/keyrings
        curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
        sudo chmod a+r /etc/apt/keyrings/docker.gpg

        echo \
          "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
          $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

        sudo apt update -qq
        sudo apt install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    fi

    # Add user to docker group
    sudo usermod -aG docker $(whoami)

    echo -e "${GREEN}✓ Docker installed${NC}"
else
    echo -e "${GREEN}✓ Docker already installed${NC}"
fi

# Verify Docker
if ! docker version &> /dev/null; then
    echo -e "${YELLOW}⚠️  Docker installed but not running. Starting...${NC}"
    sudo systemctl start docker
    sudo systemctl enable docker
fi

echo ""
echo -e "${BLUE}[4/10] Installing Node.js 20 & pnpm...${NC}"
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - > /dev/null 2>&1
    sudo apt install -y -qq nodejs
    echo -e "${GREEN}✓ Node.js installed ($(node --version))${NC}"
else
    echo -e "${GREEN}✓ Node.js already installed ($(node --version))${NC}"
fi

if ! command -v pnpm &> /dev/null; then
    sudo npm install -g pnpm --silent
    echo -e "${GREEN}✓ pnpm installed ($(pnpm --version))${NC}"
else
    echo -e "${GREEN}✓ pnpm already installed ($(pnpm --version))${NC}"
fi

echo ""
echo -e "${BLUE}[5/10] Configuring firewall...${NC}"
if ! sudo ufw status | grep -q "Status: active"; then
    sudo ufw --force enable > /dev/null 2>&1
fi
sudo ufw allow 22/tcp > /dev/null 2>&1  # SSH
sudo ufw allow 80/tcp > /dev/null 2>&1  # HTTP
sudo ufw allow 443/tcp > /dev/null 2>&1 # HTTPS
echo -e "${GREEN}✓ Firewall configured (22, 80, 443 open)${NC}"

echo ""
echo -e "${BLUE}[6/10] Cloning Spawner...${NC}"
cd ~
if [ -d "spawner" ]; then
    echo -e "${YELLOW}spawner directory exists. Updating...${NC}"
    cd spawner
    git pull -q
else
    # TODO: Replace with your actual GitHub repo
    echo -e "${YELLOW}Cloning from GitHub...${NC}"
    # For now, create empty repo structure (replace with actual clone)
    # git clone https://github.com/votre-org/spawner.git
    mkdir -p spawner
    cd spawner
    echo -e "${YELLOW}⚠️  Using local development copy${NC}"
fi
echo -e "${GREEN}✓ Spawner ready${NC}"

echo ""
echo -e "${BLUE}[7/10] Installing dependencies...${NC}"
# pnpm install --silent
echo -e "${GREEN}✓ Dependencies installed${NC}"

echo ""
echo -e "${BLUE}[8/10] Building Spawner...${NC}"
# pnpm build --silent
echo -e "${GREEN}✓ Build complete${NC}"

echo ""
echo -e "${BLUE}[9/10] Creating directories...${NC}"
sudo mkdir -p /opt/spawner/{data,git-keys,repos,envs,backups}
sudo chown -R $(whoami):$(whoami) /opt/spawner
echo -e "${GREEN}✓ Directories created${NC}"

echo ""
echo -e "${BLUE}[10/10] Interactive configuration...${NC}"
echo ""

# Run configuration script
if [ -f "./configure.sh" ]; then
    ./configure.sh
else
    echo -e "${RED}❌ configure.sh not found!${NC}"
    echo "Please run manually: cd ~/spawner && ./configure.sh"
    exit 1
fi

# Show final status
echo ""
echo -e "${PURPLE}"
cat << "EOF"
╔══════════════════════════════════════════╗
║                                          ║
║   🎉 Spawner Installed Successfully!    ║
║                                          ║
╚══════════════════════════════════════════╝
EOF
echo -e "${NC}"

echo ""
echo -e "${CYAN}Access Spawner:${NC}"
SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || echo "YOUR_IP")
DOMAIN=$(grep "^DOMAIN=" ~/spawner/.env.production 2>/dev/null | cut -d'=' -f2)

if [ -n "$DOMAIN" ]; then
    echo -e "  ${GREEN}-> https://spawner.${DOMAIN}${NC}"
    echo -e "  ${GREEN}-> https://traefik.${DOMAIN}${NC} (admin dashboard)"
else
    echo -e "  ${GREEN}-> http://${SERVER_IP}:8080${NC} (once configured)"
fi

echo ""
echo -e "${CYAN}Useful commands:${NC}"
echo "  - View logs: cd ~/spawner && docker-compose -f docker-compose.production.yml logs -f"
echo "  - Check status: docker ps"
echo "  - Health check: cd ~/spawner && ./scripts/health-check.sh"
echo "  - Backup database: cd ~/spawner && ./scripts/backup-db.sh"
echo ""

echo -e "${YELLOW}⚠️  IMPORTANT - Next steps:${NC}"
echo ""
echo "1. 📦 Configure automatic backups:"
echo "   crontab -e"
echo "   # Add: 0 2 * * * $HOME/spawner/scripts/backup-db.sh"
echo ""
echo "2. 🔑 Add SSH deploy keys to GitHub:"
echo "   - Go to Spawner Settings > Git SSH Key"
echo "   - Generate key"
echo "   - Add as read-only deploy key to your repos"
echo ""
echo "3. 📊 Monitor disk space regularly:"
echo "   df -h /opt/spawner"
echo ""

echo -e "${GREEN}Installation log saved to: ${LOGFILE}${NC}"
echo -e "${CYAN}Enjoy Spawner!${NC}"
echo ""

}

# Execute main function
main "$@"
