/**
 * CodeReviewer
 *
 * Main code review engine for RUBIX.
 * Performs automated code review with:
 * - Security vulnerability scanning
 * - Style/lint checking
 * - Logic review
 * - Test coverage analysis
 * - Summary generation
 * - EventEmitter progress tracking
 * - Parallel file processing
 * - Rich statistics
 * - Stop/Resume capability
 * - Review history
 */

import { randomUUID } from 'crypto';
import * as path from 'path';
import * as fs from 'fs/promises';
import { EventEmitter } from 'events';

import type { MemoryEngine } from '../core/MemoryEngine.js';
import type { CapabilitiesManager } from '../capabilities/CapabilitiesManager.js';
import type { PlaywrightManager } from '../playwright/PlaywrightManager.js';
import type { VerificationService } from '../playwright/VerificationService.js';

import {
  type ReviewRequest,
  type ReviewResult,
  type ReviewConfig,
  type ReviewIssue,
  type SecurityFinding,
  type StyleIssue,
  type FileReviewResult,
  type ReviewSummary,
  type ApprovalStatus,
  type SuggestedFix,
  type TestCoverageResult,
  type ReviewSeverity,
  type ReviewCategory,
  type ReviewProgress,
  type ReviewPhase,
  type ReviewStatistics,
  type ExtendedReviewConfig,
  DEFAULT_REVIEW_CONFIG
} from './types.js';
import { JS_SECURITY_PATTERNS, getPatternsForExtension, isFalsePositive } from './SecurityPatterns.js';

/**
 * Single file review result for parallel processing
 */
interface SingleFileResult {
  file: string;
  issues: ReviewIssue[];
  securityFindings: SecurityFinding[];
  styleIssues: StyleIssue[];
  fileResult: FileReviewResult;
  codeLines: number;
  commentLines: number;
}

/**
 * CodeReviewer - Automated code review engine
 *
 * Extends EventEmitter for progress tracking.
 * Emits: review:start, review:progress, review:issue, review:file:complete, review:complete, review:error, review:stopped
 */
export class CodeReviewer extends EventEmitter {
  private engine: MemoryEngine;
  private capabilities: CapabilitiesManager | undefined;
  private _playwright: PlaywrightManager | undefined;
  private verifier: VerificationService | undefined;
  private projectRoot: string;
  private config: ExtendedReviewConfig;

  // State tracking for stop/resume
  private isReviewing: boolean = false;
  private stopRequested: boolean = false;
  private currentReviewId: string | null = null;

  // Review history
  private reviewHistory: ReviewResult[] = [];
  private maxHistorySize: number = 10;

  // Progress tracking
  private reviewStartTime: number = 0;
  private phaseTimings: Map<ReviewPhase, number> = new Map();

  constructor(
    engine: MemoryEngine,
    projectRoot: string,
    config: Partial<ExtendedReviewConfig> = {},
    capabilities?: CapabilitiesManager,
    playwright?: PlaywrightManager,
    verifier?: VerificationService
  ) {
    super();
    this.engine = engine;
    this.projectRoot = projectRoot;
    this.config = {
      ...DEFAULT_REVIEW_CONFIG,
      maxParallelFiles: 5,
      fileTimeout: 30000,
      parallel: true,
      ...config
    };
    this.capabilities = capabilities;
    this._playwright = playwright;
    this.verifier = verifier;
  }

