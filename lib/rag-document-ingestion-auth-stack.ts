import * as cdk from 'aws-cdk-lib';
import {Construct} from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import {RagDocumentIngestionEnver} from '@odmd-rag/contracts-lib-rag';

export class RagDocumentIngestionAuthStack extends cdk.Stack {
    public readonly identityPool: cognito.CfnIdentityPool;
    public readonly uploadRole: iam.Role;
    public readonly apiAccessPolicy: iam.ManagedPolicy;

    constructor(scope: Construct, myEnver: RagDocumentIngestionEnver, props: cdk.StackProps) {
        const id = myEnver.getRevStackNames()[1]
        super(scope, id, props);

        // Import the API Gateway ARN from the main stack
        const mainStackName = myEnver.getRevStackNames()[0];
        const apiGatewayArn = cdk.Fn.importValue(`${mainStackName}-ApiGatewayArn`);

        // Get clientId and providerName from user auth service
        // These are populated through contract wiring with the user auth service
        const clientId = myEnver.authProviderClientId.getSharedValue(this);
        const providerName = myEnver.authProviderName.getSharedValue(this);

        // Create Cognito Identity Pool for federated authentication
        this.identityPool = new cognito.CfnIdentityPool(this, 'odmdCentralIdentityPool', {
            allowUnauthenticatedIdentities: false,
            cognitoIdentityProviders: [{
                clientId,
                providerName,
                serverSideTokenCheck: true
            }],
        });

        // Create IAM role for document uploading via Cognito Identity Pool federation
        this.uploadRole = new iam.Role(this, 'DocumentUploadRole', {
            assumedBy: new iam.FederatedPrincipal('cognito-identity.amazonaws.com', {
                'StringEquals': {
                    'cognito-identity.amazonaws.com:aud': this.identityPool.ref
                },
                'ForAnyValue:StringLike': {
                    'cognito-identity.amazonaws.com:amr': 'authenticated'
                }
            }, 'sts:AssumeRoleWithWebIdentity'),
            description: 'IAM role for RAG document upload operations via Cognito Identity Pool',
            inlinePolicies: {
                DocumentUploadPolicy: new iam.PolicyDocument({
                    statements: [
                        new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: [
                                's3:PutObject',
                                's3:PutObjectAcl',
                                's3:GetObject'
                            ],
                            resources: [
                                `arn:aws:s3:::rag-documents-${this.account}-${this.region}/*`
                            ]
                        }),
                        new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: [
                                'execute-api:Invoke'
                            ],
                            resources: [
                                apiGatewayArn
                            ]
                        })
                    ]
                })
            }
        });

        // Attach role to identity pool with group-based role mapping
        new cognito.CfnIdentityPoolRoleAttachment(this, 'IdentityPoolRoleAttachment', {
            identityPoolId: this.identityPool.ref,
            roles:{
            },
            roleMappings: JSON.parse(JSON.stringify({
                userPoolId: {
                    type: 'Rules',
                    ambiguousRoleResolution: 'Deny',
                    identityProvider: `${providerName}:${clientId}`,
                    rulesConfiguration: {
                        rules: [
                            {
                                claim: 'cognito:groups',
                                matchType: 'Contains',
                                value: 'odmd-rag-uploader',
                                roleArn: this.uploadRole.roleArn
                            }
                        ]
                    }
                }
            }))
        });

        // Create a managed policy that can be attached to users/roles for API access via Cognito Identity Pool
        this.apiAccessPolicy = new iam.ManagedPolicy(this, 'DocumentIngestionApiAccessPolicy', {
            description: 'Policy granting access to the RAG Document Ingestion API via Cognito Identity Pool',
            statements: [
                new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    actions: [
                        'execute-api:Invoke'
                    ],
                    resources: [
                        apiGatewayArn
                    ]
                }),
                new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    actions: [
                        'cognito-identity:GetId',
                        'cognito-identity:GetCredentialsForIdentity'
                    ],
                    resources: ['*']
                }),
                new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    actions: [
                        'sts:AssumeRoleWithWebIdentity'
                    ],
                    resources: [
                        this.uploadRole.roleArn
                    ]
                })
            ]
        });

        // Output values for other services to consume
        new cdk.CfnOutput(this, 'UploadRoleArn', {
            value: this.uploadRole.roleArn,
            exportName: `${this.stackName}-UploadRole`,
        });

        new cdk.CfnOutput(this, 'IdentityPoolId', {
            value: this.identityPool.ref,
            exportName: `${this.stackName}-IdentityPool`,
        });

        new cdk.CfnOutput(this, 'ApiAccessPolicyArn', {
            value: this.apiAccessPolicy.managedPolicyArn,
            exportName: `${this.stackName}-ApiAccessPolicy`,
        });
    }

    /**
     * Implement the callback URL and logout URL producers for the user-auth service to consume
     */
    implementAuthCallbackProducers(myEnver: RagDocumentIngestionEnver, webUiDomain: string) {
        const callbackUrl = `https://${webUiDomain}/index.html?callback`;
        const logoutUrl = `https://${webUiDomain}/index.html?logout`;

        // Output the URLs that should be shared with user-auth service
        // These will be consumed by the user-auth service through the OndemandEnv platform
        new cdk.CfnOutput(this, 'AuthCallbackUrl', {
            value: callbackUrl,
            description: 'OAuth callback URL for user-auth service configuration',
            exportName: `${this.stackName}-AuthCallbackUrl`,
        });

        new cdk.CfnOutput(this, 'LogoutUrl', {
            value: logoutUrl,
            description: 'Logout URL for user-auth service configuration',
            exportName: `${this.stackName}-LogoutUrl`,
        });

        // Also add development localhost callback for testing
        new cdk.CfnOutput(this, 'DevCallbackUrl', {
            value: 'http://localhost:5173/index.html?callback',
            description: 'Development callback URL for local testing',
        });
    }
} 