# RAG Document Ingestion WebUI

A React-based web interface for the RAG (Retrieval-Augmented Generation) document ingestion system built on the OndemandEnv platform.

## Overview

This WebUI provides a complete interface for:
- Document upload and validation
- Real-time pipeline tracking across all RAG services
- Authentication via Google OAuth
- Status monitoring and error handling

## Architecture

The RAG system consists of multiple microservices:
- **Document Ingestion**: Upload validation and initial processing
- **Document Processing**: Text extraction and chunking
- **Embedding Service**: Generate vector embeddings
- **Vector Storage**: Store embeddings in vector database

## Quick Start

### Prerequisites
- Node.js 18+ and npm
- Access to deployed RAG services (dev/prod environments)

### Installation
```bash
npm install
```

### Development
```bash
npm run dev
```
The development server will start on `http://localhost:5173`

### Build for Production
```bash
npm run build
```

## Configuration

### Dynamic Configuration
The WebUI automatically loads configuration from `/config.json`, which is generated by the CDK deployment process. This includes:

- AWS API endpoints
- Google OAuth client ID
- Cognito user pool details
- Service endpoints for all RAG services

### Configuration Structure
```json
{
  "aws": {
    "region": "us-east-2",
    "apiEndpoint": "https://up-api.dev.ragingest.rag-ws1.root.ondemandenv.link"
  },
  "google": {
    "clientId": "your-google-client-id"
  },
  "cognito": {
    "providerName": "cognito-idp.us-east-2.amazonaws.com/us-east-2_PoolId",
    "userPoolDomain": "your-domain.ondemandenv.link"
  },
  "services": {
    "processing": "https://proc-api.dev.ragproc.rag-ws1.root.ondemandenv.link/status",
    "embedding": "https://eb-api.dev.ragembed.rag-ws1.root.ondemandenv.link/status",
    "vectorStorage": "https://vs-api.dev.ragstore.rag-ws1.root.ondemandenv.link/status"
  }
}
```

## Core Components

### DocumentService
Main service class for document operations:
- Upload document files
- Track processing status
- Handle authentication

### DocumentTracker  
Comprehensive pipeline tracking:
- Monitor document progress across all services
- Real-time status updates
- Error handling and retry logic

### Authentication
Google OAuth integration with Cognito:
- Secure JWT token management
- Automatic token refresh
- Protected API calls

## API Documentation

See [API_ENDPOINTS.md](./docs/API_ENDPOINTS.md) for detailed endpoint documentation.

## VNC Remote Development

This project is optimized for VNC remote development environments with **centralized, type-safe configuration**.

### 🎯 Test Configuration Architecture
- **Single Source of Truth**: `./tests/config/browser-positioning.ts` (TEST SCOPE)
- **Strong TypeScript typing** for all browser positioning settings
- **Validation functions** prevent configuration errors (e.g., window too tall)
- **Preset configurations** for different test use cases (global, test-specific, custom)

### VNC Browser Setup
For proper browser positioning in VNC (title bar visibility):
- **VNC Server**: TigerVNC at 192.168.2.148:5901
- **Display Resolution**: 2560x1440
- **Global Position**: (200,100) - Main Playwright configuration
- **Test Position**: (250,120) - Test-specific positioning to avoid overlap  
- **Window Size**: 1280x800 (height ≤ 800 for title bar visibility)
- **Positioning Solution**: See `VNC_BROWSER_SETUP.md` for complete solution & failed approaches
- **Key**: Use `--window-position=X,Y` + `--user-position` + `--geometry=WxH+X+Y` together

### Playwright in VNC
Playwright tests are configured to work in VNC with proper browser positioning:
```bash
DISPLAY=:1 XAUTHORITY=~/.Xauthority npx playwright test --headed
```

## Testing

### E2E Pipeline Testing

The WebUI includes end-to-end tests that validate the complete RAG pipeline from upload to vector storage.

#### One-Time Setup (Save Authentication)
```bash
# Launch Chrome with OAuth support and save credentials
./launch-chrome-oauth.sh
```
1. Connect to VNC at 192.168.2.148:5901
2. Complete Google OAuth in the opened Chrome browser
3. Close Chrome to save credentials in `./test-usr`

#### Running Tests
```bash
# Run the full pipeline validation test (VNC environment)
DISPLAY=:1 XAUTHORITY=~/.Xauthority npx playwright test automated-upload-test.spec.ts
```

The test assumes saved authentication and will **FAIL** if credentials are missing or expired.

#### What's Tested
- ✅ Document upload and validation
- ✅ RAG pipeline processing across all services
- ✅ Real-time status tracking
- ✅ Error handling and retries
- ✅ Complete end-to-end workflow

See [TESTING_SUMMARY.md](./TESTING_SUMMARY.md) for complete testing guide.

## Development Workflow

1. **Setup**: Install dependencies and configure environment
2. **Development**: Use `npm run dev` for hot-reload development
3. **Testing**: Run unit tests and integration tests
4. **Build**: Create production build
5. **Deploy**: CDK handles deployment and configuration generation

## Troubleshooting

### Common Issues
- **Configuration not loading**: Check `/config.json` exists and is valid
- **Authentication failures**: Verify Google OAuth configuration
- **Service endpoints unreachable**: Confirm all RAG services are deployed

### Debug Mode
Set `DEBUG=true` in environment for verbose logging.

## Contributing

1. Follow TypeScript best practices
2. Add tests for new features
3. Update documentation
4. Ensure proper error handling 