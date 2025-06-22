# RAG Document Ingestion Service

A serverless AWS CDK service for secure document ingestion in a Retrieval-Augmented Generation (RAG) system, built on the OndemandEnv platform. In the **hybrid architecture**, documents flow through the processing pipeline to ultimately be stored as vectors in a cost-effective home vector server, providing 85% overall cost savings while maintaining enterprise security.

## 🏗️ Architecture Overview

![Architecture Diagram](https://mermaid.live/view/graph%20TB%0A%20%20%20%20subgraph%20%22Client%20Layer%22%0A%20%20%20%20%20%20%20%20WEB%5B%22Web%20Application%22%5D%0A%20%20%20%20%20%20%20%20MOB%5B%22Mobile%20App%22%5D%0A%20%20%20%20%20%20%20%20API_CLIENT%5B%22API%20Client%22%5D%0A%20%20%20%20end%0A%0A%20%20%20%20subgraph%20%22Authentication%20Layer%22%0A%20%20%20%20%20%20%20%20COGNITO_UP%5B%22Cognito%20User%20Pool%3Cbr%2F%3E%28User%20Auth%20Service%29%22%5D%0A%20%20%20%20%20%20%20%20COGNITO_IP%5B%22Cognito%20Identity%20Pool%3Cbr%2F%3E%28Auth%20Stack%29%22%5D%0A%20%20%20%20%20%20%20%20IAM_ROLE%5B%22Upload%20IAM%20Role%3Cbr%2F%3E%28odmd-rag-uploader%20group%29%22%5D%0A%20%20%20%20end%0A%0A%20%20%20%20subgraph%20%22API%20Gateway%20Layer%22%0A%20%20%20%20%20%20%20%20HTTP_API%5B%22HTTP%20API%20Gateway%3Cbr%2F%3E%28IAM%20Auth%29%22%5D%0A%20%20%20%20%20%20%20%20IAM_AUTH%5B%22HttpIamAuthorizer%22%5D%0A%20%20%20%20end%0A%0A%20%20%20%20subgraph%20%22Lambda%20Functions%22%0A%20%20%20%20%20%20%20%20UPLOAD_LAMBDA%5B%22Upload%20URL%20Handler%3Cbr%2F%3E%28Pre-signed%20URLs%29%22%5D%0A%20%20%20%20%20%20%20%20STATUS_LAMBDA%5B%22Status%20Handler%3Cbr%2F%3E%28Document%20Status%29%22%5D%0A%20%20%20%20%20%20%20%20VALIDATION_LAMBDA%5B%22Validation%20Handler%3Cbr%2F%3E%28Document%20Processing%29%22%5D%0A%20%20%20%20end%0A%0A%20%20%20%20subgraph%20%22Storage%20Layer%22%0A%20%20%20%20%20%20%20%20S3_DOCS%5B%22Document%20Bucket%3Cbr%2F%3E%28rag-documents%29%22%5D%0A%20%20%20%20%20%20%20%20S3_QUAR%5B%22Quarantine%20Bucket%3Cbr%2F%3E%28rag-quarantine%29%22%5D%0A%20%20%20%20end%0A%0A%20%20%20%20subgraph%20%22Event%20Layer%22%0A%20%20%20%20%20%20%20%20EVENT_BUS%5B%22EventBridge%20Bus%3Cbr%2F%3E%28Document%20Events%29%22%5D%0A%20%20%20%20end%0A%0A%20%20%20%20subgraph%20%22Downstream%20Services%22%0A%20%20%20%20%20%20%20%20DOC_PROC%5B%22Document%20Processing%3Cbr%2F%3EService%22%5D%0A%20%20%20%20%20%20%20%20EMBED%5B%22Embedding%3Cbr%2F%3EService%22%5D%0A%20%20%20%20%20%20%20%20VECTOR%5B%22Vector%20Storage%3Cbr%2F%3EService%22%5D%0A%20%20%20%20end)

This service is part of a 6-service **hybrid RAG architecture**:
1. **Document Ingestion** (this service) - Secure document upload and validation
2. Document Processing - Extract and process document content  
3. Embedding - Generate vector embeddings via AWS Bedrock
4. **Vector Storage** - **Secure proxy to home vector server** (98% cost savings)
5. **Knowledge Retrieval** - Smart proxy with query enhancement and context ranking
6. Generation - Generate responses using retrieved context via AWS Bedrock

### Service Components

The Document Ingestion Service consists of two CDK stacks:

#### 1. Main Stack (`RagDocumentIngestionStack`)
- **S3 Buckets**: Document storage and quarantine
- **Lambda Functions**: Validation, upload URL generation, status checking
- **HTTP API Gateway**: RESTful endpoints with IAM authentication
- **EventBridge**: Event-driven document processing workflow

#### 2. Authentication Stack (`RagDocumentIngestionAuthStack`) 
- **Cognito Identity Pool**: Federated authentication
- **IAM Roles**: Upload permissions with group-based access control
- **IAM Policies**: API access management

## 🔐 Authentication & Authorization Flow

### 1. Identity Federation
```
User Auth Service → Cognito Identity Pool → IAM Role Assumption
```

- Users authenticate with central user auth service (via contracts)
- Cognito Identity Pool federates with the user auth provider
- Only users in `odmd-rag-uploader` Cognito group can assume upload role

### 2. API Gateway Authentication
```
Client Request → HTTP API Gateway → IAM Authorization → Lambda Function
```

- All API endpoints require IAM authentication using `HttpIamAuthorizer`
- Clients must sign requests with AWS credentials obtained from Cognito Identity Pool
- API Gateway validates IAM credentials before forwarding to Lambda functions

### 3. S3 Access Control
- Upload role grants `s3:PutObject`, `s3:PutObjectAcl`, `s3:GetObject` to document bucket
- API access policy allows `execute-api:Invoke` for HTTP API Gateway
- Lambda functions use execution roles (not upload role) for internal operations

## 📡 API Endpoints

### POST /upload
Generates pre-signed URLs for secure document upload.

**Authentication**: IAM (via Cognito Identity Pool)

**Request**:
```json
{
  "fileName": "document.pdf",
  "contentType": "application/pdf"
}
```

**Response**:
```json
{
  "uploadUrl": "https://s3.amazonaws.com/...",
  "documentId": "uuid-v4",
  "expiresIn": 3600
}
```

### GET /status/{documentId}
Retrieves document processing status.

**Authentication**: IAM (via Cognito Identity Pool)

**Response**:
```json
{
  "documentId": "uuid-v4",
  "status": "processing|completed|failed|quarantined",
  "uploadedAt": "2024-01-15T10:30:00Z",
  "processedAt": "2024-01-15T10:31:00Z",
  "errorMessage": "Validation failed: unsupported file type"
}
```

## 🔧 Build Process

### Build Script Focus
The `scripts/build.sh` is intentionally minimal and only handles:
- **Lambda Dependencies**: Installs runtime dependencies for Lambda functions
- **Dependency Isolation**: Places dependencies in `lib/handlers/node_modules/`

The OndemandEnv platform handles all other build operations:
- CDK dependency management
- TypeScript compilation 
- Linting and testing
- CDK synthesis
- Stack deployment
- Environment configuration

### Lambda Runtime Dependencies
The build script installs these specific packages:
- `@aws-sdk/client-s3` - S3 operations
- `@aws-sdk/s3-request-presigner` - Pre-signed URLs
- `@aws-sdk/client-cognito-identity` - Authentication
- `@aws-sdk/client-eventbridge` - Event publishing
- `mime-types` - MIME type detection

## 🚀 Deployment

### Prerequisites
- AWS CLI configured
- Node.js 18+ and npm
- OndemandEnv platform access
- Service contracts configured

### Deploy
```bash
# Install Lambda dependencies only (handled by build script)
bash scripts/build.sh

# CDK synthesis and deployment are handled by OndemandEnv platform
# The platform will automatically:
# - Install CDK dependencies
# - Run TypeScript compilation
# - Execute CDK synthesis
# - Deploy stacks to target environment
```

### Environment Variables
The service automatically configures through OndemandEnv contracts:
- `authProviderClientId`: Cognito client ID from user auth service
- `authProviderName`: Cognito provider name from user auth service

## 🔄 Document Processing Workflow

1. **Upload Request**: Client calls `/upload` endpoint with document metadata
2. **Pre-signed URL**: Service generates secure S3 upload URL
3. **Direct Upload**: Client uploads file directly to S3 using pre-signed URL
4. **Validation Trigger**: S3 event triggers validation Lambda function
5. **Document Validation**: Lambda validates file type, size, content
6. **Quarantine**: Invalid documents moved to quarantine bucket
7. **Event Publication**: Valid documents trigger processing events via EventBridge
8. **Status Tracking**: Client can check processing status via `/status` endpoint

## 🏗️ OndemandEnv Integration

### Contract-Driven Development
- Uses `@odmd-rag/contracts-lib-rag` for service contracts
- Enables cross-service value sharing via AWS SSM Parameter Store
- Provides loose coupling between microservices

### Cross-Service Dependencies
```typescript
// Consumes auth provider details from user auth service
const clientId = myEnver.authProviderClientId.getSharedValue(this);
const providerName = myEnver.authProviderName.getSharedValue(this);
```

### Environment Isolation
- Automatic stack naming with environment prefixes
- Account/region-specific resource naming
- Isolated deployments across environments

## 📊 Monitoring & Observability

### CloudWatch Metrics
- Lambda function invocations, duration, errors
- API Gateway request count, latency, 4xx/5xx errors
- S3 bucket object count, storage usage

### EventBridge Events
Published events for document lifecycle:
```json
{
  "source": "rag.document-ingestion",
  "detail-type": "Document Validated",
  "detail": {
    "documentId": "uuid-v4",
    "bucketName": "rag-documents-account-region",
    "objectKey": "documents/uuid-v4.pdf",
    "contentType": "application/pdf",
    "fileSize": 1024000,
    "validatedAt": "2024-01-15T10:31:00Z"
  }
}
```

## 🛡️ Security Features

### Network Security
- VPC isolation (if configured)
- S3 bucket policies restricting access
- API Gateway with IAM authentication only

### Data Protection
- S3 bucket versioning enabled
- Quarantine bucket for suspicious files
- Pre-signed URLs with expiration (1 hour)
- IAM least-privilege access principles

### Compliance
- CloudTrail logging for all API calls
- S3 access logging
- Lambda function logs in CloudWatch

## 🧪 Local Development

### Lambda Handlers Development
The `lib/handlers/` directory is a standalone TypeScript project for Lambda function development:

```bash
# Install handler dependencies and setup development environment
bash scripts/build.sh

# Navigate to handlers directory
cd lib/handlers

# Build handlers
npm run build

# Watch for changes during development
npm run dev:watch

# Run tests
npm test

# Run linting
npm run lint
```

### Handler Project Structure
```
lib/handlers/
├── package.json          # Handler-specific dependencies
├── tsconfig.json         # TypeScript configuration
├── jest.config.js        # Test configuration
├── .eslintrc.js         # Linting rules
├── dist/                # Compiled JavaScript output
├── node_modules/        # Handler dependencies
├── upload-url-handler.ts    # Pre-signed URL generation
├── status-handler.ts        # Document status checking
└── validation-handler.ts    # Document validation
```

### Debugging Lambda Functions
```bash
# Compile handlers for debugging
cd lib/handlers
npm run build

# The compiled JavaScript files in dist/ can be debugged with:
# - VS Code debugger
# - Node.js inspector
# - AWS SAM Local
# - LocalStack
```

## 📈 Scaling Considerations

### Performance
- Lambda concurrency limits configured per function
- S3 transfer acceleration for global uploads
- API Gateway caching for status endpoints

### Cost Optimization
- S3 Intelligent Tiering for document storage
- Lambda provisioned concurrency for hot paths
- CloudWatch log retention policies

## 🔧 Configuration

### Environment-Specific Settings
Configure via CDK context or environment variables:

```json
{
  "documentRetentionDays": 90,
  "maxFileSize": "100MB",
  "allowedFileTypes": ["pdf", "docx", "doc", "pptx", "ppt", "xlsx", "xls", "txt", "md", "csv", "json", "xml", "html", "rtf", "odt", "odp", "ods", "pages", "numbers", "key"],
  "validationTimeout": 300
}
```

### Feature Flags
- `enableQuarantine`: Route invalid documents to quarantine bucket
- `enableVirusScanning`: Integrate with antivirus scanning service
- `enableContentExtraction`: Extract text content during validation

## 📚 Related Services

This service integrates with:
- **User Auth Service**: Provides Cognito federation details
- **Document Processing Service**: Consumes document validation events
- **Embedding Service**: Processes validated documents
- **Vector Storage Service**: Stores document embeddings
- **Knowledge Retrieval Service**: Searches document content
- **Generation Service**: Uses retrieved documents for responses

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.  