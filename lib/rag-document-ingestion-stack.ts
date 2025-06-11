import * as cdk from 'aws-cdk-lib';
import {Construct} from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3Notifications from 'aws-cdk-lib/aws-s3-notifications';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as schemas from 'aws-cdk-lib/aws-eventschemas';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import {HttpIamAuthorizer} from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import {NodejsFunction} from 'aws-cdk-lib/aws-lambda-nodejs';
import {RagDocumentIngestionEnver} from '@odmd-rag/contracts-lib-rag';
import {Certificate, CertificateValidation} from "aws-cdk-lib/aws-certificatemanager";
import {ARecord, HostedZone, RecordTarget} from "aws-cdk-lib/aws-route53";
import {ApiGatewayv2DomainProperties} from "aws-cdk-lib/aws-route53-targets";
import {Stack} from "aws-cdk-lib";
import {OdmdShareOut} from "@ondemandenv/contracts-lib-base";

export class RagDocumentIngestionStack extends cdk.Stack {
    readonly httpApi: apigatewayv2.HttpApi;
    readonly apiDomain: string;

    constructor(scope: Construct, myEnver: RagDocumentIngestionEnver, props: cdk.StackProps & {
        zoneName: string;
        hostedZoneId: string;
        webUiDomain: string;
    }) {
        const id = myEnver.getRevStackNames()[0];
        super(scope, id, {...props, crossRegionReferences: props.env!.region !== 'us-east-1'});

        // Use the same domain setup as web hosting
        const zoneName = props.zoneName;
        const hostedZoneId = props.hostedZoneId;
        const apiSubdomain = 'rag-api';
        this.apiDomain = `${apiSubdomain}.${zoneName}`;

        // Create EventBridge custom bus for document events
        const eventBus = new events.EventBus(this, 'DocumentEventBus', {
            eventBusName: `rag-document-events-${this.account}-${this.region}`,
        });

        // Create EventBridge Schema Registry for RAG document events
        const schemaRegistry = new schemas.CfnRegistry(this, 'RagDocumentSchemaRegistry', {
            registryName: `rag-document-schemas-${this.account}-${this.region}`,
            description: 'Schema registry for RAG document processing events',
        });

        // Define event schemas for contract compliance and debugging
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
                    account: { type: 'string' },
                    time: { type: 'string', format: 'date-time' },
                    region: { type: 'string' },
                    detail: {
                        type: 'object',
                        properties: {
                            documentId: { type: 'string', format: 'uuid' },
                            bucketName: { type: 'string' },
                            objectKey: { type: 'string' },
                            contentType: { type: 'string' },
                            fileSize: { type: 'number', minimum: 0 },
                            validatedAt: { type: 'string', format: 'date-time' },
                            metadata: {
                                type: 'object',
                                properties: {
                                    originalFileName: { type: 'string' },
                                    uploadedBy: { type: 'string' }
                                }
                            }
                        },
                        required: ['documentId', 'bucketName', 'objectKey', 'contentType', 'fileSize', 'validatedAt']
                    }
                },
                required: ['version', 'id', 'detail-type', 'source', 'account', 'time', 'region', 'detail']
            }),
        });

        const documentRejectedSchema = new schemas.CfnSchema(this, 'DocumentRejectedSchema', {
            registryName: schemaRegistry.registryName!,
            type: 'JSONSchemaDraft4',
            schemaName: 'rag.document-ingestion.DocumentRejected',
            description: 'Schema for document rejection events',
            content: JSON.stringify({
                type: 'object',
                properties: {
                    version: { type: 'string', enum: ['0'] },
                    id: { type: 'string' },
                    'detail-type': { type: 'string', enum: ['Document Rejected'] },
                    source: { type: 'string', enum: ['rag.document-ingestion'] },
                    account: { type: 'string' },
                    time: { type: 'string', format: 'date-time' },
                    region: { type: 'string' },
                    detail: {
                        type: 'object',
                        properties: {
                            documentId: { type: 'string', format: 'uuid' },
                            bucketName: { type: 'string' },
                            objectKey: { type: 'string' },
                            rejectionReason: { type: 'string' },
                            rejectionCode: { type: 'string', enum: ['INVALID_FORMAT', 'TOO_LARGE', 'MALWARE_DETECTED', 'UNSUPPORTED_TYPE'] },
                            rejectedAt: { type: 'string', format: 'date-time' },
                            metadata: {
                                type: 'object',
                                properties: {
                                    originalFileName: { type: 'string' },
                                    attemptedContentType: { type: 'string' },
                                    fileSize: { type: 'number' }
                                }
                            }
                        },
                        required: ['documentId', 'bucketName', 'objectKey', 'rejectionReason', 'rejectionCode', 'rejectedAt']
                    }
                },
                required: ['version', 'id', 'detail-type', 'source', 'account', 'time', 'region', 'detail']
            }),
        });

        const documentQuarantinedSchema = new schemas.CfnSchema(this, 'DocumentQuarantinedSchema', {
            registryName: schemaRegistry.registryName!,
            type: 'JSONSchemaDraft4',
            schemaName: 'rag.document-ingestion.DocumentQuarantined',
            description: 'Schema for document quarantine events requiring manual review',
            content: JSON.stringify({
                type: 'object',
                properties: {
                    version: { type: 'string', enum: ['0'] },
                    id: { type: 'string' },
                    'detail-type': { type: 'string', enum: ['Document Quarantined'] },
                    source: { type: 'string', enum: ['rag.document-ingestion'] },
                    account: { type: 'string' },
                    time: { type: 'string', format: 'date-time' },
                    region: { type: 'string' },
                    detail: {
                        type: 'object',
                        properties: {
                            documentId: { type: 'string', format: 'uuid' },
                            bucketName: { type: 'string' },
                            objectKey: { type: 'string' },
                            quarantineReason: { type: 'string' },
                            quarantineCode: { type: 'string', enum: ['SUSPICIOUS_CONTENT', 'MANUAL_REVIEW_REQUIRED', 'POLICY_VIOLATION'] },
                            quarantinedAt: { type: 'string', format: 'date-time' },
                            reviewRequired: { type: 'boolean', enum: [true] },
                            metadata: {
                                type: 'object',
                                properties: {
                                    originalFileName: { type: 'string' },
                                    riskScore: { type: 'number', minimum: 0, maximum: 100 },
                                    flaggedBy: { type: 'string' }
                                }
                            }
                        },
                        required: ['documentId', 'bucketName', 'objectKey', 'quarantineReason', 'quarantineCode', 'quarantinedAt', 'reviewRequired']
                    }
                },
                required: ['version', 'id', 'detail-type', 'source', 'account', 'time', 'region', 'detail']
            }),
        });

        // Create S3 bucket for document storage
        const documentBucket = new s3.Bucket(this, 'DocumentBucket', {
            bucketName: `rag-documents-${this.account}-${this.region}`,
            versioned: true,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        });

        // Create S3 bucket for quarantine
        const quarantineBucket = new s3.Bucket(this, 'QuarantineBucket', {
            bucketName: `rag-quarantine-${this.account}-${this.region}`,
            versioned: true,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        });

        // Document validation Lambda function
        const validationHandler = new NodejsFunction(this, 'ValidationHandler', {
            entry: __dirname + '/handlers/src/validation-handler.ts',
            runtime: lambda.Runtime.NODEJS_22_X,
            timeout: cdk.Duration.minutes(5),
            memorySize: 512,
            projectRoot: __dirname + '/handlers',
            depsLockFilePath: __dirname + '/handlers/package-lock.json',
            environment: {
                DOCUMENT_BUCKET: documentBucket.bucketName,
                QUARANTINE_BUCKET: quarantineBucket.bucketName,
                EVENT_BUS_NAME: eventBus.eventBusName,
                EVENT_SOURCE: 'rag.document-ingestion',
            },
        });

        // Grant permissions to validation handler
        documentBucket.grantReadWrite(validationHandler);
        quarantineBucket.grantReadWrite(validationHandler);

        // Grant EventBridge permissions
        eventBus.grantPutEventsTo(validationHandler);

        // S3 event trigger for validation
        documentBucket.addEventNotification(
            s3.EventType.OBJECT_CREATED,
            new s3Notifications.LambdaDestination(validationHandler)
        );

        // Pre-signed URL generator Lambda
        const uploadUrlHandler = new NodejsFunction(this, 'UploadUrlHandler', {
            entry: __dirname + '/handlers/src/upload-url-handler.ts',
            runtime: lambda.Runtime.NODEJS_22_X,
            timeout: cdk.Duration.seconds(30),
            memorySize: 256,
            projectRoot: __dirname + '/handlers',
            depsLockFilePath: __dirname + '/handlers/package-lock.json',
            environment: {
                DOCUMENT_BUCKET: documentBucket.bucketName,
            },
        });

        documentBucket.grantPut(uploadUrlHandler);

        // Document status API Lambda
        const statusHandler = new NodejsFunction(this, 'StatusHandler', {
            entry: __dirname + '/handlers/src/status-handler.ts',
            runtime: lambda.Runtime.NODEJS_22_X,
            timeout: cdk.Duration.seconds(30),
            memorySize: 256,
            projectRoot: __dirname + '/handlers',
            depsLockFilePath: __dirname + '/handlers/package-lock.json',
            environment: {
                DOCUMENT_BUCKET: documentBucket.bucketName,
                QUARANTINE_BUCKET: quarantineBucket.bucketName,
            },
        });

        documentBucket.grantRead(statusHandler);
        quarantineBucket.grantRead(statusHandler);

        // HTTP API Gateway with IAM authorization
        const allowedOrigins = ['http://localhost:5173'];
        allowedOrigins.push(`https://${props.webUiDomain}`);

        this.httpApi = new apigatewayv2.HttpApi(this, 'DocumentIngestionApi', {
            apiName: 'RAG Document Ingestion Service',
            description: 'HTTP API for RAG document ingestion operations with IAM authentication',
            defaultAuthorizer: new HttpIamAuthorizer(),
            corsPreflight: {
                allowOrigins: allowedOrigins,
                allowMethods: [apigatewayv2.CorsHttpMethod.GET, apigatewayv2.CorsHttpMethod.POST, apigatewayv2.CorsHttpMethod.PUT, apigatewayv2.CorsHttpMethod.DELETE, apigatewayv2.CorsHttpMethod.OPTIONS],
                allowHeaders: [
                    'Content-Type',
                    'X-Amz-Date',
                    'X-Amz-Target',
                    'Authorization', 
                    'X-Api-Key',
                    'X-Amz-Security-Token',
                    'X-Amz-User-Agent',
                    'X-Amz-Content-Sha256',
                    'X-Amz-Signature',
                    'X-Amz-SignedHeaders',
                    'X-Amz-Algorithm',
                    'X-Amz-Credential',
                    'X-Amz-Expires',
                    'Host',
                    'Cache-Control',
                    'Pragma'
                ],
                allowCredentials: false,
                exposeHeaders: ['Date', 'X-Amzn-ErrorType'],
                maxAge: cdk.Duration.hours(1),
            },
            
        });

        // API endpoints - will use default IAM authorizer
        this.httpApi.addRoutes({
            path: '/upload',
            methods: [apigatewayv2.HttpMethod.POST],
            integration: new apigatewayv2Integrations.HttpLambdaIntegration('UploadIntegration', uploadUrlHandler),
        });

        this.httpApi.addRoutes({
            path: '/status/{documentId}',
            methods: [apigatewayv2.HttpMethod.GET],
            integration: new apigatewayv2Integrations.HttpLambdaIntegration('StatusIntegration', statusHandler),
        });

        // Output the CORS configuration for debugging (after API is created)
        new cdk.CfnOutput(this, 'CorsAllowedOrigins', {
            value: allowedOrigins.join(', '),
            description: 'CORS allowed origins for API Gateway',
        });

        // Set up custom domain for API Gateway
        const hostedZone = HostedZone.fromHostedZoneAttributes(this, 'ApiHostedZone', {
            hostedZoneId: hostedZoneId,
            zoneName: zoneName,
        });


        const domainName = new apigatewayv2.DomainName(this, 'ApiDomainName', {
            domainName: this.apiDomain,
            certificate: new Certificate(this, 'ApiCertificate', {
                domainName: this.apiDomain,
                validation: CertificateValidation.fromDns(hostedZone),
            }),
        });

        new apigatewayv2.ApiMapping(this, 'ApiMapping', {
            api: this.httpApi,
            domainName: domainName,
        });

        new ARecord(this, 'ApiAliasRecord', {
            zone: hostedZone,
            target: RecordTarget.fromAlias(
                new ApiGatewayv2DomainProperties(
                    domainName.regionalDomainName,
                    domainName.regionalHostedZoneId
                )
            ),
            recordName: apiSubdomain,
        });

        // Output values for other services to consume
        new cdk.CfnOutput(this, 'DocumentBucketName', {
            value: documentBucket.bucketName,
            exportName: `${this.stackName}-DocumentBucket`,
        });

        new cdk.CfnOutput(this, 'QuarantineBucketName', {
            value: quarantineBucket.bucketName,
            exportName: `${this.stackName}-QuarantineBucket`,
        });

        new cdk.CfnOutput(this, 'ApiEndpoint-out', {
            value: `https://${this.apiDomain}`,
            exportName: `${this.stackName}-ApiEndpoint`,
        });

        new cdk.CfnOutput(this, 'ApiDomainName-out', {
            value: this.apiDomain,
            exportName: `${this.stackName}-ApiDomain`,
            description: 'Custom domain name for the API Gateway',
        });

        new cdk.CfnOutput(this, 'ApiGatewayArn', {
            value: `arn:aws:execute-api:${this.region}:${this.account}:${this.httpApi.httpApiId}/*`,
            exportName: `${this.stackName}-ApiGatewayArn`,
            description: 'tobe delete',
        });

        new cdk.CfnOutput(this, 'arnForExecuteApi', {
            // value: `arn:aws:execute-api:${this.region}:${this.account}:${this.httpApi.httpApiId}/*/*`,
            value: this.httpApi.arnForExecuteApi(),
            exportName: `${this.stackName}-arnForExecuteApi`,
            description: 'ARN pattern for the RAG Document Ingestion HTTP API Gateway (includes $default stage)',
        });

        new cdk.CfnOutput(this, 'EventBusArn', {
            value: eventBus.eventBusArn,
            exportName: `${this.stackName}-EventBus`,
        });

        // Output the actual API Gateway ID for troubleshooting
        new cdk.CfnOutput(this, 'HttpApiId', {
            value: this.httpApi.httpApiId,
            description: 'HTTP API Gateway ID',
        });

        new cdk.CfnOutput(this, 'ApiDomainNameDns', {
            value: domainName.regionalDomainName,
            description: 'Regional domain name for API Gateway custom domain',
        });

        // OndemandEnv Producers - Share actual AWS resource values with other services
        new OdmdShareOut(
            this, new Map([
                // EventBridge Bus - actual AWS resource name resolved at deployment
                [myEnver.documentValidationEvents.eventBridge, eventBus.eventBusName],
                
                // EventBridge Schema ARNs - for schema validation and code generation
                [myEnver.documentValidationEvents.documentValidatedSchema, documentValidatedSchema.attrSchemaArn],
                [myEnver.documentValidationEvents.documentRejectedSchema, documentRejectedSchema.attrSchemaArn],
                [myEnver.documentValidationEvents.documentQuarantinedSchema, documentQuarantinedSchema.attrSchemaArn],
                
                // Auth Callback URLs - dynamic URLs based on deployed domain
                [myEnver.authCallbackUrl, `https://${props.webUiDomain}/index.html?callback`],
                [myEnver.logoutUrl, `https://${props.webUiDomain}/index.html?logout`],
            ])
        );

    }
} 