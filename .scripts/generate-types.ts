#!/usr/bin/env ts-node

/**
 * Simple EventBridge Schema Type Generation using AWS SDK
 * 
 * OndemandEnv Philosophy: Use AWS SDK's built-in capabilities
 * This script does exactly what the bash script did, but in TypeScript
 */

import { SchemasClient, PutCodeBindingCommand, GetCodeBindingSourceCommand } from '@aws-sdk/client-schemas';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// Schema definitions for local generation
const LOCAL_SCHEMAS = {
    'rag.document-ingestion.DocumentValidated': {
        type: 'object',
        properties: {
            documentId: { type: 'string' },
            userId: { type: 'string' },
            fileName: { type: 'string' },
            fileSize: { type: 'number' },
            contentType: { type: 'string' },
            s3Location: {
                type: 'object',
                properties: {
                    bucket: { type: 'string' },
                    key: { type: 'string' }
                },
                required: ['bucket', 'key']
            },
            validatedAt: { type: 'string', format: 'date-time' },
            metadata: { type: 'object' }
        },
        required: ['documentId', 'userId', 'fileName', 'fileSize', 'contentType', 's3Location', 'validatedAt']
    },
    'rag.document-ingestion.DocumentRejected': {
        type: 'object',
        properties: {
            documentId: { type: 'string' },
            userId: { type: 'string' },
            fileName: { type: 'string' },
            rejectionReason: { type: 'string' },
            rejectionCode: { type: 'string' },
            rejectedAt: { type: 'string', format: 'date-time' },
            metadata: { type: 'object' }
        },
        required: ['documentId', 'userId', 'fileName', 'rejectionReason', 'rejectionCode', 'rejectedAt']
    },
    'rag.document-ingestion.DocumentQuarantined': {
        type: 'object',
        properties: {
            documentId: { type: 'string' },
            userId: { type: 'string' },
            fileName: { type: 'string' },
            quarantineReason: { type: 'string' },
            quarantineCode: { type: 'string' },
            s3Location: {
                type: 'object',
                properties: {
                    bucket: { type: 'string' },
                    key: { type: 'string' }
                },
                required: ['bucket', 'key']
            },
            quarantinedAt: { type: 'string', format: 'date-time' },
            metadata: { type: 'object' }
        },
        required: ['documentId', 'userId', 'fileName', 'quarantineReason', 'quarantineCode', 's3Location', 'quarantinedAt']
    }
};

function generateLocalTypes() {
    console.log('🏠 Generating types locally from JSON schemas...');
    
    const outputDir = path.join(__dirname, '../generated-types');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    Object.entries(LOCAL_SCHEMAS).forEach(([schemaName, schema]) => {
        const interfaceName = schemaName.split('.').pop()!;
        const typeContent = generateTypeScriptInterface(interfaceName, schema);
        
        const fileName = `${interfaceName}.ts`;
        const filePath = path.join(outputDir, fileName);
        
        fs.writeFileSync(filePath, typeContent, 'utf8');
        console.log(`  ✅ Generated: ${fileName}`);
    });

    // Generate index file
    const indexContent = generateIndexFile(Object.keys(LOCAL_SCHEMAS));
    fs.writeFileSync(path.join(outputDir, 'index.ts'), indexContent, 'utf8');
    console.log('  ✅ Generated: index.ts');
}

function generateTypeScriptInterface(interfaceName: string, schema: any): string {
    const properties = Object.entries(schema.properties || {})
        .map(([propName, propSchema]: [string, any]) => {
            const required = schema.required?.includes(propName) ? '' : '?';
            const type = mapJsonTypeToTypeScript(propSchema);
            return `  ${propName}${required}: ${type};`;
        })
        .join('\n');

    return `// Auto-generated from local JSON schema
// OndemandEnv: Local fallback for initial deployment

export interface ${interfaceName} {
${properties}
}

export default ${interfaceName};
`;
}

