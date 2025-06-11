import { S3Event, Context } from 'aws-lambda';
import { S3Client, GetObjectCommand, CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { SchemasClient, DescribeSchemaCommand } from '@aws-sdk/client-schemas';
import Ajv from 'ajv';
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
const schemasClient = new SchemasClient({});

// Configuration  
const QUARANTINE_BUCKET = process.env.QUARANTINE_BUCKET!;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME!;
const EVENT_SOURCE = process.env.EVENT_SOURCE!;
const SCHEMA_REGISTRY_NAME = process.env.SCHEMA_REGISTRY_NAME!;

// Initialize AJV for schema validation
const ajv = new Ajv();

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

// Schema validation cache
const schemaCache = new Map<string, any>();

/**
 * Validates an event payload against its registered EventBridge schema
 */
async function validateEventAgainstSchema(eventDetail: any, schemaName: string): Promise<{ isValid: boolean; errors?: any[] }> {
    try {
        // Check cache first
        let schemaDefinition = schemaCache.get(schemaName);
        
        if (!schemaDefinition) {
            // Fetch schema from EventBridge Schema Registry
            const describeCommand = new DescribeSchemaCommand({
                RegistryName: SCHEMA_REGISTRY_NAME,
                SchemaName: schemaName
            });
            
            const schemaResponse = await schemasClient.send(describeCommand);
            if (!schemaResponse.Content) {
                console.warn(`Schema ${schemaName} not found in registry`);
                return { isValid: true }; // Graceful degradation
            }
            
            schemaDefinition = JSON.parse(schemaResponse.Content);
            schemaCache.set(schemaName, schemaDefinition);
            console.log(`Cached schema ${schemaName} from registry`);
        }
        
        // Validate using AJV
        const validate = ajv.compile(schemaDefinition);
        const isValid = validate(eventDetail);
        
        if (!isValid) {
            console.error(`Schema validation failed for ${schemaName}:`, validate.errors);
            return { isValid: false, errors: validate.errors as any[] };
        }
        
        console.log(`Event validated successfully against schema ${schemaName}`);
        return { isValid: true };
        
    } catch (error) {
        console.error(`Schema validation error for ${schemaName}:`, error);
        // Graceful degradation - don't fail the entire process
        return { isValid: true };
    }
}

export async function handler(event: S3Event, context: Context): Promise<void> {
    const startTime = Date.now();
    const requestId = context.awsRequestId;
    
    console.log(`[${requestId}] === Validation Handler Started ===`);
    console.log(`[${requestId}] Function: ${context.functionName}:${context.functionVersion}`);
    console.log(`[${requestId}] Memory limit: ${context.memoryLimitInMB}MB`);
    console.log(`[${requestId}] Remaining time: ${context.getRemainingTimeInMillis()}ms`);
    console.log(`[${requestId}] Records to process: ${event.Records.length}`);
    console.log(`[${requestId}] Event details:`, JSON.stringify(event, null, 2));

    // Log environment configuration
    console.log(`[${requestId}] Configuration:`);
    console.log(`[${requestId}]   QUARANTINE_BUCKET: ${QUARANTINE_BUCKET}`);
    console.log(`[${requestId}]   EVENT_BUS_NAME: ${EVENT_BUS_NAME}`);
    console.log(`[${requestId}]   EVENT_SOURCE: ${EVENT_SOURCE}`);
    console.log(`[${requestId}]   SCHEMA_REGISTRY_NAME: ${SCHEMA_REGISTRY_NAME}`);
    console.log(`[${requestId}]   MAX_FILE_SIZE: ${MAX_FILE_SIZE} bytes (${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB)`);
    console.log(`[${requestId}]   ALLOWED_MIME_TYPES: ${ALLOWED_MIME_TYPES.join(', ')}`);

    let processedCount = 0;
    let validatedCount = 0;
    let quarantinedCount = 0;
    let rejectedCount = 0;

    for (const [index, record] of event.Records.entries()) {
        const recordStartTime = Date.now();
        const bucket = record.s3.bucket.name;
        const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
        const size = record.s3.object.size;
        const eventName = record.eventName;
        const eventTime = record.eventTime;

        console.log(`[${requestId}] === Processing Record ${index + 1}/${event.Records.length} ===`);
        console.log(`[${requestId}] S3 Event: ${eventName} at ${eventTime}`);
        console.log(`[${requestId}] Bucket: ${bucket}`);
        console.log(`[${requestId}] Object Key: ${key}`);
        console.log(`[${requestId}] File Size: ${size} bytes (${(size / 1024 / 1024).toFixed(2)}MB)`);
        console.log(`[${requestId}] File Extension: ${key.split('.').pop()}`);
        console.log(`[${requestId}] S3 ETag: ${record.s3.object.eTag}`);

        try {
            console.log(`[${requestId}] Starting document validation for: ${key}`);
            const validationResult = await validateDocument(bucket, key, size, requestId);
            
            if (validationResult.isValid) {
                console.log(`[${requestId}] ✅ Document validation PASSED for: ${key}`);
                console.log(`[${requestId}] MIME Type: ${validationResult.metadata?.mimeType}`);
                console.log(`[${requestId}] Last Modified: ${validationResult.metadata?.lastModified}`);
                
                await publishDocumentValidatedEvent(bucket, key, validationResult, requestId);
                validatedCount++;
                console.log(`[${requestId}] Published validation success event for: ${key}`);
            } else {
                console.log(`[${requestId}] ❌ Document validation FAILED for: ${key}`);
                console.log(`[${requestId}] Reason: ${validationResult.reason}`);
                
                await quarantineDocument(bucket, key, validationResult.reason!, requestId);
                await publishDocumentQuarantinedEvent(bucket, key, validationResult.reason!, requestId);
                quarantinedCount++;
                console.log(`[${requestId}] Document quarantined and event published for: ${key}`);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error(`[${requestId}] 💥 ERROR processing document: ${key}`);
            console.error(`[${requestId}] Error type: ${error instanceof Error ? error.constructor.name : typeof error}`);
            console.error(`[${requestId}] Error message: ${errorMessage}`);
            console.error(`[${requestId}] Stack trace:`, error instanceof Error ? error.stack : 'No stack trace');
            
            await rejectDocument(bucket, key, errorMessage, requestId);
            await publishDocumentRejectedEvent(bucket, key, errorMessage, requestId);
            rejectedCount++;
        }

        processedCount++;
        const recordDuration = Date.now() - recordStartTime;
        console.log(`[${requestId}] Record ${index + 1} processing completed in ${recordDuration}ms`);
        console.log(`[${requestId}] Remaining time: ${context.getRemainingTimeInMillis()}ms`);
    }

    const totalDuration = Date.now() - startTime;
    console.log(`[${requestId}] === Validation Handler Completed ===`);
    console.log(`[${requestId}] Total execution time: ${totalDuration}ms`);
    console.log(`[${requestId}] Records processed: ${processedCount}`);
    console.log(`[${requestId}] Successfully validated: ${validatedCount}`);
    console.log(`[${requestId}] Quarantined: ${quarantinedCount}`);
    console.log(`[${requestId}] Rejected: ${rejectedCount}`);
    console.log(`[${requestId}] Average processing time per record: ${Math.round(totalDuration / processedCount)}ms`);
    console.log(`[${requestId}] Final remaining time: ${context.getRemainingTimeInMillis()}ms`);
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

async function validateDocument(bucket: string, key: string, size: number, requestId: string): Promise<ValidationResult> {
    const startTime = Date.now();
    console.log(`[${requestId}] Starting document validation for ${key}`);
    
    // Size validation
    console.log(`[${requestId}] Checking file size: ${size} bytes vs max ${MAX_FILE_SIZE} bytes`);
    if (size > MAX_FILE_SIZE) {
        const reason = `File size ${size} bytes exceeds maximum allowed size of ${MAX_FILE_SIZE} bytes`;
        console.log(`[${requestId}] ❌ Size validation failed: ${reason}`);
        return {
            isValid: false,
            reason
        };
    }
    console.log(`[${requestId}] ✅ Size validation passed`);

    // Get object metadata
    try {
        console.log(`[${requestId}] Fetching S3 object metadata for ${bucket}/${key}`);
        const getObjectCommand = new GetObjectCommand({
            Bucket: bucket,
            Key: key
        });
        const response = await s3Client.send(getObjectCommand);
        
        console.log(`[${requestId}] S3 object metadata retrieved:`);
        console.log(`[${requestId}]   Content-Type: ${response.ContentType}`);
        console.log(`[${requestId}]   Content-Length: ${response.ContentLength}`);
        console.log(`[${requestId}]   Last-Modified: ${response.LastModified}`);
        console.log(`[${requestId}]   ETag: ${response.ETag}`);

        // MIME type validation
        const mimeType = response.ContentType || mime.lookup(key) || 'application/octet-stream';
        console.log(`[${requestId}] Detected MIME type: ${mimeType}`);
        console.log(`[${requestId}] Checking against allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`);
        
        if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
            const reason = `MIME type ${mimeType} is not allowed. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`;
            console.log(`[${requestId}] ❌ MIME type validation failed: ${reason}`);
            return {
                isValid: false,
                reason
            };
        }
        console.log(`[${requestId}] ✅ MIME type validation passed`);

        // Content validation (basic checks)
        const bodyStream = response.Body;
        if (!bodyStream) {
            const reason = 'Document has no content';
            console.log(`[${requestId}] ❌ Content validation failed: ${reason}`);
            return {
                isValid: false,
                reason
            };
        }
        console.log(`[${requestId}] ✅ Content validation passed`);

        const metadata: ValidationResult['metadata'] = {
            mimeType,
            contentLength: size,
        };
        
        if (response.LastModified) {
            metadata.lastModified = response.LastModified;
        }

        const duration = Date.now() - startTime;
        console.log(`[${requestId}] ✅ Document validation completed successfully in ${duration}ms`);
        console.log(`[${requestId}] Final metadata:`, JSON.stringify(metadata, null, 2));

        return {
            isValid: true,
            metadata
        };
    } catch (error) {
        const duration = Date.now() - startTime;
        const errorMessage = `Failed to retrieve document metadata: ${error instanceof Error ? error.message : 'Unknown error'}`;
        console.error(`[${requestId}] ❌ Document validation failed after ${duration}ms`);
        console.error(`[${requestId}] Error details:`, error);
        throw new Error(errorMessage);
    }
}

async function quarantineDocument(bucket: string, key: string, reason: string, requestId: string): Promise<void> {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();
    const quarantineKey = `quarantine/${timestamp}/${key}`;
    
    console.log(`[${requestId}] Starting quarantine process for ${key}`);
    console.log(`[${requestId}] Quarantine reason: ${reason}`);
    console.log(`[${requestId}] Quarantine destination: ${QUARANTINE_BUCKET}/${quarantineKey}`);
    
    try {
        const copyCommand = new CopyObjectCommand({
            Bucket: QUARANTINE_BUCKET,
            Key: quarantineKey,
            CopySource: `${bucket}/${key}`,
            Metadata: {
                'quarantine-reason': reason,
                'quarantine-timestamp': timestamp,
                'original-bucket': bucket,
                'original-key': key
            },
            MetadataDirective: 'REPLACE'
        });

        console.log(`[${requestId}] Copying document to quarantine bucket...`);
        const copyResult = await s3Client.send(copyCommand);
        console.log(`[${requestId}] ✅ Document copied to quarantine: ${copyResult.CopyObjectResult?.ETag}`);

        // Optionally delete from original bucket
        console.log(`[${requestId}] Deleting document from original bucket...`);
        const deleteCommand = new DeleteObjectCommand({
            Bucket: bucket,
            Key: key
        });
        const deleteResult = await s3Client.send(deleteCommand);
        console.log(`[${requestId}] ✅ Document deleted from original bucket`);
        
        const duration = Date.now() - startTime;
        console.log(`[${requestId}] ✅ Quarantine process completed in ${duration}ms`);
    } catch (error) {
        const duration = Date.now() - startTime;
        console.error(`[${requestId}] ❌ Quarantine process failed after ${duration}ms`);
        console.error(`[${requestId}] Error details:`, error);
        throw error;
    }
}

async function rejectDocument(bucket: string, key: string, reason: string, requestId: string): Promise<void> {
    // For rejected documents, we might want to keep them for debugging
    // or delete them based on policy
    console.log(`[${requestId}] 🚫 Document ${key} rejected: ${reason}`);
    console.log(`[${requestId}] Document will remain in bucket for debugging purposes`);
}

async function publishDocumentValidatedEvent(bucket: string, key: string, validationResult: ValidationResult, requestId: string): Promise<void> {
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

    // Validate event against schema before publishing
    const schemaValidation = await validateEventAgainstSchema(detail, 'DocumentValidated');
    if (!schemaValidation.isValid) {
        console.error('Event validation failed:', schemaValidation.errors);
        throw new Error(`Event does not conform to schema: ${JSON.stringify(schemaValidation.errors)}`);
    }

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

async function publishDocumentQuarantinedEvent(bucket: string, key: string, reason: string, requestId: string): Promise<void> {
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

async function publishDocumentRejectedEvent(bucket: string, key: string, reason: string, requestId: string): Promise<void> {
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