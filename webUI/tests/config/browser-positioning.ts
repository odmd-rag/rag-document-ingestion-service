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
  readonly maxHeight: 1440;
}

export interface BrowserPositioningConfig {
  readonly position: Position;
  readonly size: WindowSize;
  readonly vnc: VncDisplayConfig;
}

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



export const VNC_CONFIG: VncDisplayConfig = {
  display: ':1',
  maxHeight: 1440,
} as const;


export const DEFAULT_WINDOW_SIZE: WindowSize = {
  width: 1280,
  height: 1440,
} as const;


export const POSITION_PRESETS = {
  
  GLOBAL: { x: 200, y: 100 } as const,
  
  
  TEST: { x: 250, y: 120 } as const,
  
  
  CENTERED: { x: 350, y: 250 } as const,
  
  
  TOP_LEFT: { x: 100, y: 50 } as const,
} as const;


/**
 * Generate Chrome arguments for VNC browser positioning
 * @param config Browser positioning configuration
 * @returns Strongly typed Chrome arguments array
 */
export function createChromeArgs(config: BrowserPositioningConfig): ChromeArg[] {
  return [
    '--disable-dev-shm-usage',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-gpu',
    
    '--display=:1',
    `--window-size=${config.size.width},${config.size.height}`,
    `--window-position=${config.position.x},${config.position.y}`,
    '--user-position',
    `--geometry=${config.size.width}x${config.size.height}+${config.position.x}+${config.position.y}`,
    '--force-device-scale-factor=1',
    
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



export const GLOBAL_CONFIG = createPositioningConfig(POSITION_PRESETS.GLOBAL);


export const TEST_CONFIG = createPositioningConfig(POSITION_PRESETS.TEST);


export const POSITIONING_CONFIGS = {
  global: GLOBAL_CONFIG,
  test: TEST_CONFIG,
  centered: createPositioningConfig(POSITION_PRESETS.CENTERED),
  topLeft: createPositioningConfig(POSITION_PRESETS.TOP_LEFT),
} as const;


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


/**
 * ❌ FAILED CHROME FLAGS (Do not use):
 * 
 * These flags were tested and proven NOT to work for VNC positioning:
 */
export const FAILED_CHROME_FLAGS = {
  POSITION_ALONE: ['--window-position=X,Y'],
  
  MAXIMIZED: ['--start-maximized'],
  KIOSK: ['--kiosk-printing'],
  
  WEB_SECURITY: ['--disable-web-security'],
  AUTOMATION: ['--disable-blink-features=AutomationControlled'],
  
  NEW_WINDOW: ['--new-window'],
  
  TOO_TALL: ['--window-size=1280,1600'],
  TOO_BIG: ['--window-size=1980,1440'],
} as const;

/**
 * ❌ FAILED APPROACHES (Do not use):
 *
 * These approaches were tested and proven NOT to work:
 */
export const FAILED_APPROACHES = {
  JAVASCRIPT: 'window.moveTo(x, y)',

  PROJECT_OVERRIDES: 'launchOptions in project config',
  CONTEXT_OPTIONS: 'contextOptions.viewport',
  VIEWPORT_POSITIONING: 'viewport: { x, y }',

  WINDOW_MANAGERS: 'wmctrl, xdotool',
  WRAPPER_SCRIPTS: 'Shell scripts with positioning',
} as const;