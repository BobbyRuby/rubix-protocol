/**
 * PlaywrightManager
 *
 * Manages browser lifecycle, sessions, and provides core browser automation.
 * Supports multiple concurrent sessions with console capture and error tracking.
 */

import { chromium, firefox, webkit } from 'playwright';
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import {
  type BrowserConfig,
  type BrowserSession,
  type ScreenshotInfo,
  type ActionParams,
  type ActionResult,
  type AssertionParams,
  type AssertionResult,
  type NavigationOptions,
  type LaunchResult,
  type ConsoleSummary,
  type ConsoleMessageType,
  DEFAULT_BROWSER_CONFIG,
} from './types.js';

/**
 * PlaywrightManager - Browser lifecycle and session management
 */
export class PlaywrightManager {
  private sessions: Map<string, BrowserSession> = new Map();
  private defaultConfig: BrowserConfig;

  constructor(config: Partial<BrowserConfig> = {}) {
    this.defaultConfig = { ...DEFAULT_BROWSER_CONFIG, ...config };
  }

  /**
   * Launch a new browser session
   */
  async launch(config: Partial<BrowserConfig> = {}): Promise<LaunchResult> {
    const sessionConfig = { ...this.defaultConfig, ...config };
    const sessionId = randomUUID();

    // Select browser engine
    const browserEngine = this.getBrowserEngine(sessionConfig.browser);

    // Launch browser
    const browser = await browserEngine.launch({
      headless: sessionConfig.headless,
      slowMo: sessionConfig.slowMo,
    });

    // Create context with viewport
    const context = await browser.newContext({
      viewport: sessionConfig.viewport,
    });

    // Create page
    const page = await context.newPage();
    page.setDefaultTimeout(sessionConfig.timeout);

    // Create session
    const session: BrowserSession = {
      id: sessionId,
      browser,
      context,
      page,
      config: sessionConfig,
      consoleMessages: [],
      pageErrors: [],
      screenshots: [],
      startedAt: new Date(),
      currentUrl: 'about:blank',
    };

    // Set up console capture
    if (sessionConfig.captureConsole) {
      this.setupConsoleCapture(session);
    }

    // Store session
    this.sessions.set(sessionId, session);

    return {
      sessionId,
      browser: sessionConfig.browser,
      headless: sessionConfig.headless,
      viewport: sessionConfig.viewport,
    };
  }

  /**
   * Close a browser session
   */
  async close(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    await session.browser.close();
    this.sessions.delete(sessionId);
    return true;
  }

  /**
   * Close all browser sessions
   */
  async closeAll(): Promise<number> {
    let closed = 0;
    for (const sessionId of this.sessions.keys()) {
      if (await this.close(sessionId)) {
        closed++;
      }
    }
    return closed;
  }

