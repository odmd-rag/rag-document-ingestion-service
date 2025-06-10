import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

const DOCUMENT_BUCKET = process.env.DOCUMENT_BUCKET!;

interface UploadRequest {
    fileName: string;
    fileType: string;
    fileSize: number;
    userId?: string;
}

// Supported file types for document ingestion
const SUPPORTED_MIME_TYPES = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
    'application/msword', // doc
    'text/plain',
    'text/html',
    'text/markdown',
    'text/csv',
    'application/json'
];

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

/**
 * Extracts user identity from API Gateway request context
 */
function getUserIdentityFromContext(event: APIGatewayProxyEvent): string {
    // Try different possible locations for user identity in the request context
    const userIdentity = 
        event.requestContext.authorizer?.claims?.sub ||  // Cognito User Pool sub claim
        event.requestContext.authorizer?.principalId ||   // Custom authorizer
        event.requestContext.identity?.cognitoIdentityId ||  // Cognito Identity Pool
        event.requestContext.authorizer?.sub ||           // Alternative location for sub
        event.requestContext.identity?.userArn?.split('/').pop(); // IAM user

    if (!userIdentity) {
        throw new Error('User identity not found in request context');
    }

    return userIdentity;
}

/**
 * Validates the upload request parameters
 */
function validateUploadRequest(body: any): UploadRequest {
    const { fileName, fileType, fileSize, userId } = body;

    if (!fileName || typeof fileName !== 'string') {
        throw new Error('fileName is required and must be a string');
    }

    if (!fileType || typeof fileType !== 'string') {
        throw new Error('fileType is required and must be a string');
    }

    if (!fileSize || typeof fileSize !== 'number' || fileSize <= 0) {
        throw new Error('fileSize is required and must be a positive number');
    }

    if (fileSize > MAX_FILE_SIZE) {
        throw new Error(`File size exceeds maximum allowed size of ${MAX_FILE_SIZE / 1024 / 1024}MB`);
    }

    if (!SUPPORTED_MIME_TYPES.includes(fileType)) {
        throw new Error(`Unsupported file type: ${fileType}. Supported types: ${SUPPORTED_MIME_TYPES.join(', ')}`);
    }

    // Validate fileName doesn't contain path traversal or dangerous characters
    if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
        throw new Error('Invalid fileName: cannot contain path separators or relative path indicators');
    }

    return { fileName, fileType, fileSize, userId };
}

/**
 * Generates a pre-signed URL for uploading documents to S3
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    console.log('Upload URL request:', JSON.stringify(event, null, 2));

    try {
        // Extract user identity from API Gateway request context
        let userIdentityId: string;
        try {
            userIdentityId = getUserIdentityFromContext(event);
        } catch (error) {
            return {
                statusCode: 401,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
                },
                body: JSON.stringify({
                    error: 'Authentication failed',
                    message: error instanceof Error ? error.message : 'User identity not found'
                })
            };
        }

        // Parse and validate request body
        if (!event.body) {
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
                body: JSON.stringify({
                    error: 'Bad Request',
                    message: 'Request body is required'
                })
            };
        }

        let uploadRequest: UploadRequest;
        try {
            const body = JSON.parse(event.body);
            uploadRequest = validateUploadRequest(body);
        } catch (error) {
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
                body: JSON.stringify({
                    error: 'Bad Request',
                    message: error instanceof Error ? error.message : 'Invalid request body'
                })
            };
        }

        // Generate unique object key with user identity and timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const uniqueId = Math.random().toString(36).substring(2, 15);
        const sanitizedFileName = uploadRequest.fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
        const objectKey = `uploads/${userIdentityId}/${timestamp}-${uniqueId}-${sanitizedFileName}`;

        // Create the S3 PutObject command
        const putObjectParams = {
            Bucket: DOCUMENT_BUCKET,
            Key: objectKey,
            ContentType: uploadRequest.fileType,
            ContentLength: uploadRequest.fileSize,
            Metadata: {
                'original-filename': uploadRequest.fileName,
                'user-identity-id': userIdentityId,
                'upload-timestamp': timestamp,
                'file-size': uploadRequest.fileSize.toString()
            },
            // Add server-side encryption
            ServerSideEncryption: 'AES256' as const,
        };

        const command = new PutObjectCommand(putObjectParams);

        // Generate pre-signed URL (valid for 15 minutes)
        const presignedUrl = await getSignedUrl(s3Client as any, command as any, {
            expiresIn: 900, // 15 minutes
        });

        // Return the pre-signed URL and metadata
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
            },
            body: JSON.stringify({
                uploadUrl: presignedUrl,
                objectKey,
                expiresIn: 900,
                uploadId: uniqueId,
                userIdentityId,
                instructions: {
                    method: 'PUT',
                    headers: {
                        'Content-Type': uploadRequest.fileType,
                        'Content-Length': uploadRequest.fileSize.toString()
                    }
                }
            })
        };

    } catch (error) {
        console.error('Error generating pre-signed URL:', error);

        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify({
                error: 'Internal Server Error',
                message: 'Failed to generate upload URL',
                requestId: event.requestContext?.requestId
            })
        };
    }
}; 