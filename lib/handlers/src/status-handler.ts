import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, HeadObjectCommand, GetObjectTaggingCommand } from '@aws-sdk/client-s3';
import { CognitoIdentityClient, GetIdCommand } from '@aws-sdk/client-cognito-identity';

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const cognitoClient = new CognitoIdentityClient({ region: process.env.AWS_REGION || 'us-east-1' });

const DOCUMENT_BUCKET = process.env.DOCUMENT_BUCKET!;
const QUARANTINE_BUCKET = process.env.QUARANTINE_BUCKET!;
const IDENTITY_POOL_ID = process.env.IDENTITY_POOL_ID!;

interface DocumentStatus {
    documentId: string;
    status: 'pending' | 'validated' | 'rejected' | 'quarantined' | 'not_found';
    fileName?: string;
    fileSize?: number;
    uploadedAt?: string;
    validatedAt?: string;
    rejectedAt?: string;
    quarantinedAt?: string;
    errorMessage?: string;
    location: 'documents' | 'quarantine' | 'unknown';
    userIdentityId?: string;
}

/**
 * Validates the authentication token and gets user identity
 */
async function validateAndGetUserIdentity(authToken: string, requestId: string): Promise<string> {
    const startTime = Date.now();
    console.log(`[${requestId}] Starting authentication validation...`);
    console.log(`[${requestId}] Auth token length: ${authToken.length} characters`);
    
    try {
        // Extract the ID token from the Authorization header
        const token = authToken.replace('Bearer ', '');
        console.log(`[${requestId}] Token extracted (length: ${token.length})`);
        console.log(`[${requestId}] Identity Pool ID: ${IDENTITY_POOL_ID}`);
        console.log(`[${requestId}] AWS Region: ${process.env.AWS_REGION}`);
        
        // For federated identity, we need to get the identity ID from Cognito
        const getIdParams = {
            IdentityPoolId: IDENTITY_POOL_ID,
            Logins: {
                // This should match the provider name from the stack
                [`cognito-idp.${process.env.AWS_REGION}.amazonaws.com/us-east-1_example`]: token
            }
        };

        console.log(`[${requestId}] Calling Cognito GetId with provider key: cognito-idp.${process.env.AWS_REGION}.amazonaws.com/us-east-1_example`);
        const getIdResult = await cognitoClient.send(new GetIdCommand(getIdParams));
        
        if (!getIdResult.IdentityId) {
            console.error(`[${requestId}] ❌ Failed to get identity ID from Cognito`);
            throw new Error('Failed to get identity ID');
        }

        const duration = Date.now() - startTime;
        console.log(`[${requestId}] ✅ Authentication successful in ${duration}ms`);
        console.log(`[${requestId}] Identity ID: ${getIdResult.IdentityId}`);
        return getIdResult.IdentityId;
    } catch (error) {
        const duration = Date.now() - startTime;
        console.error(`[${requestId}] ❌ Authentication failed after ${duration}ms`);
        console.error(`[${requestId}] Authentication error:`, error);
        throw new Error('Invalid authentication token');
    }
}

/**
 * Gets document metadata from S3
 */
async function getDocumentMetadata(bucket: string, key: string, requestId: string): Promise<any> {
    const startTime = Date.now();
    console.log(`[${requestId}] Fetching metadata for s3://${bucket}/${key}`);
    
    try {
        const headCommand = new HeadObjectCommand({
            Bucket: bucket,
            Key: key
        });
        
        const headResult = await s3Client.send(headCommand);
        const headDuration = Date.now() - startTime;
        console.log(`[${requestId}] ✅ Head object completed in ${headDuration}ms`);
        console.log(`[${requestId}] Object metadata:`);
        console.log(`[${requestId}]   Content-Type: ${headResult.ContentType}`);
        console.log(`[${requestId}]   Content-Length: ${headResult.ContentLength}`);
        console.log(`[${requestId}]   Last-Modified: ${headResult.LastModified}`);
        console.log(`[${requestId}]   ETag: ${headResult.ETag}`);
        console.log(`[${requestId}]   Custom Metadata:`, JSON.stringify(headResult.Metadata, null, 2));
        
        // Also get tags if available
        let tags = {};
        try {
            console.log(`[${requestId}] Fetching object tags...`);
            const tagsStartTime = Date.now();
            const tagsCommand = new GetObjectTaggingCommand({
                Bucket: bucket,
                Key: key
            });
            const tagsResult = await s3Client.send(tagsCommand);
            const tagsDuration = Date.now() - tagsStartTime;
            
            tags = tagsResult.TagSet?.reduce((acc, tag) => {
                acc[tag.Key!] = tag.Value!;
                return acc;
            }, {} as Record<string, string>) || {};
            
            console.log(`[${requestId}] ✅ Tags fetched in ${tagsDuration}ms:`, JSON.stringify(tags, null, 2));
        } catch (error) {
            console.log(`[${requestId}] ℹ️  No tags found for object: ${key}`);
        }

        const totalDuration = Date.now() - startTime;
        console.log(`[${requestId}] ✅ Metadata retrieval completed in ${totalDuration}ms`);

        return {
            ...headResult,
            Tags: tags
        };
    } catch (error) {
        const duration = Date.now() - startTime;
        if ((error as any).name === 'NotFound') {
            console.log(`[${requestId}] ℹ️  Object not found after ${duration}ms: s3://${bucket}/${key}`);
            return null;
        }
        console.error(`[${requestId}] ❌ Failed to get metadata after ${duration}ms:`, error);
        throw error;
    }
}

