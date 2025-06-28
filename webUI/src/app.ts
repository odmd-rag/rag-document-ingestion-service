import { AuthService } from './auth.ts';
import { DocumentService, type PipelineStatus } from './documentService.ts';
import { loadConfig } from './config.ts';

let authService: AuthService;
let documentService: DocumentService;

async function initializeApp(): Promise<void> {
  try {
    console.log('🚀 Initializing RAG Document Ingestion App...');
    
    await loadConfig();
    console.log('✅ Configuration loaded');

    authService = await AuthService.getInstance();
    console.log('✅ AuthService initialized');

    documentService = new DocumentService();
    console.log('✅ DocumentService initialized');

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('callback') || urlParams.get('code')) {
      await handleOAuthCallback(urlParams);
      return;
    }

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

async function handleOAuthCallback(params: URLSearchParams): Promise<void> {
  try {
    console.log('🔄 Handling OAuth callback...');
    showLoadingState('Processing authentication...');

    const user = await authService.handleCallback(params);
    console.log('✅ Authentication successful for:', user.email);

    window.history.replaceState({}, document.title, '/');
    
    showMainUI(user);
  } catch (error) {
    console.error('❌ OAuth callback failed:', error);
    showErrorState('Authentication failed', error);
  }
}

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
          <p>Please sign in with your Google account or use a JWT token for testing.</p>
          
          <!-- Google Sign-in -->
          <button id="signInBtn" class="google-sign-in-btn">
            <svg width="20" height="20" viewBox="0 0 24 24">
              <path fill="#4285f4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34a853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#fbbc05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#ea4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Sign in with Google
          </button>

          <!-- JWT Token Sign-in for Testing -->
          <div class="jwt-section">
            <hr style="margin: 20px 0; border: none; border-top: 1px solid #eee;">
            <h3 style="margin-bottom: 15px; color: #666; font-size: 1rem;">For Testing: JWT Token Authentication</h3>
            <textarea id="jwtInput" class="jwt-input" placeholder="Paste your JWT token here..."></textarea>
            <button id="jwtSignInBtn" class="jwt-sign-in-btn">Sign in with JWT</button>
            <div id="jwtError" class="jwt-error" style="display: none;"></div>
          </div>

          <div class="info-section">
            <p class="note">
              <strong>Note:</strong> You must be a member of the "odmd-rag-uploader" group to upload documents.
            </p>
          </div>
        </div>
      </div>
    </div>
  `;

  setupSignInEventListeners();
}

function setupSignInEventListeners(): void {
  document.getElementById('signInBtn')?.addEventListener('click', () => {
    try {
      authService.initiateGoogleLogin();
    } catch (error) {
      console.error('❌ Failed to initiate Google login:', error);
      showErrorState('Failed to start authentication', error);
    }
  });

  document.getElementById('jwtSignInBtn')?.addEventListener('click', async () => {
    const jwtInput = document.getElementById('jwtInput') as HTMLTextAreaElement;
    const jwtError = document.getElementById('jwtError')!;
    const jwtToken = jwtInput.value.trim();

    if (!jwtToken) {
      jwtError.textContent = 'Please enter a JWT token';
      jwtError.style.display = 'block';
      return;
    }

    try {
      jwtError.style.display = 'none';
      showLoadingState('Authenticating with JWT token...');
      
      const user = await authService.authenticateWithJWT(jwtToken);
      console.log('✅ JWT authentication successful for:', user.email);
      showMainUI(user);
    } catch (error) {
      console.error('❌ JWT authentication failed:', error);
      showSignInUI();
      
      setTimeout(() => {
        const jwtErrorElement = document.getElementById('jwtError');
        if (jwtErrorElement) {
          jwtErrorElement.textContent = error instanceof Error ? error.message : 'JWT authentication failed';
          jwtErrorElement.style.display = 'block';
        }
      }, 100);
    }
  });
}

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
              <p class="file-types">Supported: PDF, DOCX, DOC, PPTX, PPT, XLSX, XLS, TXT, MD, CSV, JSON, XML, HTML, RTF, ODT, ODP, ODS, Pages, Numbers, Keynote</p>
            </div>
            <input type="file" id="fileInput" accept=".pdf,.docx,.doc,.pptx,.ppt,.xlsx,.xls,.txt,.md,.csv,.json,.xml,.html,.htm,.rtf,.odt,.odp,.ods,.pages,.numbers,.key" style="display: none;">
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
          <h3>Upload History & Pipeline Status</h3>
          <div id="uploadHistory" class="upload-history">
            <p class="no-uploads">No uploads yet</p>
          </div>
        </div>
      </div>
    </div>
  `;

  setupMainUIEventListeners();
}

