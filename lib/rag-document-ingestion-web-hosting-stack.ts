import * as cdk from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {ARecord, HostedZone, RecordTarget} from "aws-cdk-lib/aws-route53";
import {Certificate, CertificateValidation} from "aws-cdk-lib/aws-certificatemanager";
import {CloudFrontTarget} from "aws-cdk-lib/aws-route53-targets";
import {BlockPublicAccess, Bucket} from "aws-cdk-lib/aws-s3";
import {ServicePrincipal} from "aws-cdk-lib/aws-iam";
import {
    BehaviorOptions,
    CachePolicy,
    Distribution, IOrigin,
    ViewerProtocolPolicy
} from "aws-cdk-lib/aws-cloudfront";
import {S3BucketOrigin} from "aws-cdk-lib/aws-cloudfront-origins";
import {RagDocumentIngestionEnver} from '@odmd-rag/contracts-lib-rag';
import {Stack} from "aws-cdk-lib";

export class RagDocumentIngestionWebHostingStack extends cdk.Stack {

    readonly bucket: Bucket;
    readonly webSubFQDN: string;
    readonly zoneName: string;
    readonly hostedZoneId: string;

    constructor(scope: Construct, myEnver: RagDocumentIngestionEnver, props: cdk.StackProps) {
        const id = myEnver.getRevStackNames()[2]
        super(scope, id, {...props, crossRegionReferences: props.env!.region != 'us-east-1'});
        // Get hosted zone information from shared values
        this.hostedZoneId = 'Z01450892FNOJJT5BBBRU';
        this.zoneName = 'rag-ws1.root.ondemandenv.link';

        this.bucket = new Bucket(this, 'webUiBucket', {
            bucketName: `rag-webui-${this.account}-${this.region}`,
            publicReadAccess: false,
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        });


        const hostedZone = HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
            hostedZoneId: this.hostedZoneId,
            zoneName: this.zoneName,
        });

        this.bucket.grantRead(new ServicePrincipal('cloudfront.amazonaws.com'));

        const webSubdomain = 'rag-upload';
        this.webSubFQDN = webSubdomain + '.' + this.zoneName;

        const origin = S3BucketOrigin.withOriginAccessControl(this.bucket);
        const additionalBehaviors = this.createAssetBehaviors(origin);

        const noCaching = {
            origin: origin,
            viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            compress: true,
            cachePolicy: new CachePolicy(this, 'HtmlCachePolicy', {
                minTtl: cdk.Duration.seconds(0),
                maxTtl: cdk.Duration.minutes(1),
                defaultTtl: cdk.Duration.seconds(10),
            })
        };

        let certStack = this.region == 'us-east-1' ? this : new Stack(this, 'certStack', {
            crossRegionReferences: true,
            env: {region: 'us-east-1', account: this.account}
        })
        const distribution = new Distribution(this, 'Distribution', {
            defaultBehavior: {
                origin: origin,
                viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                compress: true
            },
            additionalBehaviors: {
                ...additionalBehaviors,
                '/index.html*': noCaching,
                '/config*': noCaching
            },
            domainNames: [this.webSubFQDN],
            certificate: new Certificate(certStack, 'web-Certificate', {
                domainName: this.webSubFQDN,
                validation: CertificateValidation.fromDns(hostedZone)
            }),
            defaultRootObject: 'index.html',
            errorResponses: [
                {
                    httpStatus: 404,
                    responseHttpStatus: 200,
                    responsePagePath: '/index.html',
                },
                {
                    httpStatus: 403,
                    responseHttpStatus: 200,
                    responsePagePath: '/index.html',
                }
            ]
        });

        new ARecord(this, 'WebsiteAliasRecord', {
            zone: hostedZone,
            target: RecordTarget.fromAlias(
                new CloudFrontTarget(distribution)
            ),
            recordName: webSubdomain
        });
        // Output values for other stacks to consume
        new cdk.CfnOutput(this, 'WebUiBucketName', {
            value: this.bucket.bucketName,
            exportName: `${this.stackName}-WebUiBucket`,
        });

        new cdk.CfnOutput(this, 'WebUIFQDN', {
            value: this.webSubFQDN,
            exportName: `${this.stackName}-WebUIFQDN`,
        });
    }

    private createAssetBehaviors(origin: IOrigin) {
        const cached = {
            origin: origin,
            viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            compress: true,
            cachePolicy: new CachePolicy(this, 'AssetsCachePolicy', {
                minTtl: cdk.Duration.days(1),
                maxTtl: cdk.Duration.days(7),
                defaultTtl: cdk.Duration.days(7),
            })
        };

        const additionalBehaviors: { [key: string]: BehaviorOptions } = {};
        ['js', 'css', 'svg', 'png', 'jpg', 'jpeg', 'gif', 'woff', 'woff2', 'ttf', 'eot', 'ico'].map((ext) => {
            additionalBehaviors[`/*.${ext}`] = cached;
        });
        return additionalBehaviors;
    }
} 