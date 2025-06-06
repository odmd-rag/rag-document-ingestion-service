import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { v4 as uuidv4 } from 'uuid';
import * as mime from 'mime-types';

const s3Client = new S3Client({});

// Configuration
const DOCUMENT_BUCKET = process.env.DOCUMENT_BUCKET!;
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const PRESIGNED_URL_EXPIRES = 300; // 5 minutes

const ALLOWED_MIME_TYPES = [
    'application/pdf',
    'text/plain',
    'text/markdown',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/html',
    'application/rtf'
];

interface UploadRequest {
    fileName: string;
    contentType?: string;
    tags?: string[];
    category?: string;
    priority?: 'low' | 'normal' | 'high';
}

export async function handler(event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> {
    console.log('Upload URL handler invoked:', JSON.stringify(event, null, 2));

    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
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
        if (!event.body) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: 'Request body is required',
                    message: 'Please provide fileName and other upload parameters'
                })
            };
        }

        const requestBody: UploadRequest = JSON.parse(event.body);
        
        // Validate required fields
        if (!requestBody.fileName) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: 'fileName is required',
                    message: 'Please provide a valid fileName'
                })
            };
        }

        // Determine content type
        const contentType = requestBody.contentType || mime.lookup(requestBody.fileName) || 'application/octet-stream';
        
        // Validate content type
        if (!ALLOWED_MIME_TYPES.includes(contentType)) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: 'Invalid file type',
                    message: `Content type ${contentType} is not allowed. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`,
                    allowedTypes: ALLOWED_MIME_TYPES
                })
            };
        }

        // Generate unique upload ID and key
        const uploadId = uuidv4();
        const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const sanitizedFileName = requestBody.fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
        const key = `uploads/${timestamp}/${uploadId}/${sanitizedFileName}`;

        // Create metadata
        const metadata: Record<string, string> = {
            'uploaded-by': 'api',
            'uploaded-at': new Date().toISOString(),
            'original-filename': requestBody.fileName,
            'upload-id': uploadId
        };

        if (requestBody.tags && requestBody.tags.length > 0) {
            metadata['tags'] = requestBody.tags.join(',');
        }

        if (requestBody.category) {
            metadata['category'] = requestBody.category;
        }

        if (requestBody.priority) {
            metadata['priority'] = requestBody.priority;
        }

        // Create presigned POST URL
        const presignedPost = await createPresignedPost(s3Client, {
            Bucket: DOCUMENT_BUCKET,
            Key: key,
            Conditions: [
                ['content-length-range', 0, MAX_FILE_SIZE],
                ['eq', '$Content-Type', contentType]
            ],
            Fields: {
                'Content-Type': contentType,
                ...Object.entries(metadata).reduce((acc, [key, value]) => {
                    acc[`x-amz-meta-${key}`] = value;
                    return acc;
                }, {} as Record<string, string>)
            },
            Expires: PRESIGNED_URL_EXPIRES
        });

        const response = {
            uploadId,
            uploadUrl: presignedPost.url,
            fields: presignedPost.fields,
            key,
            uploadInstructions: {
                method: 'POST',
                maxFileSize: MAX_FILE_SIZE,
                expiresIn: PRESIGNED_URL_EXPIRES,
                allowedContentTypes: ALLOWED_MIME_TYPES,
                contentType
            },
            metadata: {
                fileName: requestBody.fileName,
                contentType,
                tags: requestBody.tags,
                category: requestBody.category,
                priority: requestBody.priority || 'normal'
            }
        };

        console.log(`Generated presigned URL for upload: ${uploadId}`);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(response)
        };

    } catch (error) {
        console.error('Error generating presigned URL:', error);
        
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Internal server error',
                message: 'Failed to generate upload URL',
                requestId: context.awsRequestId
            })
        };
    }
} 