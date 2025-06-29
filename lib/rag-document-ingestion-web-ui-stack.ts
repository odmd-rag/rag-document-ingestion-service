import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cdk from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {Bucket} from "aws-cdk-lib/aws-s3";
import {AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId} from "aws-cdk-lib/custom-resources";
import {RagDocumentIngestionEnver} from '@odmd-rag/contracts-lib-rag';
import {RagDocumentIngestionStack} from './rag-document-ingestion-stack';
import {RagDocumentIngestionWebHostingStack} from "./rag-document-ingestion-web-hosting-stack";

export class RagDocumentIngestionWebUiStack extends cdk.Stack {

    readonly targetBucket: Bucket;
    readonly webHostingStack: RagDocumentIngestionWebHostingStack;
    readonly myEnver: RagDocumentIngestionEnver;
    readonly mainStack: RagDocumentIngestionStack;

    constructor(scope: Construct, myEnver: RagDocumentIngestionEnver, props: cdk.StackProps & {
        bucket: Bucket;
        webHostingStack: RagDocumentIngestionWebHostingStack;
        mainStack: RagDocumentIngestionStack;
    }) {
        const id = myEnver.getRevStackNames()[2]
        super(scope, id, props);

        this.targetBucket = props.bucket;
        this.webHostingStack = props.webHostingStack;
        this.myEnver = myEnver;
        this.mainStack = props.mainStack;
    }

