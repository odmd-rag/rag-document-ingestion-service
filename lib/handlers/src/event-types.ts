/**
 * TypeScript interfaces for RAG Document Ingestion EventBridge events
 * These interfaces match the schemas defined in the EventBridge Schema Registry
 */

// Standard EventBridge event structure
export interface BaseEventBridgeEvent {
    version: '0';
    id: string;
    'detail-type': string;
    source: string;
    account: string;
    time: string;
    region: string;
    detail: any;
}

// Document Validated Event Types
export interface DocumentValidatedDetail {
    documentId: string;
    bucketName: string;
    objectKey: string;
    contentType: string;
    fileSize: number;
    validatedAt: string;
    metadata: {
        originalFileName: string;
        uploadedBy: string;
    };
}

export interface DocumentValidatedEvent extends BaseEventBridgeEvent {
    'detail-type': 'Document Validated';
    source: 'rag.document-ingestion';
    detail: DocumentValidatedDetail;
}

// Document Rejected Event Types
export interface DocumentRejectedDetail {
    documentId: string;
    bucketName: string;
    objectKey: string;
    rejectionReason: string;
    rejectionCode: 'INVALID_FORMAT' | 'TOO_LARGE' | 'MALWARE_DETECTED' | 'UNSUPPORTED_TYPE';
    rejectedAt: string;
    metadata: {
        originalFileName: string;
        attemptedContentType: string;
        fileSize: number;
    };
}

export interface DocumentRejectedEvent extends BaseEventBridgeEvent {
    'detail-type': 'Document Rejected';
    source: 'rag.document-ingestion';
    detail: DocumentRejectedDetail;
}

// Document Quarantined Event Types
export interface DocumentQuarantinedDetail {
    documentId: string;
    bucketName: string;
    objectKey: string;
    quarantineReason: string;
    quarantineCode: 'SUSPICIOUS_CONTENT' | 'MANUAL_REVIEW_REQUIRED' | 'POLICY_VIOLATION';
    quarantinedAt: string;
    reviewRequired: true;
    metadata: {
        originalFileName: string;
        riskScore: number;
        flaggedBy: string;
    };
}

export interface DocumentQuarantinedEvent extends BaseEventBridgeEvent {
    'detail-type': 'Document Quarantined';
    source: 'rag.document-ingestion';
    detail: DocumentQuarantinedDetail;
}

// Union type for all document events
export type DocumentEvent = DocumentValidatedEvent | DocumentRejectedEvent | DocumentQuarantinedEvent;

// Event creation helpers
export function createDocumentValidatedEvent(
    account: string,
    region: string,
    detail: DocumentValidatedDetail
): DocumentValidatedEvent {
    return {
        version: '0',
        id: `doc-validated-${detail.documentId}`,
        'detail-type': 'Document Validated',
        source: 'rag.document-ingestion',
        account,
        time: new Date().toISOString(),
        region,
        detail
    };
}

export function createDocumentRejectedEvent(
    account: string,
    region: string,
    detail: DocumentRejectedDetail
): DocumentRejectedEvent {
    return {
        version: '0',
        id: `doc-rejected-${detail.documentId}`,
        'detail-type': 'Document Rejected',
        source: 'rag.document-ingestion',
        account,
        time: new Date().toISOString(),
        region,
        detail
    };
}

export function createDocumentQuarantinedEvent(
    account: string,
    region: string,
    detail: DocumentQuarantinedDetail
): DocumentQuarantinedEvent {
    return {
        version: '0',
        id: `doc-quarantined-${detail.documentId}`,
        'detail-type': 'Document Quarantined',
        source: 'rag.document-ingestion',
        account,
        time: new Date().toISOString(),
        region,
        detail
    };
} 