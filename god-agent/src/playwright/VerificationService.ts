/**
 * VerificationService
 *
 * Coordinates verification workflows for RUBIX tasks.
 * Executes verification steps, stores results in memory, and provides
 * integration with the self-healing loop.
 */

import { spawn } from 'child_process';
import { PlaywrightManager } from './PlaywrightManager.js';
import { ConsoleCapture } from './ConsoleCapture.js';
import type {
  VerificationStep,
  VerificationResult,
  ScreenshotParams,
  AssertionParams,
  TestParams,
  ConsoleCheckParams,
  TestRunResult,
  TestFailure,
  BrowserConfig,
} from './types.js';

/**
 * Verification workflow result
 */
export interface WorkflowResult {
  success: boolean;
  steps: VerificationResult[];
  duration: number;
  summary: string;
  consoleReport?: string;
  screenshots: string[];
  failures: string[];
}

/**
 * VerificationService - Execute verification workflows
 */
export class VerificationService {
  private manager: PlaywrightManager;
  private currentSessionId: string | null = null;

  constructor(config: Partial<BrowserConfig> = {}) {
    this.manager = new PlaywrightManager(config);
  }

  /**
   * Get the underlying PlaywrightManager
   */
  getManager(): PlaywrightManager {
    return this.manager;
  }

  /**
   * Ensure a browser session is active
   */
  async ensureSession(config: Partial<BrowserConfig> = {}): Promise<string> {
    if (this.currentSessionId) {
      const session = this.manager.getSession(this.currentSessionId);
      if (session) {
        return this.currentSessionId;
      }
    }

    const result = await this.manager.launch(config);
    this.currentSessionId = result.sessionId;
    return result.sessionId;
  }

  /**
   * Close the current session
   */
  async closeSession(): Promise<void> {
    if (this.currentSessionId) {
      await this.manager.close(this.currentSessionId);
      this.currentSessionId = null;
    }
  }

  /**
   * Execute a full verification workflow
   */
  async executeWorkflow(
    url: string,
    steps: VerificationStep[],
    options: { sessionId?: string; continueOnFailure?: boolean } = {}
  ): Promise<WorkflowResult> {
    const startTime = Date.now();
    const results: VerificationResult[] = [];
    const screenshots: string[] = [];
    const failures: string[] = [];

    // Use existing session or create new one
    const sessionId = options.sessionId ?? (await this.ensureSession());

    // Navigate to URL
    const navResult = await this.manager.navigate(sessionId, url);
    if (!navResult.success) {
      return {
        success: false,
        steps: [],
        duration: Date.now() - startTime,
        summary: `Failed to navigate to ${url}: ${navResult.error}`,
        screenshots: [],
        failures: [`Navigation failed: ${navResult.error}`],
      };
    }

    // Execute each step
    for (const step of steps) {
      const stepResult = await this.executeStep(sessionId, step);
      results.push(stepResult);

      if (stepResult.screenshot) {
        screenshots.push(stepResult.screenshot);
      }

      if (!stepResult.success) {
        failures.push(`${step.description}: ${stepResult.error}`);

        if (step.required && !options.continueOnFailure) {
          break;
        }
      }
    }

    // Get console report
    const consoleSummary = this.manager.getConsoleLogs(sessionId);
    const consoleReport = ConsoleCapture.createReport(consoleSummary);

    // Build summary
    const passed = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    const success = failures.length === 0;

    const summary = success
      ? `All ${passed} verification step(s) passed`
      : `${failed} of ${results.length} step(s) failed`;

    return {
      success,
      steps: results,
      duration: Date.now() - startTime,
      summary,
      consoleReport,
      screenshots,
      failures,
    };
  }

