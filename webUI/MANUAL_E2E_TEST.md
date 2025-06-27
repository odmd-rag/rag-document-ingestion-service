# Manual E2E RAG Pipeline Validation Test

This is a **manual end-to-end test** that validates the complete RAG pipeline processing from file upload through vector storage.

## ⚠️ Important: Manual Test Only

This test is designed to be run **manually** and **on-demand** - it does not run automatically with CI/CD.

## Prerequisites

1. **WebUI Development Server**: `npm run dev` (running on localhost:5173)
2. **Chrome Browser**: Must be launched with OAuth-compatible settings
3. **RAG Services**: All microservices must be running and healthy

## Running the Test

### Step 1: Start Chrome with OAuth Support
```bash
cd rag-document-ingestion-service/webUI
./launch-chrome-oauth.sh
```

### Step 2: Authenticate
- Sign in with Google OAuth in the opened Chrome browser
- Complete authentication flow
- Ensure you see the upload interface

### Step 3: Run the E2E Test
```bash
npx playwright test automated-upload-test.spec.ts --project=chromium-oauth
```

## What the Test Validates

✅ **File Upload**: Uploads test document successfully  
✅ **Document Ingestion**: Validates ingestion service processes file  
✅ **Content Processing**: Ensures processing service completes  
✅ **Vector Embedding**: Validates embedding service generates vectors  
✅ **Vector Storage**: Confirms storage service saves vectors  

## Expected Behavior

- **PASS**: All 4 pipeline stages complete successfully
- **FAIL**: Any pipeline stage fails or gets stuck

## Test Results

Screenshots and traces are saved to `test-results/` directory for debugging.

## Timeout

The test has a 15-minute timeout to allow for complete pipeline processing. 