import { DocumentValidationService, ValidationRequest } from '../src/lambdas/document-validation/validation-service';
import { SchemaRegistry } from '../src/services/schema-registry';

describe('DocumentValidationService', () => {
  let validationService: DocumentValidationService;
  let schemaRegistry: SchemaRegistry;

  beforeEach(() => {
    validationService = new DocumentValidationService();
    schemaRegistry = new SchemaRegistry();
  });

  describe('File Size Validation', () => {
    it('should reject files exceeding maximum size', async () => {
      const request: ValidationRequest = {
        bucket: 'test-bucket',
        key: 'test.pdf',
        body: Buffer.alloc(105000000),
        contentType: 'application/pdf',
        fileSize: 105000000,
        originalFileName: 'large-file.pdf',
      };

      const result = await validationService.validateDocument(request);

      expect(result.status).toBe('rejected');
      expect(result.rejectionReason).toBe('File size exceeds maximum allowed limit');
      expect(result.appliedRules).toContain('file-size-check');
    });

    it('should accept files within size limit', async () => {
      const request: ValidationRequest = {
        bucket: 'test-bucket',
        key: 'test.pdf',
        body: Buffer.from('PDF content'),
        contentType: 'application/pdf',
        fileSize: 1000,
        originalFileName: 'small-file.pdf',
      };

      const result = await validationService.validateDocument(request);

      expect(result.status).toBe('validated');
      expect(result.appliedRules).toContain('file-size-check');
    });
  });

  describe('MIME Type Validation', () => {
    it('should accept supported MIME types', async () => {
      const supportedTypes = [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain',
        'text/html',
        'text/markdown',
        'text/csv',
        'application/json',
      ];

      for (const contentType of supportedTypes) {
        const request: ValidationRequest = {
          bucket: 'test-bucket',
          key: 'test-file',
          body: Buffer.from('test content'),
          contentType,
          fileSize: 1000,
          originalFileName: `test.${contentType.split('/')[1]}`,
        };

        const result = await validationService.validateDocument(request);
        expect(result.status).toBe('validated');
      }
    });

    it('should reject unsupported MIME types', async () => {
      const request: ValidationRequest = {
        bucket: 'test-bucket',
        key: 'test.exe',
        body: Buffer.from('executable content'),
        contentType: 'application/octet-stream',
        fileSize: 1000,
        originalFileName: 'malware.exe',
      };

      const result = await validationService.validateDocument(request);

      expect(result.status).toBe('rejected');
      expect(result.rejectionReason).toBe('Unsupported file type');
      expect(result.appliedRules).toContain('mime-type-check');
    });
  });

  describe('Content Analysis', () => {
    it('should quarantine files with malicious scripts', async () => {
      const maliciousContent = '<script>alert("malicious")</script>';
      const request: ValidationRequest = {
        bucket: 'test-bucket',
        key: 'malicious.html',
        body: Buffer.from(maliciousContent),
        contentType: 'text/html',
        fileSize: maliciousContent.length,
        originalFileName: 'malicious.html',
      };

      const result = await validationService.validateDocument(request);

      expect(result.status).toBe('quarantined');
      expect(result.quarantineReason).toBe('Potentially malicious content detected');
      expect(result.securityFlags).toContain('malicious-script-detected');
      expect(result.escalationLevel).toBe('high');
    });

    it('should quarantine files with suspicious keywords', async () => {
      const suspiciousContent = 'This file contains malware instructions';
      const request: ValidationRequest = {
        bucket: 'test-bucket',
        key: 'suspicious.txt',
        body: Buffer.from(suspiciousContent),
        contentType: 'text/plain',
        fileSize: suspiciousContent.length,
        originalFileName: 'suspicious.txt',
      };

      const result = await validationService.validateDocument(request);

      expect(result.status).toBe('quarantined');
      expect(result.quarantineReason).toBe('Suspicious content requires review');
      expect(result.securityFlags).toContain('suspicious-keywords');
      expect(result.escalationLevel).toBe('medium');
    });
  });

  describe('Document Structure Validation', () => {
    it('should validate JSON structure', async () => {
      const validJson = '{"test": "value", "number": 123}';
      const request: ValidationRequest = {
        bucket: 'test-bucket',
        key: 'test.json',
        body: Buffer.from(validJson),
        contentType: 'application/json',
        fileSize: validJson.length,
        originalFileName: 'test.json',
      };

      const result = await validationService.validateDocument(request);

      expect(result.status).toBe('validated');
      expect(result.documentType).toBe('json');
      expect(result.appliedRules).toContain('structure-validation');
    });

    it('should reject invalid JSON structure', async () => {
      const invalidJson = '{"test": "value", "number":}';
      const request: ValidationRequest = {
        bucket: 'test-bucket',
        key: 'invalid.json',
        body: Buffer.from(invalidJson),
        contentType: 'application/json',
        fileSize: invalidJson.length,
        originalFileName: 'invalid.json',
      };

      const result = await validationService.validateDocument(request);

      expect(result.status).toBe('rejected');
      expect(result.rejectionReason).toBe('Invalid document structure');
      expect(result.appliedRules).toContain('structure-validation');
    });
  });

  describe('Processing Configuration', () => {
    it('should set high priority for files requiring OCR', async () => {
      const pdfWithImages = Buffer.concat([
        Buffer.from('%PDF-1.4'),
        Buffer.from([0xFF, 0xD8, 0xFF]),
      ]);

      const request: ValidationRequest = {
        bucket: 'test-bucket',
        key: 'image-pdf.pdf',
        body: pdfWithImages,
        contentType: 'application/pdf',
        fileSize: pdfWithImages.length,
        originalFileName: 'image-pdf.pdf',
      };

      const result = await validationService.validateDocument(request);

      expect(result.status).toBe('validated');
      expect(result.priority).toBe('high');
      expect(result.hasImages).toBe(true);
      expect(result.requiresOcr).toBe(true);
    });

    it('should set low priority for large files', async () => {
      const largeContent = Buffer.alloc(60 * 1024 * 1024);
      largeContent.write('%PDF-1.4', 0);

      const request: ValidationRequest = {
        bucket: 'test-bucket',
        key: 'large.pdf',
        body: largeContent,
        contentType: 'application/pdf',
        fileSize: largeContent.length,
        originalFileName: 'large.pdf',
      };

      const result = await validationService.validateDocument(request);

      expect(result.status).toBe('validated');
      expect(result.priority).toBe('low');
    });
  });
});