  /**
   * Execute a single verification step
   */
  async executeStep(
    sessionId: string,
    step: VerificationStep
  ): Promise<VerificationResult> {
    const startTime = Date.now();

    try {
      switch (step.type) {
        case 'screenshot':
          return await this.executeScreenshotStep(sessionId, step);

        case 'assertion':
          return await this.executeAssertionStep(sessionId, step);

        case 'test':
          return await this.executeTestStep(step);

        case 'console_check':
          return await this.executeConsoleCheckStep(sessionId, step);

        default:
          throw new Error(`Unknown verification step type: ${step.type}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        stepId: step.id,
        success: false,
        type: step.type,
        duration: Date.now() - startTime,
        details: {},
        error: errorMessage,
      };
    }
  }

  /**
   * Execute a screenshot verification step
   */
  private async executeScreenshotStep(
    sessionId: string,
    step: VerificationStep
  ): Promise<VerificationResult> {
    const startTime = Date.now();
    const params = step.params as ScreenshotParams;

    const screenshot = await this.manager.screenshot(sessionId, {
      fullPage: params.fullPage,
      selector: params.selector,
      label: params.label,
    });

    const result: VerificationResult = {
      stepId: step.id,
      success: true,
      type: 'screenshot',
      duration: Date.now() - startTime,
      details: {
        path: screenshot.path,
        url: screenshot.url,
        fullPage: screenshot.fullPage,
      },
      screenshot: screenshot.path,
    };

    // Visual diff comparison if requested
    if (params.compare) {
      // Visual diff would be implemented here
      // For now, just note it in details
      result.details.comparedWith = params.compare;
      result.details.threshold = params.threshold ?? 0.1;
    }

    return result;
  }

  /**
   * Execute an assertion verification step
   */
  private async executeAssertionStep(
    sessionId: string,
    step: VerificationStep
  ): Promise<VerificationResult> {
    const startTime = Date.now();
    const params = step.params as AssertionParams;

    const assertResult = await this.manager.assert(sessionId, params);

    return {
      stepId: step.id,
      success: assertResult.success,
      type: 'assertion',
      duration: Date.now() - startTime,
      details: {
        assertionType: assertResult.type,
        selector: assertResult.selector,
        expected: assertResult.expected,
        actual: assertResult.actual,
      },
      error: assertResult.error,
    };
  }

  /**
   * Execute a test file verification step
   */
  private async executeTestStep(step: VerificationStep): Promise<VerificationResult> {
    const startTime = Date.now();
    const params = step.params as TestParams;

    const testResult = await this.runPlaywrightTest(params);

    return {
      stepId: step.id,
      success: testResult.success,
      type: 'test',
      duration: Date.now() - startTime,
      details: {
        testFile: testResult.testFile,
        passed: testResult.passed,
        failed: testResult.failed,
        skipped: testResult.skipped,
        failures: testResult.failures,
      },
      error: testResult.success
        ? undefined
        : `${testResult.failed} test(s) failed`,
    };
  }

  /**
   * Execute a console check verification step
   */
  private async executeConsoleCheckStep(
    sessionId: string,
    step: VerificationStep
  ): Promise<VerificationResult> {
    const startTime = Date.now();
    const params = step.params as ConsoleCheckParams;

    const consoleSummary = this.manager.getConsoleLogs(sessionId);
    const checkResult = ConsoleCapture.passes(consoleSummary, params);

    return {
      stepId: step.id,
      success: checkResult.passed,
      type: 'console_check',
      duration: Date.now() - startTime,
      details: {
        totalMessages: consoleSummary.total,
        errors: consoleSummary.errors,
        warnings: consoleSummary.warnings,
        pageErrors: consoleSummary.pageErrors.length,
      },
      error: checkResult.reason,
    };
  }

  /**
   * Run a Playwright test file
   */
  async runPlaywrightTest(params: TestParams): Promise<TestRunResult> {
    return new Promise((resolve) => {
      const args = ['test', params.testFile];

      if (params.testName) {
        args.push('--grep', params.testName);
      }

      args.push('--reporter=json');

      const child = spawn('npx', ['playwright', ...args], {
        shell: true,
        timeout: params.timeout ?? 60000,
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        const success = code === 0;
        const failures: TestFailure[] = [];
        let passed = 0;
        let failed = 0;
        let skipped = 0;

        // Try to parse JSON output
        try {
          const jsonMatch = stdout.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const result = JSON.parse(jsonMatch[0]);
            if (result.stats) {
              passed = result.stats.expected ?? 0;
              failed = result.stats.unexpected ?? 0;
              skipped = result.stats.skipped ?? 0;
            }

            // Extract failures
            if (result.suites) {
              for (const suite of result.suites) {
                for (const spec of suite.specs ?? []) {
                  if (spec.ok === false) {
                    failures.push({
                      testName: spec.title,
                      error: spec.tests?.[0]?.results?.[0]?.error?.message ?? 'Test failed',
                      stack: spec.tests?.[0]?.results?.[0]?.error?.stack,
                    });
                  }
                }
              }
            }
          }
        } catch {
          // JSON parsing failed, use exit code
          failed = success ? 0 : 1;
        }

        resolve({
          success,
          testFile: params.testFile,
          passed,
          failed,
          skipped,
          duration: 0, // Would need to track this
          failures,
          output: stdout + stderr,
        });
      });

      child.on('error', (error) => {
        resolve({
          success: false,
          testFile: params.testFile,
          passed: 0,
          failed: 1,
          skipped: 0,
          duration: 0,
          failures: [
            {
              testName: 'Test execution',
              error: error.message,
            },
          ],
          output: error.message,
        });
      });
    });
  }

  /**
   * Quick verification - navigate, screenshot, check console
   */
  async quickVerify(
    url: string,
    options: {
      screenshot?: boolean;
      checkConsole?: boolean;
      assertVisible?: string[];
    } = {}
  ): Promise<WorkflowResult> {
    const steps: VerificationStep[] = [];

    // Screenshot step
    if (options.screenshot !== false) {
      steps.push({
        id: 'quick-screenshot',
        type: 'screenshot',
        description: 'Capture page screenshot',
        params: { fullPage: true, label: 'quick-verify' },
        required: false,
      });
    }

    // Visibility assertions
    if (options.assertVisible) {
      for (const selector of options.assertVisible) {
        steps.push({
          id: `visible-${selector}`,
          type: 'assertion',
          description: `Check ${selector} is visible`,
          params: { type: 'visible', selector },
          required: true,
        });
      }
    }

    // Console check
    if (options.checkConsole !== false) {
      steps.push({
        id: 'console-check',
        type: 'console_check',
        description: 'Check for console errors',
        params: { noErrors: true },
        required: false,
      });
    }

    return this.executeWorkflow(url, steps, { continueOnFailure: true });
  }

  /**
   * Cleanup all resources
   */
  async cleanup(): Promise<void> {
    await this.manager.closeAll();
    this.currentSessionId = null;
  }
}

export default VerificationService;
