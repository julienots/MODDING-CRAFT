#!/bin/sh
# Crée dist/CreationsVivantes_v5.mcaddon à partir des deux packs
set -e
cd "$(dirname "$0")"
mkdir -p dist
rm -f dist/CreationsVivantes_v5.mcaddon
zip -qr dist/CreationsVivantes_v5.mcaddon CreationsVivantes_BP CreationsVivantes_RP
echo "dist/CreationsVivantes_v5.mcaddon"
