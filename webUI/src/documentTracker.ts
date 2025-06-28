interface DocumentStatus {
    documentId: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    stage: 'ingestion' | 'processing' | 'embedding' | 'vector-storage';
    timestamp: string;
    metadata?: {
        processingTime?: number;
        errorMessage?: string;
        fileSize?: number;
        chunkCount?: number;
        embeddingCount?: number;
        vectorCount?: number;
        [key: string]: any;
    };
}

interface ServiceEndpoints {
    ingestion: string;
    processing: string;
    embedding: string;
    vectorStorage: string;
}

export class DocumentTracker {
    private endpoints: ServiceEndpoints;
    private token: string;

    constructor(endpoints: ServiceEndpoints, authToken: string) {
        this.endpoints = endpoints;
        this.token = authToken;
    }

    /**
     * Track a document through the entire RAG pipeline
     * Returns a promise that resolves when the document reaches the final stage or fails
     */
    async trackDocument(documentId: string, progressCallback?: (status: DocumentStatus) => void): Promise<DocumentStatus> {
        console.log(`Starting document tracking for: ${documentId}`);
        
        const stages = [
            { name: 'ingestion' as const, endpoint: this.endpoints.ingestion },
            { name: 'processing' as const, endpoint: this.endpoints.processing },
            { name: 'embedding' as const, endpoint: this.endpoints.embedding },
            { name: 'vector-storage' as const, endpoint: this.endpoints.vectorStorage }
        ];

        let currentStageIndex = 0;
        let finalStatus: DocumentStatus | null = null;

        while (currentStageIndex < stages.length) {
            const stage = stages[currentStageIndex];
            
            try {
                console.log(`Checking ${stage.name} status for document ${documentId}`);
                const status = await this.checkStageStatus(documentId, stage.endpoint);
                
                if (progressCallback) {
                    progressCallback(status);
                }
                
                if (status.status === 'completed') {
                    console.log(`${stage.name} completed for document ${documentId}`);
                    currentStageIndex++;
                    
                    if (currentStageIndex >= stages.length) {
                        finalStatus = status;
                        break;
                    }
                } else if (status.status === 'failed') {
                    console.error(`${stage.name} failed for document ${documentId}:`, status.metadata?.errorMessage);
                    finalStatus = status;
                    break;
                } else {
                    console.log(`${stage.name} status: ${status.status} for document ${documentId}`);
                    await this.sleep(2000);
                }
                
            } catch (error) {
                console.error(`Error checking ${stage.name} status for document ${documentId}:`, error);
                
                finalStatus = {
                    documentId,
                    status: 'failed',
                    stage: stage.name,
                    timestamp: new Date().toISOString(),
                    metadata: {
                        errorMessage: `Failed to check ${stage.name} status: ${error instanceof Error ? error.message : 'Unknown error'}`
                    }
                };
                break;
            }
        }

        if (!finalStatus) {
            finalStatus = {
                documentId,
                status: 'failed',
                stage: 'vector-storage',
                timestamp: new Date().toISOString(),
                metadata: {
                    errorMessage: 'Tracking completed without final status'
                }
            };
        }

        console.log(`Document tracking completed for ${documentId}:`, finalStatus);
        return finalStatus;
    }

