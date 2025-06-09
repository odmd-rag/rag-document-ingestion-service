#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { StackProps } from 'aws-cdk-lib';
import { RagDocumentIngestionStack } from '../lib/rag-document-ingestion-stack';
import { RagDocumentIngestionAuthStack } from '../lib/rag-document-ingestion-auth-stack';
import { RagDocumentIngestionWebHostingStack } from '../lib/rag-document-ingestion-web-hosting-stack';
import { RagDocumentIngestionWebUiStack } from '../lib/rag-document-ingestion-web-ui-stack';
import {RagContracts, RagDocumentIngestionEnver} from '@odmd-rag/contracts-lib-rag';

const app = new cdk.App({autoSynth:false});

async function main() {
    const buildRegion = process.env.CDK_DEFAULT_REGION;
    const buildAccount = process.env.CDK_DEFAULT_ACCOUNT;
    if (!buildRegion || !buildAccount) {
        throw new Error("buildRegion>" + buildRegion + "; buildAccount>" + buildAccount);
    }

    const props = {
        env: {
            account: buildAccount,
            region: buildRegion
        }
    } as StackProps;

    new RagContracts(app);

    const targetEnver = RagContracts.inst.getTargetEnver() as RagDocumentIngestionEnver;

    // Create web hosting stack first to get domain info
    const webHostingStack = new RagDocumentIngestionWebHostingStack(app, targetEnver, props);

    // Create main stack with domain info for API Gateway custom domain and CORS
    const mainStack = new RagDocumentIngestionStack(app, targetEnver, {
        ...props,
        zoneName: webHostingStack.zoneName,
        hostedZoneId: webHostingStack.hostedZoneId,
        webUiDomain: webHostingStack.webSubFQDN,
    });
    
    // Create auth stack after main stack so it can import the API Gateway ARN
    const authStack = new RagDocumentIngestionAuthStack(app, targetEnver, props);

    // Implement auth callback producers for user-auth service to consume
    authStack.implementAuthCallbackProducers(targetEnver, webHostingStack.webSubFQDN);
    
    const webUiStack = new RagDocumentIngestionWebUiStack(app, targetEnver, {
        ...props,
        bucket: webHostingStack.bucket,
        webHostingStack: webHostingStack,
        authStack: authStack,
        mainStack: mainStack,
    });

    // Deploy the webUI
    try {
        await webUiStack.buildWebUiAndDeploy();
    } catch (error) {
        console.error('Failed to deploy webUI configuration:', error);
        // Don't throw - let the stacks deploy even if config deployment fails
    }

    app.synth({aspectStabilization: false});
}

console.log("main begin.");
main().catch(e => {
    console.error(e);
    throw e;
}).finally(() => {
    console.log("main end.");
}); 