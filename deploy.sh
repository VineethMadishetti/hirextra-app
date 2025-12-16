#!/bin/bash

# Hirextra Deployment Script
# This script helps set up the project for deployment

echo "🚀 Hirextra Deployment Setup"
echo "============================"

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    echo "⚠️  Please edit .env file with your actual credentials"
else
    echo "✅ .env file already exists"
fi

# Install dependencies
echo "📦 Installing server dependencies..."
cd server
npm install

echo "📦 Installing client dependencies..."
cd ../client
npm install

cd ..

echo "✅ Dependencies installed"
echo ""
echo "📋 Next steps:"
echo "1. Set up MongoDB Atlas and get connection string"
echo "2. Set up Upstash Redis and get credentials"
echo "3. Update .env file with your credentials"
echo "4. Push to GitHub"
echo "5. Deploy to Render (backend) and Render Static Site (frontend)"
echo ""
echo "📖 See DEPLOYMENT.md for detailed instructions"