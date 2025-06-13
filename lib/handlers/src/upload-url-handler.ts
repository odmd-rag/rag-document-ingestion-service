import {APIGatewayProxyEventV2, APIGatewayProxyResultV2} from 'aws-lambda';
import {S3Client, PutObjectCommand} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
import {ApiResponse, JWTClaims, UploadRequest, UploadResponse} from "./typing.js";
import console from "node:console";


const s3 = new S3Client({});

// Constants
const UPLOAD_EXPIRES_IN = 900; // 15 minutes
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const ALLOWED_TYPES = [
    'application/pdf',
    'text/plain',
    'text/markdown',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
];

function getUserClaims(event: APIGatewayProxyEventV2): JWTClaims {
    const claims = (event.requestContext as any).authorizer?.jwt?.claims;
    if (!claims?.sub) throw new Error('No valid JWT claims found');
    return claims as JWTClaims;
}

// Helper: Validate upload request
function validateRequest(request: Partial<UploadRequest>): UploadRequest {
    const {fileName, fileType, fileSize} = request;

    if (!fileName?.trim()) throw new Error('fileName is required');
    if (!fileType?.trim()) throw new Error('fileType is required');
    if (typeof fileSize !== 'number' || fileSize <= 0) throw new Error('fileSize must be a positive number');
    if (fileSize > MAX_FILE_SIZE) throw new Error(`File size exceeds ${MAX_FILE_SIZE} bytes`);
    if (!ALLOWED_TYPES.includes(fileType)) throw new Error(`File type ${fileType} not allowed`);

    return {fileName, fileType, fileSize};
}

// Helper: Create response
function createResponse<T>(statusCode: number, data?: T, error?: string): APIGatewayProxyResultV2 {
    const response: ApiResponse<T> = {
        success: statusCode < 400,
        timestamp: new Date().toISOString(),
        ...(data && {data}),
        ...(error && {error})
    };

    return {
        statusCode,
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(response)
    };
}

// Main handler
export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    console.log(JSON.stringify(event, null, 2));
    try {
        const {sub: userId, email} = getUserClaims(event);

        // Parse and validate request
        const body = JSON.parse(event.body || '{}');
        const {fileName, fileType, fileSize} = validateRequest(body);

        // Generate unique upload ID and S3 key
        const uploadId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const objectKey = `uploads/${userId}/${uploadId}-${fileName}`;

        // Create pre-signed upload URL
        const command = new PutObjectCommand({
            Bucket: process.env.DOCUMENT_BUCKET!,
            Key: objectKey,
            ContentType: fileType,
            ContentLength: fileSize,
            Metadata: {
                'user-id': userId,
                'user-email': email || 'unknown',
                'original-filename': fileName,
                'uploaded-at': new Date().toISOString()
            }
        });

        const uploadUrl = await getSignedUrl(s3, command, {expiresIn: UPLOAD_EXPIRES_IN});

        // Return success response
        const responseData: UploadResponse = {
            uploadId,
            uploadUrl,
            objectKey,
            ...(email && {userEmail: email}),
            expiresIn: UPLOAD_EXPIRES_IN
        };

        return createResponse(200, responseData);

    } catch (error) {
        console.error('Upload handler error:', error);
        const message = error instanceof Error ? error.message : 'Internal server error';
        return createResponse(400, undefined, message);
    }
};