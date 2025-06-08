import { CognitoIdentityClient, GetIdCommand, GetCredentialsForIdentityCommand } from '@aws-sdk/client-cognito-identity';
import { getConfig } from './config';

export interface User {
  email: string;
  name: string;
  picture: string;
  googleToken: string;
}

export class AuthService {
  private cognitoClient: CognitoIdentityClient;
  private currentUser: User | null = null;
  private credentials: any = null;

  constructor() {
    // Initialize with default region, will be updated when config is loaded
    this.cognitoClient = new CognitoIdentityClient({ region: 'us-east-1' });
  }

  async initializeGoogleAuth(): Promise<void> {
    const config = getConfig();
    
    // Update Cognito client with correct region
    this.cognitoClient = new CognitoIdentityClient({ region: config.aws.region });
    
    return new Promise((resolve) => {
      // Load Google Identity Services script
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.onload = () => {
        window.google.accounts.id.initialize({
          client_id: config.google.clientId,
          callback: this.handleGoogleSignIn.bind(this),
        });
        resolve();
      };
      document.head.appendChild(script);
    });
  }

  private async handleGoogleSignIn(response: any): Promise<void> {
    try {
      // Decode the JWT token from Google
      const payload = JSON.parse(atob(response.credential.split('.')[1]));
      
      this.currentUser = {
        email: payload.email,
        name: payload.name,
        picture: payload.picture,
        googleToken: response.credential
      };

      // Get Cognito Identity Pool credentials
      await this.getCognitoCredentials(response.credential);
      
      // Trigger auth state change event
      window.dispatchEvent(new CustomEvent('authStateChanged', { detail: this.currentUser }));
    } catch (error) {
      console.error('Error handling Google sign-in:', error);
      throw error;
    }
  }

  private async getCognitoCredentials(googleToken: string): Promise<void> {
    try {
      const config = getConfig();
      
      // Create logins map for Cognito
      const logins: Record<string, string> = {};
      logins[`${config.cognito.providerName}`] = googleToken;

      // Get Cognito Identity ID
      const getIdCommand = new GetIdCommand({
        IdentityPoolId: config.aws.identityPoolId,
        Logins: logins
      });
      
      const idResponse = await this.cognitoClient.send(getIdCommand);
      
      // Get credentials for the identity
      const getCredentialsCommand = new GetCredentialsForIdentityCommand({
        IdentityId: idResponse.IdentityId,
        Logins: logins
      });
      
      const credentialsResponse = await this.cognitoClient.send(getCredentialsCommand);
      
      this.credentials = {
        accessKeyId: credentialsResponse.Credentials?.AccessKeyId,
        secretAccessKey: credentialsResponse.Credentials?.SecretKey,
        sessionToken: credentialsResponse.Credentials?.SessionToken,
        expiration: credentialsResponse.Credentials?.Expiration
      };

    } catch (error) {
      console.error('Error getting Cognito credentials:', error);
      throw error;
    }
  }

  renderSignInButton(containerId: string): void {
    const container = document.getElementById(containerId);
    if (container) {
      window.google.accounts.id.renderButton(container, {
        theme: 'outline',
        size: 'large',
        text: 'signin_with',
        width: 250
      });
    }
  }

  async signOut(): Promise<void> {
    this.currentUser = null;
    this.credentials = null;
    
    // Sign out from Google
    if (window.google?.accounts?.id) {
      window.google.accounts.id.disableAutoSelect();
    }
    
    // Trigger auth state change event
    window.dispatchEvent(new CustomEvent('authStateChanged', { detail: null }));
  }

  getCurrentUser(): User | null {
    return this.currentUser;
  }

  getCredentials(): any {
    return this.credentials;
  }

  isAuthenticated(): boolean {
    return this.currentUser !== null && this.credentials !== null;
  }
}

// Global Google API types
declare global {
  interface Window {
    google: {
      accounts: {
        id: {
          initialize: (config: any) => void;
          renderButton: (element: HTMLElement, config: any) => void;
          disableAutoSelect: () => void;
        };
      };
    };
  }
} 