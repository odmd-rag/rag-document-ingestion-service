import {APIGatewayProxyEventV2, APIGatewayProxyResultV2} from 'aws-lambda';
import {S3Client, PutObjectCommand} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
import {ApiResponse, JWTClaims, UploadRequest, UploadResponse} from "./typing.js";
import console from "node:console";
import {createHash} from 'crypto';


const s3 = new S3Client({});

const UPLOAD_EXPIRES_IN = 900;
const MAX_FILE_SIZE = 100 * 1024 * 1024;
const ALLOWED_TYPES = [
    'text/plain',
    'text/markdown',
    'text/csv',
    'text/tab-separated-values',
    'application/json',
    'application/xml',
    'text/html',
    
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.presentation',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/rtf',
    'application/x-iwork-pages-sffpages',
    'application/x-iwork-numbers-sffnumbers',
    'application/x-iwork-keynote-sffkey'
];

function getUserClaims(event: APIGatewayProxyEventV2): JWTClaims {
    const claims = (event.requestContext as any).authorizer?.jwt?.claims;
    if (!claims?.sub) throw new Error('No valid JWT claims found');
    return claims as JWTClaims;
}

function validateRequest(request: Partial<UploadRequest>): UploadRequest {
    const {fileName, fileType, fileSize} = request;

    if (!fileName?.trim()) throw new Error('fileName is required');
    if (!fileType?.trim()) throw new Error('fileType is required');
    if (typeof fileSize !== 'number' || fileSize <= 0) throw new Error('fileSize must be a positive number');
    if (fileSize > MAX_FILE_SIZE) throw new Error(`File size exceeds ${MAX_FILE_SIZE} bytes`);
    if (!ALLOWED_TYPES.includes(fileType)) throw new Error(`File type ${fileType} not allowed`);

    const fileExtension = fileName.split('.').pop()?.toLowerCase() || '';
    const expectedContentType = getExpectedContentType(fileExtension);
    if (expectedContentType && expectedContentType !== fileType) {
        throw new Error(`File extension .${fileExtension} does not match declared content type ${fileType}. Expected: ${expectedContentType}`);
    }

    return {fileName, fileType, fileSize};
}

function getExpectedContentType(extension: string): string | null {
    const contentTypeMap: { [key: string]: string } = {
        'txt': 'text/plain',
        'md': 'text/markdown',
        'csv': 'text/csv',
        'tsv': 'text/tab-separated-values',
        'json': 'application/json',
        'xml': 'application/xml',
        'html': 'text/html',
        'htm': 'text/html',
        
        'pdf': 'application/pdf',
        'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'doc': 'application/msword',
        'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'ppt': 'application/vnd.ms-powerpoint',
        'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'xls': 'application/vnd.ms-excel',
        'odt': 'application/vnd.oasis.opendocument.text',
        'odp': 'application/vnd.oasis.opendocument.presentation',
        'ods': 'application/vnd.oasis.opendocument.spreadsheet',
        'rtf': 'application/rtf',
        'pages': 'application/x-iwork-pages-sffpages',
        'numbers': 'application/x-iwork-numbers-sffnumbers',
        'key': 'application/x-iwork-keynote-sffkey'
    };
    
    return contentTypeMap[extension] || null;
}

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

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    console.log(JSON.stringify(event, null, 2));
    try {
        const {sub: userId, email} = getUserClaims(event);

        const body = JSON.parse(event.body || '{}');
        const {fileName, fileType, fileSize} = validateRequest(body);

        const timestamp = new Date().toISOString();
        const hashInput = timestamp + fileName + (email || 'unknown');
        const fileHash = createHash('sha256').update(hashInput).digest('hex');
        
        const fileExtension = fileName.split('.').pop()?.toLowerCase() || '';
        const objectKey = fileExtension ? `${timestamp}-${fileHash}.${fileExtension}` : `${timestamp}-${fileHash}`;
        const uploadId = objectKey;

        const command = new PutObjectCommand({
            Bucket: process.env.DOCUMENT_BUCKET!,
            Key: objectKey,
            ContentType: fileType,
            ContentLength: fileSize,
            Metadata: {
                'user-id': userId,
                'user-email': email || 'unknown',
                'original-filename': fileName,
                'uploaded-at': timestamp,
                'file-size': fileSize.toString(),
                'content-type': fileType,
                'hash-input': hashInput,
                'timestamp': timestamp,
                'validation-status': 'pending',
                'download-approved': 'false',
                'validated-at': '',
                'validated-by': ''
            }
        });

        const uploadUrl = await getSignedUrl(s3, command, {expiresIn: UPLOAD_EXPIRES_IN});

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