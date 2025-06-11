import {APIGatewayProxyEvent, APIGatewayProxyResult} from 'aws-lambda';
import {S3Client, PutObjectCommand} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';

const s3Client = new S3Client({region: process.env.AWS_REGION || 'us-east-1'});

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
function getUserIdentityFromContext(event: APIGatewayProxyEvent, requestId: string): string {
    console.log(`[${requestId}] Extracting user identity from request context`);

    // Try different possible locations for user identity in the request context
    const userIdentity =
        event.requestContext.authorizer?.claims?.sub ||  // Cognito User Pool sub claim
        event.requestContext.authorizer?.principalId ||   // Custom authorizer
        event.requestContext.identity?.cognitoIdentityId ||  // Cognito Identity Pool
        event.requestContext.authorizer?.sub ||           // Alternative location for sub
        event.requestContext.identity?.userArn?.split('/').pop(); // IAM user

    console.log(`[${requestId}] Available authorization context:`);
    console.log(`[${requestId}]   Authorizer claims sub: ${event.requestContext.authorizer?.claims?.sub || 'N/A'}`);
    console.log(`[${requestId}]   Authorizer principal ID: ${event.requestContext.authorizer?.principalId || 'N/A'}`);
    console.log(`[${requestId}]   Cognito identity ID: ${event.requestContext.identity?.cognitoIdentityId || 'N/A'}`);
    console.log(`[${requestId}]   User ARN: ${event.requestContext.identity?.userArn || 'N/A'}`);

    if (!userIdentity) {
        console.error(`[${requestId}] ❌ User identity not found in any expected location`);
        console.error(`[${requestId}] Full request context:`, JSON.stringify(event.requestContext, null, 2));
        throw new Error('User identity not found in request context');
    }

    console.log(`[${requestId}] ✅ User identity extracted: ${userIdentity}`);
    return userIdentity;
}

/**
 * Validates the upload request parameters
 */
function validateUploadRequest(body: any, requestId: string): UploadRequest {
    console.log(`[${requestId}] Starting upload request validation`);
    console.log(`[${requestId}] Request body:`, JSON.stringify(body, null, 2));

    const {fileName, fileType, fileSize, userId} = body;

    // Validate fileName
    console.log(`[${requestId}] Validating fileName: ${fileName}`);
    if (!fileName || typeof fileName !== 'string') {
        console.error(`[${requestId}] ❌ Invalid fileName: ${fileName} (type: ${typeof fileName})`);
        throw new Error('fileName is required and must be a string');
    }

    // Validate fileType
    console.log(`[${requestId}] Validating fileType: ${fileType}`);
    if (!fileType || typeof fileType !== 'string') {
        console.error(`[${requestId}] ❌ Invalid fileType: ${fileType} (type: ${typeof fileType})`);
        throw new Error('fileType is required and must be a string');
    }

    // Validate fileSize
    console.log(`[${requestId}] Validating fileSize: ${fileSize} bytes (${(fileSize / 1024 / 1024).toFixed(2)}MB)`);
    if (!fileSize || typeof fileSize !== 'number' || fileSize <= 0) {
        console.error(`[${requestId}] ❌ Invalid fileSize: ${fileSize} (type: ${typeof fileSize})`);
        throw new Error('fileSize is required and must be a positive number');
    }

    if (fileSize > MAX_FILE_SIZE) {
        console.error(`[${requestId}] ❌ File size ${fileSize} exceeds maximum ${MAX_FILE_SIZE} (${MAX_FILE_SIZE / 1024 / 1024}MB)`);
        throw new Error(`File size exceeds maximum allowed size of ${MAX_FILE_SIZE / 1024 / 1024}MB`);
    }

    // Validate MIME type
    console.log(`[${requestId}] Checking MIME type: ${fileType}`);
    console.log(`[${requestId}] Supported types: ${SUPPORTED_MIME_TYPES.join(', ')}`);
    if (!SUPPORTED_MIME_TYPES.includes(fileType)) {
        console.error(`[${requestId}] ❌ Unsupported file type: ${fileType}`);
        throw new Error(`Unsupported file type: ${fileType}. Supported types: ${SUPPORTED_MIME_TYPES.join(', ')}`);
    }

    // Validate fileName doesn't contain path traversal or dangerous characters
    console.log(`[${requestId}] Checking fileName for security issues`);
    if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
        console.error(`[${requestId}] ❌ Dangerous fileName detected: ${fileName}`);
        throw new Error('Invalid fileName: cannot contain path separators or relative path indicators');
    }

    console.log(`[${requestId}] ✅ Upload request validation passed`);
    return {fileName, fileType, fileSize, userId};
}

