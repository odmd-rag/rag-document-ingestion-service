#!/bin/bash

# RAG WebUI Chrome OAuth Launch Script
# This script launches Chrome in a VNC environment with Google OAuth support

echo "🚀 RAG WebUI Chrome OAuth Launch Script"
echo "========================================"
echo ""

# Configuration
VNC_DISPLAY=":1"
XAUTH_PATH="~/.Xauthority"
DEBUG_PORT="9222"
USER_DATA_DIR="./test-usr"
RAG_URL="http://localhost:5173"

# Check if Vite dev server is running
echo "🔍 Checking if Vite dev server is running..."
if ! curl -s -f "$RAG_URL" > /dev/null; then
    echo "❌ Vite dev server not running at $RAG_URL"
    echo "💡 Please start it first: npm run dev"
    echo ""
    read -p "Start Vite dev server now? (y/n): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "🚀 Starting Vite dev server..."
        npm run dev &
        VITE_PID=$!
        echo "⏳ Waiting for Vite to start..."
        sleep 5
        
        # Check again
        if ! curl -s -f "$RAG_URL" > /dev/null; then
            echo "❌ Failed to start Vite dev server"
            exit 1
        fi
        echo "✅ Vite dev server started"
    else
        echo "❌ Cannot proceed without Vite dev server"
        exit 1
    fi
else
    echo "✅ Vite dev server is running"
fi

echo ""

# Kill existing Chrome processes
echo "🔄 Cleaning up existing Chrome processes..."
pkill -f chrome 2>/dev/null || true
sleep 2

# Check if debugging port is in use
if netstat -tln | grep -q ":$DEBUG_PORT "; then
    echo "⚠️  Port $DEBUG_PORT is in use, trying alternative..."
    DEBUG_PORT="9223"
fi

# Set environment variables
export DISPLAY="$VNC_DISPLAY"
export XAUTHORITY="$XAUTH_PATH"

echo "🌐 Launching Chrome with OAuth support..."
echo "📍 VNC Display: $VNC_DISPLAY"
echo "🔧 Debug Port: $DEBUG_PORT"
echo "📁 User Data: $USER_DATA_DIR"
echo "🎯 Target URL: $RAG_URL"
echo ""

# Launch Chrome with debugging enabled
google-chrome \
    --no-sandbox \
    --disable-dev-shm-usage \
    --remote-debugging-port="$DEBUG_PORT" \
    --user-data-dir="$USER_DATA_DIR" \
    --new-window "$RAG_URL" &

CHROME_PID=$!

# Wait for Chrome to start
echo "⏳ Waiting for Chrome to initialize..."
sleep 3

# Check if Chrome started successfully
if ! ps -p $CHROME_PID > /dev/null; then
    echo "❌ Failed to start Chrome"
    exit 1
fi

# Wait for debugging port to be ready
echo "🔍 Waiting for debugging port to be ready..."
for i in {1..10}; do
    if curl -s -f "http://localhost:$DEBUG_PORT/json/version" > /dev/null; then
        echo "✅ Chrome debugging port is ready"
        break
    fi
    sleep 1
    if [ $i -eq 10 ]; then
        echo "⚠️  Debugging port not responding, but Chrome may still work"
    fi
done

echo ""
echo "🎉 Chrome launched successfully!"
echo "================================"
echo ""
echo "📋 Next Steps:"
echo "1. 🖥️  Connect to VNC: 192.168.2.148:5901"
echo "2. 🌐 Chrome should show the RAG WebUI"
echo "3. 🔑 Complete Google OAuth authentication (if not already saved)"
echo "4. ✅ Verify main upload UI appears"
echo "5. 🔒 Close Chrome to save credentials in ./test-usr"
echo ""
echo "🧪 For automated testing (after saving credentials):"
echo "   npx playwright test automated-upload-test.spec.ts"
echo ""
echo "🔧 Debug info:"
echo "   Chrome PID: $CHROME_PID"
echo "   Debug Port: http://localhost:$DEBUG_PORT"
echo "   User Data: $USER_DATA_DIR"
echo ""
echo "🛑 To stop Chrome: pkill -f chrome"
echo "🧹 To clean up: rm -rf $USER_DATA_DIR"
echo ""

# Optional: Show debugging info
if command -v curl &> /dev/null; then
    echo "🔍 Chrome debugging info:"
    echo "------------------------"
    curl -s "http://localhost:$DEBUG_PORT/json/version" 2>/dev/null | jq . 2>/dev/null || curl -s "http://localhost:$DEBUG_PORT/json/version" 2>/dev/null || echo "Debug port not accessible"
    echo ""
fi

echo "✨ Ready for OAuth testing!"
echo ""
echo "💡 Tip: Keep this terminal open to see Chrome logs"
echo "    Press Ctrl+C to stop monitoring"

# Keep script running to show Chrome logs
trap 'echo ""; echo "🛑 Stopping Chrome..."; pkill -f chrome; exit 0' INT

# Monitor Chrome process
while ps -p $CHROME_PID > /dev/null; do
    sleep 1
done

echo "❌ Chrome process ended unexpectedly" 