import {type Config, getConfig} from './config.ts';

export interface UserInfo {
    name: string;
    email: string;
    groups?: string[];
}

export class AuthService {
    private static _instance: AuthService | null = null;
    private config!: Config;
    private _idToken: string| null = null;
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
        this.config = getConfig();

        const missingConfig = [];
        if (!this.config.aws?.region) missingConfig.push('aws.region');
        if (!this.config.google?.clientId) missingConfig.push('google.clientId');
        
        if (missingConfig.length > 0) {
            throw new Error(`Missing critical configuration: ${missingConfig.join(', ')}`);
        }
        
        console.log('🔧 AuthService initialized with config:', {
            region: this.config.aws.region,
            apiEndpoint: this.config.aws.apiEndpoint,
            userPoolDomain: this.config.cognito.userPoolDomain,
            googleClientId: this.config.google.clientId
        });
    }

    get idToken(): string | null {
        return this._idToken;
    }

    get currentUser(): UserInfo | null {
        return this.userInfo;
    }

    get isAuthenticated(): boolean {
        return this.userInfo !== null && this._idToken !== null;
    }

    // Initiate authentication with user-auth service
    initiateGoogleLogin(): void {
        const state = this.generateRandomState();
        localStorage.setItem('oauth_state', state);

        const params = new URLSearchParams({
            response_type: 'code',
            client_id: this.config.google.clientId, // Use the actual client ID, not userPoolId
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
                client_id: this.config.google.clientId, // Use the actual client ID, not userPoolId
                redirect_uri: this.config.redirectUri,
                code
            })
        });

        if (!tokenResponse.ok) {
            const error = await tokenResponse.text();
            throw new Error(`Failed to exchange code for tokens: ${error}`);
        }

        const tokens = await tokenResponse.json();
        this._idToken = tokens.id_token as string;

        // Parse user info from ID token
        const payload = JSON.parse(atob(this._idToken.split('.')[1]));
        console.log('🔍 ID Token payload:', payload);
        
        this.userInfo = {
            name: payload.name,
            email: payload.email,
            groups: payload['cognito:groups'] || []
        };

        console.log('🔍 Extracted user info:', this.userInfo);

        // Check if user has required group membership for RAG uploads
        if (!this.userInfo.groups?.includes('odmd-rag-uploader')) {
            console.error('❌ User groups:', this.userInfo.groups);
            console.error('❌ Required group: odmd-rag-uploader');
            throw new Error('Access denied: You must be a member of the "odmd-rag-uploader" group to upload documents.');
        }

        // Store tokens for credential refresh
        localStorage.setItem('id_token', this._idToken);
        localStorage.setItem('user_info', JSON.stringify(this.userInfo));


        return this.userInfo;
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
            this._idToken = idToken; // Restore the ID token
            
            // Validate that the token hasn't expired
            const payload = JSON.parse(atob(idToken.split('.')[1]));
            const currentTime = Math.floor(Date.now() / 1000);
            
            if (payload?.exp && payload.exp < currentTime) {
                console.warn('⚠️ Stored token has expired');
                this.logout();
                return null;
            }
            
            console.log('✅ Session restored for:', this.userInfo?.email);
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

        this.userInfo = null;

        // Redirect to clean URL
        window.location.href = '/';
    }

    // Direct JWT authentication for testing purposes
    async authenticateWithJWT(jwtToken: string): Promise<UserInfo> {
        try {
            // Basic JWT validation - check if it has 3 parts
            const parts = jwtToken.split('.');
            if (parts.length !== 3) {
                throw new Error('Invalid JWT format: Token must have 3 parts separated by dots');
            }

            // Parse the payload to extract user info
            const payload = JSON.parse(atob(parts[1]));
            console.log('🔍 JWT payload:', payload);

            // Check if token is expired
            const currentTime = Math.floor(Date.now() / 1000);
            if (payload?.exp && payload.exp < currentTime) {
                throw new Error('Token has expired');
            }

            // Extract user information
            this.userInfo = {
                name: payload.name || payload.given_name + ' ' + payload.family_name || 'Test User',
                email: payload.email || 'test@example.com',
                groups: payload['cognito:groups'] || payload.groups || ['odmd-rag-uploader'] // Default to having the required group for testing
            };

            this._idToken = jwtToken;

            console.log('🔍 Extracted user info from JWT:', this.userInfo);

            // Check if user has required group membership for RAG uploads
            if (!this.userInfo.groups?.includes('odmd-rag-uploader')) {
                console.error('❌ User groups:', this.userInfo.groups);
                console.error('❌ Required group: odmd-rag-uploader');
                throw new Error('Access denied: You must be a member of the "odmd-rag-uploader" group to upload documents.');
            }

            // Store tokens for future use
            localStorage.setItem('id_token', this._idToken);
            localStorage.setItem('user_info', JSON.stringify(this.userInfo));

            return this.userInfo;
        } catch (error) {
            console.error('❌ JWT authentication failed:', error);
            throw error;
        }
    }

}