/**
 * Checks document status by looking in different S3 locations
 */
async function checkDocumentStatus(documentId: string, userIdentityId: string, requestId: string): Promise<DocumentStatus> {
    const startTime = Date.now();
    console.log(`[${requestId}] Starting document status check...`);
    console.log(`[${requestId}] Document ID: ${documentId}`);
    console.log(`[${requestId}] User Identity ID: ${userIdentityId}`);
    
    const result: DocumentStatus = {
        documentId,
        status: 'not_found',
        location: 'unknown'
    };

    // First, try to find the document in the main documents bucket
    console.log(`[${requestId}] Searching in main documents bucket: ${DOCUMENT_BUCKET}`);
    const possibleKeys = [
        `uploads/${userIdentityId}/${documentId}`,
        `validated/${userIdentityId}/${documentId}`,
        `uploads/${userIdentityId}/*${documentId}*`
    ];

    console.log(`[${requestId}] Checking possible key patterns:`, possibleKeys.filter(k => !k.includes('*')));

    for (const [index, pattern] of possibleKeys.entries()) {
        if (pattern.includes('*')) {
            console.log(`[${requestId}] Skipping pattern with wildcard: ${pattern}`);
            continue;
        }
        
        console.log(`[${requestId}] Checking key ${index + 1}/${possibleKeys.length}: ${pattern}`);
        const metadata = await getDocumentMetadata(DOCUMENT_BUCKET, pattern, requestId);
        if (metadata) {
            console.log(`[${requestId}] ✅ Document found in main bucket!`);
            result.status = 'validated';
            result.location = 'documents';
            result.fileName = metadata.Metadata?.['original-filename'];
            result.fileSize = metadata.ContentLength;
            result.uploadedAt = metadata.Metadata?.['upload-timestamp'];
            result.validatedAt = metadata.LastModified?.toISOString();
            result.userIdentityId = metadata.Metadata?.['user-identity-id'];
            
            const duration = Date.now() - startTime;
            console.log(`[${requestId}] Document status check completed in ${duration}ms: VALIDATED`);
            return result;
        }
    }

    // Check quarantine bucket
    console.log(`[${requestId}] Document not found in main bucket, checking quarantine: ${QUARANTINE_BUCKET}`);
    const quarantineKeys = [
        `quarantine/${userIdentityId}/${documentId}`,
        `quarantine/${userIdentityId}/*${documentId}*`
    ];

    console.log(`[${requestId}] Checking quarantine key patterns:`, quarantineKeys.filter(k => !k.includes('*')));

    for (const [index, pattern] of quarantineKeys.entries()) {
        if (pattern.includes('*')) {
            console.log(`[${requestId}] Skipping quarantine pattern with wildcard: ${pattern}`);
            continue;
        }
        
        console.log(`[${requestId}] Checking quarantine key ${index + 1}/${quarantineKeys.length}: ${pattern}`);
        const metadata = await getDocumentMetadata(QUARANTINE_BUCKET, pattern, requestId);
        if (metadata) {
            console.log(`[${requestId}] ✅ Document found in quarantine bucket!`);
            result.status = metadata.Metadata?.['quarantine-reason'] ? 'quarantined' : 'rejected';
            result.location = 'quarantine';
            result.fileName = metadata.Metadata?.['original-filename'];
            result.fileSize = metadata.ContentLength;
            result.uploadedAt = metadata.Metadata?.['upload-timestamp'];
            result.quarantinedAt = metadata.LastModified?.toISOString();
            result.errorMessage = metadata.Metadata?.['quarantine-reason'] || metadata.Metadata?.['rejection-reason'];
            result.userIdentityId = metadata.Metadata?.['user-identity-id'];
            
            const duration = Date.now() - startTime;
            console.log(`[${requestId}] Document status check completed in ${duration}ms: ${result.status.toUpperCase()}`);
            return result;
        }
    }

    const duration = Date.now() - startTime;
    console.log(`[${requestId}] ❌ Document not found in any location after ${duration}ms`);
    return result;
}