function setupMainUIEventListeners(): void {
  document.getElementById('signOutBtn')?.addEventListener('click', () => {
    authService.logout();
  });

  const uploadArea = document.getElementById('uploadArea')!;
  const fileInput = document.getElementById('fileInput') as HTMLInputElement;

  uploadArea.addEventListener('click', () => {
    fileInput.click();
  });

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

  fileInput.addEventListener('change', (e) => {
    const files = (e.target as HTMLInputElement).files;
    if (files && files.length > 0) {
      handleFileUpload(files[0]);
    }
  });
}

async function handleFileUpload(file: File): Promise<void> {
  try {
    console.log('📤 Starting upload for:', file.name);
    
    const allowedTypes = [
      'text/plain',
      'text/markdown',
      'text/csv',
      'text/tab-separated-values',
      'application/json',
      'application/xml',
      'text/html',
      
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/vnd.oasis.opendocument.text',
      'application/vnd.oasis.opendocument.presentation',
      'application/vnd.oasis.opendocument.spreadsheet',
      'application/rtf',
      'application/x-iwork-pages-sffpages',
      'application/x-iwork-numbers-sffnumbers',
      'application/x-iwork-keynote-sffkey'
    ];
    if (!allowedTypes.includes(file.type)) {
      throw new Error('Unsupported file type. Please upload a supported document format.');
    }

    if (file.size > 10 * 1024 * 1024) {
      throw new Error('File size too large. Please upload files smaller than 10MB.');
    }

    showUploadProgress(0, 'Preparing upload...');

    await documentService.initialize(authService.idToken!);

    const uploadId = await documentService.uploadDocument(file, (progress) => {
      showUploadProgress(progress, 'Uploading...');
    });

    console.log('✅ Upload successful, ID:', uploadId);
    showUploadProgress(100, 'Upload complete!');

    trackDocumentPipeline(uploadId, file.name);

  } catch (error) {
    console.error('❌ Upload failed:', error);
    hideUploadProgress();
    showErrorState('Upload failed', error);
  }
}

function showUploadProgress(progress: number, text: string): void {
  const progressElement = document.getElementById('uploadProgress')!;
  const progressFill = document.getElementById('progressFill')!;
  const progressText = document.getElementById('progressText')!;

  progressElement.style.display = 'block';
  progressFill.style.width = `${progress}%`;
  progressText.textContent = text;
}

function hideUploadProgress(): void {
  const progressElement = document.getElementById('uploadProgress')!;
  progressElement.style.display = 'none';
}

