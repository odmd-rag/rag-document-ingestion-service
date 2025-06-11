# EventBridge Native Validation - OndemandEnv Architecture Highlight

## 🎯 OndemandEnv Philosophy: "Leverage Cloud Reliability, Don't Reinvent the Wheel"

Rather than building custom validation logic throughout our RAG system, we leverage AWS EventBridge's **native schema validation capabilities**. This exemplifies OndemandEnv's core principle of using cloud services as they were designed to be used.

## 🏗️ The Cloud-Native Validation Pipeline

### 1. **API Gateway Schema Validation (Entry Point)**
```typescript
// EventBridge Schema Registry integration with API Gateway
const documentValidatedModel = new apigateway.Model(this, 'DocumentValidatedModel', {
  restApi: eventIngestionApi,
  schema: {
    // Direct reference to EventBridge schema
    $ref: documentValidatedSchema.schemaArn
  }
});

// Automatic rejection of non-compliant events
documentValidatedResource.addMethod('POST', 
  new apigateway.EventBridgeIntegration(documentValidationEventBus), {
  requestValidator: requestValidator,
  requestModels: {
    'application/json': documentValidatedModel // ✅ Schema enforcement
  }
});
```

**Result**: Invalid events are rejected at the API Gateway level - they never reach EventBridge.

### 2. **EventBridge Rules Content Filtering (Runtime Validation)**
```typescript
// EventBridge Rules act as additional schema validation
const validatedDocumentRule = new events.Rule(this, 'ValidatedDocumentRule', {
  eventPattern: {
    source: ['rag.document-ingestion'],
    detailType: ['Document Validated'],
    detail: {
      // Content-based validation (cloud-native approach)
      contentType: [
        'application/pdf', 
        'text/plain', 
        'text/markdown',
        'application/msword'
      ],
      fileSize: [{ numeric: ['>', 0, '<=', 104857600] }], // 100MB limit
      bucketName: [{ exists: true }],
      objectKey: [{ exists: true }]
    }
  }
});
```

**Result**: Only schema-compliant events trigger downstream processing.

### 3. **Schema Registry Code Generation (Type Safety)**
```typescript
// AWS generates TypeScript interfaces from schemas
import { DocumentValidatedEvent } from './generated/eventbridge-types';

export async function processingHandler(event: DocumentValidatedEvent) {
  // ✅ Type-safe, no validation needed - EventBridge guaranteed compliance
  const documentId = event.detail.documentId; // TypeScript knows this exists
  const bucketName = event.detail.bucketName; // TypeScript knows the type
  
  await processDocument(event.detail);
}
```

**Result**: Type safety without runtime validation overhead.

## 🛡️ Validation Strategy: Validate Once at Producer

### ✅ **DO: Comprehensive Producer Validation**
```typescript
// Document Ingestion Service (PRODUCER)
export class DocumentIngestionService {
  async publishValidatedEvent(document: DocumentMetadata) {
    // 1. API Gateway validates against schema
    // 2. EventBridge Rules filter content
    // 3. Schema Registry ensures type safety
    
    await this.eventBridge.putEvents({
      Entries: [{
        Source: 'rag.document-ingestion',
        DetailType: 'Document Validated',
        Detail: JSON.stringify(document) // Already validated by API Gateway
      }]
    });
  }
}
```

### ❌ **DON'T: Duplicate Consumer Validation**
```typescript
// Document Processing Service (CONSUMER)
export async function processingHandler(event: EventBridgeEvent<'Document Validated'>) {
  // ❌ AVOID - This goes against OndemandEnv philosophy
  // if (!validateEventStructure(event)) {
  //   throw new Error('Invalid event structure');
  // }
  
  // ✅ CORRECT - Trust EventBridge's validation
  const { documentId, bucketName, objectKey } = event.detail;
  await processDocument(documentId, bucketName, objectKey);
}
```

## 🔍 Why This Approach Works