  /**
   * Perform a code review with progress tracking and parallel processing
   */
  async review(request: ReviewRequest): Promise<ReviewResult> {
    // Prevent concurrent reviews
    if (this.isReviewing) {
      const error = new Error('A review is already in progress. Stop it first or wait for completion.');
      this.emit('review:error', error);
      throw error;
    }

    this.isReviewing = true;
    this.stopRequested = false;
    this.currentReviewId = request.id;
    this.reviewStartTime = Date.now();
    this.phaseTimings.clear();

    const config: ExtendedReviewConfig = { ...this.config, ...request.config };

    try {
      // Emit start event
      this.emit('review:start', request);
      this.emitProgress('initializing', 0, request.files.length, 0, 0);

      const issues: ReviewIssue[] = [];
      const securityFindings: SecurityFinding[] = [];
      const styleIssues: StyleIssue[] = [];
      const fileResults: FileReviewResult[] = [];
      const suggestedFixes: SuggestedFix[] = [];
      const notes: string[] = [];
      let totalCodeLines = 0;
      let totalCommentLines = 0;

      // Process files (parallel or sequential based on config)
      const useParallel = config.parallel !== false && request.files.length > 1;
      const phaseStartTime = Date.now();

      if (useParallel) {
        const results = await this.reviewFilesParallel(request.files, config, request.diff);
        for (const result of results) {
          if (this.stopRequested) break;
          issues.push(...result.issues);
          securityFindings.push(...result.securityFindings);
          styleIssues.push(...result.styleIssues);
          fileResults.push(result.fileResult);
          totalCodeLines += result.codeLines;
          totalCommentLines += result.commentLines;
        }
      } else {
        // Sequential processing with progress updates
        let filesProcessed = 0;
        for (const file of request.files) {
          if (this.stopRequested) {
            notes.push('Review stopped by user request');
            break;
          }

          const result = await this.reviewSingleFile(file, config, request.diff);
          issues.push(...result.issues);
          securityFindings.push(...result.securityFindings);
          styleIssues.push(...result.styleIssues);
          fileResults.push(result.fileResult);
          totalCodeLines += result.codeLines;
          totalCommentLines += result.commentLines;

          // Emit file complete
          const fileIssues = result.issues;
          this.emit('review:file:complete', file, fileIssues);

          filesProcessed++;
          this.emitProgress('security', filesProcessed, request.files.length, issues.length, filesProcessed);
        }
      }

      this.phaseTimings.set('security', Date.now() - phaseStartTime);

      // Check if stopped
      if (this.stopRequested) {
        const partialResult = this.createPartialResult(request, issues, securityFindings, styleIssues, fileResults, notes, suggestedFixes);
        this.emit('review:stopped', 'User requested stop');
        this.addToHistory(partialResult);
        return partialResult;
      }

      // Test coverage check
      let testCoverage: TestCoverageResult | undefined;
      if (config.tests && this.verifier) {
        this.emitProgress('tests', fileResults.length, request.files.length, issues.length, fileResults.length);
        const testStartTime = Date.now();
        testCoverage = await this.checkTestCoverage();
        this.phaseTimings.set('tests', Date.now() - testStartTime);
      }

      // Generate suggested fixes
      this.emitProgress('generating', fileResults.length, request.files.length, issues.length, fileResults.length);
      const genStartTime = Date.now();
      for (const issue of issues) {
        const fix = await this.generateFix(issue);
        if (fix) {
          suggestedFixes.push(fix);
          issue.fix = fix;
        }
      }
      this.phaseTimings.set('generating', Date.now() - genStartTime);

      // Generate summary with rich statistics
      const summary = this.generateSummary(issues, securityFindings, styleIssues, fileResults);

      // Generate statistics
      const statistics = this.calculateStatistics(
        issues,
        fileResults,
        totalCodeLines,
        totalCommentLines,
        Date.now() - this.reviewStartTime
      );

      // Determine approval status
      const approval = this.determineApproval(issues, securityFindings, config);

      // Store review in memory
      await this.storeReviewResult(request, summary, issues);

      // Build result
      const result: ReviewResult & { statistics?: ReviewStatistics } = {
        requestId: request.id,
        status: approval.approved ? 'approved' : 'changes_requested',
        summary,
        issues,
        security: securityFindings,
        style: styleIssues,
        tests: testCoverage,
        filesReviewed: fileResults,
        duration: Date.now() - this.reviewStartTime,
        notes,
        approval,
        suggestedFixes,
        statistics
      };

      // Emit complete and add to history
      this.emitProgress('complete', fileResults.length, request.files.length, issues.length, fileResults.length);
      this.emit('review:complete', result);
      this.addToHistory(result);

      return result;

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('review:error', err);
      throw err;
    } finally {
      this.isReviewing = false;
      this.currentReviewId = null;
    }
  }

