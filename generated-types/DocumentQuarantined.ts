// Auto-generated from local JSON schema
// OndemandEnv: Local fallback for initial deployment

export interface DocumentQuarantined {
  documentId: string;
  userId: string;
  fileName: string;
  quarantineReason: string;
  quarantineCode: string;
  s3Location: {
    bucket: string;
    key: string;
  };
  quarantinedAt: string;
  metadata?: Record<string, any>;
}

export default DocumentQuarantined;
