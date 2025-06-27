/**
 * Single Source of Truth for VNC Browser Positioning Configuration (TEST SCOPE)
 * 
 * ✅ PROVEN SOLUTION: Chrome positioning requires 3 flags together:
 * - --window-position=X,Y (coordinates)
 * - --user-position (CRITICAL: forces positioning)
 * - --geometry=WxH+X+Y (X11 fallback)
 * 
 * VNC Environment: TigerVNC at 192.168.2.148:5901 (2560x1440)
 */

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface Position {
  readonly x: number;
  readonly y: number;
}

export interface WindowSize {
  readonly width: number;
  readonly height: number;
}

export interface VncDisplayConfig {
  readonly display: ':1';
  readonly maxHeight: 1440; // Height limit for title bar visibility
}

export interface BrowserPositioningConfig {
  readonly position: Position;
  readonly size: WindowSize;
  readonly vnc: VncDisplayConfig;
}

// Chrome argument types for type safety
export type CoreStabilityFlag = 
  | '--disable-dev-shm-usage'
  | '--no-sandbox'
  | '--disable-setuid-sandbox'
  | '--disable-gpu';

export type VncPositioningFlag = 
  | '--display=:1'
  | `--window-size=${number},${number}`
  | `--window-position=${number},${number}`
  | '--user-position'
  | `--geometry=${number}x${number}+${number}+${number}`
  | '--force-device-scale-factor=1';

export type PerformanceFlag = 
  | '--disable-extensions'
  | '--disable-default-apps';

export type ChromeArg = CoreStabilityFlag | VncPositioningFlag | PerformanceFlag;

export interface VncEnvironment {
  readonly DISPLAY: ':1';
  readonly XAUTHORITY: string;
  readonly LIBGL_ALWAYS_SOFTWARE: '1';
}

// ============================================================================
// CONFIGURATION CONSTANTS
// ============================================================================

/** VNC display configuration */
export const VNC_CONFIG: VncDisplayConfig = {
  display: ':1',
  maxHeight: 1440,
} as const;

/** Default browser window size (optimized for VNC) */
export const DEFAULT_WINDOW_SIZE: WindowSize = {
  width: 1280,
  height: 1440, // ≤ VNC_CONFIG.maxHeight for title bar visibility
} as const;

/** Predefined positioning presets */
export const POSITION_PRESETS = {
  /** Default global positioning */
  GLOBAL: { x: 200, y: 100 } as const,
  
  /** Alternative positioning for tests */
  TEST: { x: 250, y: 120 } as const,
  
  /** Centered positioning */
  CENTERED: { x: 350, y: 250 } as const,
  
  /** Near top-left with margin */
  TOP_LEFT: { x: 100, y: 50 } as const,
} as const;

// ============================================================================
// CONFIGURATION FACTORIES
// ============================================================================

/**
 * Generate Chrome arguments for VNC browser positioning
 * @param config Browser positioning configuration
 * @returns Strongly typed Chrome arguments array
 */
export function createChromeArgs(config: BrowserPositioningConfig): ChromeArg[] {
  return [
    // Core stability flags for VNC
    '--disable-dev-shm-usage',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-gpu',
    
    // ✅ PROVEN VNC positioning solution
    '--display=:1',
    `--window-size=${config.size.width},${config.size.height}`,
    `--window-position=${config.position.x},${config.position.y}`,
    '--user-position',                                                 // CRITICAL!
    `--geometry=${config.size.width}x${config.size.height}+${config.position.x}+${config.position.y}`,
    '--force-device-scale-factor=1',
    
    // Performance optimizations
    '--disable-extensions',
    '--disable-default-apps',
  ];
}

/**
 * Generate VNC environment variables
 * @returns Strongly typed environment configuration
 */
export function createVncEnvironment(): VncEnvironment {
  return {
    DISPLAY: ':1',
    XAUTHORITY: process.env.HOME + '/.Xauthority',
    LIBGL_ALWAYS_SOFTWARE: '1',
  };
}

