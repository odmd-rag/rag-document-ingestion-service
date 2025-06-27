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
        
        // Initialize DocumentTracker with service endpoints
        const config = getConfig();
        
        // Check if services configuration is available
        if (!config.services) {
            console.warn('⚠️ Services configuration not available - using fallback endpoints for development');
            // Fallback to legacy single-service tracking
            this.documentTracker = null;
            return;
        }
        
        // Validate downstream service endpoints are available
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
            ingestion: config.aws.apiEndpoint, // Use local ingestion service base endpoint
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
        
        // Handle the actual API response structure
        if (result.success && result.data) {
            return {
                uploadUrl: result.data.uploadUrl,
                documentId: result.data.uploadId,
                fields: {} // The upload URL is already presigned, no additional fields needed
            };
        } else {
            throw new Error('Invalid response format from upload API');
        }
    }

    async uploadDocument(file: File, progressCallback?: (progress: number) => void): Promise<string> {
        try {
            progressCallback?.(10);

            // Step 1: Request upload URL
            const uploadResponse = await this.requestUploadUrl(file.name, file.type, file.size);
            progressCallback?.(20);

            // Step 2: Upload directly to S3 using presigned URL
            progressCallback?.(30);

            // Use XMLHttpRequest for progress tracking with PUT method for presigned URL
            const uploadResult = await new Promise<Response>((resolve, reject) => {
                const xhr = new XMLHttpRequest();

                xhr.upload.addEventListener('progress', (event) => {
                    if (event.lengthComputable) {
                        // Progress from 30% to 90% during upload
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

                // For presigned PUT URLs, we send the file directly
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

    // Legacy method - only checks ingestion service
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
            
            // Map ingestion service status to standardized format
            return this.mapIngestionStatus(result);
        } catch (error) {
            console.error('Error getting document status:', error);
            throw error;
        }
    }

    // New comprehensive method - tracks across all services
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

    // Track document through entire pipeline with progress callback
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

    // Map ingestion service status to standardized format
    private mapIngestionStatus(ingestionResult: any): DocumentStatus {
        const mapped: DocumentStatus = {
            documentId: ingestionResult.documentId,
            status: 'processing', // default
            timestamp: ingestionResult.timestamp || new Date().toISOString(),
            stage: 'ingestion',
            message: ingestionResult.errorMessage,
            metadata: ingestionResult
        };

        // Map ingestion service statuses to our standardized statuses
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