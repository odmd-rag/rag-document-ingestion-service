import {getConfig} from './config.ts';
import {DocumentTracker} from './documentTracker.ts';

export interface UploadResponse {
    uploadUrl: string;
    documentId: string;
    fields: Record<string, string>;
}

export interface DocumentStatus {
    documentId: string;
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'uploaded' | 'validated' | 'quarantined';
    message?: string;
    timestamp: string;
    stage?: 'ingestion' | 'processing' | 'embedding' | 'vector-storage';
    metadata?: any;
}

export interface PipelineStatus {
    documentId: string;
    overallStatus: 'pending' | 'processing' | 'completed' | 'failed';
    currentStage: string;
    completedStages: string[];
    failedStages: string[];
    totalProcessingTime: number;
    stageDetails: { [stage: string]: DocumentStatus };
}

export class DocumentService {
    private idToken: string | null = null;
    private documentTracker: DocumentTracker | null = null;

    async initialize(credentials: string): Promise<void> {
        this.idToken = credentials;
        
        const config = getConfig();
        
        if (!config.services) {
            console.warn('⚠️ Services configuration not available - using fallback endpoints for development');
            this.documentTracker = null;
            return;
        }
        
        if (!config.services?.processing || !config.services?.embedding || !config.services?.vectorStorage) {
            const missing = [];
            if (!config.services?.processing) missing.push('processing');
            if (!config.services?.embedding) missing.push('embedding');
            if (!config.services?.vectorStorage) missing.push('vectorStorage');
            
            console.warn(`⚠️ Missing downstream service endpoints: ${missing.join(', ')} - falling back to legacy tracking`);
            this.documentTracker = null;
            return;
        }
        
        const endpoints = {
            ingestion: config.aws.apiEndpoint,
            processing: config.services.processing,
            embedding: config.services.embedding,
            vectorStorage: config.services.vectorStorage
        };
        
        this.documentTracker = new DocumentTracker(endpoints, credentials);
        console.log('✅ DocumentTracker initialized with all service endpoints');
    }

    async requestUploadUrl(fileName: string, fileType: string, fileSize: number): Promise<UploadResponse> {
        if (!this.idToken) {
            throw new Error('DocumentService not initialized with idToken');
        }

        const config = getConfig();

        const response = await fetch(`${config.aws.apiEndpoint}/upload`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.idToken}`,
            },
            body: JSON.stringify({
                fileName,
                fileType,
                fileSize
            }),
        });

        if (!response.ok) {
            throw new Error(`Failed to get upload URL: ${response.statusText}`);
        }

        const result = await response.json();
        
        if (result.success && result.data) {
            return {
                uploadUrl: result.data.uploadUrl,
                documentId: result.data.uploadId,
                fields: {}
            };
        } else {
            throw new Error('Invalid response format from upload API');
        }
    }

    async uploadDocument(file: File, progressCallback?: (progress: number) => void): Promise<string> {
        try {
            progressCallback?.(10);

            const uploadResponse = await this.requestUploadUrl(file.name, file.type, file.size);
            progressCallback?.(20);

            progressCallback?.(30);

            const uploadResult = await new Promise<Response>((resolve, reject) => {
                const xhr = new XMLHttpRequest();

                xhr.upload.addEventListener('progress', (event) => {
                    if (event.lengthComputable) {
                        const uploadProgress = 30 + (event.loaded / event.total) * 60;
                        progressCallback?.(Math.round(uploadProgress));
                    }
                });

                xhr.addEventListener('load', () => {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        resolve(new Response(xhr.response, {status: xhr.status, statusText: xhr.statusText}));
                    } else {
                        reject(new Error(`Upload failed: ${xhr.statusText}`));
                    }
                });

                xhr.addEventListener('error', () => {
                    reject(new Error('Upload failed due to network error'));
                });

                xhr.open('PUT', uploadResponse.uploadUrl);
                xhr.setRequestHeader('Content-Type', file.type);
                xhr.send(file);
            });

            if (!uploadResult.ok) {
                throw new Error(`Upload failed: ${uploadResult.statusText}`);
            }

            progressCallback?.(95);
            return uploadResponse.documentId;
        } catch (error) {
            console.error('Error uploading document:', error);
            throw error;
        }
    }

    async getUploadStatus(documentId: string): Promise<DocumentStatus> {
        if (!this.idToken) {
            throw new Error('DocumentService not initialized with idToken');
        }
        const config = getConfig();

        try {
            const response = await fetch(`${config.aws.apiEndpoint}/status/${documentId}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.idToken}`,
                },
            });

            if (!response.ok) {
                throw new Error(`Failed to get document status: ${response.statusText}`);
            }

            const result = await response.json();
            
            return this.mapIngestionStatus(result);
        } catch (error) {
            console.error('Error getting document status:', error);
            throw error;
        }
    }

    async getPipelineStatus(documentId: string): Promise<PipelineStatus> {
        if (!this.documentTracker) {
            throw new Error('DocumentService not properly initialized with DocumentTracker');
        }

        try {
            return await this.documentTracker.getPipelineSummary(documentId);
        } catch (error) {
            console.error('Error getting pipeline status:', error);
            throw error;
        }
    }

    async trackDocument(documentId: string, progressCallback?: (status: any) => void): Promise<any> {
        if (!this.documentTracker) {
            throw new Error('DocumentService not properly initialized with DocumentTracker');
        }

        try {
            return await this.documentTracker.trackDocument(documentId, progressCallback);
        } catch (error) {
            console.error('Error tracking document:', error);
            throw error;
        }
    }

    private mapIngestionStatus(ingestionResult: any): DocumentStatus {
        const mapped: DocumentStatus = {
            documentId: ingestionResult.documentId,
            status: 'processing',
            timestamp: ingestionResult.timestamp || new Date().toISOString(),
            stage: 'ingestion',
            message: ingestionResult.errorMessage,
            metadata: ingestionResult
        };

        switch (ingestionResult.status) {
            case 'validated':
                mapped.status = 'validated';
                break;
            case 'rejected':
                mapped.status = 'failed';
                mapped.message = ingestionResult.errorMessage || 'Document was rejected during validation';
                break;
            case 'quarantined':
                mapped.status = 'quarantined';
                mapped.message = ingestionResult.errorMessage || 'Document was quarantined';
                break;
            case 'pending':
                mapped.status = 'pending';
                break;
            case 'not_found':
                mapped.status = 'failed';
                mapped.message = 'Document not found';
                break;
            case 'completed':
                mapped.status = 'completed';
                break;
            case 'uploaded':
                mapped.status = 'uploaded';
                break;
            default:
                mapped.status = 'processing';
        }

        return mapped;
    }
}