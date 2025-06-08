import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cdk from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {Bucket} from "aws-cdk-lib/aws-s3";
import {AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId} from "aws-cdk-lib/custom-resources";
import {RagDocumentIngestionEnver} from '@odmd-rag/contracts-lib-rag';
import {RagDocumentIngestionAuthStack} from './rag-document-ingestion-auth-stack';
import {RagDocumentIngestionStack} from './rag-document-ingestion-stack';

export class RagDocumentIngestionWebUiStack extends cdk.Stack {

    readonly targetBucket: Bucket;
    readonly webDomain: string;
    readonly myEnver: RagDocumentIngestionEnver;
    readonly authStack: RagDocumentIngestionAuthStack;
    readonly mainStack: RagDocumentIngestionStack;

    constructor(scope: Construct, myEnver: RagDocumentIngestionEnver, props: cdk.StackProps & {
        bucket: Bucket;
        webDomain: string;
        authStack: RagDocumentIngestionAuthStack;
        mainStack: RagDocumentIngestionStack;
    }) {
        const id = myEnver.getRevStackNames()[0] + '-webUi'
        super(scope, id, props);

        this.targetBucket = props.bucket;
        this.webDomain = props.webDomain;
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
                clientId: 'REPLACE_WITH_YOUR_GOOGLE_CLIENT_ID', // Placeholder - needs manual configuration
            },
            cognito: {
                userPoolId: clientId, // This comes from the auth service contracts
                providerName: providerName,
            },
            deployment: {
                timestamp: now,
                version: '1.0.0',
                webDomain: this.webDomain,
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

- **Web Domain**: ${this.webDomain}
- **API Endpoint**: ${this.mainStack.httpApi.url}
- **Identity Pool ID**: ${this.authStack.identityPool.ref}
- **Region**: ${this.region}
- **Deployment Time**: ${now}

## Required Manual Configuration

### Google OAuth Setup
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create OAuth 2.0 credentials
3. Add the following to authorized origins:
   - https://${this.webDomain}
   - http://localhost:5173 (for development)
4. Update the config.json file with your Google Client ID:

\`\`\`bash
aws s3 cp s3://${this.targetBucket.bucketName}/config.json ./config.json
# Edit config.json to replace REPLACE_WITH_YOUR_GOOGLE_CLIENT_ID
aws s3 cp ./config.json s3://${this.targetBucket.bucketName}/config.json --cache-control "no-cache, no-store, must-revalidate"
\`\`\`

### User Group Configuration
Users must be added to the "odmd-rag-uploader" group in Cognito to upload documents.

### Testing
1. Visit: https://${this.webDomain}
2. Sign in with Google
3. Upload a test document
4. Monitor status in the UI

## Troubleshooting

If uploads fail:
1. Check that the user is in the "odmd-rag-uploader" group
2. Verify Google OAuth client configuration
3. Check browser console for errors
4. Verify API Gateway CORS configuration
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
            value: `https://${this.webDomain}`,
            description: 'URL of the deployed web UI',
        });

        new cdk.CfnOutput(this, 'ConfigInstructions', {
            value: `Update Google Client ID in s3://${this.targetBucket.bucketName}/config.json`,
            description: 'Manual configuration required',
        });
    }
} 