    /**
     * Get the current status of a document at all stages
     */
    async getAllStageStatuses(documentId: string): Promise<{ [stage: string]: DocumentStatus }> {
        const stages = [
            { name: 'ingestion', endpoint: this.endpoints.ingestion },
            { name: 'processing', endpoint: this.endpoints.processing },
            { name: 'embedding', endpoint: this.endpoints.embedding },
            { name: 'vector-storage', endpoint: this.endpoints.vectorStorage }
        ];

        const statuses: { [stage: string]: DocumentStatus } = {};

        const promises = stages.map(async (stage) => {
            try {
                const status = await this.checkStageStatus(documentId, stage.endpoint);
                statuses[stage.name] = status;
                console.log(`✅ ${stage.name} service responded:`, status);
            } catch (error) {
                console.error(`❌ Error checking ${stage.name} status:`, error);
                
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                const isNetworkError = errorMessage.includes('Failed to fetch') || errorMessage.includes('Network error');
                const isNotFoundError = errorMessage.includes('404') || errorMessage.includes('Not Found');
                
                let statusValue: DocumentStatus['status'] = 'failed';
                let displayMessage = '';
                
                if (isNetworkError) {
                    if (stage.name === 'vector-storage') {
                        statusValue = 'pending';
                        displayMessage = `Vector storage service not available (service may be temporarily unavailable)`;
                    } else {
                        statusValue = 'pending';
                        displayMessage = `Service not available: ${errorMessage}`;
                    }
                } else if (isNotFoundError) {
                    statusValue = 'pending';
                    displayMessage = `Document not found at this stage (hasn't reached ${stage.name} yet)`;
                } else {
                    displayMessage = `Failed to check status: ${errorMessage}`;
                }
                
                statuses[stage.name] = {
                    documentId,
                    status: statusValue,
                    stage: stage.name as any,
                    timestamp: new Date().toISOString(),
                    metadata: {
                        errorMessage: displayMessage,
                        originalError: errorMessage,
                        errorType: isNetworkError ? 'network' : isNotFoundError ? 'not_found' : 'other'
                    }
                };
            }
        });

        await Promise.all(promises);
        return statuses;
    }