  /**
   * Get a session by ID
   */
  getSession(sessionId: string): BrowserSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): BrowserSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Navigate to a URL
   */
  async navigate(
    sessionId: string,
    url: string,
    options: NavigationOptions = {}
  ): Promise<{ success: boolean; url: string; title: string; duration: number; error?: string }> {
    const session = this.getSessionOrThrow(sessionId);
    const startTime = Date.now();

    try {
      const response = await session.page.goto(url, {
        waitUntil: options.waitUntil ?? 'load',
        timeout: options.timeout ?? session.config.timeout,
      });

      session.currentUrl = session.page.url();
      const title = await session.page.title();

      return {
        success: response?.ok() ?? true,
        url: session.currentUrl,
        title,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Navigation failed';
      return {
        success: false,
        url,
        title: '',
        duration: Date.now() - startTime,
        error: errorMessage,
      };
    }
  }

  /**
   * Take a screenshot
   */
  async screenshot(
    sessionId: string,
    options: {
      fullPage?: boolean;
      selector?: string;
      label?: string;
      taskId?: string;
      returnBase64?: boolean;
    } = {}
  ): Promise<ScreenshotInfo> {
    const session = this.getSessionOrThrow(sessionId);
    const screenshotId = randomUUID();
    const timestamp = new Date();

    // Ensure screenshot directory exists
    await mkdir(session.config.screenshotDir, { recursive: true });

    // Generate filename
    const filename = `${options.label ?? 'screenshot'}-${screenshotId.slice(0, 8)}.png`;
    const filepath = join(session.config.screenshotDir, filename);

    // Take screenshot
    let buffer: Buffer;
    if (options.selector) {
      const element = session.page.locator(options.selector);
      buffer = await element.screenshot();
    } else {
      buffer = await session.page.screenshot({
        fullPage: options.fullPage ?? false,
      });
    }

    // Save to file
    await writeFile(filepath, buffer);

    // Create screenshot info
    const info: ScreenshotInfo = {
      id: screenshotId,
      path: filepath,
      base64: options.returnBase64 ? buffer.toString('base64') : undefined,
      url: session.currentUrl,
      timestamp,
      fullPage: options.fullPage ?? false,
      viewport: session.config.viewport,
      taskId: options.taskId,
      label: options.label,
    };

    // Store in session
    session.screenshots.push(info);

    return info;
  }

  /**
   * Perform a page action
   */
  async action(sessionId: string, params: ActionParams): Promise<ActionResult> {
    const session = this.getSessionOrThrow(sessionId);
    const startTime = Date.now();
    const locator = session.page.locator(params.selector);

    try {
      switch (params.action) {
        case 'click':
          await locator.click({
            button: params.button,
            clickCount: params.clickCount,
            force: params.force,
            timeout: params.timeout,
          });
          break;

        case 'dblclick':
          await locator.dblclick({
            button: params.button,
            force: params.force,
            timeout: params.timeout,
          });
          break;

        case 'type':
          await locator.pressSequentially(params.value ?? '', {
            delay: params.delay,
            timeout: params.timeout,
          });
          break;

        case 'fill':
          await locator.fill(params.value ?? '', {
            force: params.force,
            timeout: params.timeout,
          });
          break;

        case 'clear':
          await locator.clear({
            force: params.force,
            timeout: params.timeout,
          });
          break;

        case 'check':
          await locator.check({
            force: params.force,
            timeout: params.timeout,
          });
          break;

        case 'uncheck':
          await locator.uncheck({
            force: params.force,
            timeout: params.timeout,
          });
          break;

        case 'select':
          await locator.selectOption(params.value ?? '', {
            force: params.force,
            timeout: params.timeout,
          });
          break;

        case 'hover':
          await locator.hover({
            force: params.force,
            timeout: params.timeout,
          });
          break;

        case 'focus':
          await locator.focus({
            timeout: params.timeout,
          });
          break;

        case 'press':
          await locator.press(params.key ?? 'Enter', {
            delay: params.delay,
            timeout: params.timeout,
          });
          break;

        case 'scroll':
          if (params.scroll) {
            const { direction, amount } = params.scroll;
            const deltaX = direction === 'left' ? -amount : direction === 'right' ? amount : 0;
            const deltaY = direction === 'up' ? -amount : direction === 'down' ? amount : 0;
            await locator.evaluate(
              (el, { dx, dy }) => el.scrollBy(dx, dy),
              { dx: deltaX, dy: deltaY }
            );
          }
          break;

        default:
          throw new Error(`Unknown action: ${params.action}`);
      }

      return {
        success: true,
        action: params.action,
        selector: params.selector,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Action failed';

      // Take screenshot on failure if configured
      let screenshot: string | undefined;
      if (session.config.screenshotOnFailure) {
        try {
          const info = await this.screenshot(sessionId, {
            label: `action-failure-${params.action}`,
          });
          screenshot = info.path;
        } catch {
          // Ignore screenshot errors
        }
      }

      return {
        success: false,
        action: params.action,
        selector: params.selector,
        duration: Date.now() - startTime,
        error: errorMessage,
        screenshot,
      };
    }
  }

  /**
   * Perform an assertion
   */
  async assert(sessionId: string, params: AssertionParams): Promise<AssertionResult> {
    const session = this.getSessionOrThrow(sessionId);
    const startTime = Date.now();

    try {
      let actual: string | number | boolean | undefined;

      switch (params.type) {
        case 'visible': {
          const locator = session.page.locator(params.selector!);
          await locator.waitFor({ state: 'visible', timeout: params.timeout });
          actual = true;
          break;
        }

        case 'hidden': {
          const locator = session.page.locator(params.selector!);
          await locator.waitFor({ state: 'hidden', timeout: params.timeout });
          actual = true;
          break;
        }

        case 'enabled': {
          const locator = session.page.locator(params.selector!);
          const isEnabled = await locator.isEnabled({ timeout: params.timeout });
          if (!isEnabled) throw new Error('Element is not enabled');
          actual = true;
          break;
        }

        case 'disabled': {
          const locator = session.page.locator(params.selector!);
          const isDisabled = await locator.isDisabled({ timeout: params.timeout });
          if (!isDisabled) throw new Error('Element is not disabled');
          actual = true;
          break;
        }

        case 'checked': {
          const locator = session.page.locator(params.selector!);
          const isChecked = await locator.isChecked({ timeout: params.timeout });
          if (!isChecked) throw new Error('Element is not checked');
          actual = true;
          break;
        }

        case 'unchecked': {
          const locator = session.page.locator(params.selector!);
          const isChecked = await locator.isChecked({ timeout: params.timeout });
          if (isChecked) throw new Error('Element is checked');
          actual = false;
          break;
        }

        case 'text': {
          const locator = session.page.locator(params.selector!);
          actual = await locator.textContent({ timeout: params.timeout }) ?? '';
          if (params.expected instanceof RegExp) {
            if (!params.expected.test(actual)) {
              throw new Error(`Text "${actual}" does not match pattern ${params.expected}`);
            }
          } else if (actual !== params.expected) {
            throw new Error(`Expected text "${params.expected}", got "${actual}"`);
          }
          break;
        }

        case 'value': {
          const locator = session.page.locator(params.selector!);
          actual = await locator.inputValue({ timeout: params.timeout });
          if (actual !== params.expected) {
            throw new Error(`Expected value "${params.expected}", got "${actual}"`);
          }
          break;
        }

        case 'attribute': {
          const locator = session.page.locator(params.selector!);
          actual = await locator.getAttribute(params.attribute!, { timeout: params.timeout }) ?? '';
          if (actual !== params.expected) {
            throw new Error(`Expected attribute ${params.attribute}="${params.expected}", got "${actual}"`);
          }
          break;
        }

        case 'count': {
          const locator = session.page.locator(params.selector!);
          actual = await locator.count();
          if (actual !== params.expected) {
            throw new Error(`Expected ${params.expected} elements, found ${actual}`);
          }
          break;
        }

        case 'url': {
          actual = session.page.url();
          if (params.expected instanceof RegExp) {
            if (!params.expected.test(actual)) {
              throw new Error(`URL "${actual}" does not match pattern ${params.expected}`);
            }
          } else if (actual !== params.expected) {
            throw new Error(`Expected URL "${params.expected}", got "${actual}"`);
          }
          break;
        }

        case 'title': {
          actual = await session.page.title();
          if (params.expected instanceof RegExp) {
            if (!params.expected.test(actual)) {
              throw new Error(`Title "${actual}" does not match pattern ${params.expected}`);
            }
          } else if (actual !== params.expected) {
            throw new Error(`Expected title "${params.expected}", got "${actual}"`);
          }
          break;
        }

        default:
          throw new Error(`Unknown assertion type: ${params.type}`);
      }

      return {
        success: true,
        type: params.type,
        selector: params.selector,
        expected: params.expected instanceof RegExp ? params.expected.toString() : params.expected,
        actual,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Assertion failed';

      if (params.soft) {
        return {
          success: false,
          type: params.type,
          selector: params.selector,
          expected: params.expected instanceof RegExp ? params.expected.toString() : params.expected,
          duration: Date.now() - startTime,
          error: errorMessage,
        };
      }

      return {
        success: false,
        type: params.type,
        selector: params.selector,
        expected: params.expected instanceof RegExp ? params.expected.toString() : params.expected,
        duration: Date.now() - startTime,
        error: errorMessage,
      };
    }
  }

  /**
   * Get console messages for a session
   */
  getConsoleLogs(sessionId: string): ConsoleSummary {
    const session = this.getSessionOrThrow(sessionId);

    const errors = session.consoleMessages.filter(m => m.type === 'error').length;
    const warnings = session.consoleMessages.filter(m => m.type === 'warning').length;
    const logs = session.consoleMessages.length - errors - warnings;

    return {
      total: session.consoleMessages.length,
      errors,
      warnings,
      logs,
      messages: session.consoleMessages,
      pageErrors: session.pageErrors,
    };
  }

  /**
   * Clear console messages for a session
   */
  clearConsoleLogs(sessionId: string): void {
    const session = this.getSessionOrThrow(sessionId);
    session.consoleMessages = [];
    session.pageErrors = [];
  }

  /**
   * Wait for a selector
   */
  async waitForSelector(
    sessionId: string,
    selector: string,
    options: { state?: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number } = {}
  ): Promise<boolean> {
    const session = this.getSessionOrThrow(sessionId);

    try {
      await session.page.locator(selector).waitFor({
        state: options.state ?? 'visible',
        timeout: options.timeout,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Wait for navigation
   */
  async waitForNavigation(
    sessionId: string,
    options: { url?: string | RegExp; timeout?: number } = {}
  ): Promise<boolean> {
    const session = this.getSessionOrThrow(sessionId);

    try {
      await session.page.waitForURL(options.url ?? /.*/, {
        timeout: options.timeout,
      });
      session.currentUrl = session.page.url();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Evaluate JavaScript in page context
   */
  async evaluate<T>(sessionId: string, script: string): Promise<T> {
    const session = this.getSessionOrThrow(sessionId);
    return await session.page.evaluate(script) as T;
  }

  /**
   * Get page content (HTML)
   */
  async getContent(sessionId: string): Promise<string> {
    const session = this.getSessionOrThrow(sessionId);
    return await session.page.content();
  }

  /**
   * Get current URL
   */
  getCurrentUrl(sessionId: string): string {
    const session = this.getSessionOrThrow(sessionId);
    return session.currentUrl;
  }

  /**
   * Get page title
   */
  async getTitle(sessionId: string): Promise<string> {
    const session = this.getSessionOrThrow(sessionId);
    return await session.page.title();
  }

  // Private methods

  private getBrowserEngine(browser: BrowserConfig['browser']) {
    switch (browser) {
      case 'chromium':
        return chromium;
      case 'firefox':
        return firefox;
      case 'webkit':
        return webkit;
      default:
        return chromium;
    }
  }

  private getSessionOrThrow(sessionId: string): BrowserSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    return session;
  }

  private setupConsoleCapture(session: BrowserSession): void {
    // Capture console messages
    session.page.on('console', (message) => {
      const location = message.location();
      session.consoleMessages.push({
        type: message.type() as ConsoleMessageType,
        text: message.text(),
        location: location.url
          ? {
              url: location.url,
              lineNumber: location.lineNumber,
              columnNumber: location.columnNumber,
            }
          : undefined,
        timestamp: new Date(),
        args: message.args().map((arg) => arg.toString()),
      });
    });

    // Capture page errors (uncaught exceptions)
    session.page.on('pageerror', (error) => {
      session.pageErrors.push({
        message: error.message,
        stack: error.stack,
        timestamp: new Date(),
        url: session.currentUrl,
      });
    });
  }
}

export default PlaywrightManager;
