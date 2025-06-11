/**
 * Example Lambda Event Handler using Generated EventBridge Types
 * 
 * OndemandEnv Architecture Highlight: Type-Safe Event Handling
 * This demonstrates how generated EventBridge types provide compile-time 
 * safety and enhanced developer experience without custom validation logic.
 * 
 * The types are automatically generated from EventBridge Schema Registry,
 * ensuring contract compliance across all services in the RAG system.
 */

import { Context } from 'aws-lambda';
import { 
    DocumentValidatedHandler,
    DocumentRejectedHandler,
    DocumentQuarantinedHandler,
    RAGEventTypes,
    isDocumentValidatedEvent,
    isDocumentRejectedEvent,
    isDocumentQuarantinedEvent
} from '../generated/eventbridge-types';

// ========================================================================
// TYPE-SAFE EVENT HANDLERS - No Validation Needed!
// ========================================================================
// These handlers demonstrate OndemandEnv's philosophy:
// "Leverage cloud reliability" - EventBridge guarantees schema compliance,
// so we focus on business logic, not event validation.

/**
 * Document Validated Event Handler
 * Triggered when a document passes validation and is ready for processing
 */
export const handleDocumentValidated: DocumentValidatedHandler = async (event) => {
    console.log('Processing validated document event:', {
        eventId: event.id,
        source: event.source,
        detailType: event['detail-type'],
        timestamp: event.time
    });

    // ✅ Type-safe access to event properties - TypeScript knows these exist!
    const { 
        documentId, 
        bucketName, 
        objectKey, 
        contentType, 
        fileSize, 
        validatedAt,
        metadata 
    } = event.detail;

    // Business logic - no validation needed, EventBridge guarantees schema compliance
    console.log(`Processing document: ${documentId}`);
    console.log(`Location: s3://${bucketName}/${objectKey}`);
    console.log(`Content Type: ${contentType}, Size: ${fileSize} bytes`);
    console.log(`Original filename: ${metadata.originalFileName}`);
    console.log(`Uploaded by: ${metadata.uploadedBy}`);
    console.log(`Validated at: ${validatedAt}`);

    try {
        // Trigger downstream processing
        await triggerDocumentProcessing(documentId, bucketName, objectKey);
        
        console.log(`Document ${documentId} successfully queued for processing`);
    } catch (error) {
        console.error(`Failed to process document ${documentId}:`, error);
        throw error; // Let EventBridge handle retries and DLQ
    }
};

/**
 * Document Rejected Event Handler
 * Triggered when a document fails validation (wrong format, too large, etc.)
 */
export const handleDocumentRejected: DocumentRejectedHandler = async (event) => {
    console.log('Processing rejected document event:', {
        eventId: event.id,
        source: event.source,
        detailType: event['detail-type']
    });

    // ✅ Type-safe access to rejection details
    const { 
        documentId, 
        bucketName, 
        objectKey, 
        rejectionReason, 
        rejectionCode, 
        rejectedAt 
    } = event.detail;

    console.warn(`Document ${documentId} rejected: ${rejectionReason}`);
    console.warn(`Rejection code: ${rejectionCode}`);
    console.warn(`Location: s3://${bucketName}/${objectKey}`);

    try {
        // Handle rejection - log for analytics, notify user, cleanup, etc.
        await handleDocumentRejection(documentId, rejectionReason, rejectionCode);
        
        console.log(`Document rejection ${documentId} processed successfully`);
    } catch (error) {
        console.error(`Failed to handle document rejection ${documentId}:`, error);
        throw error;
    }
};

/**
 * Document Quarantined Event Handler
 * Triggered when a document requires manual review (suspicious content, policy violation)
 */
