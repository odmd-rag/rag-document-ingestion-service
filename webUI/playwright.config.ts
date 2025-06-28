import { defineConfig, devices } from '@playwright/test';
import { getGlobalChromeArgs, getVncEnvironment, GLOBAL_CONFIG } from './tests/config/browser-positioning';

/**
 * Playwright Configuration for VNC Remote Development Environment
 * 
 * Using centralized, strongly-typed configuration from ./src/config/browser-positioning.ts
 * 
 * VNC Environment: TigerVNC at 192.168.2.148:5901 (2560x1440)
 * Browser positioned at (${GLOBAL_CONFIG.position.x}, ${GLOBAL_CONFIG.position.y}) 
 * with size ${GLOBAL_CONFIG.size.width}x${GLOBAL_CONFIG.size.height}
 * 
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests',
  
  timeout: 30000,
  expect: { timeout: 10000 },
  
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  
  reporter: [
    ['html', { open: 'never' }],
    ['line'],
  ],
  
  use: {
    launchOptions: {
      headless: false,
      executablePath: '/usr/bin/google-chrome',
      slowMo: 100,
      args: getGlobalChromeArgs(),
      env: {
        ...process.env,
        ...getVncEnvironment(),
      },
    },
    
    viewport: { 
      width: GLOBAL_CONFIG.size.width, 
      height: GLOBAL_CONFIG.size.height 
    },
    baseURL: 'file://' + process.cwd(),
    actionTimeout: 10000,
    
    screenshot: 'only-on-failure',
    video: 'retain-on-failure', 
    trace: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium-vnc',
      use: { 
        ...devices['Desktop Chrome'],
        viewport: { 
          width: GLOBAL_CONFIG.size.width, 
          height: GLOBAL_CONFIG.size.height 
        },
        channel: undefined,
      },
    },
    
  ],
}); 