  /**
   * Review files in parallel batches
   */
  private async reviewFilesParallel(
    files: string[],
    config: ExtendedReviewConfig,
    diff?: string
  ): Promise<SingleFileResult[]> {
    const concurrency = config.maxParallelFiles || 5;
    const results: SingleFileResult[] = [];
    let filesProcessed = 0;

    for (let i = 0; i < files.length; i += concurrency) {
      if (this.stopRequested) break;

      const batch = files.slice(i, i + concurrency);
      const batchPromises = batch.map(async (file) => {
        try {
          const result = await this.withTimeout(
            this.reviewSingleFile(file, config, diff),
            config.fileTimeout || 30000,
            `Timeout reviewing ${file}`
          );
          return result;
        } catch (error) {
          // Return empty result for failed files
          return {
            file,
            issues: [],
            securityFindings: [],
            styleIssues: [],
            fileResult: {
              file,
              issueCount: 0,
              highestSeverity: null,
              isSensitive: false,
              linesAdded: 0,
              linesRemoved: 0
            },
            codeLines: 0,
            commentLines: 0
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      // Emit progress and file complete events for batch
      for (const result of batchResults) {
        filesProcessed++;
        this.emit('review:file:complete', result.file, result.issues);
        this.emitProgress(
          'security',
          filesProcessed,
          files.length,
          results.reduce((sum, r) => sum + r.issues.length, 0),
          filesProcessed
        );
      }
    }

    return results;
  }

  /**
   * Review a single file
   */
  private async reviewSingleFile(
    file: string,
    config: ExtendedReviewConfig,
    diff?: string
  ): Promise<SingleFileResult> {
    const absolutePath = path.isAbsolute(file)
      ? file
      : path.join(this.projectRoot, file);

    const issues: ReviewIssue[] = [];
    const securityFindings: SecurityFinding[] = [];
    const styleIssues: StyleIssue[] = [];
    let codeLines = 0;
    let commentLines = 0;

    try {
      const content = await fs.readFile(absolutePath, 'utf-8');
      const ext = path.extname(file);

      // Count lines
      const lineStats = this.countCodeLines(content, ext);
      codeLines = lineStats.code;
      commentLines = lineStats.comments;

      // Check if this is a sensitive file
      const isSensitive = this.isSensitiveFile(file, config);

      // Security scanning
      if (config.security) {
        const findings = await this.scanSecurity(file, content, ext);
        securityFindings.push(...findings);

        for (const finding of findings) {
          const issue = this.securityFindingToIssue(finding);
          issues.push(issue);
          this.emit('review:issue', issue, file);
        }
      }

      // Style/lint checking
      if (config.style && this.capabilities) {
        const styleResults = await this.checkStyle(file);
        styleIssues.push(...styleResults);

        for (const style of styleResults) {
          const issue = this.styleIssueToReviewIssue(style);
          issues.push(issue);
          this.emit('review:issue', issue, file);
        }
      }

      // Logic review (type checking)
      if (config.logic && this.capabilities) {
        const logicIssues = await this.checkLogic(file);
        for (const issue of logicIssues) {
          issues.push(issue);
          this.emit('review:issue', issue, file);
        }
      }

      return {
        file,
        issues,
        securityFindings,
        styleIssues,
        fileResult: {
          file,
          issueCount: issues.length,
          highestSeverity: this.getHighestSeverity(issues),
          isSensitive,
          linesAdded: this.estimateLinesChanged(diff, file, 'add'),
          linesRemoved: this.estimateLinesChanged(diff, file, 'remove')
        },
        codeLines,
        commentLines
      };
    } catch (error) {
      // Return empty result with error noted
      return {
        file,
        issues: [],
        securityFindings: [],
        styleIssues: [],
        fileResult: {
          file,
          issueCount: 0,
          highestSeverity: null,
          isSensitive: false,
          linesAdded: 0,
          linesRemoved: 0
        },
        codeLines: 0,
        commentLines: 0
      };
    }
  }

  /**
   * Emit progress event
   */
  private emitProgress(
    phase: ReviewPhase,
    filesProcessed: number,
    totalFiles: number,
    issuesFound: number,
    currentStep: number
  ): void {
    const elapsedTime = Date.now() - this.reviewStartTime;
    const percentage = totalFiles > 0 ? Math.round((filesProcessed / totalFiles) * 100) : 0;

    // Estimate remaining time based on elapsed time and progress
    let estimatedTimeRemaining: number | undefined;
    if (filesProcessed > 0 && filesProcessed < totalFiles) {
      const avgTimePerFile = elapsedTime / filesProcessed;
      estimatedTimeRemaining = Math.round(avgTimePerFile * (totalFiles - filesProcessed));
    }

    const progress: ReviewProgress = {
      phase,
      totalSteps: totalFiles + 2, // files + tests + fixes
      currentStep,
      percentage,
      filesProcessed,
      totalFiles,
      issuesFound,
      elapsedTime,
      estimatedTimeRemaining
    };

    this.emit('review:progress', progress);
  }

  /**
   * Timeout wrapper for async operations
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    message: string
  ): Promise<T> {
    let timeoutId: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(message)), ms);
    });

    try {
      const result = await Promise.race([promise, timeoutPromise]);
      clearTimeout(timeoutId!);
      return result;
    } catch (error) {
      clearTimeout(timeoutId!);
      throw error;
    }
  }

  /**
   * Count code and comment lines
   */
  private countCodeLines(content: string, ext: string): { code: number; comments: number } {
    const lines = content.split('\n');
    let code = 0;
    let comments = 0;
    let inBlockComment = false;

    const singleLineComment = ext.match(/\.(js|ts|tsx|jsx|java|c|cpp|cs|go|rs|swift)$/)
      ? '//'
      : ext.match(/\.(py|rb|sh|bash|yaml|yml)$/)
        ? '#'
        : null;

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed) continue; // Skip empty lines

      // Block comment handling (/* ... */)
      if (trimmed.startsWith('/*')) {
        inBlockComment = true;
        comments++;
        if (trimmed.endsWith('*/')) inBlockComment = false;
        continue;
      }

      if (inBlockComment) {
        comments++;
        if (trimmed.endsWith('*/')) inBlockComment = false;
        continue;
      }

      // Single line comment
      if (singleLineComment && trimmed.startsWith(singleLineComment)) {
        comments++;
        continue;
      }

      code++;
    }

    return { code, comments };
  }

  /**
   * Calculate rich statistics from review results
   */
  private calculateStatistics(
    issues: ReviewIssue[],
    fileResults: FileReviewResult[],
    totalCodeLines: number,
    totalCommentLines: number,
    executionTime: number
  ): ReviewStatistics {
    const issuesByCategory: Record<ReviewCategory, number> = {
      security: 0,
      performance: 0,
      logic: 0,
      style: 0,
      maintainability: 0,
      documentation: 0,
      testing: 0,
      accessibility: 0,
      compatibility: 0
    };

    const issuesBySeverity: Record<ReviewSeverity, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0
    };

    const issueTitles: Record<string, number> = {};

    for (const issue of issues) {
      issuesByCategory[issue.category]++;
      issuesBySeverity[issue.severity]++;
      issueTitles[issue.title] = (issueTitles[issue.title] || 0) + 1;
    }

    // Find most common issue type
    let mostCommonIssueType: string | undefined;
    let maxCount = 0;
    for (const [title, count] of Object.entries(issueTitles)) {
      if (count > maxCount) {
        maxCount = count;
        mostCommonIssueType = title;
      }
    }

    const filesWithIssues = fileResults.filter(f => f.issueCount > 0).length;

    // Convert phase timings to record
    const timeByPhase: Record<ReviewPhase, number> = {
      initializing: this.phaseTimings.get('initializing') || 0,
      security: this.phaseTimings.get('security') || 0,
      style: this.phaseTimings.get('style') || 0,
      logic: this.phaseTimings.get('logic') || 0,
      tests: this.phaseTimings.get('tests') || 0,
      generating: this.phaseTimings.get('generating') || 0,
      complete: 0
    };

    return {
      filesScanned: fileResults.length,
      filesWithIssues,
      totalIssues: issues.length,
      issuesByCategory,
      issuesBySeverity,
      averageIssuesPerFile: fileResults.length > 0 ? issues.length / fileResults.length : 0,
      mostCommonIssueType,
      totalCodeLines,
      totalCommentLines,
      codeToCommentRatio: totalCommentLines > 0 ? totalCodeLines / totalCommentLines : totalCodeLines,
      executionTime,
      timeByPhase
    };
  }

  /**
   * Create a partial result when review is stopped
   */
  private createPartialResult(
    request: ReviewRequest,
    issues: ReviewIssue[],
    securityFindings: SecurityFinding[],
    styleIssues: StyleIssue[],
    fileResults: FileReviewResult[],
    notes: string[],
    suggestedFixes: SuggestedFix[]
  ): ReviewResult {
    notes.push('Review was stopped before completion');
    const summary = this.generateSummary(issues, securityFindings, styleIssues, fileResults);

    return {
      requestId: request.id,
      status: 'pending',
      summary,
      issues,
      security: securityFindings,
      style: styleIssues,
      filesReviewed: fileResults,
      duration: Date.now() - this.reviewStartTime,
      notes,
      approval: {
        approved: false,
        reason: 'Review incomplete - stopped before completion',
        requiresHumanReview: true
      },
      suggestedFixes
    };
  }

  /**
   * Add result to history
   */
  private addToHistory(result: ReviewResult): void {
    this.reviewHistory.unshift(result);
    if (this.reviewHistory.length > this.maxHistorySize) {
      this.reviewHistory.pop();
    }
  }

  // ===========================================================================
  // Stop/Resume and Status Methods
  // ===========================================================================

  /**
   * Stop the current review
   */
  stopReview(): void {
    if (this.isReviewing) {
      this.stopRequested = true;
    }
  }

  /**
   * Check if a review is in progress
   */
  isReviewInProgress(): boolean {
    return this.isReviewing;
  }

  /**
   * Get current review ID
   */
  getCurrentReviewId(): string | null {
    return this.currentReviewId;
  }

  /**
   * Get review history
   */
  getReviewHistory(): ReviewResult[] {
    return [...this.reviewHistory];
  }

  /**
   * Clear review history
   */
  clearHistory(): void {
    this.reviewHistory = [];
  }

  /**
   * Set maximum history size
   */
  setMaxHistorySize(size: number): void {
    this.maxHistorySize = size;
    while (this.reviewHistory.length > this.maxHistorySize) {
      this.reviewHistory.pop();
    }
  }

  /**
   * Quick review for pre-commit hooks
   */
  async quickReview(files: string[]): Promise<{
    pass: boolean;
    criticalIssues: ReviewIssue[];
    summary: string;
  }> {
    const request: ReviewRequest = {
      id: randomUUID(),
      files,
      type: 'quick'
    };

    const result = await this.review(request);

    const criticalIssues = result.issues.filter(i =>
      i.severity === 'critical' || i.severity === 'high'
    );

    return {
      pass: criticalIssues.length === 0,
      criticalIssues,
      summary: result.summary.text
    };
  }

  /**
   * Security-focused review
   */
  async securityReview(files: string[]): Promise<{
    findings: SecurityFinding[];
    riskLevel: 'critical' | 'high' | 'medium' | 'low' | 'none';
    summary: string;
  }> {
    const request: ReviewRequest = {
      id: randomUUID(),
      files,
      type: 'security',
      config: {
        security: true,
        style: false,
        logic: false,
        tests: false,
        blockingSeverity: 'high',
        maxIssues: 100,
        sensitivePatterns: this.config.sensitivePatterns
      }
    };

    const result = await this.review(request);

    const riskLevel = this.calculateRiskLevel(result.security);

    return {
      findings: result.security,
      riskLevel,
      summary: `Found ${result.security.length} security issues. Risk level: ${riskLevel.toUpperCase()}`
    };
  }

  // ===========================================================================
  // Security Scanning
  // ===========================================================================

  /**
   * Scan file for security vulnerabilities
   */
  private async scanSecurity(
    file: string,
    content: string,
    extension: string
  ): Promise<SecurityFinding[]> {
    const findings: SecurityFinding[] = [];
    const patterns = getPatternsForExtension(extension);

    for (const pattern of patterns) {
      const matches = content.matchAll(new RegExp(pattern.pattern, 'g'));

      for (const match of matches) {
        const matchIndex = match.index ?? 0;

        // Check for false positives
        if (isFalsePositive(pattern, content, matchIndex)) {
          continue;
        }

        // Calculate line number
        const lineNumber = content.substring(0, matchIndex).split('\n').length;

        // Extract code snippet
        const lines = content.split('\n');
        const snippetStart = Math.max(0, lineNumber - 2);
        const snippetEnd = Math.min(lines.length, lineNumber + 2);
        const snippet = lines.slice(snippetStart, snippetEnd).join('\n');

        findings.push({
          id: randomUUID(),
          type: pattern.type,
          severity: pattern.severity,
          title: pattern.name,
          description: pattern.description,
          file,
          line: lineNumber,
          snippet,
          cweId: pattern.cweId,
          owaspCategory: pattern.owaspCategory,
          remediation: pattern.remediation,
          references: this.getSecurityReferences(pattern),
          confidence: pattern.confidence
        });
      }
    }

    return findings;
  }

  /**
   * Get security references for a pattern
   */
  private getSecurityReferences(pattern: typeof JS_SECURITY_PATTERNS[0]): string[] {
    const refs: string[] = [];

    if (pattern.cweId) {
      refs.push(`https://cwe.mitre.org/data/definitions/${pattern.cweId.replace('CWE-', '')}.html`);
    }

    if (pattern.owaspCategory) {
      refs.push('https://owasp.org/Top10/');
    }

    return refs;
  }

  // ===========================================================================
  // Style Checking
  // ===========================================================================

  /**
   * Check style and lint issues
   */
  private async checkStyle(file: string): Promise<StyleIssue[]> {
    const issues: StyleIssue[] = [];

    if (!this.capabilities) return issues;

    try {
      // Run ESLint
      const lintResults = await this.capabilities.runLint([file]);

      for (const result of lintResults) {
        for (const msg of result.messages) {
          issues.push({
            id: randomUUID(),
            severity: msg.severity === 'error' ? 'high' : 'low',
            rule: msg.ruleId ?? 'unknown',
            message: msg.message,
            file: result.file,
            line: msg.line,
            column: msg.column,
            endLine: msg.endLine,
            endColumn: msg.endColumn,
            source: 'eslint',
            fixable: msg.fix !== undefined,
            fix: msg.fix ? msg.fix.text : undefined
          });
        }
      }
    } catch {
      // Linting failed
    }

    return issues;
  }

  // ===========================================================================
  // Logic Checking
  // ===========================================================================

  /**
   * Check logic and type issues
   */
  private async checkLogic(file: string): Promise<ReviewIssue[]> {
    const issues: ReviewIssue[] = [];

    if (!this.capabilities) return issues;

    try {
      // Run TypeScript type checking
      const typeResults = await this.capabilities.runTypeCheck([file]);

      for (const result of typeResults) {
        for (const error of result.errors) {
          issues.push({
            id: randomUUID(),
            severity: 'high',
            category: 'logic',
            title: 'Type Error',
            description: error.message,
            file: result.file,
            line: error.line,
            column: error.column,
            ruleId: `TS${error.code}`
          });
        }

        for (const warning of result.warnings) {
          issues.push({
            id: randomUUID(),
            severity: 'medium',
            category: 'logic',
            title: 'Type Warning',
            description: warning.message,
            file: result.file,
            line: warning.line,
            column: warning.column,
            ruleId: `TS${warning.code}`
          });
        }
      }
    } catch {
      // Type checking failed
    }

    return issues;
  }

  // ===========================================================================
  // Test Coverage
  // ===========================================================================

  /**
   * Check test coverage by running the test runner with coverage
   */
  private async checkTestCoverage(): Promise<TestCoverageResult> {
    const threshold = this.config.coverageThreshold || 80;

    try {
      // Detect test runner
      const testRunner = await this.detectTestRunner();

      if (!testRunner) {
        console.log('[CodeReviewer] No test runner detected (jest/vitest)');
        return {
          overall: 0,
          lines: 0,
          branches: 0,
          functions: 0,
          statements: 0,
          uncoveredFiles: [],
          meetsThreshold: false,
          threshold
        };
      }

      console.log(`[CodeReviewer] Detected test runner: ${testRunner}`);

      // Run test with coverage
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      let coverageCmd: string;
      if (testRunner === 'vitest') {
        coverageCmd = 'npx vitest run --coverage --reporter=json';
      } else {
        coverageCmd = 'npx jest --coverage --json --outputFile=coverage/coverage-summary.json';
      }

      try {
        await execAsync(coverageCmd, {
          cwd: this.projectRoot,
          timeout: 120000 // 2 minute timeout
        });
      } catch (testError) {
        // Tests might fail but we still want coverage data
        console.log('[CodeReviewer] Tests completed (some may have failed)');
      }

      // Parse coverage report
      const coverageResult = await this.parseCoverageReport(testRunner);

      return {
        ...coverageResult,
        threshold,
        meetsThreshold: coverageResult.overall >= threshold
      };
    } catch (error) {
      console.warn('[CodeReviewer] Failed to run test coverage:', error);
      return {
        overall: 0,
        lines: 0,
        branches: 0,
        functions: 0,
        statements: 0,
        uncoveredFiles: [],
        meetsThreshold: false,
        threshold
      };
    }
  }

  /**
   * Detect which test runner is installed
   */
  private async detectTestRunner(): Promise<'jest' | 'vitest' | null> {
    const pkgPath = path.join(this.projectRoot, 'package.json');

    try {
      const pkgContent = await fs.readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(pkgContent);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };

      if (deps['vitest']) return 'vitest';
      if (deps['jest']) return 'jest';
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Parse coverage report from test runner
   */
  private async parseCoverageReport(
    testRunner: 'jest' | 'vitest'
  ): Promise<Omit<TestCoverageResult, 'threshold' | 'meetsThreshold'>> {
    let coveragePath: string;

    if (testRunner === 'vitest') {
      coveragePath = path.join(this.projectRoot, 'coverage', 'coverage-summary.json');
    } else {
      coveragePath = path.join(this.projectRoot, 'coverage', 'coverage-summary.json');
    }

    try {
      const coverageContent = await fs.readFile(coveragePath, 'utf-8');
      const coverage = JSON.parse(coverageContent);

      // Extract total metrics
      const total = coverage.total || {};

      const lines = total.lines?.pct ?? 0;
      const branches = total.branches?.pct ?? 0;
      const functions = total.functions?.pct ?? 0;
      const statements = total.statements?.pct ?? 0;

      // Calculate overall as average
      const overall = (lines + branches + functions + statements) / 4;

      // Find uncovered files (less than 50% coverage)
      const uncoveredFiles: string[] = [];
      for (const [filePath, fileCoverage] of Object.entries(coverage)) {
        if (filePath === 'total') continue;
        const fc = fileCoverage as { lines?: { pct: number } };
        if (fc.lines && fc.lines.pct < 50) {
          uncoveredFiles.push(filePath);
        }
      }

      console.log(`[CodeReviewer] Coverage: ${overall.toFixed(1)}% overall (L:${lines.toFixed(1)}% B:${branches.toFixed(1)}% F:${functions.toFixed(1)}% S:${statements.toFixed(1)}%)`);

      return {
        overall,
        lines,
        branches,
        functions,
        statements,
        uncoveredFiles
      };
    } catch (error) {
      console.warn('[CodeReviewer] Failed to parse coverage report:', error);
      return {
        overall: 0,
        lines: 0,
        branches: 0,
        functions: 0,
        statements: 0,
        uncoveredFiles: []
      };
    }
  }

  // ===========================================================================
  // Fix Generation
  // ===========================================================================

  /**
   * Generate a suggested fix for an issue
   */
  private async generateFix(issue: ReviewIssue): Promise<SuggestedFix | null> {
    // Only generate fixes for certain issue types
    if (issue.category !== 'security' && issue.category !== 'style') {
      return null;
    }

    // For security issues, provide generic fixes based on vulnerability type
    if (issue.category === 'security') {
      return this.generateSecurityFix(issue);
    }

    return null;
  }

  /**
   * Generate security-specific fix
   */
  private generateSecurityFix(issue: ReviewIssue): SuggestedFix | null {
    // Map of common security fixes
    const fixes: Record<string, { pattern: RegExp; replacement: string }> = {
      'Unsafe eval usage': {
        pattern: /eval\s*\(/g,
        replacement: '/* SECURITY: eval removed */ JSON.parse('
      },
      'CORS wildcard origin': {
        pattern: /['"`]\*['"`]/g,
        replacement: 'process.env.ALLOWED_ORIGINS'
      }
    };

    const fixInfo = fixes[issue.title];
    if (!fixInfo || !issue.snippet) return null;

    return {
      id: randomUUID(),
      issueId: issue.id,
      description: `Fix ${issue.title}: ${issue.description}`,
      file: issue.file,
      original: issue.snippet,
      fixed: issue.snippet.replace(fixInfo.pattern, fixInfo.replacement),
      lineRange: { start: issue.line, end: issue.endLine ?? issue.line },
      confidence: 'medium',
      autoApplicable: false
    };
  }

  // ===========================================================================
  // Summary Generation
  // ===========================================================================

  /**
   * Generate review summary
   */
  private generateSummary(
    issues: ReviewIssue[],
    security: SecurityFinding[],
    _style: StyleIssue[],
    files: FileReviewResult[]
  ): ReviewSummary {
    const bySeverity: Record<ReviewSeverity, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0
    };

    const byCategory: Record<ReviewCategory, number> = {
      security: 0,
      performance: 0,
      logic: 0,
      style: 0,
      maintainability: 0,
      documentation: 0,
      testing: 0,
      accessibility: 0,
      compatibility: 0
    };

    for (const issue of issues) {
      bySeverity[issue.severity]++;
      byCategory[issue.category]++;
    }

    const filesWithIssues = files.filter(f => f.issueCount > 0).length;

    // Calculate score (100 - weighted penalty for issues)
    const penalties = {
      critical: 25,
      high: 10,
      medium: 3,
      low: 1,
      info: 0
    };

    let penalty = 0;
    for (const [severity, count] of Object.entries(bySeverity)) {
      penalty += count * penalties[severity as ReviewSeverity];
    }

    const score = Math.max(0, 100 - penalty);

    // Generate text summary
    const parts: string[] = [];
    parts.push(`Reviewed ${files.length} files with ${issues.length} issues found.`);

    if (bySeverity.critical > 0) {
      parts.push(`${bySeverity.critical} CRITICAL issues require immediate attention.`);
    }
    if (bySeverity.high > 0) {
      parts.push(`${bySeverity.high} high-severity issues found.`);
    }
    if (security.length > 0) {
      parts.push(`${security.length} security vulnerabilities detected.`);
    }

    parts.push(`Review score: ${score}/100`);

    return {
      totalFiles: files.length,
      filesWithIssues,
      totalIssues: issues.length,
      bySeverity,
      byCategory,
      score,
      text: parts.join(' ')
    };
  }

  /**
   * Determine approval status
   */
  private determineApproval(
    issues: ReviewIssue[],
    security: SecurityFinding[],
    config: ReviewConfig
  ): ApprovalStatus {
    const criticalIssues = issues.filter(i => i.severity === 'critical');
    const highIssues = issues.filter(i => i.severity === 'high');
    const criticalSecurity = security.filter(s => s.severity === 'critical');

    // Blocked if critical issues
    if (criticalIssues.length > 0 || criticalSecurity.length > 0) {
      return {
        approved: false,
        reason: `${criticalIssues.length + criticalSecurity.length} critical issues must be fixed`,
        requiresHumanReview: true,
        humanReviewReason: 'Critical security or logic issues detected'
      };
    }

    // Changes requested for high issues
    if (highIssues.length > 0) {
      return {
        approved: false,
        reason: `${highIssues.length} high-severity issues should be addressed`,
        conditions: highIssues.map(i => `Fix: ${i.title} in ${i.file}`),
        requiresHumanReview: highIssues.length > 5
      };
    }

    // Too many total issues
    if (issues.length > config.maxIssues) {
      return {
        approved: false,
        reason: `Too many issues (${issues.length}/${config.maxIssues})`,
        requiresHumanReview: false
      };
    }

    // Approved with minor issues
    if (issues.length > 0) {
      return {
        approved: true,
        reason: `Approved with ${issues.length} minor issues`,
        conditions: ['Consider addressing remaining issues'],
        requiresHumanReview: false
      };
    }

    // Clean approval
    return {
      approved: true,
      reason: 'No issues found',
      requiresHumanReview: false
    };
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  /**
   * Check if file matches sensitive patterns
   */
  private isSensitiveFile(file: string, config: ReviewConfig): boolean {
    const normalizedFile = file.replace(/\\/g, '/');

    for (const pattern of config.sensitivePatterns) {
      // Simple glob matching
      const regexPattern = pattern
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*')
        .replace(/\./g, '\\.');

      if (new RegExp(regexPattern, 'i').test(normalizedFile)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get highest severity from issues
   */
  private getHighestSeverity(issues: ReviewIssue[]): ReviewSeverity | null {
    if (issues.length === 0) return null;

    const order: ReviewSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];

    for (const severity of order) {
      if (issues.some(i => i.severity === severity)) {
        return severity;
      }
    }

    return 'info';
  }

  /**
   * Convert security finding to review issue
   */
  private securityFindingToIssue(finding: SecurityFinding): ReviewIssue {
    return {
      id: finding.id,
      severity: finding.severity,
      category: 'security',
      title: finding.title,
      description: finding.description,
      file: finding.file,
      line: finding.line,
      snippet: finding.snippet,
      cweId: finding.cweId,
      owaspCategory: finding.owaspCategory
    };
  }

  /**
   * Convert style issue to review issue
   */
  private styleIssueToReviewIssue(style: StyleIssue): ReviewIssue {
    return {
      id: style.id,
      severity: style.severity,
      category: 'style',
      title: style.rule,
      description: style.message,
      file: style.file,
      line: style.line,
      column: style.column,
      endLine: style.endLine,
      ruleId: style.rule
    };
  }

  /**
   * Estimate lines changed from diff
   */
  private estimateLinesChanged(diff: string | undefined, file: string, type: 'add' | 'remove'): number {
    if (!diff) return 0;

    const prefix = type === 'add' ? '+' : '-';
    const lines = diff.split('\n');
    let inFile = false;
    let count = 0;

    for (const line of lines) {
      if (line.startsWith('diff --git') || line.startsWith('+++') || line.startsWith('---')) {
        inFile = line.includes(file);
      } else if (inFile && line.startsWith(prefix) && !line.startsWith(prefix + prefix)) {
        count++;
      }
    }

    return count;
  }

  /**
   * Calculate overall risk level from security findings
   */
  private calculateRiskLevel(findings: SecurityFinding[]): 'critical' | 'high' | 'medium' | 'low' | 'none' {
    if (findings.some(f => f.severity === 'critical')) return 'critical';
    if (findings.some(f => f.severity === 'high')) return 'high';
    if (findings.some(f => f.severity === 'medium')) return 'medium';
    if (findings.some(f => f.severity === 'low')) return 'low';
    return 'none';
  }

  /**
   * Store review result in memory
   */
  private async storeReviewResult(
    request: ReviewRequest,
    summary: ReviewSummary,
    issues: ReviewIssue[]
  ): Promise<void> {
    try {
      const content = `Code Review Result:
Request ID: ${request.id}
Type: ${request.type}
Files: ${request.files.join(', ')}
Summary: ${summary.text}
Score: ${summary.score}/100
Total Issues: ${summary.totalIssues}
Critical: ${summary.bySeverity.critical}
High: ${summary.bySeverity.high}
Medium: ${summary.bySeverity.medium}
Low: ${summary.bySeverity.low}`;

      await this.engine.store(content, {
        tags: ['codex', 'review', request.type],
        importance: summary.score < 50 ? 0.9 : 0.6
      });

      // Store critical issues separately for learning
      for (const issue of issues.filter(i => i.severity === 'critical')) {
        await this.engine.store(
          `Critical Issue: ${issue.title} in ${issue.file}:${issue.line}\n${issue.description}`,
          {
            tags: ['codex', 'review', 'critical', issue.category],
            importance: 0.9
          }
        );
      }
    } catch {
      // Ignore storage errors
    }
  }

  // ===========================================================================
  // Configuration
  // ===========================================================================

  /**
   * Update configuration
   */
  setConfig(config: Partial<ExtendedReviewConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Set capabilities manager
   */
  setCapabilities(capabilities: CapabilitiesManager): void {
    this.capabilities = capabilities;
  }

  /**
   * Set Playwright for test verification
   */
  setPlaywright(playwright: PlaywrightManager, verifier: VerificationService): void {
    this._playwright = playwright;
    this.verifier = verifier;
  }

  /**
   * Get current configuration
   */
  getConfig(): ExtendedReviewConfig {
    return { ...this.config };
  }

  /**
   * Get Playwright manager (for advanced verification)
   */
  getPlaywright(): PlaywrightManager | undefined {
    return this._playwright;
  }
}

export default CodeReviewer;