export const handleDocumentQuarantined: DocumentQuarantinedHandler = async (event) => {
    console.log('Processing quarantined document event:', {
        eventId: event.id,
        source: event.source,
        detailType: event['detail-type']
    });

    // ✅ Type-safe access to quarantine details
    const { 
        documentId, 
        bucketName, 
        objectKey, 
        quarantineReason, 
        quarantineCode, 
        quarantinedAt, 
        reviewRequired,
        metadata 
    } = event.detail;

    console.warn(`Document ${documentId} quarantined: ${quarantineReason}`);
    console.warn(`Quarantine code: ${quarantineCode}, Review required: ${reviewRequired}`);
    console.warn(`Location: s3://${bucketName}/${objectKey}`);

    if (metadata) {
        console.warn(`Risk score: ${metadata.riskScore}`);
        console.warn(`Flagged by: ${metadata.flaggedBy}`);
    }

    try {
        // Handle quarantine - create review ticket, notify security team, etc.
        await handleDocumentQuarantine(
            documentId, 
            quarantineReason, 
            quarantineCode, 
            metadata?.riskScore
        );
        
        console.log(`Document quarantine ${documentId} processed successfully`);
    } catch (error) {
        console.error(`Failed to handle document quarantine ${documentId}:`, error);
        throw error;
    }
};

// ========================================================================
// GENERIC EVENT ROUTER - Type-Safe Pattern Matching
// ========================================================================

/**
 * Generic EventBridge Event Router
 * Demonstrates type-safe event routing using generated type guards
 */
export async function routeRAGEvent(event: RAGEventTypes, context: Context): Promise<void> {
    console.log('Routing RAG event:', {
        eventId: event.id,
        source: event.source,
        detailType: event['detail-type'],
        account: event.account,
        region: event.region
    });

    // ✅ Type-safe event routing using generated type guards
    if (isDocumentValidatedEvent(event)) {
        await handleDocumentValidated(event);
    } else if (isDocumentRejectedEvent(event)) {
        await handleDocumentRejected(event);
    } else if (isDocumentQuarantinedEvent(event)) {
        await handleDocumentQuarantined(event);
    } else {
        // TypeScript ensures this case should never happen due to union types
        console.error('Unknown event type received:', event);
        throw new Error(`Unhandled event type: ${(event as any)['detail-type']}`);
    }
}

// ========================================================================
// BUSINESS LOGIC FUNCTIONS - Focus on Value, Not Validation
// ========================================================================

async function triggerDocumentProcessing(
    documentId: string, 
    bucketName: string, 
    objectKey: string
): Promise<void> {
    // Publish to document processing service
    // This would trigger content extraction, embedding generation, etc.
    console.log(`Triggering processing pipeline for document ${documentId}`);
    
    // Example: Send to processing queue, update database, etc.
    // Implementation depends on your specific architecture
}

async function handleDocumentRejection(
    documentId: string, 
    rejectionReason: string, 
    rejectionCode: string
): Promise<void> {
    // Handle rejection - analytics, user notification, cleanup
    console.log(`Recording rejection for document ${documentId}: ${rejectionCode}`);
    
    // Example: Update metrics, send user notification, cleanup S3, etc.
}

async function handleDocumentQuarantine(
    documentId: string, 
    quarantineReason: string, 
    quarantineCode: string, 
    riskScore?: number
): Promise<void> {
    // Handle quarantine - create review ticket, notify security
    console.log(`Creating review ticket for document ${documentId}: ${quarantineCode}`);
    
    // Example: Create Jira ticket, send Slack alert, update security dashboard
}

// ========================================================================
// LAMBDA ENTRY POINTS
// ========================================================================

/**
 * Main Lambda handler for EventBridge events
 * This would be configured as the target for EventBridge rules
 */
export async function handler(event: RAGEventTypes, context: Context): Promise<void> {
    try {
        await routeRAGEvent(event, context);
    } catch (error) {
        console.error('Event processing failed:', error);
        
        // Let EventBridge handle retries and dead letter queue
        // OndemandEnv philosophy: leverage cloud reliability
        throw error;
    }
}

/**
 * Example: Separate Lambda handlers for each event type
 * You can also create individual handlers if you prefer separate functions
 */
export { handleDocumentValidated as documentValidatedHandler };
export { handleDocumentRejected as documentRejectedHandler };
export { handleDocumentQuarantined as documentQuarantinedHandler }; 