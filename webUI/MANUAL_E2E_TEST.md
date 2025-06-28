# Manual E2E RAG Pipeline Validation Test

This is a **manual end-to-end test** that validates the complete RAG pipeline processing from file upload through vector storage.

## ⚠️ Important: Manual Test Only

This test is designed to be run **manually** and **on-demand** - it does not run automatically with CI/CD.

## Prerequisites

1. **WebUI Development Server**: `npm run dev` (running on localhost:5173)
2. **Saved Authentication**: Google OAuth credentials must be saved in `./test-usr` directory
3. **RAG Services**: All microservices must be running and healthy

## One-Time Setup: Save Authentication

**Only needed once** - saves Google OAuth credentials for future test runs:

```bash
cd rag-document-ingestion-service/webUI
./launch-chrome-oauth.sh
```

1. Sign in with Google OAuth in the opened Chrome browser
2. Complete authentication and verify upload interface works
3. Close Chrome - credentials are now saved in `./test-usr`

## Running the Test

```bash
cd rag-document-ingestion-service/webUI
npx playwright test automated-upload-test.spec.ts
```

**The test assumes you're already authenticated** and will **FAIL** if saved credentials are missing or expired.

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