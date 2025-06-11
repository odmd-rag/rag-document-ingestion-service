#!/usr/bin/env ts-node

/**
 * EventBridge Schema Type Generator
 * 
 * OndemandEnv Architecture Highlight: Leverage Cloud Capabilities
 * Rather than manually maintaining TypeScript interfaces, we use EventBridge 
 * Schema Registry's native code generation capabilities to automatically 
 * generate type-safe interfaces for our Lambda functions.
 * 
 * This script:
 * 1. Fetches schemas from EventBridge Schema Registry
 * 2. Generates TypeScript interfaces using AWS's built-in code generation
 * 3. Creates strongly-typed event handlers for Lambda functions
 * 4. Ensures contract compliance across producer/consumer services
 */

import { SchemasClient, DescribeSchemaCommand, GetCodeBindingSourceCommand } from '@aws-sdk/client-schemas';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// Configuration - these should match your CDK deployment
const SCHEMA_REGISTRY_NAME = process.env.SCHEMA_REGISTRY_NAME || `rag-document-schemas-${process.env.AWS_ACCOUNT_ID}-${process.env.AWS_DEFAULT_REGION}`;
const OUTPUT_DIR = join(__dirname, '../lib/generated/eventbridge-types');

// Schema names that match our EventBridge Schema Registry
const SCHEMA_NAMES = [
    'rag.document-ingestion.DocumentValidated',
    'rag.document-ingestion.DocumentRejected', 
    'rag.document-ingestion.DocumentQuarantined'
];

interface SchemaMetadata {
    name: string;
    version: string;
    description: string;
    content: string;
}

class EventBridgeSchemaGenerator {
    private schemasClient: SchemasClient;

    constructor() {
        this.schemasClient = new SchemasClient({
            region: process.env.AWS_DEFAULT_REGION || 'us-east-2'
        });
    }

    async generateTypes(): Promise<void> {
        console.log('🚀 EventBridge Schema Type Generation Started');
        console.log(`📋 Registry: ${SCHEMA_REGISTRY_NAME}`);
        console.log(`📁 Output Directory: ${OUTPUT_DIR}`);

        // Ensure output directory exists
        if (!existsSync(OUTPUT_DIR)) {
            mkdirSync(OUTPUT_DIR, { recursive: true });
        }

        const schemas: SchemaMetadata[] = [];

        // Fetch all schemas from registry
        for (const schemaName of SCHEMA_NAMES) {
            try {
                console.log(`\n📥 Fetching schema: ${schemaName}`);
                const schema = await this.fetchSchema(schemaName);
                schemas.push(schema);
                console.log(`✅ Retrieved: ${schema.name} (v${schema.version})`);
            } catch (error) {
                console.error(`❌ Failed to fetch schema ${schemaName}:`, error);
                process.exit(1);
            }
        }

        // Generate TypeScript interfaces
        await this.generateTypeScriptInterfaces(schemas);
        
        // Generate code bindings using AWS native capability
        await this.generateAWSCodeBindings();

        console.log('\n🎉 Schema type generation completed successfully!');
        console.log(`📄 Generated files in: ${OUTPUT_DIR}`);
    }

    private async fetchSchema(schemaName: string): Promise<SchemaMetadata> {
        const command = new DescribeSchemaCommand({
            RegistryName: SCHEMA_REGISTRY_NAME,
            SchemaName: schemaName
        });

        const response = await this.schemasClient.send(command);
        
        if (!response.Content) {
            throw new Error(`Schema content not found for ${schemaName}`);
        }

        return {
            name: schemaName,
            version: response.SchemaVersion || '1',
            description: response.Description || '',
            content: response.Content
        };
    }

    private async generateTypeScriptInterfaces(schemas: SchemaMetadata[]): Promise<void> {
        console.log('\n🔧 Generating TypeScript interfaces...');

        let tsContent = `// Auto-generated TypeScript interfaces from EventBridge Schema Registry
// Generated at: ${new Date().toISOString()}
// Registry: ${SCHEMA_REGISTRY_NAME}
//
// OndemandEnv Architecture: These types are automatically generated from 
// EventBridge Schema Registry, ensuring contract compliance across services.
// DO NOT EDIT MANUALLY - Run 'npm run generate:types' to regenerate.

import { EventBridgeEvent } from 'aws-lambda';

`;

        for (const schema of schemas) {
            try {
                const schemaObj = JSON.parse(schema.content);
                const interfaceName = this.getInterfaceName(schema.name);
                const detailInterface = this.generateDetailInterface(schemaObj, interfaceName);
                
                tsContent += `// ${schema.description}\n`;
                tsContent += `// Schema: ${schema.name} (v${schema.version})\n`;
                tsContent += detailInterface;
                tsContent += `\nexport type ${interfaceName}Event = EventBridgeEvent<'${this.getDetailType(schemaObj)}', ${interfaceName}Detail>;\n\n`;
                
                console.log(`  ✅ Generated interface: ${interfaceName}Detail`);
            } catch (error) {
                console.error(`❌ Failed to generate interface for ${schema.name}:`, error);
            }
        }

        // Add utility types and helper functions
        tsContent += this.generateUtilityTypes();

        const outputFile = join(OUTPUT_DIR, 'index.ts');
        writeFileSync(outputFile, tsContent, 'utf8');
        console.log(`📝 TypeScript interfaces written to: ${outputFile}`);
    }

