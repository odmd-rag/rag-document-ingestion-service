import { AuthService } from './auth';
import { getConfig } from './config';
import { HttpRequest } from '@aws-sdk/protocol-http';
import { SignatureV4 } from '@aws-sdk/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-browser';

export interface UploadResponse {
  uploadUrl: string;
  documentId: string;
  fields: Record<string, string>;
}

export interface DocumentStatus {
  documentId: string;
  status: 'uploaded' | 'processing' | 'validated' | 'quarantined' | 'failed';
  message?: string;
  timestamp: string;
}

export class DocumentService {
  private authService: AuthService;

  constructor(authService: AuthService) {
    this.authService = authService;
  }

  async requestUploadUrl(fileName: string, fileType: string): Promise<UploadResponse> {
    if (!this.authService.isAuthenticated()) {
      throw new Error('User must be authenticated to upload documents');
    }

    const credentials = this.authService.getCredentials();
    if (!credentials) {
      throw new Error('No valid credentials available');
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
        }),
      }, credentials);

      if (!response.ok) {
        throw new Error(`Failed to get upload URL: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error requesting upload URL:', error);
      throw error;
    }
  }

  async uploadDocument(file: File): Promise<string> {
    try {
      // Step 1: Request upload URL
      const uploadResponse = await this.requestUploadUrl(file.name, file.type);

      // Step 2: Upload directly to S3 using presigned URL
      const formData = new FormData();
      
      // Add all the required fields from the presigned POST
      Object.entries(uploadResponse.fields).forEach(([key, value]) => {
        formData.append(key, value);
      });
      
      // Add the file (must be last)
      formData.append('file', file);

      const uploadResult = await fetch(uploadResponse.uploadUrl, {
        method: 'POST',
        body: formData,
      });

      if (!uploadResult.ok) {
        throw new Error(`Upload failed: ${uploadResult.statusText}`);
      }

      return uploadResponse.documentId;
    } catch (error) {
      console.error('Error uploading document:', error);
      throw error;
    }
  }

  async getDocumentStatus(documentId: string): Promise<DocumentStatus> {
    if (!this.authService.isAuthenticated()) {
      throw new Error('User must be authenticated to check document status');
    }

    const credentials = this.authService.getCredentials();
    if (!credentials) {
      throw new Error('No valid credentials available');
    }

    try {
      const response = await this.authenticatedFetch(`/status/${documentId}`, {
        method: 'GET',
      }, credentials);

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
    options: RequestInit,
    credentials: any
  ): Promise<Response> {
    const config = getConfig();
    const url = new URL(`${config.aws.apiEndpoint.replace(/\/$/, '')}${path}`);
    
    // Create HTTP request for signing
    const request = new HttpRequest({
      method: options.method || 'GET',
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port ? parseInt(url.port) : undefined,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        'Host': url.hostname,
        ...(options.headers as Record<string, string>),
      },
      body: options.body,
    });

    // Sign the request using AWS Signature V4
    const signer = new SignatureV4({
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
      },
      region: config.aws.region,
      service: 'execute-api',
      sha256: Sha256,
    });

    const signedRequest = await signer.sign(request);

    // Convert signed request back to fetch options
    return fetch(url.toString(), {
      method: signedRequest.method,
      headers: signedRequest.headers,
      body: signedRequest.body,
    });
  }
} 