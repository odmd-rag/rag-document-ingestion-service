import * as cdk from 'aws-cdk-lib';
import {Construct} from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3Notifications from 'aws-cdk-lib/aws-s3-notifications';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import {HttpIamAuthorizer} from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import {NodejsFunction} from 'aws-cdk-lib/aws-lambda-nodejs';
import {RagDocumentIngestionEnver} from '@odmd-rag/contracts-lib-rag';
import {Certificate, CertificateValidation} from "aws-cdk-lib/aws-certificatemanager";
import {ARecord, HostedZone, RecordTarget} from "aws-cdk-lib/aws-route53";
import {ApiGatewayv2DomainProperties} from "aws-cdk-lib/aws-route53-targets";
import {Stack} from "aws-cdk-lib";

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
            corsPreflight: {
                allowOrigins: allowedOrigins,
                allowMethods: [apigatewayv2.CorsHttpMethod.GET, apigatewayv2.CorsHttpMethod.POST, apigatewayv2.CorsHttpMethod.OPTIONS],
                allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key', 'X-Amz-Security-Token', 'X-Amz-User-Agent'],
            },
        });

        // API endpoints with IAM authentication using HttpIamAuthorizer
        const iamAuthorizer = new HttpIamAuthorizer();

        this.httpApi.addRoutes({
            path: '/upload',
            methods: [apigatewayv2.HttpMethod.POST],
            integration: new apigatewayv2Integrations.HttpLambdaIntegration('UploadIntegration', uploadUrlHandler),
            authorizer: iamAuthorizer,
        });

        this.httpApi.addRoutes({
            path: '/status/{documentId}',
            methods: [apigatewayv2.HttpMethod.GET],
            integration: new apigatewayv2Integrations.HttpLambdaIntegration('StatusIntegration', statusHandler),
            authorizer: iamAuthorizer,
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
            description: 'ARN pattern for the RAG Document Ingestion API Gateway',
        });

        new cdk.CfnOutput(this, 'EventBusArn', {
            value: eventBus.eventBusArn,
            exportName: `${this.stackName}-EventBus`,
        });

    }
} 