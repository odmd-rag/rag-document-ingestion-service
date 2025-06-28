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


let runtimeConfig: Config | null = null;

export async function loadConfig(): Promise<Config> {
    if (runtimeConfig) {
        return runtimeConfig;
    }

    try {
        const response = await fetch('/config.json?t=' + Date.now());
        if (response.ok) {
            runtimeConfig = await response.json();
            runtimeConfig!.redirectUri = window.location.hostname == 'localhost'
                ? 'http://localhost:5173/index.html?callback'
                : `https://${runtimeConfig!.deployment.webDomain}/index.html?callback`

            console.log('✅ Loaded runtime configuration from /config.json');
            return runtimeConfig!;
        } else {
            console.warn('⚠️ Failed to load /config.json, using default configuration');
            throw new Error('Failed to load /config.json');
        }
    } catch (error) {
        console.warn('⚠️ Error loading /config.json:', error);
        throw error
    }

}

export function getConfig(): Config {
    if (!runtimeConfig) {
        throw new Error('Configuration not loaded yet. Call loadConfig() first.');
    }
    return runtimeConfig;
}