    async buildWebUiAndDeploy() {
        const webDeployment = new s3deploy.BucketDeployment(this, 'DeployWebsite', {
            sources: [s3deploy.Source.asset('webUI/dist')],
            destinationBucket: this.targetBucket,
            exclude: ['config.json'],
        });

        const now = new Date().toISOString();

        const clientId = this.myEnver.authProviderClientId.getSharedValue(this);
        const providerName = this.myEnver.authProviderName.getSharedValue(this);

        const processingStatusEndpoint = this.myEnver.processingStatusApiEndpoint.getSharedValue(this);
        const embeddingStatusEndpoint = this.myEnver.embeddingStatusApiEndpoint.getSharedValue(this);
        const vectorStorageStatusEndpoint = this.myEnver.vectorStorageStatusApiEndpoint.getSharedValue(this);

        const configObject = {
            aws: {
                region: this.region,
                apiEndpoint: `https://${this.mainStack.apiDomain}`,
            },
            google: {
                clientId: clientId,
            },
            cognito: {
                providerName: providerName,
                userPoolDomain: this.webHostingStack.zoneName,
            },
            deployment: {
                timestamp: now,
                version: '1.0.0',
                webDomain: this.webHostingStack.webSubFQDN,
            },
            services: {
                processing: processingStatusEndpoint,
                embedding: embeddingStatusEndpoint,
                vectorStorage: vectorStorageStatusEndpoint,
            }
        };

        const configParams = {
            Bucket: this.targetBucket.bucketName,
            Key: 'config.json',
            Body: JSON.stringify(configObject, null, 2),
            ContentType: 'application/json',
            CacheControl: 'no-cache, no-store, must-revalidate',
        };

        new AwsCustomResource(this, 'deployConfig', {
            onCreate: {
                service: 'S3',
                action: 'putObject',
                parameters: configParams,
                physicalResourceId: PhysicalResourceId.of('s3PutConfigObject')
            },
            onUpdate: {
                service: 'S3',
                action: 'putObject',
                parameters: configParams,
                physicalResourceId: PhysicalResourceId.of('s3PutConfigObject')
            },
            policy: AwsCustomResourcePolicy.fromSdkCalls({
                resources: [this.targetBucket.arnForObjects('*')]
            })
        }).node.addDependency(webDeployment);

        const readmeContent = `# RAG Document Ingestion Web UI - Deployment Configuration

## Deployed Configuration

- **Web Domain**: ${this.webHostingStack.webSubFQDN}
- **API Endpoint**: https://${this.mainStack.apiDomain}
- **Region**: ${this.region}
- **Google Client ID**: ${clientId} (from auth service contracts)
- **Auth Provider**: ${providerName}
- **Deployment Time**: ${now}

## Service Endpoints (Auto-Generated via Contracts)

- **Ingestion Service**: https://${this.mainStack.apiDomain}
- **Processing Service**: ${processingStatusEndpoint.replace('/status', '')}
- **Embedding Service**: ${embeddingStatusEndpoint.replace('/status', '')}
- **Vector Storage Service**: ${vectorStorageStatusEndpoint.replace('/status', '')}

## Configuration Status

✅ **Automatic Configuration Completed**
- Google OAuth Client ID automatically retrieved from user-auth service contracts
- Service endpoints automatically discovered via OndemandEnv contracts
- Cognito Identity Pool configured with group-based access control
- API Gateway IAM authentication configured
- All authentication components wired through OndemandEnv shared values

## Pipeline Status Tracking

The web UI now supports comprehensive pipeline tracking:
- ✅ Document upload status (ingestion service)
- ✅ Content processing status (processing service)  
- ✅ Text embedding status (embedding service)
- ✅ Vector storage status (vector storage service)
- ✅ Real-time progress visualization
- ✅ Stage-by-stage error reporting

## User Access Configuration

### User Group Membership
Users must be added to the **"odmd-rag-uploader"** group in Cognito to upload documents.

### Testing
1. Visit: https://${this.webHostingStack.webSubFQDN}
2. Sign in with Google (via user-auth service)
3. Upload a test document
4. Monitor status in the UI with full pipeline visibility

## Troubleshooting

If uploads fail:
1. **Check Group Membership**: Verify the user is in the "odmd-rag-uploader" group
2. **Check Auth Service**: Ensure the user-auth service is deployed and accessible
3. **Check Service Endpoints**: Verify all pipeline services are deployed and accessible
4. **Check Browser Console**: Look for authentication or API errors
5. **Verify CORS**: Check API Gateway CORS configuration for your domain

## Architecture

This web UI integrates with the RAG system through:
- **Authentication**: User-auth service via OndemandEnv contracts
- **File Upload**: Direct to S3 via pre-signed URLs from this service
- **Document Processing**: Automated pipeline through EventBridge
- **Status Tracking**: Real-time monitoring across all pipeline services
- **Access Control**: Cognito Identity Pool with IAM role mapping
`;

        const readmeParams = {
            Bucket: this.targetBucket.bucketName,
            Key: 'DEPLOYMENT_README.md',
            Body: readmeContent,
            ContentType: 'text/markdown',
        };

        new AwsCustomResource(this, 'deployReadme', {
            onCreate: {
                service: 'S3',
                action: 'putObject',
                parameters: readmeParams,
                physicalResourceId: PhysicalResourceId.of('s3PutReadmeObject')
            },
            onUpdate: {
                service: 'S3',
                action: 'putObject',
                parameters: readmeParams,
                physicalResourceId: PhysicalResourceId.of('s3PutReadmeObject')
            },
            policy: AwsCustomResourcePolicy.fromSdkCalls({
                resources: [this.targetBucket.arnForObjects('*')]
            })
        }).node.addDependency(webDeployment);

        new cdk.CfnOutput(this, 'WebUIURL', {
            value: `https://${this.webHostingStack.webSubFQDN}`,
            description: 'URL of the deployed web UI',
        });

        new cdk.CfnOutput(this, 'ConfigStatus', {
            value: `✅ Fully configured via OndemandEnv contracts - Google Client ID: ${clientId}`,
            description: 'Configuration automatically completed',
        });

        new cdk.CfnOutput(this, 'ConfiguredApiEndpoint', {
            value: `https://${this.mainStack.apiDomain}`,
            description: 'API endpoint configured in web UI',
        });

        new cdk.CfnOutput(this, 'ServiceEndpoints', {
            value: `Processing: ${processingStatusEndpoint.replace('/status', '')}, Embedding: ${embeddingStatusEndpoint.replace('/status', '')}, Vector: ${vectorStorageStatusEndpoint.replace('/status', '')}`,
            description: 'Service endpoints configured via contracts',
        });
    }
} 