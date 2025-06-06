import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { S3Client, HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

const s3Client = new S3Client({});

// Configuration
const DOCUMENT_BUCKET = process.env.DOCUMENT_BUCKET!;
const QUARANTINE_BUCKET = process.env.QUARANTINE_BUCKET!;

interface DocumentStatus {
    documentId: string;
    status: 'uploading' | 'processing' | 'validated' | 'quarantined' | 'rejected' | 'not_found';
    lastUpdated: string;
    metadata?: {
        fileName?: string;
        contentType?: string;
        fileSize?: number;
        uploadedAt?: string;
        uploadedBy?: string;
        tags?: string[];
        category?: string;
        priority?: string;
    };
    location?: {
        bucket: string;
        key: string;
    };
    quarantineInfo?: {
        reason: string;
        quarantinedAt: string;
    };
    processingStage?: string;
    estimatedCompletion?: string;
}

export async function handler(event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> {
    console.log('Status handler invoked:', JSON.stringify(event, null, 2));

    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
    };

    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: ''
        };
    }

    try {
        const documentId = event.pathParameters?.documentId;
        
        if (!documentId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: 'Document ID is required',
                    message: 'Please provide a valid document ID in the path'
                })
            };
        }

        console.log(`Checking status for document: ${documentId}`);

        // Try to find the document in various locations
        const documentStatus = await findDocumentStatus(documentId);

        if (documentStatus.status === 'not_found') {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({
                    error: 'Document not found',
                    message: `Document with ID ${documentId} was not found`,
                    documentId
                })
            };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(documentStatus)
        };

    } catch (error) {
        console.error('Error checking document status:', error);
        
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Internal server error',
                message: 'Failed to check document status',
                requestId: context.awsRequestId
            })
        };
    }
}

async function findDocumentStatus(documentId: string): Promise<DocumentStatus> {
    const currentDate = new Date().toISOString().split('T')[0];
    
    // Search patterns for different locations
    const searchPatterns = [
        `uploads/${currentDate}/${documentId}/`,
        `uploads/*/${documentId}/`,
        `processed/${documentId}/`,
        `quarantine/*/${documentId}/`
    ];

    // Try to find the document in the main bucket
    try {
        const documentInfo = await searchInBucket(DOCUMENT_BUCKET, documentId, searchPatterns);
        if (documentInfo) {
            return {
                documentId,
                status: 'validated',
                lastUpdated: documentInfo.lastModified,
                metadata: documentInfo.metadata,
                location: {
                    bucket: DOCUMENT_BUCKET,
                    key: documentInfo.key
                },
                processingStage: 'completed'
            };
        }
    } catch (error) {
        console.log(`Document not found in main bucket: ${error}`);
    }

    // Try to find the document in quarantine
    try {
        const quarantineInfo = await searchInBucket(QUARANTINE_BUCKET, documentId, [`quarantine/*/${documentId}/`]);
        if (quarantineInfo) {
            return {
                documentId,
                status: 'quarantined',
                lastUpdated: quarantineInfo.lastModified,
                metadata: quarantineInfo.metadata,
                location: {
                    bucket: QUARANTINE_BUCKET,
                    key: quarantineInfo.key
                },
                quarantineInfo: {
                    reason: quarantineInfo.metadata?.quarantineReason || 'Unknown reason',
                    quarantinedAt: quarantineInfo.metadata?.quarantineTimestamp || quarantineInfo.lastModified
                },
                processingStage: 'quarantined'
            };
        }
    } catch (error) {
        console.log(`Document not found in quarantine bucket: ${error}`);
    }

    // If not found anywhere, return not_found status
    return {
        documentId,
        status: 'not_found',
        lastUpdated: new Date().toISOString()
    };
}

async function searchInBucket(bucket: string, documentId: string, patterns: string[]): Promise<{
    key: string;
    lastModified: string;
    metadata: any;
} | null> {
    
    for (const pattern of patterns) {
        try {
            const prefix = pattern.replace('*', '').replace(`${documentId}/`, '');
            
            const listCommand = new ListObjectsV2Command({
                Bucket: bucket,
                Prefix: prefix,
                MaxKeys: 100
            });

            const listResponse = await s3Client.send(listCommand);
            
            if (listResponse.Contents) {
                // Look for objects that contain the document ID
                const matchingObjects = listResponse.Contents.filter(obj => 
                    obj.Key && obj.Key.includes(documentId)
                );

                if (matchingObjects.length > 0) {
                    const firstMatch = matchingObjects[0];
                    
                    // Get detailed metadata
                    const headCommand = new HeadObjectCommand({
                        Bucket: bucket,
                        Key: firstMatch.Key!
                    });

                    const headResponse = await s3Client.send(headCommand);

                    return {
                        key: firstMatch.Key!,
                        lastModified: firstMatch.LastModified?.toISOString() || new Date().toISOString(),
                        metadata: {
                            fileName: headResponse.Metadata?.['original-filename'],
                            contentType: headResponse.ContentType,
                            fileSize: headResponse.ContentLength,
                            uploadedAt: headResponse.Metadata?.['uploaded-at'],
                            uploadedBy: headResponse.Metadata?.['uploaded-by'],
                            tags: headResponse.Metadata?.['tags']?.split(','),
                            category: headResponse.Metadata?.['category'],
                            priority: headResponse.Metadata?.['priority'],
                            quarantineReason: headResponse.Metadata?.['quarantine-reason'],
                            quarantineTimestamp: headResponse.Metadata?.['quarantine-timestamp']
                        }
                    };
                }
            }
        } catch (error) {
            console.log(`Error searching with pattern ${pattern}:`, error);
            continue;
        }
    }

    return null;
} 