describe('SchemaRegistry', () => {
  let schemaRegistry: SchemaRegistry;

  beforeEach(() => {
    schemaRegistry = new SchemaRegistry();
  });

  describe('Schema Registration', () => {
    it('should register default schemas on initialization', () => {
      const schemas = schemaRegistry.getAllSchemas();

      expect(schemas).toHaveLength(3);
      
      const contractPaths = schemas.map(s => s.contractPath);
      expect(contractPaths).toContain('documentValidationEvents.eventBridge.documentValidatedEventSchema');
      expect(contractPaths).toContain('documentValidationEvents.eventBridge.documentRejectedEventSchema');
      expect(contractPaths).toContain('documentValidationEvents.eventBridge.documentQuarantinedEventSchema');
    });

    it('should retrieve schemas by contract path', () => {
      const validatedSchema = schemaRegistry.getSchema(
        'documentValidationEvents.eventBridge.documentValidatedEventSchema'
      );

      expect(validatedSchema).toBeDefined();
      expect(validatedSchema?.version).toBe('1.0.0');
      expect(validatedSchema?.description).toContain('validation');
    });

    it('should export metadata for OndemandEnv platform', () => {
      const metadata = schemaRegistry.exportMetadata();

      expect(metadata.service).toBe('rag-document-ingestion');
      expect(metadata.version).toBe('1.0.0');
      expect(metadata.schemas).toHaveLength(3);
      
      metadata.schemas.forEach(schema => {
        expect(schema.contractPath).toBeDefined();
        expect(schema.version).toBeDefined();
        expect(schema.description).toBeDefined();
        expect(schema.schemaHash).toBeDefined();
      });
    });
  });

  describe('Schema Validation', () => {
    it('should validate data existence for registered schemas', () => {
      const result = schemaRegistry.validateData(
        'documentValidationEvents.eventBridge.documentValidatedEventSchema',
        { test: 'data' }
      );

      expect(result.isValid).toBe(true);
    });

    it('should fail validation for unregistered schemas', () => {
      const result = schemaRegistry.validateData(
        'nonexistent.schema.path',
        { test: 'data' }
      );

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Schema not found for contract path: nonexistent.schema.path');
    });
  });
}); 