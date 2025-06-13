import { AuthService } from './auth.js';
import { DocumentService } from './documentService.js';
import { loadConfig } from './config.js';

// Global state
let authService: AuthService;
let documentService: DocumentService;

// Initialize the application
async function initializeApp(): Promise<void> {
  try {
    console.log('🚀 Initializing RAG Document Ingestion App...');
    
    // Load configuration
    await loadConfig();
    console.log('✅ Configuration loaded');

    // Initialize auth service
    authService = await AuthService.getInstance();
    console.log('✅ AuthService initialized');

    // Initialize document service
    documentService = new DocumentService();
    console.log('✅ DocumentService initialized');

    // Handle OAuth callback if present
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('callback') || urlParams.get('code')) {
      await handleOAuthCallback(urlParams);
      return; // Early return to avoid rendering sign-in UI
    }

    // Try to restore existing session
    const existingUser = await authService.loadExistingSession();
    if (existingUser) {
      console.log('✅ Restored existing session for:', existingUser.email);
      showMainUI(existingUser);
    } else {
      showSignInUI();
    }

    console.log('✅ App initialization complete');
  } catch (error) {
    console.error('❌ Failed to initialize app:', error);
    showErrorState('Failed to initialize application', error);
  }
}

// Handle OAuth callback from Cognito
async function handleOAuthCallback(params: URLSearchParams): Promise<void> {
  try {
    console.log('🔄 Handling OAuth callback...');
    showLoadingState('Processing authentication...');

    const user = await authService.handleCallback(params);
    console.log('✅ Authentication successful for:', user.email);

    // Clean up URL by redirecting to the main page
    window.history.replaceState({}, document.title, '/');
    
    showMainUI(user);
  } catch (error) {
    console.error('❌ OAuth callback failed:', error);
    showErrorState('Authentication failed', error);
  }
}

// Show sign-in UI
function showSignInUI(): void {
  const appDiv = document.getElementById('app')!;
  appDiv.innerHTML = `
    <div class="container">
      <div class="header">
        <h1>🔄 RAG Document Ingestion</h1>
        <p>Upload documents for AI-powered processing and retrieval</p>
      </div>
      
      <div class="auth-section">
        <div class="sign-in-card">
          <h2>Sign In Required</h2>
          <p>Please sign in with your Google account to access the document upload service.</p>
          <button id="signInBtn" class="google-sign-in-btn">
            <svg width="20" height="20" viewBox="0 0 24 24">
              <path fill="#4285f4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34a853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#fbbc05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#ea4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Sign in with Google
          </button>
          <div class="info-section">
            <p class="note">
              <strong>Note:</strong> You must be a member of the "odmd-rag-uploader" group to upload documents.
            </p>
          </div>
        </div>
      </div>
    </div>
  `;

  // Add event listener for sign-in button
  document.getElementById('signInBtn')?.addEventListener('click', () => {
    try {
      authService.initiateGoogleLogin();
    } catch (error) {
      console.error('❌ Failed to initiate Google login:', error);
      showErrorState('Failed to start authentication', error);
    }
  });
}

// Show main UI for authenticated users
function showMainUI(user: any): void {
  const appDiv = document.getElementById('app')!;
  appDiv.innerHTML = `
    <div class="container">
      <div class="header">
        <h1>🔄 RAG Document Ingestion</h1>
        <div class="user-info">
          <span>Welcome, ${user.name} (${user.email})</span>
          <button id="signOutBtn" class="sign-out-btn">Sign Out</button>
        </div>
      </div>

      <div class="upload-section">
        <div class="upload-card">
          <h2>Upload Document</h2>
          <div class="upload-area" id="uploadArea">
            <div class="upload-placeholder">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7,10 12,15 17,10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              <p>Drag & drop a document here or click to browse</p>
              <p class="file-types">Supported: PDF, DOCX, TXT</p>
            </div>
            <input type="file" id="fileInput" accept=".pdf,.docx,.txt" style="display: none;">
          </div>
          
          <div id="uploadProgress" class="upload-progress" style="display: none;">
            <div class="progress-bar">
              <div id="progressFill" class="progress-fill"></div>
            </div>
            <div id="progressText" class="progress-text">Uploading...</div>
          </div>
        </div>
      </div>

      <div class="status-section">
        <div class="status-card">
          <h3>Upload History</h3>
          <div id="uploadHistory" class="upload-history">
            <p class="no-uploads">No uploads yet</p>
          </div>
        </div>
      </div>
    </div>
  `;

  setupMainUIEventListeners();
}

// Set up event listeners for the main UI
function setupMainUIEventListeners(): void {
  // Sign out button
  document.getElementById('signOutBtn')?.addEventListener('click', () => {
    authService.logout();
  });

  // File upload functionality
  const uploadArea = document.getElementById('uploadArea')!;
  const fileInput = document.getElementById('fileInput') as HTMLInputElement;

  // Click to open file dialog
  uploadArea.addEventListener('click', () => {
    fileInput.click();
  });

  // Drag and drop handling
  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('drag-over');
  });

  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('drag-over');
  });

  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      handleFileUpload(files[0]);
    }
  });

  // File input change handler
  fileInput.addEventListener('change', (e) => {
    const files = (e.target as HTMLInputElement).files;
    if (files && files.length > 0) {
      handleFileUpload(files[0]);
    }
  });
}

