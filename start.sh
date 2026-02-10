#!/bin/bash

# Jobs AI Chrome Extension - Startup Script

echo "🚀 Starting Jobs AI Chrome Extension Server..."
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    echo ""
fi

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "⚠️  No .env file found. Creating from template..."
    cp .env.example .env
    echo "⚠️  Please edit .env and add your OPENAI_API_KEY"
    echo ""
    exit 1
fi

# Check if API key is set
if grep -q "OPENAI_API_KEY=$" .env; then
    echo "⚠️  OPENAI_API_KEY not set in .env file"
    echo "Please edit .env and add your API key"
    exit 1
fi

# Start the server
echo "✅ Starting server on port 3002..."
echo ""
echo "📝 Server logs:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

npm start
