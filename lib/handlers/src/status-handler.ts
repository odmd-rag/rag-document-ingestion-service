import {APIGatewayProxyEventV2, APIGatewayProxyResultV2} from 'aws-lambda';
import {S3Client, HeadObjectCommand, GetObjectTaggingCommand} from '@aws-sdk/client-s3';
import * as console from "node:console";
import {JWTClaims} from "./typing.js";

const s3Client = new S3Client({region: process.env.AWS_REGION || 'us-east-1'});

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

    // In the new architecture, files are stored directly in the bucket root with timestamp-hash keys
    // First, try to find the document in the main documents bucket
    console.log(`[${requestId}] Searching in main documents bucket: ${DOCUMENT_BUCKET}`);
    console.log(`[${requestId}] Checking key: ${documentId}`);
    
    const metadata = await getDocumentMetadata(DOCUMENT_BUCKET, documentId, requestId);
    if (metadata) {
        console.log(`[${requestId}] ✅ Document found in main bucket!`);
        
        // Check if the user owns this document
        const documentUserId = metadata.Metadata?.['user-identity-id'];
        if (documentUserId !== userIdentityId) {
            console.log(`[${requestId}] ❌ Access denied: Document belongs to different user`);
            console.log(`[${requestId}] Document user: ${documentUserId}, Request user: ${userIdentityId}`);
            const duration = Date.now() - startTime;
            console.log(`[${requestId}] Document status check completed in ${duration}ms: ACCESS_DENIED`);
            return {
                documentId,
                status: 'not_found', // Don't reveal existence to unauthorized users
                location: 'unknown'
            };
        }
        
        // Check validation status from metadata
        // AWS S3 stores custom metadata without the x-amz-meta- prefix when reading back
        const validationStatus = metadata.Metadata?.['validation-status'];
        const downloadApproved = metadata.Metadata?.['download-approved'] === 'true';
        
        console.log(`[${requestId}] Validation metadata check:`);
        console.log(`[${requestId}]   validation-status: ${validationStatus}`);
        console.log(`[${requestId}]   download-approved: ${metadata.Metadata?.['download-approved']}`);
        console.log(`[${requestId}]   validated-at: ${metadata.Metadata?.['validated-at']}`);
        console.log(`[${requestId}]   validated-by: ${metadata.Metadata?.['validated-by']}`);
        console.log(`[${requestId}]   validation-comments: ${metadata.Metadata?.['validation-comments']}`);
        
        let status: DocumentStatus['status'];
        if (validationStatus === 'approved' || downloadApproved) {
            status = 'validated';
            console.log(`[${requestId}] ✅ Document status determined: VALIDATED`);
        } else if (validationStatus === 'rejected') {
            status = 'rejected';
            console.log(`[${requestId}] ❌ Document status determined: REJECTED`);
        } else {
            status = 'pending'; // validation-status: pending or not set
            console.log(`[${requestId}] ⏳ Document status determined: PENDING (validation-status: ${validationStatus || 'not set'})`);
        }
        
        result.status = status;
        result.location = 'documents';
        result.fileName = metadata.Metadata?.['original-filename'];
        result.fileSize = metadata.ContentLength;
        result.uploadedAt = metadata.Metadata?.['upload-timestamp'];
        result.userIdentityId = documentUserId;
        
        if (status === 'validated') {
            result.validatedAt = metadata.Metadata?.['validated-at'] || metadata.LastModified?.toISOString();
        } else if (status === 'rejected') {
            result.rejectedAt = metadata.Metadata?.['validated-at'] || metadata.LastModified?.toISOString();
            result.errorMessage = metadata.Metadata?.['validation-comments'];
        }

        const duration = Date.now() - startTime;
        console.log(`[${requestId}] Document status check completed in ${duration}ms: ${status.toUpperCase()}`);
        return result;
    }

    // Check quarantine bucket - quarantine files also use the flat structure
    console.log(`[${requestId}] Document not found in main bucket, checking quarantine: ${QUARANTINE_BUCKET}`);
    console.log(`[${requestId}] Checking quarantine key: ${documentId}`);
    
    const quarantineMetadata = await getDocumentMetadata(QUARANTINE_BUCKET, documentId, requestId);
    if (quarantineMetadata) {
        console.log(`[${requestId}] ✅ Document found in quarantine bucket!`);
        
        // Check if the user owns this document
        const documentUserId = quarantineMetadata.Metadata?.['user-identity-id'];
        if (documentUserId !== userIdentityId) {
            console.log(`[${requestId}] ❌ Access denied: Quarantined document belongs to different user`);
            const duration = Date.now() - startTime;
            console.log(`[${requestId}] Document status check completed in ${duration}ms: ACCESS_DENIED`);
            return {
                documentId,
                status: 'not_found', // Don't reveal existence to unauthorized users
                location: 'unknown'
            };
        }
        
        result.status = 'quarantined';
        result.location = 'quarantine';
        result.fileName = quarantineMetadata.Metadata?.['original-filename'];
        result.fileSize = quarantineMetadata.ContentLength;
        result.uploadedAt = quarantineMetadata.Metadata?.['upload-timestamp'];
        result.quarantinedAt = quarantineMetadata.LastModified?.toISOString();
        result.errorMessage = quarantineMetadata.Metadata?.['quarantine-reason'];
        result.userIdentityId = documentUserId;

        const duration = Date.now() - startTime;
        console.log(`[${requestId}] Document status check completed in ${duration}ms: QUARANTINED`);
        return result;
    }

    const duration = Date.now() - startTime;
    console.log(`[${requestId}] ❌ Document not found in any location after ${duration}ms`);
    return result;
}


function getUserClaims(event: APIGatewayProxyEventV2): JWTClaims {
    const claims = (event.requestContext as any).authorizer?.jwt?.claims;
    if (!claims?.sub) throw new Error('No valid JWT claims found');
    return claims as JWTClaims;
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    console.log(JSON.stringify(event, null, 2));

    const startTime = Date.now();
    const requestId = event.requestContext.requestId;

    const {sub: userId} = getUserClaims(event);

    console.log(`[${requestId}] === Document Status Handler Started ===`);
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
        if (!userId) {
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
                    message: 'Invalid authentication token',
                    requestId
                })
            };
        }

        // Check document status
        console.log(`[${requestId}] Starting document status lookup...`);
        const documentStatus = await checkDocumentStatus(documentId, userId, requestId);

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