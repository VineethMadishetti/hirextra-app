#!/bin/bash

# Resume Parsing Status Check Script
# This script helps verify that the resume parsing endpoints are working correctly

API_BASE="https://api.stucrow.com"
# For local testing, use: API_BASE="http://localhost:5000"

echo "🔍 Resume Parsing Endpoint Status Check"
echo "========================================"
echo ""

# Check if curl is available
if ! command -v curl &> /dev/null; then
    echo "❌ curl not found. Please install curl to run this script."
    exit 1
fi

# Function to test an endpoint
test_endpoint() {
    local method=$1
    local endpoint=$2
    local data=$3
    local description=$4
    
    echo "Testing: $description"
    echo "  URL: $API_BASE$endpoint"
    echo "  Method: $method"
    
    if [ -z "$data" ]; then
        response=$(curl -s -w "\n%{http_code}" -X "$method" \
            -H "Authorization: Bearer YOUR_TOKEN_HERE" \
            -H "Content-Type: application/json" \
            "$API_BASE$endpoint")
    else
        response=$(curl -s -w "\n%{http_code}" -X "$method" \
            -H "Authorization: Bearer YOUR_TOKEN_HERE" \
            -H "Content-Type: application/json" \
            -d "$data" \
            "$API_BASE$endpoint")
    fi
    
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    echo "  Status: $http_code"
    if [ "$http_code" = "200" ] || [ "$http_code" = "201" ]; then
        echo "  ✅ Success"
    elif [ "$http_code" = "404" ]; then
        echo "  ⚠️  Not Found (Job may not exist)"
    elif echo "$http_code" | grep -q "^5"; then
        echo "  ❌ Server Error"
    elif echo "$http_code" | grep -q "^4"; then
        echo "  ⚠️  Client Error"
    fi
    
    if [ ! -z "$body" ]; then
        echo "  Response: $body"
    fi
    echo ""
}

# Check health endpoint
echo "1️⃣  Health Check"
echo "----------------"
test_endpoint "GET" "/api/candidates/health" "" "Candidates API is running"

# Instructions for manual testing
echo ""
echo "2️⃣  Manual Testing Instructions"
echo "---------------------------------"
echo ""
echo "To test resume import from UI:"
echo "1. Go to Admin Dashboard → Bulk Resume Import"
echo "2. Enter S3 folder path: 'Resumes 2/'"
echo "3. Click 'Start Resume Import'"
echo "4. Job status will update automatically in History tab"
echo ""

echo "To test via curl:"
echo ""
echo "# Get your auth token first (from browser localStorage)"
echo "TOKEN='your-jwt-token-here'"
echo ""
echo "# Start resume import"
echo "curl -X POST $API_BASE/api/candidates/import-resumes \\"
echo "  -H \"Authorization: Bearer \$TOKEN\" \\"
echo "  -H \"Content-Type: application/json\" \\"
echo "  -d '{\"folderPath\": \"Resumes 2/\", \"skipExisting\": true}'"
echo ""
echo "# Check job status"
echo "curl -X GET '$API_BASE/api/candidates/job/{jobId}/status' \\"
echo "  -H \"Authorization: Bearer \$TOKEN\""
echo ""

echo "3️⃣  Common Issues"
echo "------------------"
echo "❌ 500 Error on status polling:"
echo "   - Check that job ID is valid (24 hex characters)"
echo "   - Verify backend is running and connected to MongoDB"
echo "   - Check browser console for CORS errors (should show no errors now)"
echo ""
echo "❌ Import doesn't start:"
echo "   - Verify S3 folder path exists and contains resume files"
echo "   - Check folder has PDF, DOCX, or DOC files"
echo "   - Ensure you're logged in as ADMIN user"
echo ""
echo "✅ Expected behavior:"
echo "   - Import starts immediately with toast notification"
echo "   - Status updates every 2 seconds in History tab"
echo "   - Progress percentage increases as files are processed"
echo "   - No CORS errors in browser console"
echo ""
