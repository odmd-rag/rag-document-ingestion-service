import {GetCallerIdentityCommand, STSClient} from "@aws-sdk/client-sts";
import {fromIni} from "@aws-sdk/credential-providers";
import * as fs from "node:fs";

// import {addProxyToClient} from "aws-sdk-v3-proxy";
// process.env.HTTP_PROXY='http://192.168.49.1:8282'
// process.env.HTTPS_PROXY='http://192.168.49.1:8282'
// process.env.NO_PROXY='localhost,127.0.0.1'

console.log("=== RAG Document Ingestion Service - Upload URL Handler Debug ===");
console.log("Loading debug configuration...");

const {
    event,
    context,
    env
} = JSON.parse(fs.readFileSync('debug-upload-url-event.json', {encoding: 'utf-8'}))

const envs = env as { [k: string]: string }

console.log("Setting environment variables:");
for (const k in envs) {
    process.env[k] = envs[k]!
    console.log(`  ${k}=${envs[k]}`)
}

async function main() {
    const region = 'us-east-2'
    // const region = context.invokedFunctionArn.split(':')[3]

    console.log(`\n=== AWS Credentials Setup ===`);
    console.log(`Region: ${region}`);

    const creds = await fromIni({profile: 'odmd-rag-ws1'})()

    console.log("AWS Credentials loaded:");
    console.log(`  Access Key ID: ${creds.accessKeyId.substring(0, 10)}...`);
    console.log(`  Secret Access Key: ${creds.secretAccessKey.substring(0, 10)}...`);
    console.log(`  Session Token: ${creds.sessionToken ? creds.sessionToken.substring(0, 20) + '...' : 'N/A'}`);

    process.env.AWS_ACCESS_KEY_ID = creds.accessKeyId
    process.env.AWS_SECRET_ACCESS_KEY = creds.secretAccessKey
    process.env.AWS_SESSION_TOKEN = creds.sessionToken

    process.env.AWS_REGION = region
    process.env.AWS_DEFAULT_REGION = region

    console.log(`\n=== STS Identity Verification ===`);
    // const sts = addProxyToClient(new STSClient({}))
    const sts = new STSClient({})
    const caller = await sts.send(new GetCallerIdentityCommand({}))
    console.log(`STS Caller Identity:
  Account: ${caller.Account}
  User ID: ${caller.UserId}
  ARN: ${caller.Arn}`)

    console.log(`\n=== Environment Variables Check ===`);
    const requiredEnvVars = [
        'UPLOAD_BUCKET',
        'USER_POOL_ID',
        'CORS_ORIGIN'
    ];
    
    for (const envVar of requiredEnvVars) {
        const value = process.env[envVar];
        console.log(`  ${envVar}: ${value || 'NOT SET'}`);
        if (!value) {
            console.warn(`  ⚠️  Warning: ${envVar} is not set!`);
        }
    }

    console.log(`\n=== API Gateway Event Analysis ===`);
    console.log(`Event type: ${typeof event}`);
    console.log(`HTTP Method: ${event.httpMethod || event.requestContext?.http?.method}`);
    console.log(`Resource: ${event.resource || event.routeKey}`);
    console.log(`Path: ${event.path || event.rawPath}`);
    console.log(`Query parameters:`, event.queryStringParameters);
    console.log(`Path parameters:`, event.pathParameters);
    
    if (event.headers) {
        console.log(`Headers:`);
        Object.entries(event.headers).forEach(([key, value]) => {
            // Mask sensitive headers
            const maskedValue = key.toLowerCase().includes('authorization') || key.toLowerCase().includes('token') 
                ? `${String(value).substring(0, 10)}...` 
                : value;
            console.log(`  ${key}: ${maskedValue}`);
        });
    }

    if (event.body) {
        console.log(`Body (first 200 chars): ${event.body.substring(0, 200)}${event.body.length > 200 ? '...' : ''}`);
    }

    console.log(`\n=== Context Information ===`);
    console.log(`Function name: ${context.functionName}`);
    console.log(`Function version: ${context.functionVersion}`);
    console.log(`Request ID: ${context.awsRequestId}`);
    console.log(`Memory limit: ${context.memoryLimitInMB}MB`);
    // console.log(`Remaining time: ${context.getRemainingTimeInMillis()}ms`);

    console.log(`\n=== Starting Upload URL Handler ===`);
    const startTime = Date.now();
    
    try {
        const {handler} = await import("./src/upload-url-handler");
        const result = await handler(event);
        
        const endTime = Date.now();
        const executionTime = endTime - startTime;
        
        console.log(`\n=== Execution Completed Successfully ===`);
        console.log(`Execution time: ${executionTime}ms`);
        console.log(`Status code: ${result.statusCode}`);
        console.log(`Response headers:`, result.headers);
        
        // Parse and log response body if it's JSON
        try {
            const responseBody = JSON.parse(result.body);
            console.log(`Response body:`, responseBody);
            
            // Log presigned URL info if present
            if (responseBody.uploadUrl) {
                const url = new URL(responseBody.uploadUrl);
                console.log(`Presigned URL details:`);
                console.log(`  Bucket: ${url.hostname.split('.')[0]}`);
                console.log(`  Key: ${url.pathname.substring(1)}`);
                console.log(`  Expires: ${url.searchParams.get('X-Amz-Expires')} seconds`);
            }
        } catch {
            console.log(`Response body (raw): ${result.body}`);
        }
        
    } catch (error) {
        const endTime = Date.now();
        const executionTime = endTime - startTime;
        
        console.error(`\n=== Execution Failed ===`);
        console.error(`Execution time: ${executionTime}ms`);
        console.error(`Error type: ${error instanceof Error ? error.constructor.name : typeof error}`);
        console.error(`Error message: ${error instanceof Error ? error.message : String(error)}`);
        console.error(`Stack trace:`, error instanceof Error ? error.stack : 'No stack trace available');
        throw error;
    }
}

main().catch(e => {
    console.error("\n=== MAIN FUNCTION ERROR ===")
    console.error("Error type:", e instanceof Error ? e.constructor.name : typeof e)
    console.error("Error message:", e instanceof Error ? e.message : String(e))
    console.error("Stack trace:", e instanceof Error ? e.stack : 'No stack trace available')
    console.error("=== END MAIN ERROR ===")
    process.exit(1)
}).finally(() => {
    console.log("\n=== Debug Session Complete ===")
    console.log("Timestamp:", new Date().toISOString())
}) 