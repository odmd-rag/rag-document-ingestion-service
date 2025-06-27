import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for RAG Pipeline Validation
 * Optimized for OAuth-compatible Chrome testing in VNC environment
 * @see https://playwright.dev/docs/test-configuration
 */

export default defineConfig({
  // Test directory
  testDir: './tests',
  
  // Timeout configurations
  timeout: 900000, // 15 minutes for full pipeline processing
  expect: {
    timeout: 10000,
  },
  
  // Run tests in files in parallel
  fullyParallel: true,
  
  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,
  
  // Retry on CI only
  retries: process.env.CI ? 2 : 0,
  
  // Opt out of parallel tests on CI
  workers: process.env.CI ? 1 : undefined,
  
  // Reporter to use
  reporter: [
    ['html', { open: 'never' }], // Don't auto-open in VNC
    ['line'],
  ],
  
  // Global setup for VNC environment
  use: {
    // Base URL for static testing (will use file:// URLs)
    baseURL: 'file://' + process.cwd(),
    
    // Global test timeout
    actionTimeout: 10000,
    
    // Capture screenshot only on failure
    screenshot: 'only-on-failure',
    
    // Record video only on failure
    video: 'retain-on-failure',
    
    // Collect trace on failure
    trace: 'retain-on-failure',
    
    // Viewport size
    viewport: { width: 1280, height: 720 },
  },

  // Single project configuration for OAuth-compatible Chrome
  projects: [
    {
      name: 'chromium-oauth',
      use: { 
        ...devices['Desktop Chrome'],
        // OAuth-compatible Chrome with persistent context for RAG pipeline testing
        channel: undefined,
        launchOptions: {
          headless: false,
          executablePath: '/usr/bin/google-chrome',
          slowMo: 100,
          args: [
            '--disable-dev-shm-usage',
            '--disable-web-security',
            '--disable-features=TranslateUI',
            '--disable-ipc-flooding-protection',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-gpu',
            '--window-size=1280,720',
            '--display=:1',
            '--disable-blink-features=AutomationControlled', // Prevent automation detection
            '--disable-extensions', // Disable all extensions
            '--disable-default-apps',
            '--remote-debugging-port=9222' // Enable remote debugging
          ],
          env: {
            ...process.env,
            DISPLAY: ':1',
            XAUTHORITY: process.env.HOME + '/.Xauthority',
          },
        },
      },
    },
  ],
}); 