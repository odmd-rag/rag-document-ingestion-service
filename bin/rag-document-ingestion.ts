#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { StackProps } from 'aws-cdk-lib';
import { RagDocumentIngestionStack } from '../lib/rag-document-ingestion-stack';
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

    const webHostingStack = new RagDocumentIngestionWebHostingStack(app, targetEnver, props);

    const mainStack = new RagDocumentIngestionStack(app, targetEnver, {
        ...props,
        zoneName: webHostingStack.zoneName,
        hostedZoneId: webHostingStack.hostedZoneId,
        webUiDomain: webHostingStack.webSubFQDN,
    });

    
    const webUiStack = new RagDocumentIngestionWebUiStack(app, targetEnver, {
        ...props,
        bucket: webHostingStack.bucket,
        webHostingStack: webHostingStack,
        mainStack: mainStack,
    });

    try {
        await webUiStack.buildWebUiAndDeploy();
    } catch (error) {
        console.error('Failed to deploy webUI configuration:', error);
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