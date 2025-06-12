import type {AwsCredentialIdentity} from '@aws-sdk/types';
import {getConfig} from './config.js';
import {SignatureV4} from '@aws-sdk/signature-v4';
import {Sha256} from '@aws-crypto/sha256-js';

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
    private credentials: AwsCredentialIdentity | null = null;

    async initialize(credentials: AwsCredentialIdentity): Promise<void> {
        this.credentials = credentials;
    }

    async requestUploadUrl(fileName: string, fileType: string, fileSize: number): Promise<UploadResponse> {
        if (!this.credentials) {
            throw new Error('DocumentService not initialized with credentials');
        }

        try {
            const response = await this.authenticatedFetch('/upload', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
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

            return await response.json();
        } catch (error) {
            console.error('Error requesting upload URL:', error);
            throw error;
        }
    }

    async uploadDocument(file: File, progressCallback?: (progress: number) => void): Promise<string> {
        try {
            progressCallback?.(10);

            // Step 1: Request upload URL
            const uploadResponse = await this.requestUploadUrl(file.name, file.type, file.size);
            progressCallback?.(20);

            // Step 2: Upload directly to S3 using presigned URL
            const formData = new FormData();

            // Add all the required fields from the presigned POST
            Object.entries(uploadResponse.fields).forEach(([key, value]) => {
                formData.append(key, value);
            });

            // Add the file (must be last)
            formData.append('file', file);
            progressCallback?.(30);

            // Use XMLHttpRequest for progress tracking
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

                xhr.open('POST', uploadResponse.uploadUrl);
                xhr.send(formData);
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
        if (!this.credentials) {
            throw new Error('DocumentService not initialized with credentials');
        }

        try {
            const response = await this.authenticatedFetch(`/status/${documentId}`, {
                method: 'GET',
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

    private async authenticatedFetch(
        path: string,
        options: RequestInit
    ): Promise<Response> {
        if (!this.credentials) {
            throw new Error('DocumentService not initialized with credentials');
        }

        const config = getConfig();
        const url = new URL(`${config.aws.apiEndpoint.replace(/\/$/, '')}${path}`);

        // Create simple request object like the working GraphQL client
        const request = {
            method: options.method || 'GET',
            protocol: 'https:',
            hostname: url.hostname,
            path: url.pathname + url.search,
            headers: {
                'Content-Type': 'application/json',
                'host': url.hostname,
                ...(options.headers as Record<string, string>),
            },
            body: options.body || '',
        };

        // Sign the request using AWS Signature V4 (same pattern as working GraphQL client)
        const signer = new SignatureV4({
            credentials: this.credentials,
            region: config.aws.region,
            service: 'execute-api',
            sha256: Sha256,
        });

        const signedRequest = await signer.sign(request);
        console.log('signedRequest:', JSON.stringify({
            method: signedRequest.method,
            hostname: signedRequest.hostname,
            query: signedRequest.query,
            headers: signedRequest.headers,
            body: signedRequest.body,
            protocol: signedRequest.protocol,
            path: signedRequest.path
        }, null, 2));

        // Convert signed request back to fetch options
        return fetch(url.toString(), {
            method: signedRequest.method,
            headers: signedRequest.headers as Record<string, string>,
            body: signedRequest.body,
        });
    }
} 