async function trackDocumentPipeline(documentId: string, fileName: string): Promise<void> {
  let attempts = 0;
  let consecutiveErrors = 0;
  const maxConsecutiveErrors = 3;

  const addToHistory = (status: string, className: string, details?: string) => {
    const historyElement = document.getElementById('uploadHistory')!;
    if (historyElement.querySelector('.no-uploads')) {
      historyElement.innerHTML = '';
    }

    const uploadItem = document.createElement('div');
    uploadItem.className = `upload-item ${className}`;
    uploadItem.innerHTML = `
      <div class="upload-item-info">
        <span class="file-name">${fileName}</span>
        <span class="upload-id">ID: ${documentId}</span>
        ${details ? `<div class="pipeline-details">${details}</div>` : ''}
      </div>
      <span class="upload-status">${status}</span>
    `;
    historyElement.insertBefore(uploadItem, historyElement.firstChild);
  };

  addToHistory('Starting comprehensive pipeline processing...', 'processing');

  const checkPipelineStatus = async () => {
    try {
      attempts++;
      console.log(`📊 Comprehensive pipeline status check ${attempts}:`);
      
      const pipelineStatus = await documentService.getPipelineStatus(documentId);
      console.log('Pipeline Status:', pipelineStatus);

      consecutiveErrors = 0;

      const historyElement = document.getElementById('uploadHistory')!;
      const latestItem = historyElement.querySelector('.upload-item');
      
      const stageProgress = createComprehensiveStageDisplay(pipelineStatus);
      const statusText = getComprehensiveStatusText(pipelineStatus);
      
      if (pipelineStatus.overallStatus === 'completed') {
        latestItem?.classList.remove('processing');
        latestItem?.classList.add('completed');
        latestItem!.querySelector('.upload-status')!.textContent = 'Pipeline Completed ✅ - Ready for RAG queries';
        updateItemDetails(latestItem, stageProgress);
        hideUploadProgress();
        console.log('🎉 Document pipeline completed successfully');
        return;
      } else if (pipelineStatus.overallStatus === 'failed') {
        const hasRealFailures = pipelineStatus.failedStages.some(stage => {
          const stageDetail = pipelineStatus.stageDetails[stage];
          return stageDetail?.metadata?.errorType !== 'network';
        });
        
        if (hasRealFailures) {
          latestItem?.classList.remove('processing');
          latestItem?.classList.add('failed');
          const failedStages = pipelineStatus.failedStages.join(', ');
          const errorDetails = getErrorDetailsFromPipeline(pipelineStatus);
          latestItem!.querySelector('.upload-status')!.textContent = `Pipeline Failed ❌ - Failed stages: ${failedStages}`;
          updateItemDetails(latestItem, stageProgress + errorDetails);
          hideUploadProgress();
          console.error('❌ Document pipeline failed:', pipelineStatus);
          return;
        }
      }
      
      latestItem!.querySelector('.upload-status')!.textContent = statusText;
      updateItemDetails(latestItem, stageProgress);
      console.log(`🔄 Pipeline processing: ${pipelineStatus.currentStage} (${pipelineStatus.completedStages.length}/4 stages completed)`);

      let nextCheckDelay = 5000;
      if (attempts > 10) nextCheckDelay = 10000;
      if (attempts > 30) nextCheckDelay = 30000;
      if (attempts > 60) nextCheckDelay = 60000;
      
      setTimeout(checkPipelineStatus, nextCheckDelay);
      
    } catch (error) {
      consecutiveErrors++;
      console.error('❌ Comprehensive pipeline status check failed:', error);
      
      if (consecutiveErrors >= maxConsecutiveErrors) {
        try {
          console.log('🔄 Falling back to ingestion-only status check...');
          const legacyStatus = await documentService.getUploadStatus(documentId);
          
          const historyElement = document.getElementById('uploadHistory')!;
          const latestItem = historyElement.querySelector('.upload-item');
          
          if (legacyStatus.status === 'completed' || legacyStatus.status === 'validated') {
            latestItem?.classList.remove('processing');
            latestItem?.classList.add('partial-success');
            latestItem!.querySelector('.upload-status')!.textContent = 'Ingestion Completed ✅ - Downstream services unavailable';
          } else {
            latestItem?.classList.remove('processing');
            latestItem?.classList.add('failed');
            latestItem!.querySelector('.upload-status')!.textContent = 'Pipeline status unavailable ❌ - Services may be down';
          }
          
        } catch (fallbackError) {
          console.error('❌ Fallback status check also failed:', fallbackError);
          const historyElement = document.getElementById('uploadHistory')!;
          const latestItem = historyElement.querySelector('.upload-item');
          latestItem?.classList.remove('processing');
          latestItem?.classList.add('failed');
          latestItem!.querySelector('.upload-status')!.textContent = 'All services unavailable ❌';
        }
        
        hideUploadProgress();
        return;
      }
      
      const retryDelay = Math.min(5000 * Math.pow(2, consecutiveErrors - 1), 30000);
      setTimeout(checkPipelineStatus, retryDelay);
    }
  };

  setTimeout(checkPipelineStatus, 3000);
}

