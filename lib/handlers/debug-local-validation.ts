import {GetCallerIdentityCommand, STSClient} from "@aws-sdk/client-sts";
import {fromIni} from "@aws-sdk/credential-providers";
import * as fs from "node:fs";


console.log("=== RAG Document Ingestion Service - Validation Handler Debug ===");
console.log("Loading debug configuration...");

const {
    event,
    context,
    env
} = JSON.parse(fs.readFileSync('debug-validation-event.json', {encoding: 'utf-8'}))

const envs = env as { [k: string]: string }

console.log("Setting environment variables:");
for (const k in envs) {
    process.env[k] = envs[k]!
    console.log(`  ${k}=${envs[k]}`)
}

async function main() {
    const region = 'us-west-1'

    console.log(`\n=== AWS Credentials Setup ===`);
    console.log(`Region: ${region}`);

    const creds = await fromIni({profile: 'sandbox-central'})()

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
    const sts = new STSClient({})
    const caller = await sts.send(new GetCallerIdentityCommand({}))
    console.log(`STS Caller Identity:
  Account: ${caller.Account}
  User ID: ${caller.UserId}
  ARN: ${caller.Arn}`)

    console.log(`\n=== Environment Variables Check ===`);
    const requiredEnvVars = [
        'QUARANTINE_BUCKET',
        'EVENT_BUS_NAME', 
        'EVENT_SOURCE',
        'SCHEMA_REGISTRY_NAME'
    ];
    
    for (const envVar of requiredEnvVars) {
        const value = process.env[envVar];
        console.log(`  ${envVar}: ${value || 'NOT SET'}`);
        if (!value) {
            console.warn(`  ⚠️  Warning: ${envVar} is not set!`);
        }
    }

    console.log(`\n=== Event Structure Validation ===`);
    console.log(`Event type: ${typeof event}`);
    console.log(`Event records count: ${event.Records?.length || 0}`);
    
    if (event.Records && event.Records.length > 0) {
        event.Records.forEach((record: any, index: number) => {
            console.log(`  Record ${index + 1}:`);
            console.log(`    Event name: ${record.eventName}`);
            console.log(`    Bucket: ${record.s3?.bucket?.name}`);
            console.log(`    Key: ${record.s3?.object?.key}`);
            console.log(`    Size: ${record.s3?.object?.size} bytes`);
        });
    }

    console.log(`\n=== Context Information ===`);
    console.log(`Function name: ${context.functionName}`);
    console.log(`Function version: ${context.functionVersion}`);
    console.log(`Request ID: ${context.awsRequestId}`);
    console.log(`Memory limit: ${context.memoryLimitInMB}MB`);
    console.log(`Remaining time: ${context.getRemainingTimeInMillis()}ms`);

    /*
    const assumeOut = await sts.send(new AssumeRoleCommand({
        RoleArn: 'arn:aws:iam::590184031795:role/cdk-hnb659fds-deploy-role-590184031795-us-west-1',
        RoleSessionName: "debugging-validation-" + Date.now()
    }));

    process.env.AWS_ACCESS_KEY_ID = assumeOut.Credentials!.AccessKeyId
    process.env.AWS_SECRET_ACCESS_KEY = assumeOut.Credentials!.SecretAccessKey
    process.env.AWS_SESSION_TOKEN = assumeOut.Credentials!.SessionToken
    */

    console.log(`\n=== Starting Validation Handler ===`);
    const startTime = Date.now();
    
    try {
        const {handler} = await import("./src/validation-handler");
        const result = await handler(event, context);
        
        const endTime = Date.now();
        const executionTime = endTime - startTime;
        
        console.log(`\n=== Execution Completed Successfully ===`);
        console.log(`Execution time: ${executionTime}ms`);
        console.log(`Result:`, result);
        
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