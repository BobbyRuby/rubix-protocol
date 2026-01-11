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
 */

import { randomUUID } from 'crypto';
import * as path from 'path';
import * as fs from 'fs/promises';

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
  DEFAULT_REVIEW_CONFIG
} from './types.js';
import { JS_SECURITY_PATTERNS, getPatternsForExtension, isFalsePositive } from './SecurityPatterns.js';

/**
 * CodeReviewer - Automated code review engine
 */
export class CodeReviewer {
  private engine: MemoryEngine;
  private capabilities: CapabilitiesManager | undefined;
  private _playwright: PlaywrightManager | undefined;
  private verifier: VerificationService | undefined;
  private projectRoot: string;
  private config: ReviewConfig;

  constructor(
    engine: MemoryEngine,
    projectRoot: string,
    config: Partial<ReviewConfig> = {},
    capabilities?: CapabilitiesManager,
    playwright?: PlaywrightManager,
    verifier?: VerificationService
  ) {
    this.engine = engine;
    this.projectRoot = projectRoot;
    this.config = { ...DEFAULT_REVIEW_CONFIG, ...config };
    this.capabilities = capabilities;
    this._playwright = playwright;
    this.verifier = verifier;
  }

  /**
   * Perform a code review
   */
  async review(request: ReviewRequest): Promise<ReviewResult> {
    const startTime = Date.now();
    const config = { ...this.config, ...request.config };

    const issues: ReviewIssue[] = [];
    const securityFindings: SecurityFinding[] = [];
    const styleIssues: StyleIssue[] = [];
    const fileResults: FileReviewResult[] = [];
    const suggestedFixes: SuggestedFix[] = [];
    const notes: string[] = [];

    // Process each file
    for (const file of request.files) {
      const absolutePath = path.isAbsolute(file)
        ? file
        : path.join(this.projectRoot, file);

      try {
        const content = await fs.readFile(absolutePath, 'utf-8');
        const ext = path.extname(file);

        // Check if this is a sensitive file
        const isSensitive = this.isSensitiveFile(file, config);
        if (isSensitive) {
          notes.push(`Sensitive file flagged for review: ${file}`);
        }

        // Security scanning
        if (config.security) {
          const findings = await this.scanSecurity(file, content, ext);
          securityFindings.push(...findings);

          // Convert security findings to issues
          for (const finding of findings) {
            issues.push(this.securityFindingToIssue(finding));
          }
        }

        // Style/lint checking
        if (config.style && this.capabilities) {
          const styleResults = await this.checkStyle(file);
          styleIssues.push(...styleResults);

          // Convert style issues to general issues
          for (const style of styleResults) {
            issues.push(this.styleIssueToReviewIssue(style));
          }
        }

        // Logic review (type checking)
        if (config.logic && this.capabilities) {
          const logicIssues = await this.checkLogic(file);
          issues.push(...logicIssues);
        }

        // Calculate file metrics
        fileResults.push({
          file,
          issueCount: issues.filter(i => i.file === file).length,
          highestSeverity: this.getHighestSeverity(issues.filter(i => i.file === file)),
          isSensitive,
          linesAdded: this.estimateLinesChanged(request.diff, file, 'add'),
          linesRemoved: this.estimateLinesChanged(request.diff, file, 'remove')
        });
      } catch (error) {
        notes.push(`Failed to review ${file}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Test coverage check
    let testCoverage: TestCoverageResult | undefined;
    if (config.tests && this.verifier) {
      testCoverage = await this.checkTestCoverage();
    }

    // Generate suggested fixes
    for (const issue of issues) {
      const fix = await this.generateFix(issue);
      if (fix) {
        suggestedFixes.push(fix);
        issue.fix = fix;
      }
    }

    // Generate summary
    const summary = this.generateSummary(issues, securityFindings, styleIssues, fileResults);

    // Determine approval status
    const approval = this.determineApproval(issues, securityFindings, config);

    // Store review in memory
    await this.storeReviewResult(request, summary, issues);

    return {
      requestId: request.id,
      status: approval.approved ? 'approved' : 'changes_requested',
      summary,
      issues,
      security: securityFindings,
      style: styleIssues,
      tests: testCoverage,
      filesReviewed: fileResults,
      duration: Date.now() - startTime,
      notes,
      approval,
      suggestedFixes
    };
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
  setConfig(config: Partial<ReviewConfig>): void {
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
  getConfig(): ReviewConfig {
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
