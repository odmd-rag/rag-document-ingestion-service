/**
 * Essential types for RAG Document Ingestion
 */

export interface JWTClaims {
  sub: string;
  email?: string;
  name?: string;
  'cognito:groups'?: string[];
  exp: number;
  iat: number;
}

export interface UploadRequest {
  fileName: string;
  fileType: string;
  fileSize: number;
}

export interface UploadResponse {
  uploadId: string;
  uploadUrl: string;
  objectKey: string;
  userEmail?: string;
  expiresIn: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

export interface RequiredEnv {
  DOCUMENT_BUCKET: string;
  AWS_REGION: string;
} 