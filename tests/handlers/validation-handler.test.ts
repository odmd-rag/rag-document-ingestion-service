import { S3Event, Context } from 'aws-lambda';
import { handler } from '../../lib/handlers/src/validation-handler';

jest.mock('@aws-sdk/client-s3');

describe('Validation Handler', () => {
    const mockContext: Context = {
        callbackWaitsForEmptyEventLoop: false,
        functionName: 'test-function',
        functionVersion: '1',
        invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
        memoryLimitInMB: '512',
        awsRequestId: 'test-request-id',
        logGroupName: '/aws/lambda/test-function',
        logStreamName: '2023/01/01/[$LATEST]test-stream',
        getRemainingTimeInMillis: () => 30000,
        done: jest.fn(),
        fail: jest.fn(),
        succeed: jest.fn()
    };

    beforeEach(() => {
        process.env.DOCUMENT_BUCKET = 'test-document-bucket';
        process.env.QUARANTINE_BUCKET = 'test-quarantine-bucket';
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should process S3 event successfully', async () => {
        const s3Event: S3Event = {
            Records: [
                {
                    eventVersion: '2.1',
                    eventSource: 'aws:s3',
                    awsRegion: 'us-east-1',
                    eventTime: '2023-01-01T00:00:00.000Z',
                    eventName: 's3:ObjectCreated:Put',
                    userIdentity: {
                        principalId: 'test-principal'
                    },
                    requestParameters: {
                        sourceIPAddress: '127.0.0.1'
                    },
                    responseElements: {
                        'x-amz-request-id': 'test-request-id',
                        'x-amz-id-2': 'test-id-2'
                    },
                    s3: {
                        s3SchemaVersion: '1.0',
                        configurationId: 'test-config',
                        bucket: {
                            name: 'test-bucket',
                            ownerIdentity: {
                                principalId: 'test-principal'
                            },
                            arn: 'arn:aws:s3:::test-bucket'
                        },
                        object: {
                            key: 'test-document.pdf',
                            size: 1024,
                            eTag: 'test-etag',
                            sequencer: 'test-sequencer'
                        }
                    }
                }
            ]
        };

        const mockS3Response = {
            ContentType: 'application/pdf',
            ContentLength: 1024,
            LastModified: new Date(),
            Body: 'mock-body'
        };

        const { S3Client } = require('@aws-sdk/client-s3');

        S3Client.prototype.send = jest.fn().mockResolvedValue(mockS3Response);

        await expect(handler(s3Event, mockContext)).resolves.toBeUndefined();
    });

    it('should handle invalid file types', async () => {
        const s3Event: S3Event = {
            Records: [
                {
                    eventVersion: '2.1',
                    eventSource: 'aws:s3',
                    awsRegion: 'us-east-1',
                    eventTime: '2023-01-01T00:00:00.000Z',
                    eventName: 's3:ObjectCreated:Put',
                    userIdentity: {
                        principalId: 'test-principal'
                    },
                    requestParameters: {
                        sourceIPAddress: '127.0.0.1'
                    },
                    responseElements: {
                        'x-amz-request-id': 'test-request-id',
                        'x-amz-id-2': 'test-id-2'
                    },
                    s3: {
                        s3SchemaVersion: '1.0',
                        configurationId: 'test-config',
                        bucket: {
                            name: 'test-bucket',
                            ownerIdentity: {
                                principalId: 'test-principal'
                            },
                            arn: 'arn:aws:s3:::test-bucket'
                        },
                        object: {
                            key: 'test-executable.exe',
                            size: 1024,
                            eTag: 'test-etag',
                            sequencer: 'test-sequencer'
                        }
                    }
                }
            ]
        };

        const mockS3Response = {
            ContentType: 'application/octet-stream',
            ContentLength: 1024,
            LastModified: new Date(),
            Body: 'mock-body'
        };

        const { S3Client } = require('@aws-sdk/client-s3');
        S3Client.prototype.send = jest.fn().mockResolvedValue(mockS3Response);

        await expect(handler(s3Event, mockContext)).resolves.toBeUndefined();
    });
}); 