/**
 * Playwright Integration Module
 *
 * Browser automation, verification, and console capture for CODEX.
 */

export { PlaywrightManager } from './PlaywrightManager.js';
export { VerificationService } from './VerificationService.js';
export { ConsoleCapture } from './ConsoleCapture.js';

export type {
  BrowserConfig,
  BrowserSession,
  CapturedConsoleMessage,
  CapturedPageError,
  ScreenshotInfo,
  ActionType,
  ActionParams,
  ActionResult,
  AssertionType,
  AssertionParams,
  AssertionResult,
  VisualDiffResult,
  VerificationStep,
  VerificationResult,
  ScreenshotParams,
  TestParams,
  ConsoleCheckParams,
  TestRunResult,
  TestFailure,
  NavigationOptions,
  LaunchResult,
  ConsoleSummary,
  ConsoleMessageType,
} from './types.js';

export { DEFAULT_BROWSER_CONFIG } from './types.js';
