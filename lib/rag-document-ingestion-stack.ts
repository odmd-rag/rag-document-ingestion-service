import * as cdk from 'aws-cdk-lib';
import {Construct} from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3Notifications from 'aws-cdk-lib/aws-s3-notifications';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import {HttpJwtAuthorizer} from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import {NodejsFunction} from 'aws-cdk-lib/aws-lambda-nodejs';
import {RagDocumentIngestionEnver} from '@odmd-rag/contracts-lib-rag';
import {Certificate, CertificateValidation} from "aws-cdk-lib/aws-certificatemanager";
import {ARecord, HostedZone, RecordTarget} from "aws-cdk-lib/aws-route53";
import {ApiGatewayv2DomainProperties} from "aws-cdk-lib/aws-route53-targets";
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

        const zoneName = props.zoneName;
        const hostedZoneId = props.hostedZoneId;
        const apiSubdomain = ('up-api.' + myEnver.targetRevision.value + '.' + myEnver.owner.buildId).toLowerCase()
        this.apiDomain = `${apiSubdomain}.${zoneName}`;


        const documentBucket = new s3.Bucket(this, 'DocumentBucket', {
            versioned: false, // No versioning needed for timestamp-based keys
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        });

        const quarantineBucket = new s3.Bucket(this, 'QuarantineBucket', {
            versioned: true,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        });

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
            },
        });

        documentBucket.grantReadWrite(validationHandler);
        quarantineBucket.grantReadWrite(validationHandler);

        documentBucket.addToResourcePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            principals: [new iam.AccountPrincipal(this.account)],
            actions: [
                's3:ListBucket',
                's3:GetObject',
                's3:GetObjectAttributes',
                's3:GetObjectTagging'
            ],
            resources: [
                documentBucket.bucketArn,
                `${documentBucket.bucketArn}/*`
            ],
            conditions: {
                'StringLike': {
                    'aws:PrincipalArn': [
                        `arn:aws:iam::${this.account}:role/RagDocumentProcessingStack-DocumentProcessorHandler*`,
                        `arn:aws:iam::${this.account}:role/RagDocumentProcessingStack-AdvancedDocumentProcessor*`,
                        `arn:aws:iam::${this.account}:role/RagEmbeddingStack-EmbeddingHandler*`,
                        `arn:aws:iam::${this.account}:role/RagVectorStorageStack-VectorStorageHandler*`
                    ]
                }
            }
        }));

        quarantineBucket.addToResourcePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            principals: [new iam.AccountPrincipal(this.account)],
            actions: [
                's3:ListBucket',
                's3:GetObject',
                's3:GetObjectAttributes'
            ],
            resources: [
                quarantineBucket.bucketArn,
                `${quarantineBucket.bucketArn}/*`
            ],
            conditions: {
                'StringLike': {
                    'aws:PrincipalArn': [
                        `arn:aws:iam::${this.account}:role/RagDocumentProcessingStack-DocumentProcessorHandler*`,
                        `arn:aws:iam::${this.account}:role/RagDocumentProcessingStack-AdvancedDocumentProcessor*`,
                        `arn:aws:iam::${this.account}:role/RagEmbeddingStack-EmbeddingHandler*`,
                        `arn:aws:iam::${this.account}:role/RagVectorStorageStack-VectorStorageHandler*`
                    ]
                }
            }
        }));

        documentBucket.addEventNotification(
            s3.EventType.OBJECT_CREATED,
            new s3Notifications.LambdaDestination(validationHandler)
        );

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

        const allowedOrigins = ['http://localhost:5173'];
        allowedOrigins.push(`https://${props.webUiDomain}`);

        documentBucket.addCorsRule({
            allowedOrigins: allowedOrigins,
            allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.POST],
            allowedHeaders: [
                'Content-Type',
                'Content-Length',
                'Content-MD5',
                'X-Amz-Content-Sha256',
                'X-Amz-Date',
                'X-Amz-Security-Token',
                'X-Amz-User-Agent',
                'X-Amz-Signature',
                'X-Amz-SignedHeaders',
                'X-Amz-Algorithm',
                'X-Amz-Credential',
                'X-Amz-Expires',
                'x-amz-checksum-crc32',
                'x-amz-meta-*',
                'x-amz-sdk-checksum-algorithm',
                'Authorization'
            ],
            exposedHeaders: [
                'ETag',
                'x-amz-version-id'
            ],
            maxAge: 3000
        });

        const clientId = myEnver.authProviderClientId.getSharedValue(this);
        const providerName = myEnver.authProviderName.getSharedValue(this);

        this.httpApi = new apigatewayv2.HttpApi(this, 'DocumentIngestionApi', {
            apiName: 'RAG Document Ingestion Service',
            description: 'HTTP API for RAG document ingestion operations with IAM authentication',
            defaultAuthorizer: new HttpJwtAuthorizer('Auth',
                `https://${providerName}`,
                {jwtAudience: [clientId]}
            ),
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

        new cdk.CfnOutput(this, 'CorsAllowedOrigins', {
            value: allowedOrigins.join(', '),
            description: 'CORS allowed origins for API Gateway',
        });

        const hostedZone = HostedZone.fromHostedZoneAttributes(this, 'ApiHostedZone', {
            hostedZoneId: hostedZoneId,
            zoneName: zoneName,
        });


        const certificate = new Certificate(this, 'ApiCertificate', {
            domainName: this.apiDomain,
            validation: CertificateValidation.fromDns(hostedZone),
        });

        const domainName = new apigatewayv2.DomainName(this, 'ApiDomainName', {
            domainName: this.apiDomain,
            certificate,
        });

        const apiMapping = new apigatewayv2.ApiMapping(this, 'ApiMapping', {
            api: this.httpApi,
            domainName: domainName,
        });

        apiMapping.node.addDependency(certificate);
        apiMapping.node.addDependency(domainName);
        apiMapping.node.addDependency(this.httpApi);

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
            value: this.httpApi.arnForExecuteApi(),
            exportName: `${this.stackName}-arnForExecuteApi`,
            description: 'ARN pattern for the RAG Document Ingestion HTTP API Gateway (includes $default stage)',
        });


        new cdk.CfnOutput(this, 'HttpApiId', {
            value: this.httpApi.httpApiId,
            description: 'HTTP API Gateway ID',
        });

        new cdk.CfnOutput(this, 'ApiDomainNameDns', {
            value: domainName.regionalDomainName,
            description: 'Regional domain name for API Gateway custom domain',
        });

        new OdmdShareOut(
            this, new Map([
                [myEnver.documentStorageResources.documentBucket, documentBucket.bucketName],
                [myEnver.documentStorageResources.quarantineBucket, quarantineBucket.bucketName],

                [myEnver.authCallbackUrl, `https://${props.webUiDomain}/index.html?callback`],
                [myEnver.logoutUrl, `https://${props.webUiDomain}/index.html?logout`],
            ])
        );

    }
} 