### **1. Cloud-Native Reliability**
- **EventBridge**: 99.99% availability SLA
- **API Gateway**: Built-in request validation
- **Schema Registry**: Versioning and evolution support
- **Automatic retries**: EventBridge handles delivery failures

### **2. Operational Excellence**
- **No custom validation code**: Fewer bugs, less maintenance
- **Centralized schema management**: Single source of truth
- **Built-in monitoring**: CloudWatch metrics for rule failures
- **Dead letter queues**: AWS handles failed deliveries

### **3. Developer Experience**
- **Type generation**: Automatic TypeScript interfaces
- **IDE integration**: AWS Toolkit schema browsing
- **Contract enforcement**: Producers can't publish invalid events
- **Backwards compatibility**: Schema versioning built-in

## 🚦 When Events Fail Validation

### **API Gateway Level (Entry Point)**
```typescript
// Invalid events get HTTP 400 responses
{
  "message": "Invalid request body",
  "errors": [
    {
      "property": "detail.fileSize",
      "message": "Value 200000000 exceeds maximum 104857600"
    }
  ]
}
```

### **EventBridge Rule Level (Runtime Filtering)**
```typescript
// Non-matching events don't trigger targets
const validationFailureDlq = new sqs.Queue(this, 'ValidationFailuresDLQ', {
  retentionPeriod: cdk.Duration.days(14)
});

// Failed validations go to DLQ for investigation
validatedDocumentRule.addTarget(new targets.SqsQueue(validationFailureDlq, {
  deadLetterQueue: {
    queue: validationFailureDlq,
    maxReceiveCount: 3
  }
}));
```

## 📊 Monitoring Validation Health

### **CloudWatch Metrics (Built-in)**
- `AWS/Events/SuccessfulInvocations`: Successful rule executions  
- `AWS/Events/FailedInvocations`: Failed rule executions
- `AWS/ApiGateway/4XXError`: Schema validation failures at API Gateway

### **Alerting Strategy**
```typescript
// Alert on validation failures
const validationFailureAlarm = new cloudwatch.Alarm(this, 'ValidationFailures', {
  metric: validatedDocumentRule.metricFailedInvocations(),
  threshold: 5,
  evaluationPeriods: 2,
  treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
});
```

## 🎯 OndemandEnv Benefits

### **1. Reduced Complexity**
- ❌ **Custom validation logic**: 500+ lines of validation code
- ✅ **EventBridge native**: 50 lines of CDK configuration

### **2. Improved Reliability**
- ❌ **Custom code bugs**: Validation logic failures
- ✅ **AWS managed service**: 99.99% availability SLA

### **3. Better Maintainability**
- ❌ **Multiple validation points**: Inconsistent validation across services
- ✅ **Single schema source**: Centralized contract management

### **4. Enhanced Developer Experience**
- ❌ **Manual type definitions**: Error-prone interface creation
- ✅ **Generated types**: Automatic, always up-to-date interfaces

## 🏛️ Architectural Decision

**Question**: Should we validate events again on the subscribing (consumer) side?

**OndemandEnv Answer**: **NO** - Trust EventBridge's native validation.

**Rationale**:
1. **EventBridge guarantees** that events reaching consumers are schema-compliant
2. **API Gateway validation** prevents invalid events from entering the system
3. **EventBridge Rules** provide content-based filtering as additional validation
4. **Duplicate validation** goes against "don't reinvent the wheel" philosophy
5. **AWS handles reliability** - we focus on business value, not infrastructure concerns

## 🚀 Implementation Summary

```typescript
// PRODUCER (Document Ingestion): Comprehensive validation
✅ API Gateway + Schema Registry validation
✅ EventBridge Rules content filtering  
✅ Dead letter queues for failures

// CONSUMERS (Processing, Embedding, etc.): Trust and process
✅ Type-safe event handling
✅ Focus on business logic
❌ No duplicate validation needed
```

This approach maximizes cloud reliability while minimizing custom code - the essence of OndemandEnv architecture. 