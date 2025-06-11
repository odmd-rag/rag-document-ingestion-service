import { SchemasClient, GetCodeBindingSourceCommand } from '@aws-sdk/client-schemas';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import * as fs from 'fs';
import * as path from 'path';

async function debugSingleSchema() {
    const schemaName = 'rag.document-ingestion.DocumentValidated';
    const region = 'us-east-2';
    const profile = 'odmd-rag-ws1';
    const accountId = '366920167720';
    const schemaRegistry = `rag-document-schemas-${accountId}-${region}`;
    
    console.log(`🔍 Debugging single schema: ${schemaName}`);
    
    const credentials = fromNodeProviderChain({ profile });
    const schemasClient = new SchemasClient({ region, credentials });
    
    try {
        const response = await schemasClient.send(new GetCodeBindingSourceCommand({
            RegistryName: schemaRegistry,
            SchemaName: schemaName,
            Language: 'TypeScript3'
        }));
        
        if (!response.Body) {
            console.log('❌ No response body');
            return;
        }
        
        console.log('📊 Response Body analysis:');
        console.log('- Type:', typeof response.Body);
        console.log('- Constructor:', response.Body.constructor.name);
        console.log('- Methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(response.Body)));
        
        // Method 1: transformToString with different encodings
        console.log('\n🧪 Method 1: transformToString with binary encoding');
        const str1 = await response.Body.transformToString();
        const buf1 = Buffer.from(str1, 'binary');
        console.log(`Length: ${buf1.length}, Magic: ${buf1.slice(0, 4).toString('hex')}`);
        fs.writeFileSync('./debug-method1.zip', buf1);
        
        // Try refreshing the client for method 2
        const response2 = await schemasClient.send(new GetCodeBindingSourceCommand({
            RegistryName: schemaRegistry,
            SchemaName: schemaName,
            Language: 'TypeScript3'
        }));
        
        // Method 2: transformToString with latin1 encoding
        console.log('\n🧪 Method 2: transformToString with latin1 encoding');
        const str2 = await response2.Body!.transformToString();
        const buf2 = Buffer.from(str2, 'latin1');
        console.log(`Length: ${buf2.length}, Magic: ${buf2.slice(0, 4).toString('hex')}`);
        fs.writeFileSync('./debug-method2.zip', buf2);
        
        // Try method 3: raw string no encoding conversion
        const response3 = await schemasClient.send(new GetCodeBindingSourceCommand({
            RegistryName: schemaRegistry,
            SchemaName: schemaName,
            Language: 'TypeScript3'
        }));
        
        console.log('\n🧪 Method 3: Raw string as buffer');
        const str3 = await response3.Body!.transformToString();
        const buf3 = Buffer.from(str3);
        console.log(`Length: ${buf3.length}, Magic: ${buf3.slice(0, 4).toString('hex')}`);
        fs.writeFileSync('./debug-method3.zip', buf3);
        
        // Compare all methods
        console.log('\n📊 Comparison:');
        console.log(`Method 1 (binary): ${buf1.slice(0, 20).toString('hex')}`);
        console.log(`Method 2 (latin1): ${buf2.slice(0, 20).toString('hex')}`);
        console.log(`Method 3 (default): ${buf3.slice(0, 20).toString('hex')}`);
        
    } catch (error) {
        console.error('❌ Error:', error);
    }
}

debugSingleSchema(); 