/**
 * Playwright Integration Types
 *
 * Type definitions for browser automation, verification, and console capture.
 */

import type { Browser, BrowserContext, Page } from 'playwright';

/**
 * Browser configuration options
 */
export interface BrowserConfig {
  /** Browser type to use */
  browser: 'chromium' | 'firefox' | 'webkit';
  /** Run in headless mode (default: true) */
  headless: boolean;
  /** Slow down operations by this many milliseconds */
  slowMo?: number;
  /** Default timeout for operations in milliseconds */
  timeout: number;
  /** Viewport size */
  viewport: { width: number; height: number };
  /** Whether to capture console messages */
  captureConsole: boolean;
  /** Whether to take screenshots on failure */
  screenshotOnFailure: boolean;
  /** Directory to save screenshots */
  screenshotDir: string;
}

/**
 * Default browser configuration
 */
export const DEFAULT_BROWSER_CONFIG: BrowserConfig = {
  browser: 'chromium',
  headless: true,
  timeout: 30000,
  viewport: { width: 1280, height: 720 },
  captureConsole: true,
  screenshotOnFailure: true,
  screenshotDir: './screenshots',
};

/**
 * Console message types
 */
export type ConsoleMessageType = 'log' | 'debug' | 'info' | 'error' | 'warning' | 'dir' | 'table' | 'trace' | 'assert';

/**
 * Captured console message
 */
export interface CapturedConsoleMessage {
  type: ConsoleMessageType;
  text: string;
  location?: {
    url: string;
    lineNumber: number;
    columnNumber: number;
  };
  timestamp: Date;
  args?: string[];
}

/**
 * Page error (uncaught exception)
 */
export interface CapturedPageError {
  message: string;
  stack?: string;
  timestamp: Date;
  url: string;
}

/**
 * Browser session state
 */
export interface BrowserSession {
  id: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  config: BrowserConfig;
  consoleMessages: CapturedConsoleMessage[];
  pageErrors: CapturedPageError[];
  screenshots: ScreenshotInfo[];
  startedAt: Date;
  currentUrl: string;
}

/**
 * Screenshot information
 */
export interface ScreenshotInfo {
  id: string;
  path: string;
  base64?: string;
  url: string;
  timestamp: Date;
  fullPage: boolean;
  viewport: { width: number; height: number };
  taskId?: string;
  label?: string;
}

/**
 * Action types for page interaction
 */
export type ActionType =
  | 'click'
  | 'dblclick'
  | 'type'
  | 'fill'
  | 'clear'
  | 'check'
  | 'uncheck'
  | 'select'
  | 'hover'
  | 'focus'
  | 'press'
  | 'scroll';

/**
 * Page action parameters
 */
export interface ActionParams {
  /** CSS selector or XPath */
  selector: string;
  /** Action type */
  action: ActionType;
  /** Value for type/fill/select actions */
  value?: string;
  /** Key for press action */
  key?: string;
  /** Button for click (left, right, middle) */
  button?: 'left' | 'right' | 'middle';
  /** Number of clicks */
  clickCount?: number;
  /** Delay between key presses in ms */
  delay?: number;
  /** Force the action (skip actionability checks) */
  force?: boolean;
  /** Timeout for this action */
  timeout?: number;
  /** Scroll direction and amount */
  scroll?: { direction: 'up' | 'down' | 'left' | 'right'; amount: number };
}

/**
 * Action result
 */
export interface ActionResult {
  success: boolean;
  action: ActionType;
  selector: string;
  duration: number;
  error?: string;
  screenshot?: string;
}

/**
 * Assertion types for verification
 */
export type AssertionType =
  | 'visible'
  | 'hidden'
  | 'enabled'
  | 'disabled'
  | 'checked'
  | 'unchecked'
  | 'text'
  | 'value'
  | 'attribute'
  | 'count'
  | 'url'
  | 'title';

/**
 * Assertion parameters
 */
export interface AssertionParams {
  /** Assertion type */
  type: AssertionType;
  /** CSS selector (not needed for url/title) */
  selector?: string;
  /** Expected value for text/value/attribute/count/url/title */
  expected?: string | number | RegExp;
  /** Attribute name for attribute assertion */
  attribute?: string;
  /** Timeout for this assertion */
  timeout?: number;
  /** Whether to use soft assertion (don't throw) */
  soft?: boolean;
}

/**
 * Assertion result
 */
export interface AssertionResult {
  success: boolean;
  type: AssertionType;
  selector?: string;
  expected?: string | number;
  actual?: string | number | boolean;
  duration: number;
  error?: string;
}

/**
 * Visual diff result
 */
export interface VisualDiffResult {
  match: boolean;
  diffPercentage: number;
  diffImagePath?: string;
  beforePath: string;
  afterPath: string;
  threshold: number;
}

/**
 * Verification step for RUBIX tasks
 */
export interface VerificationStep {
  id: string;
  type: 'screenshot' | 'assertion' | 'test' | 'console_check';
  description: string;
  params: ScreenshotParams | AssertionParams | TestParams | ConsoleCheckParams;
  required: boolean;
}

/**
 * Screenshot parameters
 */
export interface ScreenshotParams {
  /** Full page screenshot */
  fullPage?: boolean;
  /** Specific element to screenshot */
  selector?: string;
  /** Label for the screenshot */
  label?: string;
  /** Compare with previous screenshot */
  compare?: string;
  /** Diff threshold (0-1) */
  threshold?: number;
}

/**
 * Test run parameters
 */
export interface TestParams {
  /** Test file path */
  testFile: string;
  /** Specific test name pattern */
  testName?: string;
  /** Test timeout */
  timeout?: number;
}

/**
 * Console check parameters
 */
export interface ConsoleCheckParams {
  /** Check for errors */
  noErrors?: boolean;
  /** Check for warnings */
  noWarnings?: boolean;
  /** Expected console patterns */
  expectedPatterns?: string[];
  /** Forbidden console patterns */
  forbiddenPatterns?: string[];
}

/**
 * Verification result
 */
export interface VerificationResult {
  stepId: string;
  success: boolean;
  type: VerificationStep['type'];
  duration: number;
  details: Record<string, unknown>;
  error?: string;
  screenshot?: string;
}

/**
 * Test run result
 */
export interface TestRunResult {
  success: boolean;
  testFile: string;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  failures: TestFailure[];
  output: string;
}

/**
 * Individual test failure
 */
export interface TestFailure {
  testName: string;
  error: string;
  stack?: string;
  screenshot?: string;
}

/**
 * Navigation options
 */
export interface NavigationOptions {
  /** Wait until this event */
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
  /** Timeout for navigation */
  timeout?: number;
  /** HTTP headers to set */
  headers?: Record<string, string>;
}

/**
 * Launch result
 */
export interface LaunchResult {
  sessionId: string;
  browser: string;
  headless: boolean;
  viewport: { width: number; height: number };
}

/**
 * Console log summary
 */
export interface ConsoleSummary {
  total: number;
  errors: number;
  warnings: number;
  logs: number;
  messages: CapturedConsoleMessage[];
  pageErrors: CapturedPageError[];
}
