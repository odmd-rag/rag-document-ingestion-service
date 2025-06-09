import {CognitoIdentityClient} from '@aws-sdk/client-cognito-identity';
import {fromCognitoIdentityPool} from '@aws-sdk/credential-provider-cognito-identity';
import type {AwsCredentialIdentity} from '@aws-sdk/types';
import {type Config, getConfig} from './config.js';

export interface UserInfo {
    name: string;
    email: string;
    groups?: string[];
}

export class AuthService {
    private static _instance: AuthService | null = null;
    private config!: Config;
    private _credentials: AwsCredentialIdentity | null = null;
    private userInfo: UserInfo | null = null;
    private tokenRefreshTimeout?: number;

    public static async getInstance(): Promise<AuthService> {
        if (!AuthService._instance) {
            AuthService._instance = new AuthService();
            await AuthService._instance.initialize();
        }
        return AuthService._instance;
    }

    private async initialize(): Promise<void> {
        this.config = await getConfig();
        console.log('🔧 AuthService initialized with config:', {
            region: this.config.aws.region,
            identityPoolId: this.config.aws.identityPoolId,
            apiEndpoint: this.config.aws.apiEndpoint,
            providerName: this.config.cognito.providerName,
            userPoolId: this.config.cognito.userPoolId,
            userPoolDomain: this.config.cognito.userPoolDomain
        });
    }

    get credentials(): AwsCredentialIdentity | null {
        return this._credentials;
    }

    get currentUser(): UserInfo | null {
        return this.userInfo;
    }

    get isAuthenticated(): boolean {
        return this.userInfo !== null && this._credentials !== null;
    }

    // Initiate authentication with user-auth service
    initiateGoogleLogin(): void {
        const state = this.generateRandomState();
        localStorage.setItem('oauth_state', state);

        const params = new URLSearchParams({
            response_type: 'code',
            client_id: this.config.cognito.userPoolId, // This is actually the client ID from user-auth service
            redirect_uri: this.config.redirectUri,
            state,
            identity_provider: 'Google'
        });

        window.location.href = `https://${this.config.cognito.userPoolDomain}/oauth2/authorize?${params.toString()}`;
    }

    private generateRandomState(): string {
        const array = new Uint8Array(16);
        crypto.getRandomValues(array);
        return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    }

    // Handle OAuth callback and exchange code for tokens
    async handleCallback(params: URLSearchParams): Promise<UserInfo> {
        const storedState = localStorage.getItem('oauth_state');
        const returnedState = params.get('state');

        if (!storedState || storedState !== returnedState) {
            throw new Error('Invalid state parameter');
        }

        const code = params.get('code');
        if (!code) {
            throw new Error('No authorization code received');
        }

        const tokenResponse = await fetch(`https://${this.config.cognito.userPoolDomain}/oauth2/token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: this.config.cognito.userPoolId, // This is the client ID from user-auth service
                redirect_uri: this.config.redirectUri,
                code
            })
        });

        if (!tokenResponse.ok) {
            const error = await tokenResponse.text();
            throw new Error(`Failed to exchange code for tokens: ${error}`);
        }

        const tokens = await tokenResponse.json();
        const idToken = tokens.id_token;

        // Parse user info from ID token
        const payload = JSON.parse(atob(idToken.split('.')[1]));
        this.userInfo = {
            name: payload.name,
            email: payload.email,
            groups: payload['cognito:groups'] || []
        };

        // Check if user has required group membership for RAG uploads
        if (!this.userInfo.groups?.includes('odmd-rag-uploader')) {
            throw new Error('Access denied: You must be a member of the "odmd-rag-uploader" group to upload documents.');
        }

        // Store tokens for credential refresh
        localStorage.setItem('id_token', idToken);
        localStorage.setItem('user_info', JSON.stringify(this.userInfo));

        // Get AWS credentials via Cognito Identity Pool
        await this.refreshCredentials();

        return this.userInfo;
    }

    // Exchange ID token from user-auth service for AWS credentials via Identity Pool
    async refreshCredentials(): Promise<AwsCredentialIdentity | null> {
        const idToken = localStorage.getItem('id_token');
        if (!idToken) {
            this.logout();
            return null;
        }

        try {
            const client = new CognitoIdentityClient({
                region: this.config.aws.region
            });

            // Use the Identity Pool to get AWS credentials with federated token
            this._credentials = await fromCognitoIdentityPool({
                client,
                identityPoolId: this.config.aws.identityPoolId,
                logins: {
                    // Use the user-auth service provider as the login provider
                    [this.config.cognito.providerName]: idToken
                }
            })();

            console.log('✅ AWS credentials refreshed successfully');

            // Schedule next refresh (20 minutes)
            if (this.tokenRefreshTimeout) {
                window.clearTimeout(this.tokenRefreshTimeout);
            }
            this.tokenRefreshTimeout = window.setTimeout(
                () => this.refreshCredentials(),
                20 * 60 * 1000 // 20 minutes
            );

            return this._credentials;
        } catch (error: any) {
            console.error('❌ Failed to refresh credentials:', error);

            if (error.name === 'NotAuthorizedException') {
                throw new Error('Access denied: Not authorized to assume upload role. Please contact your administrator to be added to the "odmd-rag-uploader" group.');
            }

            // For other errors, logout and re-authenticate
            this.logout();
            throw new Error(`Authentication failed: ${error.message}`);
        }
    }

    // Load existing session on page load
    async loadExistingSession(): Promise<UserInfo | null> {
        const storedUserInfo = localStorage.getItem('user_info');
        const idToken = localStorage.getItem('id_token');

        if (!storedUserInfo || !idToken) {
            return null;
        }

        try {
            this.userInfo = JSON.parse(storedUserInfo);
            await this.refreshCredentials();
            return this.userInfo;
        } catch (error) {
            console.warn('⚠️ Failed to restore session:', error);
            this.logout();
            return null;
        }
    }

    // Logout and clear all stored data
    logout(): void {
        localStorage.removeItem('id_token');
        localStorage.removeItem('user_info');
        localStorage.removeItem('oauth_state');

        if (this.tokenRefreshTimeout) {
            window.clearTimeout(this.tokenRefreshTimeout);
        }

        this._credentials = null;
        this.userInfo = null;

        // Redirect to clean URL
        window.location.href = '/';
    }
}
