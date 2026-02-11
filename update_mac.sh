#!/bin/bash

#############################################
#   GeoRanker - One-Click macOS Updater     #
#############################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo ""
echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                                                              ║${NC}"
echo -e "${BLUE}║     ${GREEN}🔄 GeoRanker - One-Click Updater${BLUE}                        ║${NC}"
echo -e "${BLUE}║                                                              ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check if running from the correct directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ Error: Please run this script from the GeoRanker project directory.${NC}"
    exit 1
fi

# Step 1: Pull latest code
echo -e "${YELLOW}[1/4]${NC} Pulling latest updates from Git..."
if [ -d ".git" ]; then
    git pull origin main || echo -e "${YELLOW}⚠️ Git pull failed. Continuing with local files...${NC}"
else
    echo -e "${YELLOW}⚠️ Not a git repository. Skipping pull.${NC}"
fi

# Step 2: Install dependencies
echo ""
echo -e "${YELLOW}[2/4]${NC} Updating dependencies..."
npm install --silent
echo -e "       ${GREEN}✓ Dependencies updated${NC}"

# Step 3: Update database
echo ""
echo -e "${YELLOW}[3/4]${NC} Updating database schema..."
npx prisma generate --quiet
npx prisma db push --quiet
echo -e "       ${GREEN}✓ Database schema updated${NC}"

# Step 4: Rebuild application
echo ""
echo -e "${YELLOW}[4/4]${NC} Rebuilding application..."
npm run build --silent
echo -e "       ${GREEN}✓ Application rebuilt${NC}"

echo ""
echo -e "${GREEN}✅ Update Complete! Please restart the application.${NC}"
echo ""
