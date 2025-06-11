import { S3Event, Context } from 'aws-lambda';
import { S3Client, GetObjectCommand, CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import * as mime from 'mime-types';
import { randomUUID } from 'crypto';
import { 
    DocumentValidatedDetail,
    DocumentRejectedDetail, 
    DocumentQuarantinedDetail,
    createDocumentValidatedEvent,
    createDocumentRejectedEvent,
    createDocumentQuarantinedEvent
} from './event-types';

const s3Client = new S3Client({});
const eventBridgeClient = new EventBridgeClient({});

// Configuration  
const QUARANTINE_BUCKET = process.env.QUARANTINE_BUCKET!;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME!;
const EVENT_SOURCE = process.env.EVENT_SOURCE!;

// Validation configuration
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const ALLOWED_MIME_TYPES = [
    'application/pdf',
    'text/plain',
    'text/markdown',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/html',
    'application/rtf'
];

export async function handler(event: S3Event, _context: Context): Promise<void> {
    console.log('Validation handler invoked:', JSON.stringify(event, null, 2));

    for (const record of event.Records) {
        const bucket = record.s3.bucket.name;
        const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
        const size = record.s3.object.size;

        console.log(`Processing file: ${key} (${size} bytes) from bucket: ${bucket}`);

        try {
            const validationResult = await validateDocument(bucket, key, size);
            
            if (validationResult.isValid) {
                await publishDocumentValidatedEvent(bucket, key, validationResult);
                console.log(`Document ${key} validated successfully`);
            } else {
                await quarantineDocument(bucket, key, validationResult.reason!);
                await publishDocumentQuarantinedEvent(bucket, key, validationResult.reason!);
                console.log(`Document ${key} quarantined: ${validationResult.reason}`);
            }
        } catch (error) {
            console.error(`Error processing document ${key}:`, error);
            await rejectDocument(bucket, key, error instanceof Error ? error.message : 'Unknown error');
            await publishDocumentRejectedEvent(bucket, key, error instanceof Error ? error.message : 'Unknown error');
        }
    }
}

interface ValidationResult {
    isValid: boolean;
    reason?: string;
    metadata?: {
        mimeType?: string;
        contentLength: number;
        lastModified?: Date;
    };
}

async function validateDocument(bucket: string, key: string, size: number): Promise<ValidationResult> {
    // Size validation
    if (size > MAX_FILE_SIZE) {
        return {
            isValid: false,
            reason: `File size ${size} bytes exceeds maximum allowed size of ${MAX_FILE_SIZE} bytes`
        };
    }

    // Get object metadata
    try {
        const getObjectCommand = new GetObjectCommand({
            Bucket: bucket,
            Key: key
        });
        const response = await s3Client.send(getObjectCommand);

        // MIME type validation
        const mimeType = response.ContentType || mime.lookup(key) || 'application/octet-stream';
        if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
            return {
                isValid: false,
                reason: `MIME type ${mimeType} is not allowed. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`
            };
        }

        // Content validation (basic checks)
        const bodyStream = response.Body;
        if (!bodyStream) {
            return {
                isValid: false,
                reason: 'Document has no content'
            };
        }

        const metadata: ValidationResult['metadata'] = {
            mimeType,
            contentLength: size,
        };
        
        if (response.LastModified) {
            metadata.lastModified = response.LastModified;
        }

        return {
            isValid: true,
            metadata
        };
    } catch (error) {
        throw new Error(`Failed to retrieve document metadata: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

async function quarantineDocument(bucket: string, key: string, reason: string): Promise<void> {
    const quarantineKey = `quarantine/${new Date().toISOString()}/${key}`;
    
    const copyCommand = new CopyObjectCommand({
        Bucket: QUARANTINE_BUCKET,
        Key: quarantineKey,
        CopySource: `${bucket}/${key}`,
        Metadata: {
            'quarantine-reason': reason,
            'quarantine-timestamp': new Date().toISOString(),
            'original-bucket': bucket,
            'original-key': key
        },
        MetadataDirective: 'REPLACE'
    });

    await s3Client.send(copyCommand);

    // Optionally delete from original bucket
    const deleteCommand = new DeleteObjectCommand({
        Bucket: bucket,
        Key: key
    });
    await s3Client.send(deleteCommand);
}

async function rejectDocument(bucket: string, key: string, reason: string): Promise<void> {
    // For rejected documents, we might want to keep them for debugging
    // or delete them based on policy
    console.log(`Document ${key} rejected: ${reason}`);
}

async function publishDocumentValidatedEvent(bucket: string, key: string, validationResult: ValidationResult): Promise<void> {
    const documentId = randomUUID();
    const now = new Date().toISOString();
    
    const detail: DocumentValidatedDetail = {
        documentId: documentId,
        bucketName: bucket,
        objectKey: key,
        contentType: validationResult.metadata?.mimeType || 'application/octet-stream',
        fileSize: validationResult.metadata?.contentLength || 0,
        validatedAt: now,
        metadata: {
            originalFileName: key.split('/').pop() || key,
            uploadedBy: 'system' // Could be extracted from S3 metadata if available
        }
    };

    // Get AWS context for account and region
    const account = process.env.AWS_ACCOUNT_ID || 'unknown';
    const region = process.env.AWS_REGION || 'unknown';
    const validatedEvent = createDocumentValidatedEvent(account, region, detail);

    const event = {
        Time: new Date(),
        Source: validatedEvent.source,
        DetailType: validatedEvent['detail-type'],
        EventBusName: EVENT_BUS_NAME,
        Detail: JSON.stringify(validatedEvent.detail)
    };

    await eventBridgeClient.send(new PutEventsCommand({
        Entries: [event]
    }));
}

async function publishDocumentQuarantinedEvent(bucket: string, key: string, reason: string): Promise<void> {
    const documentId = randomUUID();
    const now = new Date().toISOString();
    const quarantineKey = `quarantine/${now}/${key}`;
    
    // Determine quarantine code based on reason
    let quarantineCode: DocumentQuarantinedDetail['quarantineCode'] = 'MANUAL_REVIEW_REQUIRED';
    if (reason.toLowerCase().includes('suspicious') || reason.toLowerCase().includes('malware')) {
        quarantineCode = 'SUSPICIOUS_CONTENT';
    } else if (reason.toLowerCase().includes('policy') || reason.toLowerCase().includes('violation')) {
        quarantineCode = 'POLICY_VIOLATION';
    }
    
    const detail: DocumentQuarantinedDetail = {
        documentId: documentId,
        bucketName: QUARANTINE_BUCKET,
        objectKey: quarantineKey,
        quarantineReason: reason,
        quarantineCode: quarantineCode,
        quarantinedAt: now,
        reviewRequired: true,
        metadata: {
            originalFileName: key.split('/').pop() || key,
            riskScore: 50, // Default risk score, could be calculated based on validation
            flaggedBy: 'validation-handler'
        }
    };

    // Get AWS context for account and region
    const account = process.env.AWS_ACCOUNT_ID || 'unknown';
    const region = process.env.AWS_REGION || 'unknown';
    const quarantinedEvent = createDocumentQuarantinedEvent(account, region, detail);

    const event = {
        Time: new Date(),
        Source: quarantinedEvent.source,
        DetailType: quarantinedEvent['detail-type'],
        EventBusName: EVENT_BUS_NAME,
        Detail: JSON.stringify(quarantinedEvent.detail)
    };

    await eventBridgeClient.send(new PutEventsCommand({
        Entries: [event]
    }));
}

async function publishDocumentRejectedEvent(bucket: string, key: string, reason: string): Promise<void> {
    const documentId = randomUUID();
    const now = new Date().toISOString();
    
    // Determine rejection code based on reason
    let rejectionCode: DocumentRejectedDetail['rejectionCode'] = 'INVALID_FORMAT';
    if (reason.toLowerCase().includes('size')) rejectionCode = 'TOO_LARGE';
    if (reason.toLowerCase().includes('mime') || reason.toLowerCase().includes('type')) rejectionCode = 'UNSUPPORTED_TYPE';
    if (reason.toLowerCase().includes('malware') || reason.toLowerCase().includes('virus')) rejectionCode = 'MALWARE_DETECTED';
    
    const detail: DocumentRejectedDetail = {
        documentId: documentId,
        bucketName: bucket,
        objectKey: key,
        rejectionReason: reason,
        rejectionCode: rejectionCode,
        rejectedAt: now,
        metadata: {
            originalFileName: key.split('/').pop() || key,
            attemptedContentType: 'unknown',
            fileSize: 0 // Could be extracted from S3 event if needed
        }
    };

    // Get AWS context for account and region
    const account = process.env.AWS_ACCOUNT_ID || 'unknown';
    const region = process.env.AWS_REGION || 'unknown';
    const rejectedEvent = createDocumentRejectedEvent(account, region, detail);

    const event = {
        Time: new Date(),
        Source: rejectedEvent.source,
        DetailType: rejectedEvent['detail-type'],
        EventBusName: EVENT_BUS_NAME,
        Detail: JSON.stringify(rejectedEvent.detail)
    };

    await eventBridgeClient.send(new PutEventsCommand({
        Entries: [event]
    }));
} 