function createComprehensiveStageDisplay(pipelineStatus: PipelineStatus): string {
  const stages = [
    { key: 'ingestion', name: 'Document Ingestion', icon: '📤' },
    { key: 'processing', name: 'Content Processing', icon: '⚙️' },
    { key: 'embedding', name: 'Vector Embedding', icon: '🔗' },
    { key: 'vector-storage', name: 'Vector Storage', icon: '💾' }
  ];
  
  let progressHtml = '<div class="comprehensive-stage-progress">';
  
  stages.forEach((stage) => {
    const stageDetail = pipelineStatus.stageDetails[stage.key];
    let stageClass = 'pending';
    let stageIcon = '⏳';
    let stageInfo = '';
    
    if (pipelineStatus.completedStages.includes(stage.key)) {
      stageClass = 'completed';
      stageIcon = '✅';
      if (stageDetail?.metadata) {
        const processingTime = stageDetail.metadata.processingTime || 0;
        stageInfo = `<small>(${processingTime}ms)</small>`;
      }
    } else if (pipelineStatus.failedStages.includes(stage.key)) {
      stageClass = 'failed';
      stageIcon = '❌';
      if (stageDetail?.metadata?.errorMessage) {
        stageInfo = `<small class="error-text">(${stageDetail.metadata.errorMessage})</small>`;
      }
    } else if (pipelineStatus.currentStage === stage.key) {
      stageClass = 'processing';
      stageIcon = '🔄';
      if (stageDetail?.metadata) {
        if (stage.key === 'processing' && stageDetail.metadata.chunkCount) {
          stageInfo = `<small>(${stageDetail.metadata.chunkCount} chunks)</small>`;
        } else if (stage.key === 'embedding' && stageDetail.metadata.embeddingCount) {
          stageInfo = `<small>(${stageDetail.metadata.embeddingCount} embeddings)</small>`;
        } else if (stage.key === 'vector-storage' && stageDetail.metadata.vectorCount) {
          stageInfo = `<small>(${stageDetail.metadata.vectorCount} vectors)</small>`;
        }
      }
    }
    
    progressHtml += `
      <div class="stage-item ${stageClass}">
        <div class="stage-header">
          <span class="stage-icon">${stageIcon}</span>
          <span class="stage-name">${stage.name}</span>
        </div>
        ${stageInfo ? `<div class="stage-info">${stageInfo}</div>` : ''}
      </div>
    `;
  });
  
  progressHtml += '</div>';
  
  if (pipelineStatus.totalProcessingTime > 0) {
    progressHtml += `<div class="pipeline-summary">Total Processing Time: ${pipelineStatus.totalProcessingTime}ms</div>`;
  }
  
  return progressHtml;
}

function getComprehensiveStatusText(pipelineStatus: PipelineStatus): string {
  const stageNames = {
    'ingestion': 'Document Ingestion',
    'processing': 'Content Processing', 
    'embedding': 'Vector Embedding',
    'vector-storage': 'Vector Storage'
  };
  
  const currentStageName = stageNames[pipelineStatus.currentStage as keyof typeof stageNames] || pipelineStatus.currentStage;
  const progress = `${pipelineStatus.completedStages.length}/4`;
  
  switch (pipelineStatus.overallStatus) {
    case 'processing':
      return `Processing: ${currentStageName} (${progress} completed) 🔄`;
    case 'pending':
      return `Pending: ${currentStageName} (${progress} completed) ⏳`;
    case 'completed':
      return `Completed: All stages processed (4/4) ✅`;
    case 'failed':
      return `Failed: ${pipelineStatus.failedStages.length} stage(s) failed ❌`;
    default:
      return `Status: ${pipelineStatus.overallStatus} (${progress} completed)`;
  }
}

function getErrorDetailsFromPipeline(pipelineStatus: PipelineStatus): string {
  if (pipelineStatus.failedStages.length === 0) {
    return '';
  }
  
  let errorDetails = '<div class="pipeline-errors">';
  errorDetails += '<h4>Error Details:</h4>';
  
  pipelineStatus.failedStages.forEach(stage => {
    const stageDetail = pipelineStatus.stageDetails[stage];
    const errorMessage = stageDetail?.metadata?.errorMessage || 'Unknown error';
    const timestamp = stageDetail?.timestamp ? new Date(stageDetail.timestamp).toLocaleTimeString() : '';
    
    errorDetails += `
      <div class="error-item">
        <strong>${stage}:</strong> ${errorMessage}
        ${timestamp ? `<small>(${timestamp})</small>` : ''}
      </div>
    `;
  });
  
  errorDetails += '</div>';
  return errorDetails;
}

function updateItemDetails(item: Element | null, details: string): void {
  if (!item) return;
  
  let detailsElement = item.querySelector('.pipeline-details');
  if (!detailsElement) {
    detailsElement = document.createElement('div');
    detailsElement.className = 'pipeline-details';
    item.querySelector('.upload-item-info')?.appendChild(detailsElement);
  }
  
  detailsElement.innerHTML = details;
}

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

document.addEventListener('DOMContentLoaded', initializeApp); 
