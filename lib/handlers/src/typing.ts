/**
 * Essential types for RAG Document Ingestion
 */

// JWT Claims from Cognito (what API Gateway gives us)
export interface JWTClaims {
  sub: string;
  email?: string;
  name?: string;
  'cognito:groups'?: string[];
  exp: number;
  iat: number;
}

// Upload request body
export interface UploadRequest {
  fileName: string;
  fileType: string;
  fileSize: number;
}

// Upload response
export interface UploadResponse {
  uploadId: string;
  uploadUrl: string;
  objectKey: string;
  userEmail?: string;
  expiresIn: number;
}

// Standard API response wrapper
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

// Environment variables
export interface RequiredEnv {
  DOCUMENT_BUCKET: string;
  AWS_REGION: string;
} 