    private async generateAWSCodeBindings(): Promise<void> {
        console.log('\n🔧 Generating AWS Code Bindings...');

        for (const schemaName of SCHEMA_NAMES) {
            try {
                const command = new GetCodeBindingSourceCommand({
                    RegistryName: SCHEMA_REGISTRY_NAME,
                    SchemaName: schemaName,
                    Language: 'TypeScript'
                });

                const response = await this.schemasClient.send(command);
                
                if (response.Body) {
                    const bindingContent = await response.Body.transformToString();
                    const fileName = `${this.getInterfaceName(schemaName)}.binding.ts`;
                    const filePath = join(OUTPUT_DIR, fileName);
                    
                    writeFileSync(filePath, bindingContent, 'utf8');
                    console.log(`  ✅ AWS binding generated: ${fileName}`);
                }
            } catch (error) {
                console.warn(`⚠️  AWS code binding not available for ${schemaName}:`, error);
            }
        }
    }

    private generateDetailInterface(schemaObj: any, interfaceName: string): string {
        const detailProperties = schemaObj.properties?.detail?.properties || {};
        
        let interfaceContent = `export interface ${interfaceName}Detail {\n`;
        
        for (const [key, value] of Object.entries(detailProperties)) {
            const propType = this.getTypeScriptType(value as any);
            const isRequired = schemaObj.properties?.detail?.required?.includes(key) || false;
            const optional = isRequired ? '' : '?';
            
            interfaceContent += `  ${key}${optional}: ${propType};\n`;
        }
        
        interfaceContent += '}\n';
        return interfaceContent;
    }

    private getTypeScriptType(jsonSchemaProperty: any): string {
        if (jsonSchemaProperty.type === 'string') {
            if (jsonSchemaProperty.enum) {
                return jsonSchemaProperty.enum.map((e: string) => `'${e}'`).join(' | ');
            }
            if (jsonSchemaProperty.format === 'uuid') return 'string';
            if (jsonSchemaProperty.format === 'date-time') return 'string';
            return 'string';
        }
        
        if (jsonSchemaProperty.type === 'number') {
            return 'number';
        }
        
        if (jsonSchemaProperty.type === 'boolean') {
            return 'boolean';
        }
        
        if (jsonSchemaProperty.type === 'object') {
            if (jsonSchemaProperty.properties) {
                let objType = '{\n';
                for (const [key, value] of Object.entries(jsonSchemaProperty.properties)) {
                    const propType = this.getTypeScriptType(value as any);
                    const isRequired = jsonSchemaProperty.required?.includes(key) || false;
                    const optional = isRequired ? '' : '?';
                    objType += `    ${key}${optional}: ${propType};\n`;
                }
                objType += '  }';
                return objType;
            }
            return 'Record<string, any>';
        }
        
        if (jsonSchemaProperty.type === 'array') {
            const itemType = this.getTypeScriptType(jsonSchemaProperty.items || { type: 'any' });
            return `${itemType}[]`;
        }
        
        return 'any';
    }

    private getInterfaceName(schemaName: string): string {
        // Convert 'rag.document-ingestion.DocumentValidated' to 'DocumentValidated'
        const parts = schemaName.split('.');
        return parts[parts.length - 1];
    }

    private getDetailType(schemaObj: any): string {
        return schemaObj.properties?.['detail-type']?.enum?.[0] || 'Unknown';
    }

    private generateUtilityTypes(): string {
        return `
// Utility types for EventBridge event handling
export type RAGEventTypes = 
  | DocumentValidatedEvent 
  | DocumentRejectedEvent 
  | DocumentQuarantinedEvent;

// Type guards for runtime type checking
export function isDocumentValidatedEvent(event: any): event is DocumentValidatedEvent {
  return event['detail-type'] === 'Document Validated';
}

export function isDocumentRejectedEvent(event: any): event is DocumentRejectedEvent {
  return event['detail-type'] === 'Document Rejected';
}

export function isDocumentQuarantinedEvent(event: any): event is DocumentQuarantinedEvent {
  return event['detail-type'] === 'Document Quarantined';
}

// Event handler type definitions
export type DocumentValidatedHandler = (event: DocumentValidatedEvent) => Promise<void>;
export type DocumentRejectedHandler = (event: DocumentRejectedEvent) => Promise<void>;
export type DocumentQuarantinedHandler = (event: DocumentQuarantinedEvent) => Promise<void>;

// Generic event handler type
export type RAGEventHandler<T extends RAGEventTypes> = (event: T) => Promise<void>;
`;
    }
}

// Script execution
async function main() {
    try {
        // Validate required environment variables
        if (!process.env.AWS_ACCOUNT_ID || !process.env.AWS_DEFAULT_REGION) {
            console.error('❌ Required environment variables missing:');
            console.error('   AWS_ACCOUNT_ID: AWS Account ID where schemas are deployed');
            console.error('   AWS_DEFAULT_REGION: AWS Region where Schema Registry exists');
            console.error('\nExample usage:');
            console.error('   AWS_ACCOUNT_ID=123456789012 AWS_DEFAULT_REGION=us-east-2 npm run generate:types');
            process.exit(1);
        }

        const generator = new EventBridgeSchemaGenerator();
        await generator.generateTypes();
        
    } catch (error) {
        console.error('❌ Schema type generation failed:', error);
        process.exit(1);
    }
}

// Run the script
if (require.main === module) {
    main();
}

export { EventBridgeSchemaGenerator }; 