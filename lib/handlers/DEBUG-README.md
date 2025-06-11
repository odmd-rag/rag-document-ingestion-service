# Lambda Debug Files Guide

This directory contains comprehensive debug scripts for locally testing Lambda handlers with enhanced logging.

## Debug Files Overview

### RAG Document Ingestion Service Handlers

1. **debug-local-validation.ts** - Debug script for S3 validation handler
   - Tests document validation, quarantine, and event publishing
   - Uses: `debug-validation-event.json`

2. **debug-local-upload-url.ts** - Debug script for upload URL generation handler  
   - Tests presigned URL generation for document uploads
   - Uses: `debug-upload-url-event.json`

3. **debug-local-status.ts** - Debug script for document status handler
   - Tests document status retrieval and tracking
   - Uses: `debug-status-event.json`

### RAG Document Processing Service Handlers

4. **debug-local-event-processor.ts** - Debug script for EventBridge event processor
   - Tests processing of document validation events and SQS queuing
   - Uses: `debug-event-processor.json`

## Features

All debug scripts include:

- ✅ **AWS Credentials Setup** - Automatic profile-based authentication
- ✅ **STS Identity Verification** - Confirms AWS identity before execution  
- ✅ **Environment Variables Validation** - Checks all required env vars
- ✅ **Enhanced Event Analysis** - Detailed logging of event structure
- ✅ **Execution Timing** - Performance measurement with ms precision
- ✅ **Error Handling** - Comprehensive error logging with stack traces
- ✅ **Response Analysis** - Intelligent parsing of handler responses
- ✅ **Security** - Masks sensitive data in logs (tokens, keys)

## Setup Instructions

### 1. Prerequisites

```bash
# Install dependencies
npm install @aws-sdk/client-sts @aws-sdk/credential-providers

# Ensure AWS profile is configured
aws configure --profile sandbox-central
```

### 2. Configuration

Each debug script requires a corresponding JSON event file with three sections:

```json
{
  "event": {
    // Lambda event payload (S3, API Gateway, EventBridge, etc.)
  },
  "context": {
    // Lambda context object simulation
  },
  "env": {
    // Environment variables required by the handler
  }
}
```

### 3. Environment Variable Setup

Update the `env` section in each JSON file with your actual values:

#### For Validation Handler (debug-validation-event.json):
```json
"env": {
  "QUARANTINE_BUCKET": "your-quarantine-bucket",
  "EVENT_BUS_NAME": "your-eventbus-name", 
  "EVENT_SOURCE": "rag.document.ingestion",
  "SCHEMA_REGISTRY_NAME": "your-schema-registry",
  "AWS_REGION": "us-west-1"
}
```

#### For Upload URL Handler (debug-upload-url-event.json):
```json
"env": {
  "UPLOAD_BUCKET": "your-upload-bucket",
  "USER_POOL_ID": "your-cognito-pool-id",
  "CORS_ORIGIN": "https://your-app-domain.com",
  "AWS_REGION": "us-west-1"
}
```

#### For Status Handler (debug-status-event.json):
```json
"env": {
  "STATUS_TABLE_NAME": "your-dynamodb-table",
  "USER_POOL_ID": "your-cognito-pool-id", 
  "CORS_ORIGIN": "https://your-app-domain.com",
  "AWS_REGION": "us-west-1"
}
```

#### For Event Processor (debug-event-processor.json):
```json
"env": {
  "PROCESSING_QUEUE_URL": "https://sqs.region.amazonaws.com/account/queue-name",
  "PROCESSED_CONTENT_EVENT_BUS": "your-processed-eventbus",
  "AWS_ACCOUNT_ID": "123456789012",
  "AWS_REGION": "us-west-1"
}
```

## Usage

### Running Debug Scripts

```bash
# Navigate to handlers directory
cd rag-document-ingestion-service/lib/handlers

# Run validation handler debug
npx ts-node debug-local-validation.ts

# Run upload URL handler debug  
npx ts-node debug-local-upload-url.ts

# Run status handler debug
npx ts-node debug-local-status.ts

# For processing service
cd rag-document-processing-service/lib/handlers
npx ts-node debug-local-event-processor.ts
```

### Sample Output

