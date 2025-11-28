#!/bin/bash
# Bootstrap script - Downloads and executes install.sh
# Usage: curl -fsSL https://raw.githubusercontent.com/Florian-mfr/Spawner/master/bootstrap.sh | bash

set -e

INSTALL_URL="https://raw.githubusercontent.com/Florian-mfr/Spawner/master/install.sh"
TMP_FILE="/tmp/spawner-install-$$.sh"

# Download the installer
echo "Downloading Spawner installer..."
curl -fsSL "$INSTALL_URL" -o "$TMP_FILE"

# Make it executable
chmod +x "$TMP_FILE"

# Execute it
bash "$TMP_FILE" "$@"

# Cleanup
rm -f "$TMP_FILE"
