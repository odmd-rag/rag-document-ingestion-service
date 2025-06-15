import {getConfig} from './config.js';

export interface UploadResponse {
    uploadUrl: string;
    documentId: string;
    fields: Record<string, string>;
}

export interface DocumentStatus {
    documentId: string;
    status: 'uploaded' | 'processing' | 'validated' | 'quarantined' | 'failed' | 'completed';
    message?: string;
    timestamp: string;
}

export class DocumentService {
    private idToken: string | null = null;

    async initialize(credentials: string): Promise<void> {
        this.idToken = credentials;
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

            return await response.json();
        } catch (error) {
            console.error('Error getting document status:', error);
            throw error;
        }
    }


}