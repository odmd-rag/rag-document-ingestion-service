// Share schema ARNs for downstream validation
const schemasToShare = {
  documentValidatedSchemaArn: documentValidatedSchema.schemaArn,
  documentRejectedSchemaArn: documentRejectedSchema.schemaArn,
  documentQuarantinedSchemaArn: documentQuarantinedSchema.schemaArn,
  eventBusName: documentValidationEventBus.eventBusName,
  eventBusArn: documentValidationEventBus.eventBusArn,
  schemaRegistryName: documentValidationSchemaRegistry.registryName
};

this.odmdShareOut = new OdmdShareOut(this, 'IngestionServiceSharedResources', schemasToShare);

// =======================================================================================
// ONDEMANDENV ARCHITECTURE HIGHLIGHT: LEVERAGE CLOUD RELIABILITY 
// =======================================================================================
// Rather than building custom validation logic, we leverage EventBridge's native 
// schema validation capabilities:
// 1. API Gateway validates incoming events against registered schemas
// 2. EventBridge Rules provide content-based filtering (schema enforcement)
// 3. Schema Registry enables automatic code generation and type safety
// 4. Built-in retry, DLQ, and monitoring capabilities
// This exemplifies OndemandEnv's philosophy: "Use cloud services as intended"
// =======================================================================================

// API Gateway for schema-validated event ingestion
const eventIngestionApi = new apigateway.RestApi(this, 'DocumentIngestionAPI', {
  restApiName: 'RAG Document Ingestion API',
  description: 'Schema-validated event ingestion using EventBridge Schema Registry',
  endpointConfiguration: {
    types: [apigateway.EndpointType.REGIONAL]
  },
  defaultCorsPreflightOptions: {
    allowOrigins: apigateway.Cors.ALL_ORIGINS,
    allowMethods: apigateway.Cors.ALL_METHODS,
    allowHeaders: ['Content-Type', 'Authorization']
  }
});

// Create models based on EventBridge schemas for automatic validation
const documentValidatedModel = new apigateway.Model(this, 'DocumentValidatedModel', {
  restApi: eventIngestionApi,
  contentType: 'application/json',
  modelName: 'DocumentValidatedModel',
  schema: {
    $schema: 'http://json-schema.org/draft-04/schema#',
    title: 'Document Validated Event',
    type: 'object',
    properties: {
      source: { type: 'string', pattern: '^rag\\.document-ingestion$' },
      'detail-type': { type: 'string', enum: ['Document Validated'] },
      detail: {
        type: 'object',
        properties: {
          documentId: { type: 'string', format: 'uuid' },
          bucketName: { type: 'string', minLength: 1 },
          objectKey: { type: 'string', minLength: 1 },
          contentType: { 
            type: 'string', 
            enum: ['application/pdf', 'text/plain', 'text/markdown', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/html', 'application/rtf']
          },
          fileSize: { type: 'number', minimum: 1, maximum: 104857600 },
          validatedAt: { type: 'string', format: 'date-time' },
          metadata: {
            type: 'object',
            properties: {
              originalFileName: { type: 'string' },
              uploadedBy: { type: 'string' }
            },
            required: ['originalFileName', 'uploadedBy']
          }
        },
        required: ['documentId', 'bucketName', 'objectKey', 'contentType', 'fileSize', 'validatedAt', 'metadata']
      }
    },
    required: ['source', 'detail-type', 'detail']
  }
});

// Request validator for schema enforcement
const requestValidator = new apigateway.RequestValidator(this, 'EventValidator', {
  restApi: eventIngestionApi,
  requestValidatorName: 'Schema-Based Event Validator',
  validateRequestBody: true,
  validateRequestParameters: true
});

// Event ingestion endpoint with schema validation
const eventsResource = eventIngestionApi.root.addResource('events');
const documentValidatedResource = eventsResource.addResource('document-validated');

documentValidatedResource.addMethod('POST', new apigateway.EventBridgeIntegration(documentValidationEventBus), {
  requestValidator: requestValidator,
  requestModels: {
    'application/json': documentValidatedModel
  },
  methodResponses: [
    {
      statusCode: '200',
      responseModels: {
        'application/json': apigateway.Model.EMPTY_MODEL
      }
    },
    {
      statusCode: '400',
      responseModels: {
        'application/json': apigateway.Model.ERROR_MODEL
      }
    }
  ]
});

// Schema-enforced EventBridge Rules for downstream processing
// These rules act as additional validation layers using EventBridge's content filtering
const validatedDocumentRule = new events.Rule(this, 'ValidatedDocumentProcessingRule', {
  eventBus: documentValidationEventBus,
  ruleName: 'schema-validated-document-processing',
  description: 'Routes schema-validated documents for processing (leverages EventBridge content filtering)',
  eventPattern: {
    source: ['rag.document-ingestion'],
    detailType: ['Document Validated'],
    detail: {
      // EventBridge content-based validation (cloud-native approach)
      contentType: ['application/pdf', 'text/plain', 'text/markdown', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/html', 'application/rtf'],
      fileSize: [{ numeric: ['>', 0, '<=', 104857600] }], // 100MB limit
      bucketName: [{ exists: true }],
      objectKey: [{ exists: true }]
    }
  },
  targets: [
    new targets.EventBridgeTarget(
      events.EventBus.fromEventBusName(this, 'ProcessingEventBusTarget', 
        getSharedValue(this, 'rag-document-processing-service', 'processingEventBusName')
      )
    )
  ]
});

// Dead Letter Queue for failed validations (cloud-native reliability)
const validationDlq = new sqs.Queue(this, 'ValidationFailuresDLQ', {
  queueName: 'rag-document-validation-failures-dlq',
  retentionPeriod: cdk.Duration.days(14),
  visibilityTimeout: cdk.Duration.minutes(5)
});

// Add DLQ to the validation rule for resilience
validatedDocumentRule.addTarget(new targets.SqsQueue(validationDlq, {
  deadLetterQueue: {
    queue: validationDlq,
    maxReceiveCount: 3
  }
})); 