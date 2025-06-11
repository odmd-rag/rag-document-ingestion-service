# AWS Schema Registry TypeScript Code Generation

## 🎯 **Bootstrap Problem & Solution**

**Issue:** Classic chicken-and-egg problem for initial deployment:
- Can't deploy CDK → Need TypeScript types
- Can't generate from AWS → Schemas not registered yet  
- Can't register schemas → Need to deploy first
- Can't deploy → Need types... 🔄

**Solution:** **Local generation for bootstrap, cloud generation after deployment**

## 🔧 **Usage**

### 🥾 **Bootstrap (First Deployment)**
```bash
npm run generate:types:bootstrap
# or
npm run generate:types:local
```
Generates types locally from JSON schemas for initial deployment.

### ☁️ **After Deployment** 
```bash
npm run generate:types
```
Automatically detects AWS Schema Registry and uses cloud generation.

### 🏠 **Force Local Generation**
```bash
npm run generate:types:local
```
Always uses local generation (reliable fallback).

### ⚠️ **Force AWS Generation** 
```bash
npm run generate:types:aws
```
Forces AWS Schema Registry (may fail due to ZIP encoding issues).

## 🔄 **Deployment Workflow**

1. **Initial deployment:** `npm run generate:types:bootstrap`
2. **Deploy CDK stack:** `npm run cdk-deploy` 
3. **After deployment:** `npm run generate:types` (uses AWS automatically)
4. **Future deploys:** Use either local or AWS generation

## 📝 **Key Discovery**

- AWS returns **valid ZIP files** (magic bytes: `504b0304`)
- ZIP contains TypeScript files with proper schema types
- Issue is in binary-to-string conversion during AWS SDK response handling
- Local generation provides reliable fallback for all scenarios

## ⚠️ **Common Issues**

### "Parameter CodeBindingLanguage doesn't match pattern" Error
AWS expects `'TypeScript3'` instead of `'TypeScript'` as the language parameter.

### "Invalid CEN header" or "Invalid ZIP format" Errors  
This indicates binary data corruption during AWS SDK stream conversion. The ZIP files have correct magic bytes but corrupted headers. **Solution:** Use local generation.

### "ResourceNotFoundException" During Bootstrap
This is expected! The schema registry doesn't exist yet. The script automatically falls back to local generation.

## 🏗️ **OndemandEnv Architecture Principle**

This script embodies OndemandEnv's philosophy: **"Leverage cloud reliability instead of reinventing the wheel"**
- Uses AWS Schema Registry's native TypeScript code generation when available
- Provides local fallback for reliability and bootstrap scenarios  
- Avoids custom JSON Schema parsing when cloud generation works
- Pragmatic approach: reliability over purity

## 🎯 OndemandEnv Philosophy: Use AWS SDK Directly

Instead of bash scripts, we use **AWS SDK for JavaScript/TypeScript** to generate types directly from EventBridge Schema Registry. Clean, simple, and stays in the TypeScript ecosystem.

## 🚀 Simple Usage

```bash
# Generate types from EventBridge Schema Registry
npm run generate:types
```

The script uses AWS SDK to do exactly what AWS CLI would do, but in TypeScript.

## 📁 What Gets Generated

The script creates these files in `lib/generated/`:

- **`DocumentValidated.ts`** - AWS-generated TypeScript types
- **`DocumentRejected.ts`** - AWS-generated TypeScript types  
- **`DocumentQuarantined.ts`** - AWS-generated TypeScript types
- **`index.ts`** - Convenience export file

## 💡 Usage in Lambda Functions

```typescript
import { DocumentValidated } from './generated';

export async function handler(event: DocumentValidated) {
    // ✅ Fully type-safe, AWS-generated interfaces
    const { documentId, bucketName, objectKey } = event.detail;
    await processDocument(documentId, bucketName, objectKey);
}
```

## ⚡ How It Works

The TypeScript script does exactly what AWS CLI would do:

1. **`PutCodeBindingCommand`** - Tells AWS to generate TypeScript types
2. **`GetCodeBindingSourceCommand`** - Downloads the generated files
3. **File system writes** - Saves the generated TypeScript files

```typescript
// Same as: aws schemas put-code-binding --language TypeScript3
await schemasClient.send(new PutCodeBindingCommand({
    RegistryName: schemaRegistry,
    SchemaName: schemaName,
    Language: 'TypeScript3'
}));

// Same as: aws schemas get-code-binding-source --query 'Body'
const response = await schemasClient.send(new GetCodeBindingSourceCommand({
    RegistryName: schemaRegistry,
    SchemaName: schemaName,
    Language: 'TypeScript3'
}));
```

## 🛠️ Prerequisites

- Node.js with TypeScript support
- AWS SDK credentials configured
- EventBridge schemas deployed (via CDK)

## 🎯 OndemandEnv Benefits

### ✅ What We Leverage
- **AWS SDK Native Calls**: Direct API usage, no CLI dependency
- **TypeScript Ecosystem**: Stays within our development environment
- **EventBridge Schema Registry**: Official AWS type generation
- **Zero Custom Logic**: AWS handles all type conversion

### ❌ What We Avoid  
- Bash script dependencies
- AWS CLI requirement in CI/CD
- Custom JSON Schema parsers
- Cross-platform shell compatibility issues

This exemplifies OndemandEnv's principle: **"Use cloud services as they were designed to be used,"** but in the language and ecosystem we're already using. 

## 🔍 Common Issues

### Invalid Language Parameter
```
BadRequestException: Parameter CodeBindingLanguage doesn't match pattern ^(Java8|TypeScript3|Python36|Go1)$
```

**Solution**: Use `TypeScript3`, not `TypeScript` as the language parameter. 