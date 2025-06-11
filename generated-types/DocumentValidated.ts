// Auto-generated from local JSON schema
// OndemandEnv: Local fallback for initial deployment

export interface DocumentValidated {
  documentId: string;
  userId: string;
  fileName: string;
  fileSize: number;
  contentType: string;
  s3Location: {
    bucket: string;
    key: string;
  };
  validatedAt: string;
  metadata?: Record<string, any>;
}

export default DocumentValidated;
