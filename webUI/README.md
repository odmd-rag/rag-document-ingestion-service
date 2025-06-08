# RAG Document Ingestion Web Client

A modern web client for the RAG Document Ingestion Service, built with Vite, TypeScript, and AWS SDK. This application provides a beautiful interface for users to sign in with Google and upload documents to the RAG system.

## Features

- 🔐 **Google OAuth Authentication** - Secure sign-in with Google accounts
- 🔗 **AWS Cognito Integration** - Federated authentication with Cognito Identity Pool
- 📄 **Document Upload** - Drag-and-drop or click-to-upload interface
- 📊 **Real-time Status Tracking** - Monitor document processing status
- 🎨 **Modern UI** - Beautiful, responsive design with glassmorphism effects
- ⚡ **Fast & Lightweight** - Built with Vite for optimal performance

## Prerequisites

Before running this application, ensure you have:

1. **Deployed RAG Infrastructure** - The main RAG document ingestion service and auth stack must be deployed
2. **Google OAuth Setup** - A Google OAuth client configured for your domain
3. **Node.js** - Version 18 or higher

## Configuration

### 1. Update AWS Configuration

Edit `src/config.ts` with your deployed AWS resources:

```typescript
export const config = {
  aws: {
    region: 'us-east-1', // Your AWS region
    identityPoolId: 'us-east-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', // From CDK output
    apiEndpoint: 'https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com', // From CDK output
  },
  google: {
    clientId: 'your-google-oauth-client-id.apps.googleusercontent.com', // From Google Console
  },
  cognito: {
    userPoolId: 'us-east-1_xxxxxxxxx', // From auth service contracts
    providerName: 'cognito-idp.us-east-1.amazonaws.com/us-east-1_xxxxxxxxx', // From auth service contracts
  }
};
```

### 2. Get Configuration Values

#### AWS Values (from CDK deployment):
```bash
# Get Identity Pool ID
aws cloudformation describe-stacks --stack-name <your-auth-stack-name> --query "Stacks[0].Outputs[?OutputKey=='IdentityPoolId'].OutputValue" --output text

# Get API Endpoint
aws cloudformation describe-stacks --stack-name <your-main-stack-name> --query "Stacks[0].Outputs[?OutputKey=='ApiEndpoint'].OutputValue" --output text
```

#### Google OAuth Setup:
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable Google+ API
4. Create OAuth 2.0 credentials
5. Add your domain to authorized origins
6. Copy the Client ID

### 3. Cognito User Pool Configuration

The `userPoolId` and `providerName` should come from your auth service contracts via the `getSharedValue()` mechanism. These are automatically wired when the auth service is deployed.

## Installation & Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Usage

### 1. Authentication
- Click "Sign in with Google" on the login screen
- Authorize the application with your Google account
- The app will automatically exchange the Google token for AWS credentials via Cognito Identity Pool

### 2. Document Upload
- Once authenticated, use the upload area to select documents
- Supported formats: PDF, TXT, DOC, DOCX, MD
- Documents are uploaded directly to S3 using presigned URLs
- Upload progress and status are displayed in real-time

### 3. Status Monitoring
- View all uploaded documents in the "Uploaded Documents" section
- Status updates automatically via polling:
  - 📄 **Uploaded** - Document successfully uploaded to S3
  - ⏳ **Processing** - Document is being validated
  - ✅ **Validated** - Document passed validation and is ready for RAG processing
  - ⚠️ **Quarantined** - Document failed validation and was moved to quarantine
  - ❌ **Failed** - Upload or processing failed

## Architecture

### Authentication Flow
1. User signs in with Google OAuth
2. Google JWT token is exchanged for Cognito Identity Pool credentials
3. Cognito credentials are used to sign AWS API requests
4. API Gateway validates the signed requests using IAM authorization

### Upload Flow
1. Client requests presigned upload URL from API Gateway
2. API Gateway Lambda generates S3 presigned POST URL
3. Client uploads file directly to S3 using presigned URL
4. S3 triggers validation Lambda on object creation
5. Validation results are published to EventBridge for downstream processing

### Security
- All API requests are signed using AWS Signature V4
- Users must be in the "odmd-rag-uploader" Cognito group to access upload functionality
- Files are uploaded directly to S3 without passing through API Gateway
- Presigned URLs have limited validity and scope

## Troubleshooting

### Common Issues

1. **"Configuration Required" warning**
   - Update `src/config.ts` with your actual AWS resource values
   - Ensure all CDK stacks are deployed successfully

2. **Google Sign-in not working**
   - Verify Google OAuth client ID is correct
   - Check that your domain is added to authorized origins in Google Console
   - Ensure the Google Identity Services script loads correctly

3. **Upload fails with authentication error**
   - Verify user is in the "odmd-rag-uploader" Cognito group
   - Check that Cognito Identity Pool is configured correctly
   - Ensure API Gateway has proper IAM authorization setup

4. **Status polling not working**
   - Verify API Gateway endpoint is correct
   - Check that status Lambda function is deployed and has proper permissions
   - Ensure CORS is configured correctly on API Gateway

### Debug Mode

Enable debug logging by opening browser developer tools and setting:
```javascript
localStorage.setItem('debug', 'true');
```

## Development

### Project Structure
```
webUI/
├── src/
│   ├── app.ts          # Main application class
│   ├── auth.ts         # Authentication service
│   ├── documentService.ts # Document upload service
│   ├── config.ts       # Configuration
│   ├── main.ts         # Application entry point
│   └── style.css       # Styles
├── index.html          # HTML template
└── package.json        # Dependencies
```

### Adding Features

To add new features:
1. Create new service classes in `src/`
2. Update the main `App` class to integrate new functionality
3. Add corresponding UI elements and styles
4. Update this README with new configuration requirements

## License

This project is part of the OndemandEnv RAG system and follows the same licensing terms. 