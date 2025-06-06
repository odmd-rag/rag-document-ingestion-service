import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3Notifications from 'aws-cdk-lib/aws-s3-notifications';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { OdmdEnverCdk } from '@ondemandenv/contracts-lib-base';
import { RagDocumentIngestionEnver } from '@odmd-rag/contracts-lib-rag';

export class RagDocumentIngestionStack extends cdk.Stack {
    constructor(scope: Construct, enver: OdmdEnverCdk, props?: cdk.StackProps) {
        const id = enver.getRevStackNames()[0];
        super(scope, id, props);

        const myEnver = enver as RagDocumentIngestionEnver;

        // Create EventBridge custom bus for document events
        const eventBus = new events.EventBus(this, 'DocumentEventBus', {
            eventBusName: `rag-document-events-${this.account}-${this.region}`,
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
            entry: __dirname + '/handlers/validation-handler.ts',
            runtime: lambda.Runtime.NODEJS_18_X,
            timeout: cdk.Duration.minutes(5),
            memorySize: 512,
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
            entry: __dirname + '/handlers/upload-url-handler.ts',
            runtime: lambda.Runtime.NODEJS_18_X,
            timeout: cdk.Duration.seconds(30),
            memorySize: 256,
            environment: {
                DOCUMENT_BUCKET: documentBucket.bucketName,
            },
        });

        documentBucket.grantPut(uploadUrlHandler);

        // Document status API Lambda
        const statusHandler = new NodejsFunction(this, 'StatusHandler', {
            entry: __dirname + '/handlers/status-handler.ts',
            runtime: lambda.Runtime.NODEJS_18_X,
            timeout: cdk.Duration.seconds(30),
            memorySize: 256,
            environment: {
                DOCUMENT_BUCKET: documentBucket.bucketName,
                QUARANTINE_BUCKET: quarantineBucket.bucketName,
            },
        });

        documentBucket.grantRead(statusHandler);
        quarantineBucket.grantRead(statusHandler);

        // API Gateway
        const api = new apigateway.RestApi(this, 'DocumentIngestionApi', {
            restApiName: 'RAG Document Ingestion Service',
            description: 'API for RAG document ingestion operations',
            defaultCorsPreflightOptions: {
                allowOrigins: apigateway.Cors.ALL_ORIGINS,
                allowMethods: apigateway.Cors.ALL_METHODS,
            },
        });

        // API endpoints
        const uploadResource = api.root.addResource('upload');
        uploadResource.addMethod('POST', new apigateway.LambdaIntegration(uploadUrlHandler));

        const statusResource = api.root.addResource('status');
        statusResource.addResource('{documentId}').addMethod('GET', 
            new apigateway.LambdaIntegration(statusHandler)
        );

        // Output values for other services to consume
        new cdk.CfnOutput(this, 'DocumentBucketName', {
            value: documentBucket.bucketName,
            exportName: `${this.stackName}-DocumentBucket`,
        });

        new cdk.CfnOutput(this, 'QuarantineBucketName', {
            value: quarantineBucket.bucketName,
            exportName: `${this.stackName}-QuarantineBucket`,
        });

        new cdk.CfnOutput(this, 'ApiEndpoint', {
            value: api.url,
            exportName: `${this.stackName}-ApiEndpoint`,
        });

        new cdk.CfnOutput(this, 'EventBusArn', {
            value: eventBus.eventBusArn,
            exportName: `${this.stackName}-EventBus`,
        });
    }
} 