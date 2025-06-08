#!/bin/bash

set -ex  # Exit immediately if a command exits with a non-zero status

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔧 Installing Lambda Dependencies for RAG Document Ingestion Service${NC}"
echo "=================================================================="

# Function to log with timestamp
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

# Function to log errors
log_error() {
    echo -e "${RED:-\033[0;31m}[ERROR $(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

log "📦 Installing Lambda runtime dependencies..."

# Check if handlers directory has package.json
if [ ! -f "lib/handlers/package.json" ]; then
    log_error "lib/handlers/package.json not found. Handlers directory should be a proper Node.js project."
    exit 1
fi

# Install dependencies in handlers directory
cd lib/handlers

log "📋 Installing dependencies from lib/handlers/package.json"
npm install --production

log "✅ Lambda dependencies installed successfully"

# Return to root directory
cd ../..

log "📊 Lambda Dependencies Summary:"
log "   - Installation directory: lib/handlers/node_modules/"
log "   - AWS SDK modules: 4 packages"
log "   - Utility modules: 1 package"
log "   - Production-only: Yes"

echo "=================================================================="
echo -e "${GREEN}✅ Lambda dependencies installation completed!${NC}"
echo -e "${BLUE}📝 Note: CDK synthesis and deployment will be handled by OndemandEnv platform${NC}"

cd webUI && npm install && npm run build