    /**
     * Check the status of a document at a specific service endpoint
     */
    private async checkStageStatus(documentId: string, endpoint: string): Promise<DocumentStatus> {
        const url = endpoint.endsWith('/status') ? `${endpoint}/${documentId}` : `${endpoint}/status/${documentId}`;
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${this.token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const rawResponse = await response.json();
        
        return this.mapServiceResponse(rawResponse, endpoint);
    }

    /**
     * Map service-specific response formats to standardized DocumentStatus
     */
    private mapServiceResponse(rawResponse: any, endpoint: string): DocumentStatus {
        const isIngestionService = endpoint.includes('ragingest') || endpoint.includes('up-api');
        const isProcessingService = endpoint.includes('ragproc') || endpoint.includes('pr-api');
        const isEmbeddingService = endpoint.includes('ragembed') || endpoint.includes('em-api');
        const isVectorStorageService = endpoint.includes('ragvector') || endpoint.includes('vs-api');

        let stage: DocumentStatus['stage'] = 'ingestion';
        if (isProcessingService) stage = 'processing';
        else if (isEmbeddingService) stage = 'embedding';
        else if (isVectorStorageService) stage = 'vector-storage';

        if (isIngestionService) {
            let mappedStatus: DocumentStatus['status'] = 'pending';
            
            switch (rawResponse.status) {
                case 'validated':
                    mappedStatus = 'completed';
                    break;
                case 'completed':
                    mappedStatus = 'completed';
                    break;
                case 'rejected':
                case 'quarantined':
                    mappedStatus = 'failed';
                    break;
                case 'pending':
                case 'uploaded':
                    mappedStatus = 'pending';
                    break;
                case 'processing':
                    mappedStatus = 'processing';
                    break;
                default:
                    mappedStatus = 'pending';
            }

            return {
                documentId: rawResponse.documentId,
                status: mappedStatus,
                stage: stage,
                timestamp: rawResponse.validatedAt || rawResponse.timestamp || new Date().toISOString(),
                metadata: {
                    fileSize: rawResponse.fileSize,
                    fileName: rawResponse.fileName,
                    location: rawResponse.location,
                    userIdentityId: rawResponse.userIdentityId,
                    requestId: rawResponse.requestId,
                    executionTimeMs: rawResponse.executionTimeMs,
                    errorMessage: rawResponse.errorMessage,
                    originalResponse: rawResponse
                }
            };
        }

        return {
            documentId: rawResponse.documentId || rawResponse.id,
            status: rawResponse.status === 'completed' ? 'completed' : 
                   rawResponse.status === 'failed' ? 'failed' :
                   rawResponse.status === 'processing' ? 'processing' : 'pending',
            stage: stage,
            timestamp: rawResponse.timestamp || new Date().toISOString(),
            metadata: rawResponse
        };
    }

    /**
     * Utility method to sleep for a specified number of milliseconds
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Get a summary of the pipeline status for a document
     */
    async getPipelineSummary(documentId: string): Promise<{
        documentId: string;
        overallStatus: 'pending' | 'processing' | 'completed' | 'failed';
        currentStage: string;
        completedStages: string[];
        failedStages: string[];
        totalProcessingTime: number;
        stageDetails: { [stage: string]: DocumentStatus };
    }> {
        const allStatuses = await this.getAllStageStatuses(documentId);
        
        const stages = ['ingestion', 'processing', 'embedding', 'vector-storage'];
        const completedStages: string[] = [];
        const failedStages: string[] = [];
        const unavailableStages: string[] = [];
        let currentStage = 'ingestion';
        let overallStatus: 'pending' | 'processing' | 'completed' | 'failed' = 'pending';
        let totalProcessingTime = 0;

        for (const stage of stages) {
            const status = allStatuses[stage];
            
            if (status) {
                if (status.status === 'completed') {
                    completedStages.push(stage);
                    if (status.metadata?.processingTime) {
                        totalProcessingTime += status.metadata.processingTime;
                    } else if (status.metadata?.executionTimeMs) {
                        totalProcessingTime += status.metadata.executionTimeMs;
                    }
                } else if (status.status === 'failed' && status.metadata?.errorType !== 'network') {
                    failedStages.push(stage);
                    overallStatus = 'failed';
                    currentStage = stage;
                    break;
                } else if (status.status === 'processing') {
                    overallStatus = 'processing';
                    currentStage = stage;
                    break;
                } else {
                    if (status.metadata?.errorType === 'network') {
                        unavailableStages.push(stage);
                    }
                    currentStage = stage;
                    break;
                }
            }
        }

        if (completedStages.length === stages.length && failedStages.length === 0) {
            overallStatus = 'completed';
            currentStage = 'vector-storage';
        } else if (completedStages.length > 0 && failedStages.length === 0) {
            if (completedStages.includes('embedding') && unavailableStages.includes('vector-storage')) {
                overallStatus = 'processing';
                currentStage = 'vector-storage';
            } else if (completedStages.includes('ingestion') && unavailableStages.length > 0) {
                overallStatus = 'processing';
                for (const stage of stages) {
                    if (!completedStages.includes(stage) && !unavailableStages.includes(stage)) {
                        currentStage = stage;
                        break;
                    }
                }
            } else {
                overallStatus = 'processing';
            }
        }

        const summary = {
            documentId,
            overallStatus,
            currentStage,
            completedStages,
            failedStages,
            totalProcessingTime,
            stageDetails: allStatuses
        };

        console.log(`📊 Pipeline Summary for ${documentId}:`, {
            ...summary,
            unavailableStages,
            stageStatuses: Object.fromEntries(
                Object.entries(allStatuses).map(([stage, status]) => [
                    stage, 
                    {
                        status: status.status, 
                        errorType: status.metadata?.errorType,
                        timestamp: status.timestamp
                    }
                ])
            )
        });

        return summary;
    }
}

/**
 * Example usage function showing how to use the DocumentTracker
 */
export async function trackDocumentExample(documentId: string, authToken: string) {
    const endpoints: ServiceEndpoints = {
        ingestion: 'https://up-api.dev.ragDocumentIngestion.yourdomain.com',
        processing: 'https://st-api.dev.ragDocumentProcessing.yourdomain.com',
        embedding: 'https://eb-api.dev.ragEmbedding.yourdomain.com',
        vectorStorage: 'https://vs-api.dev.ragVectorStorage.yourdomain.com'
    };

    const tracker = new DocumentTracker(endpoints, authToken);

    console.log('Starting document tracking with progress updates...');
    
    const finalStatus = await tracker.trackDocument(documentId, (status) => {
        console.log(`Progress update - ${status.stage}: ${status.status}`);
        if (status.metadata?.errorMessage) {
            console.error(`Error in ${status.stage}: ${status.metadata.errorMessage}`);
        }
    });

    console.log('Final status:', finalStatus);

    const summary = await tracker.getPipelineSummary(documentId);
    console.log('Pipeline summary:', summary);

    const allStatuses = await tracker.getAllStageStatuses(documentId);
    console.log('All stage statuses:', allStatuses);

    return {
        finalStatus,
        summary,
        allStatuses
    };
} 