// Jest setup for Lambda function testing
process.env.AWS_REGION = 'us-east-1';
process.env.DOCUMENT_BUCKET = 'test-documents-bucket';
process.env.QUARANTINE_BUCKET = 'test-quarantine-bucket';
process.env.EVENT_BUS_NAME = 'test-event-bus';
process.env.EVENT_SOURCE = 'rag.document-ingestion.test';
process.env.IDENTITY_POOL_ID = 'us-east-1:test-identity-pool-id';
process.env.COGNITO_CLIENT_ID = 'test-client-id';
process.env.COGNITO_PROVIDER_NAME = 'test-provider';

// Mock AWS SDK clients for testing
jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/client-cognito-identity');
jest.mock('@aws-sdk/client-eventbridge');
jest.mock('@aws-sdk/s3-request-presigner'); 