/**
 * Gets the status of a document upload/processing
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const startTime = Date.now();
    const requestId = event.requestContext.requestId;
    
    console.log(`[${requestId}] === Document Status Handler Started ===`);
    console.log(`[${requestId}] HTTP Method: ${event.httpMethod}`);
    console.log(`[${requestId}] Resource: ${event.resource}`);
    console.log(`[${requestId}] Path: ${event.path}`);
    console.log(`[${requestId}] Source IP: ${event.requestContext.identity.sourceIp}`);
    console.log(`[${requestId}] User Agent: ${event.requestContext.identity.userAgent}`);
    console.log(`[${requestId}] Stage: ${event.requestContext.stage}`);
    
    // Log configuration
    console.log(`[${requestId}] Configuration:`);
    console.log(`[${requestId}]   DOCUMENT_BUCKET: ${DOCUMENT_BUCKET}`);
    console.log(`[${requestId}]   QUARANTINE_BUCKET: ${QUARANTINE_BUCKET}`);
    console.log(`[${requestId}]   IDENTITY_POOL_ID: ${IDENTITY_POOL_ID}`);
    console.log(`[${requestId}]   AWS_REGION: ${process.env.AWS_REGION}`);

    // Log path parameters
    console.log(`[${requestId}] Path parameters:`, JSON.stringify(event.pathParameters, null, 2));
    console.log(`[${requestId}] Query parameters:`, JSON.stringify(event.queryStringParameters, null, 2));

    // Log headers (mask sensitive ones)
    console.log(`[${requestId}] Request headers:`);
    Object.entries(event.headers || {}).forEach(([key, value]) => {
        const maskedValue = key.toLowerCase().includes('authorization') || key.toLowerCase().includes('token') 
            ? `${value?.substring(0, 10)}...` 
            : value;
        console.log(`[${requestId}]   ${key}: ${maskedValue}`);
    });

    try {
        // Extract document ID from path parameters
        const documentId = event.pathParameters?.documentId;
        if (!documentId) {
            const duration = Date.now() - startTime;
            console.error(`[${requestId}] ❌ Missing document ID in path after ${duration}ms`);
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
                body: JSON.stringify({
                    error: 'Bad Request',
                    message: 'Document ID is required in the path',
                    requestId
                })
            };
        }

        console.log(`[${requestId}] Document ID extracted: ${documentId}`);

        // Validate authentication
        const authHeader = event.headers.Authorization || event.headers.authorization;
        if (!authHeader) {
            const duration = Date.now() - startTime;
            console.error(`[${requestId}] ❌ Missing authorization header after ${duration}ms`);
            return {
                statusCode: 401,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
                },
                body: JSON.stringify({
                    error: 'Authentication required',
                    message: 'Authorization header is missing',
                    requestId
                })
            };
        }

        // Validate user identity with Cognito
        let userIdentityId: string;
        try {
            userIdentityId = await validateAndGetUserIdentity(authHeader, requestId);
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
                    message: error instanceof Error ? error.message : 'Invalid authentication token',
                    requestId
                })
            };
        }

        // Check document status
        console.log(`[${requestId}] Starting document status lookup...`);
        const documentStatus = await checkDocumentStatus(documentId, userIdentityId, requestId);

        const totalDuration = Date.now() - startTime;
        console.log(`[${requestId}] === Document Status Handler Completed Successfully ===`);
        console.log(`[${requestId}] Total execution time: ${totalDuration}ms`);
        console.log(`[${requestId}] Document status: ${documentStatus.status}`);
        console.log(`[${requestId}] Document location: ${documentStatus.location}`);

        // Return the document status
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
            },
            body: JSON.stringify({
                ...documentStatus,
                requestId,
                executionTimeMs: totalDuration
            })
        };

    } catch (error) {
        const totalDuration = Date.now() - startTime;
        console.error(`[${requestId}] ❌ Document Status Handler Failed after ${totalDuration}ms`);
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
                message: 'An unexpected error occurred while checking document status',
                requestId,
                executionTimeMs: totalDuration
            })
        };
    }
}; 