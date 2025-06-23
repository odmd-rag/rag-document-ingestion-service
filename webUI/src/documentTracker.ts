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
                
                // Call progress callback if provided
                if (progressCallback) {
                    progressCallback(status);
                }
                
                if (status.status === 'completed') {
                    // Stage completed, move to next stage
                    console.log(`${stage.name} completed for document ${documentId}`);
                    currentStageIndex++;
                    
                    // If this was the last stage, we're done
                    if (currentStageIndex >= stages.length) {
                        finalStatus = status;
                        break;
                    }
                } else if (status.status === 'failed') {
                    // Stage failed, return the failure status
                    console.error(`${stage.name} failed for document ${documentId}:`, status.metadata?.errorMessage);
                    finalStatus = status;
                    break;
                } else {
                    // Stage is pending or processing, wait and check again
                    console.log(`${stage.name} status: ${status.status} for document ${documentId}`);
                    await this.sleep(2000); // Wait 2 seconds before checking again
                }
                
            } catch (error) {
                console.error(`Error checking ${stage.name} status for document ${documentId}:`, error);
                
                // Return a failed status
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
            // This shouldn't happen, but just in case
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

        // Check all stages in parallel
        const promises = stages.map(async (stage) => {
            try {
                const status = await this.checkStageStatus(documentId, stage.endpoint);
                statuses[stage.name] = status;
            } catch (error) {
                console.error(`Error checking ${stage.name} status:`, error);
                statuses[stage.name] = {
                    documentId,
                    status: 'failed',
                    stage: stage.name as any,
                    timestamp: new Date().toISOString(),
                    metadata: {
                        errorMessage: `Failed to check status: ${error instanceof Error ? error.message : 'Unknown error'}`
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
        const url = `${endpoint}/status/${documentId}`;
        
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

        const status: DocumentStatus = await response.json();
        return status;
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
    }> {
        const allStatuses = await this.getAllStageStatuses(documentId);
        
        const stages = ['ingestion', 'processing', 'embedding', 'vector-storage'];
        const completedStages: string[] = [];
        const failedStages: string[] = [];
        let currentStage = 'ingestion';
        let overallStatus: 'pending' | 'processing' | 'completed' | 'failed' = 'pending';
        let totalProcessingTime = 0;

        // Analyze statuses to determine overall state
        for (const stage of stages) {
            const status = allStatuses[stage];
            
            if (status) {
                if (status.status === 'completed') {
                    completedStages.push(stage);
                    if (status.metadata?.processingTime) {
                        totalProcessingTime += status.metadata.processingTime;
                    }
                } else if (status.status === 'failed') {
                    failedStages.push(stage);
                    overallStatus = 'failed';
                    currentStage = stage;
                    break;
                } else if (status.status === 'processing') {
                    overallStatus = 'processing';
                    currentStage = stage;
                    break;
                } else {
                    // pending
                    currentStage = stage;
                    break;
                }
            }
        }

        // If all stages completed, overall status is completed
        if (completedStages.length === stages.length && failedStages.length === 0) {
            overallStatus = 'completed';
            currentStage = 'vector-storage';
        } else if (completedStages.length > 0 && failedStages.length === 0) {
            overallStatus = 'processing';
        }

        return {
            documentId,
            overallStatus,
            currentStage,
            completedStages,
            failedStages,
            totalProcessingTime
        };
    }
}

/**
 * Example usage function showing how to use the DocumentTracker
 */
export async function trackDocumentExample(documentId: string, authToken: string) {
    // Configure service endpoints based on environment (using buildId pattern)
    const endpoints: ServiceEndpoints = {
        ingestion: 'https://up-api.dev.ragDocumentIngestion.yourdomain.com',
        processing: 'https://st-api.dev.ragDocumentProcessing.yourdomain.com',
        embedding: 'https://eb-api.dev.ragEmbedding.yourdomain.com',
        vectorStorage: 'https://vs-api.dev.ragVectorStorage.yourdomain.com'
    };

    const tracker = new DocumentTracker(endpoints, authToken);

    // Example 1: Track document with progress callback
    console.log('Starting document tracking with progress updates...');
    
    const finalStatus = await tracker.trackDocument(documentId, (status) => {
        console.log(`Progress update - ${status.stage}: ${status.status}`);
        if (status.metadata?.errorMessage) {
            console.error(`Error in ${status.stage}: ${status.metadata.errorMessage}`);
        }
    });

    console.log('Final status:', finalStatus);

    // Example 2: Get pipeline summary
    const summary = await tracker.getPipelineSummary(documentId);
    console.log('Pipeline summary:', summary);

    // Example 3: Get all stage statuses at once
    const allStatuses = await tracker.getAllStageStatuses(documentId);
    console.log('All stage statuses:', allStatuses);

    return {
        finalStatus,
        summary,
        allStatuses
    };
} 