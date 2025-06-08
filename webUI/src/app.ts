import { AuthService, type User } from './auth';
import { DocumentService, type DocumentStatus } from './documentService';
import { loadConfig } from './config';

export class App {
  private authService: AuthService;
  private documentService: DocumentService;
  private uploadedDocuments: Map<string, DocumentStatus> = new Map();

  constructor() {
    this.authService = new AuthService();
    this.documentService = new DocumentService(this.authService);
    this.init();
  }

  private async init(): Promise<void> {
    try {
      // Load runtime configuration first
      await loadConfig();
      console.log('✅ Configuration loaded successfully');
      
      // Initialize Google Auth
      await this.authService.initializeGoogleAuth();
      
      // Set up event listeners
      this.setupEventListeners();
      
      // Initial render
      this.render();
    } catch (error) {
      console.error('❌ Failed to initialize app:', error);
      this.renderError('Failed to initialize application. Please check the configuration.');
    }
  }

  private setupEventListeners(): void {
    // Listen for auth state changes
    window.addEventListener('authStateChanged', () => {
      this.render();
    });

    // File upload listener
    document.addEventListener('change', async (event) => {
      const target = event.target as HTMLInputElement;
      if (target.id === 'fileInput' && target.files && target.files.length > 0) {
        await this.handleFileUpload(target.files[0]);
      }
    });

    // Sign out button listener
    document.addEventListener('click', async (event) => {
      const target = event.target as HTMLElement;
      if (target.id === 'signOutBtn') {
        await this.authService.signOut();
      }
    });
  }

  private async handleFileUpload(file: File): Promise<void> {
    try {
      this.showUploadStatus('Uploading document...', 'info');
      
      const documentId = await this.documentService.uploadDocument(file);
      
      // Add to tracked documents
      this.uploadedDocuments.set(documentId, {
        documentId,
        status: 'uploaded',
        timestamp: new Date().toISOString(),
      });

      this.showUploadStatus(`Document uploaded successfully! ID: ${documentId}`, 'success');
      this.renderDocumentList();
      
      // Start polling for status updates
      this.pollDocumentStatus(documentId);
      
    } catch (error) {
      console.error('Upload failed:', error);
      this.showUploadStatus(`Upload failed: ${(error as Error).message}`, 'error');
    }
  }

  private async pollDocumentStatus(documentId: string): Promise<void> {
    try {
      const status = await this.documentService.getDocumentStatus(documentId);
      this.uploadedDocuments.set(documentId, status);
      this.renderDocumentList();

      // Continue polling if still processing
      if (status.status === 'uploaded' || status.status === 'processing') {
        setTimeout(() => this.pollDocumentStatus(documentId), 2000);
      }
    } catch (error) {
      console.error('Failed to get document status:', error);
    }
  }

  private showUploadStatus(message: string, type: 'info' | 'success' | 'error'): void {
    const statusDiv = document.getElementById('uploadStatus');
    if (statusDiv) {
      statusDiv.textContent = message;
      statusDiv.className = `upload-status ${type}`;
      statusDiv.style.display = 'block';
      
      if (type === 'success' || type === 'error') {
        setTimeout(() => {
          statusDiv.style.display = 'none';
        }, 5000);
      }
    }
  }

  private render(): void {
    const app = document.getElementById('app');
    if (!app) return;

    const user = this.authService.getCurrentUser();

    if (!user) {
      // Show login screen
      app.innerHTML = this.getLoginHTML();
      // Render Google sign-in button
      setTimeout(() => {
        this.authService.renderSignInButton('googleSignIn');
      }, 100);
    } else {
      // Show main application
      app.innerHTML = this.getMainAppHTML(user);
      this.renderDocumentList();
    }
  }

  private renderError(message: string): void {
    const app = document.getElementById('app');
    if (!app) return;

    app.innerHTML = `
      <div class="error-container">
        <div class="error-card">
          <h1>⚠️ Application Error</h1>
          <p>${message}</p>
          <button onclick="location.reload()" class="retry-btn">Retry</button>
        </div>
      </div>
    `;
  }

  private getLoginHTML(): string {
    return `
      <div class="login-container">
        <div class="login-card">
          <h1>RAG Document Ingestion</h1>
          <p>Sign in with Google to upload documents to the RAG system</p>
          <div id="googleSignIn"></div>
          <div class="config-warning">
            <p><strong>Configuration Required:</strong></p>
            <p>Please update the configuration in <code>src/config.ts</code> with your deployed AWS resources:</p>
            <ul>
              <li>AWS Region</li>
              <li>Cognito Identity Pool ID</li>
              <li>API Gateway Endpoint</li>
              <li>Google OAuth Client ID</li>
              <li>Cognito User Pool details</li>
            </ul>
          </div>
        </div>
      </div>
    `;
  }

  private getMainAppHTML(user: User): string {
    return `
      <div class="main-container">
        <header class="app-header">
          <h1>RAG Document Ingestion</h1>
          <div class="user-info">
            <img src="${user.picture}" alt="Profile" class="profile-pic">
            <span>Welcome, ${user.name}</span>
            <button id="signOutBtn" class="sign-out-btn">Sign Out</button>
          </div>
        </header>
        
        <main class="app-main">
          <div class="upload-section">
            <h2>Upload Document</h2>
            <p>Select a document to upload to the RAG system for processing</p>
            
            <div class="upload-area">
              <input type="file" id="fileInput" accept=".pdf,.txt,.doc,.docx,.md" />
              <label for="fileInput" class="upload-label">
                <div class="upload-icon">📄</div>
                <div>Click to select a document</div>
                <div class="upload-hint">Supported formats: PDF, TXT, DOC, DOCX, MD</div>
              </label>
            </div>
            
            <div id="uploadStatus" class="upload-status" style="display: none;"></div>
          </div>
          
          <div class="documents-section">
            <h2>Uploaded Documents</h2>
            <div id="documentList" class="document-list">
              <p class="no-documents">No documents uploaded yet</p>
            </div>
          </div>
        </main>
      </div>
    `;
  }

  private renderDocumentList(): void {
    const documentList = document.getElementById('documentList');
    if (!documentList) return;

    if (this.uploadedDocuments.size === 0) {
      documentList.innerHTML = '<p class="no-documents">No documents uploaded yet</p>';
      return;
    }

    const documentsHTML = Array.from(this.uploadedDocuments.values())
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .map(doc => this.getDocumentHTML(doc))
      .join('');

    documentList.innerHTML = documentsHTML;
  }

  private getDocumentHTML(doc: DocumentStatus): string {
    const statusClass = this.getStatusClass(doc.status);
    const statusIcon = this.getStatusIcon(doc.status);
    
    return `
      <div class="document-item ${statusClass}">
        <div class="document-info">
          <div class="document-id">${doc.documentId}</div>
          <div class="document-timestamp">${new Date(doc.timestamp).toLocaleString()}</div>
        </div>
        <div class="document-status">
          <span class="status-icon">${statusIcon}</span>
          <span class="status-text">${doc.status}</span>
          ${doc.message ? `<div class="status-message">${doc.message}</div>` : ''}
        </div>
      </div>
    `;
  }

  private getStatusClass(status: string): string {
    switch (status) {
      case 'validated': return 'status-success';
      case 'quarantined':
      case 'failed': return 'status-error';
      case 'processing': return 'status-processing';
      default: return 'status-pending';
    }
  }

  private getStatusIcon(status: string): string {
    switch (status) {
      case 'validated': return '✅';
      case 'quarantined': return '⚠️';
      case 'failed': return '❌';
      case 'processing': return '⏳';
      default: return '📄';
    }
  }
} 