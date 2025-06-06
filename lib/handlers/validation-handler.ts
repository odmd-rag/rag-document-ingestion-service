import { S3Event, Context } from 'aws-lambda';
import { S3Client, GetObjectCommand, CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import * as mime from 'mime-types';

const s3Client = new S3Client({});
const eventBridgeClient = new EventBridgeClient({});

// Configuration
const DOCUMENT_BUCKET = process.env.DOCUMENT_BUCKET!;
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

export async function handler(event: S3Event, context: Context): Promise<void> {
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

        return {
            isValid: true,
            metadata: {
                mimeType,
                contentLength: size,
                lastModified: response.LastModified
            }
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
    const event = {
        Time: new Date(),
        Source: EVENT_SOURCE,
        DetailType: 'Document Validated',
        Detail: JSON.stringify({
            documentId: key,
            bucket: bucket,
            metadata: validationResult.metadata,
            validatedAt: new Date().toISOString(),
            status: 'validated'
        })
    };

    await eventBridgeClient.send(new PutEventsCommand({
        Entries: [event]
    }));
}

async function publishDocumentQuarantinedEvent(bucket: string, key: string, reason: string): Promise<void> {
    const event = {
        Time: new Date(),
        Source: EVENT_SOURCE,
        DetailType: 'Document Quarantined',
        Detail: JSON.stringify({
            documentId: key,
            bucket: bucket,
            quarantineReason: reason,
            quarantinedAt: new Date().toISOString(),
            status: 'quarantined'
        })
    };

    await eventBridgeClient.send(new PutEventsCommand({
        Entries: [event]
    }));
}

async function publishDocumentRejectedEvent(bucket: string, key: string, reason: string): Promise<void> {
    const event = {
        Time: new Date(),
        Source: EVENT_SOURCE,
        DetailType: 'Document Rejected',
        Detail: JSON.stringify({
            documentId: key,
            bucket: bucket,
            rejectionReason: reason,
            rejectedAt: new Date().toISOString(),
            status: 'rejected'
        })
    };

    await eventBridgeClient.send(new PutEventsCommand({
        Entries: [event]
    }));
} 