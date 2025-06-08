#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { StackProps } from 'aws-cdk-lib';
import { RagDocumentIngestionStack } from '../lib/rag-document-ingestion-stack';
import { RagDocumentIngestionAuthStack } from '../lib/rag-document-ingestion-auth-stack';
import {RagContracts, RagDocumentIngestionEnver} from '@odmd-rag/contracts-lib-rag';

const app = new cdk.App();

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

    // Create both stacks independently - no circular dependencies
    const authStack = new RagDocumentIngestionAuthStack(app, targetEnver, props);
    const mainStack = new RagDocumentIngestionStack(app, targetEnver, props);
}

console.log("main begin.");
main().catch(e => {
    console.error(e);
    throw e;
}).finally(() => {
    console.log("main end.");
}); 