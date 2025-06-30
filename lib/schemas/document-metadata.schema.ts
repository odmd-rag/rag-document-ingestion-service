import { z } from 'zod';

// Document validation result schema
export const DocumentValidationResultSchema = z.object({
  isValid: z.boolean(),
  validationStatus: z.enum(['approved', 'rejected', 'quarantined']),
  validatedAt: z.string().datetime(),
  validatedBy: z.string(),
  validationComments: z.string().optional(),
  reason: z.string().optional() // For rejected/quarantined documents
});

// Document S3 reference schema
export const DocumentS3ReferenceSchema = z.object({
  bucketName: z.string(),
  objectKey: z.string(),
  contentType: z.string(),
  contentLength: z.number().int().nonnegative(),
  lastModified: z.string().datetime().optional(),
  eTag: z.string().optional(),
  versionId: z.string().optional()
});

// Document S3 tags schema (what's stored in S3 object tags)
export const DocumentS3TagsSchema = z.object({
  'validation-status': z.enum(['approved', 'rejected', 'quarantined']),
  'download-approved': z.enum(['true', 'false']),
  'validated-at': z.string(),
  'validated-by': z.string(),
  'validation-comments': z.string().optional()
});

// Complete document metadata schema (the structure downstream services can expect)
export const DocumentMetadataSchema = z.object({
  documentId: z.string(),
  s3Reference: DocumentS3ReferenceSchema,
  validationResult: DocumentValidationResultSchema,
  s3Tags: DocumentS3TagsSchema,
  ingestedAt: z.string().datetime(),
  processingEligible: z.boolean() // Derived from validation-status === 'approved'
});

// Export TypeScript types
export type DocumentValidationResult = z.infer<typeof DocumentValidationResultSchema>;
export type DocumentS3Reference = z.infer<typeof DocumentS3ReferenceSchema>;
export type DocumentS3Tags = z.infer<typeof DocumentS3TagsSchema>;
export type DocumentMetadata = z.infer<typeof DocumentMetadataSchema>; 