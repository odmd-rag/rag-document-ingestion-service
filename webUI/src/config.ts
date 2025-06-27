// Configuration interface
export interface Config {
    aws: {
        region: string;
        apiEndpoint: string;
    };
    google: {
        clientId: string;
    };
    cognito: {
        providerName: string;
        userPoolDomain: string;
    };
    deployment: {
        timestamp: string;
        version: string;
        webDomain: string;
    };
    services?: {
        ingestion?: string;
        processing?: string;
        embedding?: string;
        vectorStorage?: string;
    };
    redirectUri:string
}


// Runtime configuration loaded from deployed config.json
let runtimeConfig: Config | null = null;

// Load configuration from the deployed config.json file
export async function loadConfig(): Promise<Config> {
    if (runtimeConfig) {
        return runtimeConfig;
    }

    try {
        const response = await fetch('/config.json?t=' + Date.now()); // Cache bust
        if (response.ok) {
            runtimeConfig = await response.json();
            runtimeConfig!.redirectUri = window.location.hostname == 'localhost'
                ? 'http://localhost:5173/index.html?callback'
                : `https://${runtimeConfig!.deployment.webDomain}/index.html?callback`

            console.log('✅ Loaded runtime configuration from /config.json');
            return runtimeConfig!; // We know it's not null here
        } else {
            console.warn('⚠️ Failed to load /config.json, using default configuration');
            throw new Error('Failed to load /config.json');
        }
    } catch (error) {
        console.warn('⚠️ Error loading /config.json:', error);
        throw error
    }

}

// Get current configuration (use after calling loadConfig)
export function getConfig(): Config {
    if (!runtimeConfig) {
        throw new Error('Configuration not loaded yet. Call loadConfig() first.');
    }
    return runtimeConfig;
}
