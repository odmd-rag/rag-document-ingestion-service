import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cdk from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {Bucket} from "aws-cdk-lib/aws-s3";
import {AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId} from "aws-cdk-lib/custom-resources";
import {RagDocumentIngestionEnver} from '@odmd-rag/contracts-lib-rag';
import {RagDocumentIngestionAuthStack} from './rag-document-ingestion-auth-stack';
import {RagDocumentIngestionStack} from './rag-document-ingestion-stack';
import {RagDocumentIngestionWebHostingStack} from "./rag-document-ingestion-web-hosting-stack";

export class RagDocumentIngestionWebUiStack extends cdk.Stack {

    readonly targetBucket: Bucket;
    readonly webHostingStack: RagDocumentIngestionWebHostingStack;
    readonly myEnver: RagDocumentIngestionEnver;
    readonly authStack: RagDocumentIngestionAuthStack;
    readonly mainStack: RagDocumentIngestionStack;

    constructor(scope: Construct, myEnver: RagDocumentIngestionEnver, props: cdk.StackProps & {
        bucket: Bucket;
        webHostingStack: RagDocumentIngestionWebHostingStack;
        authStack: RagDocumentIngestionAuthStack;
        mainStack: RagDocumentIngestionStack;
    }) {
        const id = myEnver.getRevStackNames()[3]
        super(scope, id, props);

        this.targetBucket = props.bucket;
        this.webHostingStack = props.webHostingStack;
        this.myEnver = myEnver;
        this.authStack = props.authStack;
        this.mainStack = props.mainStack;
    }

    async buildWebUiAndDeploy() {
        // Deploy the built webUI assets
        const webDeployment = new s3deploy.BucketDeployment(this, 'DeployWebsite', {
            sources: [s3deploy.Source.asset('webUI/dist')],
            destinationBucket: this.targetBucket,
            exclude: ['config.json'], // We'll generate config.json dynamically
        });

        // Generate runtime configuration
        const now = new Date().toISOString();

        // Get shared values from contracts
        const clientId = this.myEnver.authProviderClientId.getSharedValue(this);
        const providerName = this.myEnver.authProviderName.getSharedValue(this);

        // Build configuration object
        const configObject = {
            aws: {
                region: this.region,
                identityPoolId: this.authStack.identityPool.ref,
                apiEndpoint: this.mainStack.httpApi.url,
            },
            google: {
                clientId: clientId, // Using Google Client ID from auth service contracts
            },
            cognito: {
                userPoolId: clientId, // This is the client ID from user-auth service contracts
                providerName: providerName, // This is the provider name like "cognito-idp.region.amazonaws.com/userPoolId"
                userPoolDomain: this.webHostingStack.zoneName, // user pool domain
            },
            deployment: {
                timestamp: now,
                version: '1.0.0',
                webDomain: this.webHostingStack.webSubFQDN,
            }
        };

        // Deploy configuration as JSON file
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

        // Create a README with configuration instructions
        const readmeContent = `# RAG Document Ingestion Web UI - Deployment Configuration

## Deployed Configuration

- **Web Domain**: ${this.webHostingStack}
- **API Endpoint**: ${this.mainStack.httpApi.url}
- **Identity Pool ID**: ${this.authStack.identityPool.ref}
- **Region**: ${this.region}
- **Google Client ID**: ${clientId} (from auth service contracts)
- **Auth Provider**: ${providerName}
- **Deployment Time**: ${now}

## Configuration Status

✅ **Automatic Configuration Completed**
- Google OAuth Client ID automatically retrieved from user-auth service contracts
- Cognito Identity Pool configured with group-based access control
- API Gateway IAM authentication configured
- All authentication components wired through OndemandEnv shared values

## User Access Configuration

### User Group Membership
Users must be added to the **"odmd-rag-uploader"** group in Cognito to upload documents.

### Testing
1. Visit: https://${this.webHostingStack}
2. Sign in with Google (via user-auth service)
3. Upload a test document
4. Monitor status in the UI

## Troubleshooting

If uploads fail:
1. **Check Group Membership**: Verify the user is in the "odmd-rag-uploader" group
2. **Check Auth Service**: Ensure the user-auth service is deployed and accessible
3. **Check Browser Console**: Look for authentication or API errors
4. **Verify CORS**: Check API Gateway CORS configuration for your domain

## Architecture

This web UI integrates with the RAG system through:
- **Authentication**: User-auth service via OndemandEnv contracts
- **File Upload**: Direct to S3 via pre-signed URLs from this service
- **Document Processing**: Automated pipeline through EventBridge
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

        // Output important URLs and IDs
        new cdk.CfnOutput(this, 'WebUIURL', {
            value: `https://${this.webHostingStack}`,
            description: 'URL of the deployed web UI',
        });

        new cdk.CfnOutput(this, 'ConfigStatus', {
            value: `✅ Fully configured via OndemandEnv contracts - Google Client ID: ${clientId}`,
            description: 'Configuration automatically completed',
        });
    }
} 