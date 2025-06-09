// Configuration interface
export interface Config {
  aws: {
    region: string;
    identityPoolId: string;
    apiEndpoint: string;
  };
  google: {
    clientId: string;
  };
  cognito: {
    userPoolId: string;
    providerName: string;
  };
  authZoneName: string;
  deployment?: {
    timestamp: string;
    version: string;
    webDomain: string;
  };
}

// Default configuration (fallback)
const defaultConfig: Config = {
  aws: {
    region: 'us-east-1',
    identityPoolId: '',
    apiEndpoint: '',
  },
  google: {
    clientId: '',
  },
  cognito: {
    userPoolId: '',
    providerName: '',
  },
  authZoneName: ''
};

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
      console.log('✅ Loaded runtime configuration from /config.json');
      return runtimeConfig!; // We know it's not null here
    } else {
      console.warn('⚠️ Failed to load /config.json, using default configuration');
    }
  } catch (error) {
    console.warn('⚠️ Error loading /config.json:', error);
  }

  runtimeConfig = defaultConfig;
  return runtimeConfig;
}

// Get current configuration (use after calling loadConfig)
export function getConfig(): Config {
  if (!runtimeConfig) {
    console.warn('⚠️ Configuration not loaded yet, using default');
    return defaultConfig;
  }
  return runtimeConfig;
}

// Legacy export for backward compatibility during development
export const config = defaultConfig; 