/**
 * Generates a pre-signed URL for uploading documents to S3
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const startTime = Date.now();
    const requestId = event.requestContext.requestId;

    console.log(`[${requestId}] === Upload URL Handler Started ===`);
    console.log(`[${requestId}] HTTP Method: ${event.httpMethod}`);
    console.log(`[${requestId}] Resource: ${event.resource}`);
    console.log(`[${requestId}] Path: ${event.path}`);
    console.log(`[${requestId}] auth: ${JSON.stringify(event.requestContext.authorizer, null, 2)}`);
    // console.log(`[${requestId}] User Agent: ${event.requestContext.identity.userAgent}`);
    console.log(`[${requestId}] Stage: ${event.requestContext.stage}`);

    // Log configuration
    console.log(`[${requestId}] Configuration:`);
    console.log(`[${requestId}]   DOCUMENT_BUCKET: ${DOCUMENT_BUCKET}`);
    console.log(`[${requestId}]   AWS_REGION: ${process.env.AWS_REGION}`);
    console.log(`[${requestId}]   MAX_FILE_SIZE: ${MAX_FILE_SIZE} bytes (${MAX_FILE_SIZE / 1024 / 1024}MB)`);
    console.log(`[${requestId}]   SUPPORTED_MIME_TYPES: ${SUPPORTED_MIME_TYPES.length} types`);

    // Log headers (mask sensitive ones)
    console.log(`[${requestId}] Request headers:`);
    Object.entries(event.headers || {}).forEach(([key, value]) => {
        const maskedValue = key.toLowerCase().includes('authorization') || key.toLowerCase().includes('token')
            ? `${value?.substring(0, 10)}...`
            : value;
        console.log(`[${requestId}]   ${key}: ${maskedValue}`);
    });

    try {
        // Extract user identity from API Gateway request context
        let userIdentityId: string;
        try {
            userIdentityId = getUserIdentityFromContext(event, requestId);
        } catch (error) {
            const duration = Date.now() - startTime;
            console.error(`[${requestId}] ❌ Authentication failed after ${duration}ms`);
            return {
                statusCode: 401,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
                },
                body: JSON.stringify({
                    error: 'Authentication failed',
                    message: error instanceof Error ? error.message : 'User identity not found',
                    requestId
                })
            };
        }

        // Parse and validate request body
        if (!event.body) {
            const duration = Date.now() - startTime;
            console.error(`[${requestId}] ❌ Missing request body after ${duration}ms`);
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
                body: JSON.stringify({
                    error: 'Bad Request',
                    message: 'Request body is required',
                    requestId
                })
            };
        }

        let uploadRequest: UploadRequest;
        try {
            console.log(`[${requestId}] Parsing request body...`);
            const body = JSON.parse(event.body);
            uploadRequest = validateUploadRequest(body, requestId);
        } catch (error) {
            const duration = Date.now() - startTime;
            console.error(`[${requestId}] ❌ Request validation failed after ${duration}ms`);
            console.error(`[${requestId}] Validation error:`, error);
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
                body: JSON.stringify({
                    error: 'Bad Request',
                    message: error instanceof Error ? error.message : 'Invalid request body',
                    requestId
                })
            };
        }

        // Generate unique object key with user identity and timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const uniqueId = Math.random().toString(36).substring(2, 15);
        const sanitizedFileName = uploadRequest.fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
        const objectKey = `uploads/${userIdentityId}/${timestamp}-${uniqueId}-${sanitizedFileName}`;

        console.log(`[${requestId}] Generated upload details:`);
        console.log(`[${requestId}]   Object Key: ${objectKey}`);
        console.log(`[${requestId}]   Unique ID: ${uniqueId}`);
        console.log(`[${requestId}]   Sanitized Filename: ${sanitizedFileName}`);
        console.log(`[${requestId}]   User: ${userIdentityId}`);

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
                'file-size': uploadRequest.fileSize.toString(),
                'request-id': requestId
            },
            // Add server-side encryption
            ServerSideEncryption: 'AES256' as const,
        };

        console.log(`[${requestId}] S3 PutObject parameters:`);
        console.log(`[${requestId}]   Bucket: ${putObjectParams.Bucket}`);
        console.log(`[${requestId}]   Content-Type: ${putObjectParams.ContentType}`);
        console.log(`[${requestId}]   Content-Length: ${putObjectParams.ContentLength}`);
        console.log(`[${requestId}]   Server-Side Encryption: ${putObjectParams.ServerSideEncryption}`);

        const command = new PutObjectCommand(putObjectParams);

        // Generate pre-signed URL (valid for 15 minutes)
        console.log(`[${requestId}] Generating pre-signed URL...`);
        const presignedUrlStartTime = Date.now();
        const presignedUrl = await getSignedUrl(s3Client as any, command as any, {
            expiresIn: 900, // 15 minutes
        });
        const presignedUrlDuration = Date.now() - presignedUrlStartTime;
        console.log(`[${requestId}] ✅ Pre-signed URL generated in ${presignedUrlDuration}ms`);
        console.log(`[${requestId}] URL expires in: 900 seconds (15 minutes)`);

        const totalDuration = Date.now() - startTime;
        console.log(`[${requestId}] === Upload URL Handler Completed Successfully ===`);
        console.log(`[${requestId}] Total execution time: ${totalDuration}ms`);

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
                requestId,
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
        const totalDuration = Date.now() - startTime;
        console.error(`[${requestId}] ❌ Upload URL Handler Failed after ${totalDuration}ms`);
        console.error(`[${requestId}] Error type: ${error instanceof Error ? error.constructor.name : typeof error}`);
        console.error(`[${requestId}] Error message: ${error instanceof Error ? error.message : 'Unknown error'}`);
        console.error(`[${requestId}] Stack trace:`, error instanceof Error ? error.stack : 'No stack trace');

        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify({
                error: 'Internal Server Error',
                message: 'An unexpected error occurred while generating the upload URL',
                requestId
            })
        };
    }
}; 