```
=== RAG Document Ingestion Service - Validation Handler Debug ===
Loading debug configuration...
Setting environment variables:
  QUARANTINE_BUCKET=rag-quarantine-bucket-dev
  EVENT_BUS_NAME=rag-eventbus-dev
  ...

=== AWS Credentials Setup ===
Region: us-west-1
AWS Credentials loaded:
  Access Key ID: AKIAIOSFOD...
  Secret Access Key: wJalrXUtnF...
  Session Token: N/A

=== STS Identity Verification ===
STS Caller Identity:
  Account: 123456789012
  User ID: AIDACKCEVSQ6C2EXAMPLE
  ARN: arn:aws:iam::123456789012:user/example-user

=== Environment Variables Check ===
  QUARANTINE_BUCKET: rag-quarantine-bucket-dev
  EVENT_BUS_NAME: rag-eventbus-dev
  EVENT_SOURCE: rag.document.ingestion
  SCHEMA_REGISTRY_NAME: rag-schema-registry-dev

=== Event Structure Validation ===
Event type: object
Event records count: 1
  Record 1:
    Event name: ObjectCreated:Put
    Bucket: rag-document-upload-bucket-dev
    Key: documents/test-document.pdf
    Size: 1024000 bytes

=== Starting Validation Handler ===

=== Execution Completed Successfully ===
Execution time: 1245ms
Result: undefined

=== Debug Session Complete ===
Timestamp: 2024-01-15T10:45:00.000Z
```

## Event File Customization

### S3 Events (Validation Handler)
- Modify `Records[0].s3.bucket.name` for different buckets
- Change `Records[0].s3.object.key` for different file paths
- Adjust `Records[0].s3.object.size` for different file sizes

### API Gateway Events (Upload URL, Status Handlers)
- Update `httpMethod` for different HTTP methods
- Modify `pathParameters` for different route parameters
- Change `body` for different request payloads
- Adjust `headers.Authorization` for different auth tokens

### EventBridge Events (Event Processor)
- Modify `detail` section for different document validation events
- Change `source` for different event sources
- Update `detail.documentId`, `detail.bucketName`, etc. for different scenarios

## Troubleshooting

### Common Issues

1. **AWS Credentials Not Found**
   ```
   Error: Could not load credentials from profile sandbox-central
   ```
   **Solution**: Run `aws configure --profile sandbox-central`

2. **Environment Variables Missing**
   ```
   ⚠️  Warning: QUARANTINE_BUCKET is not set!
   ```
   **Solution**: Update the `env` section in your JSON event file

3. **Handler Import Errors**
   ```
   Error: Cannot find module './src/validation-handler'
   ```
   **Solution**: Ensure you're running from the correct directory and handlers exist

4. **TypeScript Compilation Errors**
   ```
   Error: Expected 1 arguments, but got 2
   ```
   **Solution**: Check that your handler signatures match Lambda expectations

### Enable Proxy Support

Uncomment these lines if you need to debug through a proxy:

```typescript
// import {addProxyToClient} from "aws-sdk-v3-proxy";
// process.env.HTTP_PROXY='http://192.168.49.1:8282'
// process.env.HTTPS_PROXY='http://192.168.49.1:8282'
// process.env.NO_PROXY='localhost,127.0.0.1'
```

## Advanced Configuration

### Custom AWS Profiles
Change the profile name in debug scripts:
```typescript
const creds = await fromIni({profile: 'your-profile-name'})()
```

### Different Regions
Update the region in debug scripts:
```typescript
const region = 'us-east-1' // Change as needed
```

### Cross-Account Role Testing
Uncomment and configure the role assumption section:
```typescript
const assumeOut = await sts.send(new AssumeRoleCommand({
    RoleArn: 'arn:aws:iam::TARGET-ACCOUNT:role/ROLE-NAME',
    RoleSessionName: "debugging-" + Date.now()
}));
```

## Security Notes

- Debug files automatically mask sensitive information in logs
- Never commit actual AWS credentials or tokens to version control
- Use appropriate IAM permissions for your debug profile
- Consider using temporary credentials for debugging sessions

## Performance Analysis

Each debug session provides:
- **Execution Time**: Handler execution duration in milliseconds
- **Memory Usage**: Lambda context memory limit information  
- **Remaining Time**: Lambda timeout information
- **AWS Service Calls**: STS verification timing

Use this data to optimize your Lambda functions for production deployment. 