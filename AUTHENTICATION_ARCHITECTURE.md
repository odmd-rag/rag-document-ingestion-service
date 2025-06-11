# RAG Document Ingestion - Authentication Architecture

## Overview

The RAG Document Ingestion service uses **federated authentication** through the OndemandEnv user-auth service, following the established pattern for cross-service authentication in the ODMD ecosystem.

## Authentication Flow

### 1. User Authentication (via user-auth service)
```
User → RAG WebUI → user-auth service → Google OAuth → Cognito User Pool (user-auth) → ID Token
```

### 2. AWS Credential Exchange (via RAG Identity Pool)
```
ID Token → RAG Identity Pool → AWS Credentials → API Gateway (IAM Auth)
```

## Architecture Components

### User-Auth Service (Provider)
- **Cognito User Pool**: Manages user identities and Google OAuth integration
- **Hosted UI**: Provides OAuth flow for Google sign-in
- **User Groups**: Manages group membership (e.g., "odmd-rag-uploader")
- **ID Tokens**: Issues JWT tokens with user info and group claims

### RAG Service (Consumer)
- **Cognito Identity Pool**: Exchanges federated tokens for AWS credentials
- **IAM Role**: `DocumentUploadRole` with S3 and API Gateway permissions
- **Role Mapping**: Maps "odmd-rag-uploader" group to upload role
- **API Gateway**: Uses IAM authentication with AWS Signature V4

## Configuration Structure

### Web App Configuration (`config.json`)
```json
{
  "aws": {
    "region": "us-east-1",
    "identityPoolId": "us-east-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "apiEndpoint": "https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com"
  },
  "cognito": {
    "userPoolId": "client-id-from-user-auth-service",
    "providerName": "cognito-idp.us-east-1.amazonaws.com/us-east-1_xxxxxxxxx"
  },
  "deployment": {
    "timestamp": "2024-01-01T00:00:00.000Z",
    "version": "1.0.0",
    "webDomain": "rag-docs.example.com"
  }
}
```

### Contract Wiring
The RAG service receives authentication configuration through OndemandEnv contracts:
- `authProviderClientId`: Client ID from user-auth service
- `authProviderName`: Provider name in format `cognito-idp.{region}.amazonaws.com/{userPoolId}`

## Authentication Process

### Step 1: Initiate Authentication
1. User clicks "Sign in with Google" in RAG WebUI
2. WebUI redirects to user-auth service hosted UI
3. User authenticates with Google via user-auth service
4. User-auth service returns authorization code to RAG WebUI

### Step 2: Token Exchange
1. RAG WebUI exchanges authorization code for ID token
2. ID token contains user info and group membership
3. WebUI validates user has "odmd-rag-uploader" group membership

### Step 3: AWS Credential Exchange
1. WebUI uses Cognito Identity Pool to exchange ID token for AWS credentials
2. Identity Pool validates token against user-auth service provider
3. Role mapping assigns `DocumentUploadRole` based on group membership
4. AWS credentials are returned for API access

### Step 4: API Access
1. WebUI uses AWS credentials to sign API requests (Signature V4)
2. API Gateway validates IAM authentication
3. Lambda functions process authenticated requests

## Security Features

### Group-Based Access Control
- Users must be in "odmd-rag-uploader" group to upload documents
- Group membership is managed in user-auth service
- Role mapping enforced at Identity Pool level

### Token Security
- ID tokens stored in localStorage with automatic refresh
- AWS credentials refreshed every 20 minutes
- Secure logout clears all stored tokens

### API Security
- All API requests signed with AWS Signature V4
- IAM policies restrict access to specific S3 buckets and API endpoints
- No direct S3 access - all uploads via presigned URLs

## Error Handling

### Authentication Errors
- **Invalid Group**: User not in "odmd-rag-uploader" group
- **Token Expired**: Automatic refresh or re-authentication required
- **Invalid Provider**: Configuration error with user-auth service

### API Errors
- **Credential Expired**: Automatic credential refresh
- **Access Denied**: IAM policy or role mapping issue
- **Network Error**: Retry mechanism with exponential backoff

## Development vs Production

### Development (localhost:5173)
- Redirects to localhost for OAuth callback
- Uses development configuration
- Same authentication flow as production

### Production (rag-docs.{domain})
- Redirects to production domain
- Uses deployed configuration from S3
- SSL/TLS encryption for all communication

## Troubleshooting

### Common Issues

1. **"Access denied: You must be a member of the odmd-rag-uploader group"**
   - User needs to be added to the group in user-auth service
   - Contact administrator to add user to group

2. **"Authentication failed: NotAuthorizedException"**
   - Identity Pool role mapping issue
   - Check that role mapping includes "odmd-rag-uploader" group

3. **"Failed to exchange code for tokens"**
   - OAuth configuration issue
   - Verify redirect URIs in user-auth service

4. **API requests failing with 403**
   - AWS credentials not properly obtained
   - Check Identity Pool configuration and role policies

### Debugging Steps

1. **Check Browser Console**: Look for authentication errors
2. **Verify Configuration**: Ensure config.json has correct values
3. **Test Token Exchange**: Check if ID token contains expected groups
4. **Validate Credentials**: Ensure AWS credentials are being obtained
5. **Check Role Policies**: Verify IAM role has necessary permissions

## Comparison with user-auth1

The RAG service follows the same pattern as other OndemandEnv services:

| Component | user-auth1 | RAG Service |
|-----------|------------|-------------|
| **Authentication** | Own User Pool | Federated via user-auth |
| **Identity Pool** | Own Identity Pool | Own Identity Pool |
| **Web App** | Direct User Pool auth | Federated auth flow |
| **API Access** | AWS credentials via Identity Pool | AWS credentials via Identity Pool |
| **Group Management** | Own groups | Groups from user-auth |

This federated approach provides:
- **Centralized User Management**: All users managed in user-auth service
- **Consistent Authentication**: Same login experience across services
- **Simplified Administration**: Single place to manage user access
- **Security**: Leverages proven authentication patterns

## Future Enhancements

1. **Multi-Region Support**: Deploy Identity Pools in multiple regions
2. **Advanced Role Mapping**: More granular permissions based on user attributes
3. **Audit Logging**: Track authentication and authorization events
4. **Session Management**: Advanced session timeout and refresh policies 