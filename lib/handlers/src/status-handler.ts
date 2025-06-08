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
async function validateAndGetUserIdentity(authToken: string): Promise<string> {
    try {
        // Extract the ID token from the Authorization header
        const token = authToken.replace('Bearer ', '');
        
        // For federated identity, we need to get the identity ID from Cognito
        const getIdParams = {
            IdentityPoolId: IDENTITY_POOL_ID,
            Logins: {
                // This should match the provider name from the stack
                [`cognito-idp.${process.env.AWS_REGION}.amazonaws.com/us-east-1_example`]: token
            }
        };

        const getIdResult = await cognitoClient.send(new GetIdCommand(getIdParams));
        
        if (!getIdResult.IdentityId) {
            throw new Error('Failed to get identity ID');
        }

        return getIdResult.IdentityId;
    } catch (error) {
        console.error('Authentication error:', error);
        throw new Error('Invalid authentication token');
    }
}

/**
 * Gets document metadata from S3
 */
async function getDocumentMetadata(bucket: string, key: string): Promise<any> {
    try {
        const headCommand = new HeadObjectCommand({
            Bucket: bucket,
            Key: key
        });
        
        const headResult = await s3Client.send(headCommand);
        
        // Also get tags if available
        let tags = {};
        try {
            const tagsCommand = new GetObjectTaggingCommand({
                Bucket: bucket,
                Key: key
            });
            const tagsResult = await s3Client.send(tagsCommand);
            tags = tagsResult.TagSet?.reduce((acc, tag) => {
                acc[tag.Key!] = tag.Value!;
                return acc;
            }, {} as Record<string, string>) || {};
        } catch (error) {
            console.log('No tags found for object:', key);
        }

        return {
            ...headResult,
            Tags: tags
        };
    } catch (error) {
        if ((error as any).name === 'NotFound') {
            return null;
        }
        throw error;
    }
}

/**
 * Checks document status by looking in different S3 locations
 */
async function checkDocumentStatus(documentId: string, userIdentityId: string): Promise<DocumentStatus> {
    const result: DocumentStatus = {
        documentId,
        status: 'not_found',
        location: 'unknown'
    };

    // First, try to find the document in the main documents bucket
    // Look for documents with the user's identity ID in the path
    const possibleKeys = [
        `uploads/${userIdentityId}/${documentId}`,
        `validated/${userIdentityId}/${documentId}`,
        `uploads/${userIdentityId}/*${documentId}*`
    ];

    for (const pattern of possibleKeys) {
        if (pattern.includes('*')) {
            // This would require listing objects, which is more complex
            // For now, skip pattern matching
            continue;
        }
        
        const metadata = await getDocumentMetadata(DOCUMENT_BUCKET, pattern);
        if (metadata) {
            result.status = 'validated';
            result.location = 'documents';
            result.fileName = metadata.Metadata?.['original-filename'];
            result.fileSize = metadata.ContentLength;
            result.uploadedAt = metadata.Metadata?.['upload-timestamp'];
            result.validatedAt = metadata.LastModified?.toISOString();
            result.userIdentityId = metadata.Metadata?.['user-identity-id'];
            return result;
        }
    }

    // Check quarantine bucket
    const quarantineKeys = [
        `quarantine/${userIdentityId}/${documentId}`,
        `quarantine/${userIdentityId}/*${documentId}*`
    ];

    for (const pattern of quarantineKeys) {
        if (pattern.includes('*')) {
            continue;
        }
        
        const metadata = await getDocumentMetadata(QUARANTINE_BUCKET, pattern);
        if (metadata) {
            result.status = metadata.Metadata?.['quarantine-reason'] ? 'quarantined' : 'rejected';
            result.location = 'quarantine';
            result.fileName = metadata.Metadata?.['original-filename'];
            result.fileSize = metadata.ContentLength;
            result.uploadedAt = metadata.Metadata?.['upload-timestamp'];
            result.quarantinedAt = metadata.LastModified?.toISOString();
            result.errorMessage = metadata.Metadata?.['quarantine-reason'] || metadata.Metadata?.['rejection-reason'];
            result.userIdentityId = metadata.Metadata?.['user-identity-id'];
            return result;
        }
    }

    return result;
}

/**
 * Gets the status of a document upload/processing
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    console.log('Status check request:', JSON.stringify(event, null, 2));

    try {
        // Validate authentication
        const authHeader = event.headers.Authorization || event.headers.authorization;
        if (!authHeader) {
            return {
                statusCode: 401,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
                },
                body: JSON.stringify({
                    error: 'Authentication required',
                    message: 'Authorization header is missing'
                })
            };
        }

        // Validate user identity with Cognito
        let userIdentityId: string;
        try {
            userIdentityId = await validateAndGetUserIdentity(authHeader);
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
                    message: error instanceof Error ? error.message : 'Invalid authentication token'
                })
            };
        }

        // Get document ID from path parameters
        const documentId = event.pathParameters?.documentId;
        if (!documentId) {
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
                body: JSON.stringify({
                    error: 'Bad Request',
                    message: 'documentId is required in the path'
                })
            };
        }

        // Validate that the document ID is safe
        if (!/^[a-zA-Z0-9\-_\.]+$/.test(documentId)) {
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
                body: JSON.stringify({
                    error: 'Bad Request',
                    message: 'Invalid documentId format'
                })
            };
        }

        // Check document status
        const status = await checkDocumentStatus(documentId, userIdentityId);

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
            },
            body: JSON.stringify({
                ...status,
                requestedBy: userIdentityId,
                checkedAt: new Date().toISOString()
            })
        };

    } catch (error) {
        console.error('Error checking document status:', error);

        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify({
                error: 'Internal Server Error',
                message: 'Failed to check document status',
                requestId: event.requestContext?.requestId
            })
        };
    }
}; 