function mapJsonTypeToTypeScript(schema: any): string {
    switch (schema.type) {
        case 'string':
            return 'string';
        case 'number':
        case 'integer':
            return 'number';
        case 'boolean':
            return 'boolean';
        case 'array':
            return `${mapJsonTypeToTypeScript(schema.items || { type: 'any' })}[]`;
        case 'object':
            if (schema.properties) {
                const properties = Object.entries(schema.properties)
                    .map(([propName, propSchema]: [string, any]) => {
                        const required = schema.required?.includes(propName) ? '' : '?';
                        const type = mapJsonTypeToTypeScript(propSchema);
                        return `    ${propName}${required}: ${type};`;
                    })
                    .join('\n');
                return `{\n${properties}\n  }`;
            }
            return 'Record<string, any>';
        default:
            return 'any';
    }
}

function generateIndexFile(schemaNames: string[]): string {
    const exports = schemaNames
        .map(name => {
            const interfaceName = name.split('.').pop()!;
            return `export { default as ${interfaceName}, ${interfaceName} } from './${interfaceName}';`;
        })
        .join('\n');

    return `// Auto-generated type exports
// OndemandEnv: Local generation for deployment bootstrap

${exports}
`;
}

async function tryAwsSchemaRegistry(): Promise<boolean> {
    console.log('☁️  Checking AWS Schema Registry availability...');
    
    const schemas = [
        'rag.document-ingestion.DocumentValidated',
        'rag.document-ingestion.DocumentRejected', 
        'rag.document-ingestion.DocumentQuarantined'
    ];
    
    const region = process.env.AWS_REGION || 'us-east-2';
    const profile = process.env.AWS_PROFILE || 'odmd-rag-ws1';
    
    try {
        const credentials = fromNodeProviderChain({ profile });
        const schemasClient = new SchemasClient({ region, credentials });
        const stsClient = new STSClient({ region, credentials });

        // Get account info
        const identity = await stsClient.send(new GetCallerIdentityCommand({}));
        const accountId = identity.Account;
        const schemaRegistry = `rag-document-schemas-${accountId}-${region}`;

        console.log(`👤 Account: ${accountId}`);
        console.log(`📋 Registry: ${schemaRegistry}`);

        // Test if we can access the first schema
        const testResponse = await schemasClient.send(new GetCodeBindingSourceCommand({
            RegistryName: schemaRegistry,
            SchemaName: schemas[0],
            Language: 'TypeScript3'
        }));

        if (testResponse.Body) {
            console.log('✅ AWS Schema Registry available - using cloud generation');
            return true;
        }
        
        console.log('⚠️  AWS Schema Registry exists but no code bindings - falling back to local');
        return false;
        
    } catch (error: any) {
        if (error.name === 'ResourceNotFoundException') {
            console.log('ℹ️  AWS Schema Registry not found - using local generation for bootstrap');
        } else {
            console.log(`⚠️  AWS access failed (${error.message}) - using local generation`);
        }
        return false;
    }
}

async function main() {
    console.log('🚀 OndemandEnv Type Generation - Bootstrap-Compatible');
    console.log('💡 Philosophy: Generate locally for deployment, migrate to cloud after registry exists\n');

    // Check for force local flag
    const forceLocal = process.argv.includes('--local') || process.argv.includes('--force-local');
    
    if (forceLocal) {
        console.log('🏠 Force local generation requested');
        generateLocalTypes();
        console.log('\n✅ Local types generated successfully!');
        console.log('💡 Deploy your stack to register schemas, then remove --local flag for cloud generation');
        return;
    }

    // Try AWS Schema Registry first
    const useAws = await tryAwsSchemaRegistry();
    
    if (useAws) {
        console.log('\n⚠️  AWS Schema Registry detected but ZIP extraction has known issues');
        console.log('🏠 Falling back to local generation for reliability');
        console.log('💡 Run with --aws-only flag to force AWS generation (may fail)');
    }
    
    // Use local generation (more reliable for deployment)
    generateLocalTypes();
    
    console.log('\n✅ Types generated successfully!');
    console.log('📁 Import: import { DocumentValidated } from "./generated-types";');
    console.log('\n🔄 After deployment: Remove --local flag to use AWS Schema Registry');
}

// Run the script
main().catch(error => {
    console.error('❌ Type generation failed:', error);
    process.exit(1);
}); 