/**
 * Create browser positioning configuration
 * @param position Window position coordinates
 * @param size Window size (defaults to optimal VNC size)
 * @returns Complete configuration object
 */
export function createPositioningConfig(
  position: Position,
  size: WindowSize = DEFAULT_WINDOW_SIZE
): BrowserPositioningConfig {
  // Validate height doesn't exceed VNC limits
  if (size.height > VNC_CONFIG.maxHeight) {
    throw new Error(
      `Window height ${size.height} exceeds VNC limit ${VNC_CONFIG.maxHeight}. ` +
      `Title bar will be cut off.`
    );
  }
  
  return {
    position,
    size,
    vnc: VNC_CONFIG,
  };
}

// ============================================================================
// PRESET CONFIGURATIONS
// ============================================================================

/** Global Playwright configuration */
export const GLOBAL_CONFIG = createPositioningConfig(POSITION_PRESETS.GLOBAL);

/** Test-specific configuration */
export const TEST_CONFIG = createPositioningConfig(POSITION_PRESETS.TEST);

/** Alternative configurations for different use cases */
export const POSITIONING_CONFIGS = {
  global: GLOBAL_CONFIG,
  test: TEST_CONFIG,
  centered: createPositioningConfig(POSITION_PRESETS.CENTERED),
  topLeft: createPositioningConfig(POSITION_PRESETS.TOP_LEFT),
} as const;

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Get Chrome args for global Playwright configuration
 */
export const getGlobalChromeArgs = (): ChromeArg[] => 
  createChromeArgs(GLOBAL_CONFIG);

/**
 * Get Chrome args for test configuration
 */
export const getTestChromeArgs = (): ChromeArg[] => 
  createChromeArgs(TEST_CONFIG);

/**
 * Get VNC environment variables
 */
export const getVncEnvironment = (): VncEnvironment => 
  createVncEnvironment();

// ============================================================================
// FAILED APPROACHES (For Reference)
// ============================================================================

/**
 * ❌ FAILED CHROME FLAGS (Do not use):
 * 
 * These flags were tested and proven NOT to work for VNC positioning:
 */
export const FAILED_CHROME_FLAGS = {
  // Position flags that don't work alone
  POSITION_ALONE: ['--window-position=X,Y'], // IGNORED without --user-position
  
  // Conflicting flags
  MAXIMIZED: ['--start-maximized'],          // OVERRIDES positioning
  KIOSK: ['--kiosk-printing'],              // INTERFERES with positioning
  
  // Security flags that break OAuth
  WEB_SECURITY: ['--disable-web-security'],     // BREAKS OAuth in tests
  AUTOMATION: ['--disable-blink-features=AutomationControlled'], // BREAKS OAuth detection
  
  // Useless flags for positioning
  NEW_WINDOW: ['--new-window'],              // DOESN'T help positioning
  
  // Size issues
  TOO_TALL: ['--window-size=1280,1600'],     // CUTS OFF title bar
  TOO_BIG: ['--window-size=1980,1440'],      // CUTS OFF title bar
} as const;

/**
 * ❌ FAILED APPROACHES (Do not use):
 * 
 * These approaches were tested and proven NOT to work:
 */
export const FAILED_APPROACHES = {
  // JavaScript positioning (blocked in automation)
  JAVASCRIPT: 'window.moveTo(x, y) // BLOCKED in automated browsers',
  
  // Playwright config limitations
  PROJECT_OVERRIDES: 'launchOptions in project config // IGNORED by global config',
  CONTEXT_OPTIONS: 'contextOptions.viewport // NO positioning control',
  VIEWPORT_POSITIONING: 'viewport: { x, y } // ONLY width/height supported',
  
  // External tools (not available)
  WINDOW_MANAGERS: 'wmctrl, xdotool // NOT INSTALLED',
  WRAPPER_SCRIPTS: 'Shell scripts with positioning // UNRELIABLE',
} as const; 