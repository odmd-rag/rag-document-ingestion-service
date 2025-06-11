# EventBridge Schema Patterns for OndemandEnv RAG Services

**A hybrid approach for managing event schemas in distributed RAG microservices architecture**

## 🎯 **Strategic Approach: Hybrid Schema Management**

### **When to Use Each Pattern**

| **Scenario** | **Pattern** | **Implementation** | **Benefits** |
|--------------|-------------|-------------------|--------------|
| **Stable/Mature APIs** | Static Contract Definition | ContractsLib TypeScript definitions | Type safety, compile-time validation, version control |
| **Incremental/Development** | Dynamic Schema Registry | AWS EventBridge Schema Registry | Runtime validation, debugging tools, AWS integration |
| **Production/Immutable** | Mixed Approach | Static contracts + Registry validation | Best of both worlds |

---

## 🏗️ **Implementation Pattern: Document Ingestion Service**

### **1. EventBridge Schema Registry (CDK Implementation)**

```typescript
// Create Schema Registry
const schemaRegistry = new schemas.CfnRegistry(this, 'RagDocumentSchemaRegistry', {
    registryName: `rag-document-schemas-${this.account}-${this.region}`,
    description: 'Schema registry for RAG document processing events',
});

// Define JSON Schema Draft 4 schemas for each event type
const documentValidatedSchema = new schemas.CfnSchema(this, 'DocumentValidatedSchema', {
    registryName: schemaRegistry.registryName!,
    type: 'JSONSchemaDraft4',
    schemaName: 'rag.document-ingestion.DocumentValidated',
    description: 'Schema for successful document validation events',
    content: JSON.stringify({
        type: 'object',
        properties: {
            version: { type: 'string', enum: ['0'] },
            id: { type: 'string' },
            'detail-type': { type: 'string', enum: ['Document Validated'] },
            source: { type: 'string', enum: ['rag.document-ingestion'] },
            // ... EventBridge standard fields
            detail: {
                type: 'object',
                properties: {
                    documentId: { type: 'string', format: 'uuid' },
                    bucketName: { type: 'string' },
                    objectKey: { type: 'string' },
                    contentType: { type: 'string' },
                    fileSize: { type: 'number', minimum: 0 },
                    validatedAt: { type: 'string', format: 'date-time' },
                    // ... business-specific fields
                },
                required: ['documentId', 'bucketName', 'objectKey', 'contentType', 'fileSize', 'validatedAt']
            }
        },
        required: ['version', 'id', 'detail-type', 'source', 'account', 'time', 'region', 'detail']
    }),
});
```

### **2. OndemandEnv Producer Integration**

```typescript
// Share actual AWS resource ARNs (not static definitions)
new OdmdShareOut(
    this, new Map([
        // EventBridge Bus - resolved at deployment
        [myEnver.documentValidationEvents.eventBridge, eventBus.eventBusName],
        
        // Schema ARNs - for downstream services to reference
        [myEnver.documentValidationEvents.documentValidatedSchema, documentValidatedSchema.attrSchemaArn],
        [myEnver.documentValidationEvents.documentRejectedSchema, documentRejectedSchema.attrSchemaArn],
        [myEnver.documentValidationEvents.documentQuarantinedSchema, documentQuarantinedSchema.attrSchemaArn],
        
        // Dynamic URLs based on deployed infrastructure
        [myEnver.authCallbackUrl, `https://${props.webUiDomain}/index.html?callback`],
        [myEnver.logoutUrl, `https://${props.webUiDomain}/index.html?logout`],
    ])
);
```

---

## 📋 **Event Schema Definitions**

### **Standard EventBridge Event Structure**
All events follow AWS EventBridge format:
```json
{
  "version": "0",
  "id": "uuid",
  "detail-type": "Event Type Name", 
  "source": "rag.service-name",
  "account": "123456789012",
  "time": "2024-01-15T10:30:00Z",
  "region": "us-east-2",
  "detail": {
    // Service-specific event data
  }
}
```

### **1. Document Validated Event**
**Schema Name**: `rag.document-ingestion.DocumentValidated`
**Detail Type**: `Document Validated`

```json
{
  "detail": {
    "documentId": "uuid-v4",
    "bucketName": "rag-documents-account-region", 
    "objectKey": "documents/uuid-v4.pdf",
    "contentType": "application/pdf",
    "fileSize": 1024000,
    "validatedAt": "2024-01-15T10:31:00Z",
    "metadata": {
      "originalFileName": "user-document.pdf",
      "uploadedBy": "user-123"
    }
  }
}
```

### **2. Document Rejected Event**
**Schema Name**: `rag.document-ingestion.DocumentRejected`
**Detail Type**: `Document Rejected`

```json
{
  "detail": {
    "documentId": "uuid-v4",
    "bucketName": "rag-documents-account-region",
    "objectKey": "documents/uuid-v4.invalid",
    "rejectionReason": "File type not supported",
    "rejectionCode": "UNSUPPORTED_TYPE",
    "rejectedAt": "2024-01-15T10:31:00Z",
    "metadata": {
      "originalFileName": "document.xyz",
      "attemptedContentType": "application/unknown",
      "fileSize": 5000000
    }
  }
}
```

### **3. Document Quarantined Event**
**Schema Name**: `rag.document-ingestion.DocumentQuarantined`
**Detail Type**: `Document Quarantined`

```json
{
  "detail": {
    "documentId": "uuid-v4",
    "bucketName": "rag-quarantine-account-region",
    "objectKey": "quarantine/uuid-v4.pdf",
    "quarantineReason": "Content requires manual review",
    "quarantineCode": "MANUAL_REVIEW_REQUIRED",
    "quarantinedAt": "2024-01-15T10:31:00Z",
    "reviewRequired": true,
    "metadata": {
      "originalFileName": "suspicious-doc.pdf",
      "riskScore": 75,
      "flaggedBy": "content-scanner"
    }
  }
}
```

---

## 🔗 **Cross-Service Integration Patterns**

### **Document Processing Service (Consumer)**

```typescript
export class RagDocumentProcessingEnver extends OdmdEnverCdk {
    // Consumer of ingestion events
    documentValidationEventBus!: OdmdCrossRefConsumer<this, any>;
    documentValidatedSchemaArn!: OdmdCrossRefConsumer<this, any>;
    