// Handle file upload
async function handleFileUpload(file: File): Promise<void> {
  try {
    console.log('📤 Starting upload for:', file.name);
    
    // Validate file type
    const allowedTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'];
    if (!allowedTypes.includes(file.type)) {
      throw new Error('Unsupported file type. Please upload PDF, DOCX, or TXT files.');
    }

    // Validate file size (10MB limit)
    if (file.size > 10 * 1024 * 1024) {
      throw new Error('File size too large. Please upload files smaller than 10MB.');
    }

    showUploadProgress(0, 'Preparing upload...');

    // Initialize document service with current credentials
    await documentService.initialize(authService.idToken!);

    // Upload the file
    const uploadId = await documentService.uploadDocument(file, (progress) => {
      showUploadProgress(progress, 'Uploading...');
    });

    console.log('✅ Upload successful, ID:', uploadId);
    showUploadProgress(100, 'Upload complete!');

    // Start polling for status
    pollUploadStatus(uploadId, file.name);

  } catch (error) {
    console.error('❌ Upload failed:', error);
    hideUploadProgress();
    showErrorState('Upload failed', error);
  }
}

// Show upload progress
function showUploadProgress(progress: number, text: string): void {
  const progressElement = document.getElementById('uploadProgress')!;
  const progressFill = document.getElementById('progressFill')!;
  const progressText = document.getElementById('progressText')!;

  progressElement.style.display = 'block';
  progressFill.style.width = `${progress}%`;
  progressText.textContent = text;
}

// Hide upload progress
function hideUploadProgress(): void {
  const progressElement = document.getElementById('uploadProgress')!;
  progressElement.style.display = 'none';
}

// Poll upload status
async function pollUploadStatus(uploadId: string, fileName: string): Promise<void> {
  const maxAttempts = 30; // 5 minutes with 10-second intervals
  let attempts = 0;

  const addToHistory = (status: string, className: string) => {
    const historyElement = document.getElementById('uploadHistory')!;
    if (historyElement.querySelector('.no-uploads')) {
      historyElement.innerHTML = '';
    }

    const uploadItem = document.createElement('div');
    uploadItem.className = `upload-item ${className}`;
    uploadItem.innerHTML = `
      <div class="upload-item-info">
        <span class="file-name">${fileName}</span>
        <span class="upload-id">ID: ${uploadId}</span>
      </div>
      <span class="upload-status">${status}</span>
    `;
    historyElement.insertBefore(uploadItem, historyElement.firstChild);
  };

  // Add initial entry
  addToHistory('Processing...', 'processing');

  const checkStatus = async () => {
    try {
      const status = await documentService.getUploadStatus(uploadId);
      console.log(`📊 Status check ${attempts + 1}/${maxAttempts}:`, status);

      // Update the history entry
      const historyElement = document.getElementById('uploadHistory')!;
      const latestItem = historyElement.querySelector('.upload-item');
      
      if (status.status === 'completed') {
        latestItem?.classList.remove('processing');
        latestItem?.classList.add('completed');
        latestItem!.querySelector('.upload-status')!.textContent = 'Completed ✅';
        hideUploadProgress();
        return;
      } else if (status.status === 'failed') {
        latestItem?.classList.remove('processing');
        latestItem?.classList.add('failed');
        latestItem!.querySelector('.upload-status')!.textContent = `Failed: ${status.message || 'Unknown error'} ❌`;
        hideUploadProgress();
        return;
      }

      attempts++;
      if (attempts < maxAttempts) {
        setTimeout(checkStatus, 10000); // Check every 10 seconds
      } else {
        latestItem?.classList.remove('processing');
        latestItem?.classList.add('timeout');
        latestItem!.querySelector('.upload-status')!.textContent = 'Status check timeout ⏰';
        hideUploadProgress();
      }
    } catch (error) {
      console.error('❌ Status check failed:', error);
      const historyElement = document.getElementById('uploadHistory')!;
      const latestItem = historyElement.querySelector('.upload-item');
      latestItem?.classList.remove('processing');
      latestItem?.classList.add('failed');
      latestItem!.querySelector('.upload-status')!.textContent = 'Status check failed ❌';
      hideUploadProgress();
    }
  };

  setTimeout(checkStatus, 2000); // Start checking after 2 seconds
}

// Show loading state
function showLoadingState(message: string): void {
  const appDiv = document.getElementById('app')!;
  appDiv.innerHTML = `
    <div class="container">
      <div class="header">
        <h1>🔄 RAG Document Ingestion</h1>
      </div>
      <div class="loading-section">
        <div class="loading-spinner"></div>
        <p>${message}</p>
      </div>
    </div>
  `;
}

// Show error state
function showErrorState(title: string, error: any): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  
  const appDiv = document.getElementById('app')!;
  appDiv.innerHTML = `
    <div class="container">
      <div class="header">
        <h1>🔄 RAG Document Ingestion</h1>
      </div>
      <div class="error-section">
        <div class="error-card">
          <h2>⚠️ ${title}</h2>
          <p class="error-message">${errorMessage}</p>
          <button id="retryBtn" class="retry-btn">Try Again</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('retryBtn')?.addEventListener('click', () => {
    window.location.reload();
  });
}

// Start the application when the page loads
document.addEventListener('DOMContentLoaded', initializeApp); 