    wireConsuming() {
        const ingestionEnver = this.contracts.ragDocumentIngestion.dev;
        
        // Consume EventBridge bus for event subscription
        this.documentValidationEventBus = new OdmdCrossRefConsumer(
            this, 'doc-validation-bus', 
            ingestionEnver.documentValidationEvents.eventBridge
        );
        
        // Consume schema ARN for validation/code generation
        this.documentValidatedSchemaArn = new OdmdCrossRefConsumer(
            this, 'doc-validated-schema',
            ingestionEnver.documentValidationEvents.documentValidatedSchema
        );
    }
}
```

### **EventBridge Rule Creation**

```typescript
// In Document Processing Service CDK Stack
const eventBusName = myEnver.documentValidationEventBus.getSharedValue(this);
const schemaArn = myEnver.documentValidatedSchemaArn.getSharedValue(this);

// Create EventBridge rule to consume document validation events
const documentProcessingRule = new events.Rule(this, 'ProcessDocumentRule', {
    eventBus: events.EventBus.fromEventBusName(this, 'ImportedEventBus', eventBusName),
    eventPattern: {
        source: ['rag.document-ingestion'],
        detailType: ['Document Validated']
    },
    targets: [new targets.LambdaFunction(documentProcessingHandler)]
});
```

---

## 🛠️ **Development & Debugging Benefits**

### **AWS Console Integration**
- **Schema Discovery**: Browse schemas in EventBridge console
- **Event Replay**: Test with historical events using schema validation  
- **Code Generation**: Generate TypeScript/Python types from schemas
- **Validation**: Runtime event validation against registered schemas

### **CLI Tools**
```bash
# List schemas in registry
aws schemas list-schemas --registry-name rag-document-schemas-account-region

# Get schema content for code generation
aws schemas describe-schema \
  --registry-name rag-document-schemas-account-region \
  --schema-name rag.document-ingestion.DocumentValidated

# Generate code bindings
aws schemas get-code-binding-source \
  --registry-name rag-document-schemas-account-region \
  --schema-name rag.document-ingestion.DocumentValidated \
  --language TypeScript
```

### **Local Development**
```typescript
// Use schema for TypeScript type generation
export interface DocumentValidatedDetail {
    documentId: string;
    bucketName: string;
    objectKey: string;
    contentType: string;
    fileSize: number;
    validatedAt: string;
    metadata?: {
        originalFileName?: string;
        uploadedBy?: string;
    };
}

export interface DocumentValidatedEvent {
    version: '0';
    id: string;
    'detail-type': 'Document Validated';
    source: 'rag.document-ingestion';
    account: string;
    time: string;
    region: string;
    detail: DocumentValidatedDetail;
}
```

---

## 🔄 **Schema Evolution Strategy**

### **Versioning Approach**
1. **Semantic Versioning**: Use schema name versions (`v1`, `v2`, etc.)
2. **Backward Compatibility**: Always add optional fields first
3. **Breaking Changes**: Create new schema versions with migration path

### **Migration Example**
```typescript
// v1 Schema
const documentValidatedSchemaV1 = new schemas.CfnSchema(this, 'DocumentValidatedSchemaV1', {
    schemaName: 'rag.document-ingestion.DocumentValidated.v1',
    // ... v1 definition
});

// v2 Schema (with additional fields)
const documentValidatedSchemaV2 = new schemas.CfnSchema(this, 'DocumentValidatedSchemaV2', {
    schemaName: 'rag.document-ingestion.DocumentValidated.v2', 
    // ... v2 definition with new optional fields
});
```

---

## 📊 **Monitoring & Observability**

### **CloudWatch Metrics**
- Schema validation failures
- Event processing latency by schema version
- Cross-service event flow tracking

### **X-Ray Tracing**
- End-to-end event flow across microservices
- Schema validation performance
- Event transformation timings

---

## 🎯 **Best Practices**

### **✅ DO**
- Use JSONSchema Draft 4 for compatibility
- Include detailed descriptions for all fields
- Set appropriate constraints (min/max, enums, formats)
- Version schemas for evolution
- Share schema ARNs through OndemandEnv contracts
- Include metadata fields for debugging

### **❌ DON'T**
- Hardcode schema content in OdmdShareOut (use ARNs)
- Skip required field validation
- Use overly permissive schemas
- Break backward compatibility without versioning
- Share static schema definitions as deployment-time values

---

## 🚀 **Future Enhancements**

1. **Automated Code Generation Pipeline**: Generate TypeScript types from schemas in CI/CD
2. **Schema Testing Framework**: Validate events against schemas in unit tests  
3. **Cross-Service Contract Testing**: Ensure producer/consumer schema compatibility
4. **Schema Analytics**: Track schema usage and evolution across services

---

This hybrid approach provides the flexibility needed for rapid development while maintaining the structure required for production reliability and debugging capabilities. 