/**
 * Post-Execution Guardian
 *
 * Post-write audit system with rollback capability.
 * Runs after EXECUTOR phase to catch issues before completion.
 *
 * Capabilities:
 * - Security audit on written files
 * - Regression testing (run test suite)
 * - Diff analysis (what changed and is it safe?)
 * - Type checking on modified files
 * - Linting on modified files
 * - Git-based rollback if issues found
 */

import { randomUUID } from 'crypto';
import * as path from 'path';
import * as fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createHash } from 'crypto';

import type { CodeReviewer } from '../review/CodeReviewer.js';
import type { CapabilitiesManager } from '../capabilities/CapabilitiesManager.js';
import type { MemoryEngine } from '../core/MemoryEngine.js';

import {
  type AuditResult,
  type AuditIssue,
  type AuditSeverity,
  type AuditCategory,
  type AuditSummary,
  type AuditPhase,
  type AuditContext,
  type RollbackResult,
  type RollbackMethod,
  type PreWriteSnapshot,
  type SnapshotFile,
  type GuardianConfig,
  type GuardianStats,
  type SecurityPattern,
  DEFAULT_GUARDIAN_CONFIG
} from './types.js';

const execAsync = promisify(exec);

/**
 * Security patterns for direct scanning
 */
const SECURITY_PATTERNS: SecurityPattern[] = [
  {
    id: 'eval-usage',
    name: 'Unsafe eval usage',
    pattern: /\beval\s*\(/g,
    severity: 'critical',
    description: 'eval() can execute arbitrary code and is a major security risk',
    suggestion: 'Use JSON.parse() for data or Function constructor for controlled execution',
    blocking: true
  },
  {
    id: 'hardcoded-secret',
    name: 'Hardcoded secret',
    pattern: /(api[_-]?key|password|secret|token)\s*[:=]\s*['"`][^'"`]{8,}/gi,
    severity: 'critical',
    description: 'Hardcoded credentials can be exposed in version control',
    suggestion: 'Use environment variables or a secrets manager',
    blocking: true
  },
  {
    id: 'sql-injection',
    name: 'Potential SQL injection',
    pattern: /(?:query|execute)\s*\(\s*[`'"].*\$\{/g,
    severity: 'high',
    description: 'String interpolation in SQL queries can lead to SQL injection',
    suggestion: 'Use parameterized queries or prepared statements',
    blocking: true
  },
  {
    id: 'command-injection',
    name: 'Potential command injection',
    pattern: /(?:exec|spawn|execSync|spawnSync)\s*\(\s*[`'"].*\$\{/g,
    severity: 'critical',
    description: 'String interpolation in shell commands can lead to command injection',
    suggestion: 'Use parameterized commands or validate/escape input',
    blocking: true
  },
  {
    id: 'path-traversal',
    name: 'Potential path traversal',
    pattern: /(?:readFile|writeFile|readdir|unlink)\s*\([^)]*(?:\+|concat|\$\{)/g,
    severity: 'high',
    description: 'Dynamic file paths can lead to directory traversal attacks',
    suggestion: 'Validate and sanitize file paths, use path.resolve with allowlist',
    blocking: true
  },
  {
    id: 'insecure-random',
    name: 'Insecure random number generator',
    pattern: /Math\.random\s*\(\)/g,
    severity: 'medium',
    description: 'Math.random() is not cryptographically secure',
    suggestion: 'Use crypto.randomBytes() or crypto.randomUUID() for security-sensitive operations',
    fileTypes: ['.ts', '.js', '.tsx', '.jsx'],
    blocking: false
  },
  {
    id: 'disabled-ssl',
    name: 'SSL verification disabled',
    pattern: /rejectUnauthorized\s*:\s*false/g,
    severity: 'high',
    description: 'Disabling SSL verification enables man-in-the-middle attacks',
    suggestion: 'Enable SSL verification or properly configure certificates',
    blocking: true
  },
  {
    id: 'cors-wildcard',
    name: 'CORS wildcard origin',
    pattern: /(?:Access-Control-Allow-Origin|origin)\s*[:=]\s*['"`]\*['"`]/g,
    severity: 'medium',
    description: 'Wildcard CORS allows any origin to access resources',
    suggestion: 'Specify allowed origins explicitly',
    blocking: false
  },
  {
    id: 'innerHTML',
    name: 'Unsafe innerHTML usage',
    pattern: /\.innerHTML\s*=/g,
    severity: 'high',
    description: 'innerHTML can introduce XSS vulnerabilities',
    suggestion: 'Use textContent for text or sanitize HTML content',
    fileTypes: ['.ts', '.tsx', '.js', '.jsx'],
    blocking: true
  },
  {
    id: 'dangerouslySetInnerHTML',
    name: 'React dangerouslySetInnerHTML',
    pattern: /dangerouslySetInnerHTML/g,
    severity: 'high',
    description: 'dangerouslySetInnerHTML can introduce XSS vulnerabilities',
    suggestion: 'Sanitize content with DOMPurify or similar library',
    fileTypes: ['.tsx', '.jsx'],
    blocking: true
  }
];

/**
 * PostExecGuardian - Post-write audit system
 */
export class PostExecGuardian {
  private codeReviewer: CodeReviewer | undefined;
  private capabilities: CapabilitiesManager | undefined;
  private memory: MemoryEngine | undefined;
  private config: GuardianConfig;
  private projectRoot: string;
  private stats: GuardianStats;
  private snapshots: Map<string, PreWriteSnapshot> = new Map();

  constructor(
    projectRoot: string,
    config: Partial<GuardianConfig> = {},
    codeReviewer?: CodeReviewer,
    capabilities?: CapabilitiesManager,
    memory?: MemoryEngine
  ) {
    this.projectRoot = projectRoot;
    this.config = { ...DEFAULT_GUARDIAN_CONFIG, ...config };
    this.codeReviewer = codeReviewer;
    this.capabilities = capabilities;
    this.memory = memory;
    this.stats = this.initStats();
  }

  /**
   * Initialize statistics
   */
  private initStats(): GuardianStats {
    return {
      totalAudits: 0,
      passedAudits: 0,
      failedAudits: 0,
      totalIssues: 0,
      issuesBySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      issuesByCategory: {
        security: 0,
        regression: 0,
        quality: 0,
        performance: 0,
        type_error: 0,
        lint: 0,
        style: 0,
        complexity: 0,
        duplication: 0,
        deprecated: 0,
        compatibility: 0,
        other: 0
      },
      rollbacksPerformed: 0,
      successfulRollbacks: 0,
      avgAuditDurationMs: 0,
      topIssues: []
    };
  }

  // ===========================================================================
  // Snapshot Management
  // ===========================================================================

  /**
   * Create a pre-write snapshot for rollback capability
   */
  async createSnapshot(
    taskId: string,
    subtaskId: string,
    files: string[]
  ): Promise<PreWriteSnapshot> {
    const id = randomUUID();
    const snapshotFiles: SnapshotFile[] = [];

    for (const file of files) {
      const absolutePath = this.resolvePath(file);

      try {
        const exists = await this.fileExists(absolutePath);

        if (exists) {
          const content = await fs.readFile(absolutePath, 'utf-8');
          const contentHash = createHash('sha256').update(content).digest('hex');

          // For small files, store content directly
          if (content.length < 100 * 1024) { // 100KB threshold
            snapshotFiles.push({
              path: file,
              contentHash,
              existed: true,
              content
            });
          } else {
            // For large files, create a backup
            const backupPath = path.join(this.projectRoot, '.guardian-backup', id, file);
            await fs.mkdir(path.dirname(backupPath), { recursive: true });
            await fs.writeFile(backupPath, content);

            snapshotFiles.push({
              path: file,
              contentHash,
              existed: true,
              backupPath
            });
          }
        } else {
          snapshotFiles.push({
            path: file,
            contentHash: '',
            existed: false
          });
        }
      } catch {
        // File doesn't exist or can't be read
        snapshotFiles.push({
          path: file,
          contentHash: '',
          existed: false
        });
      }
    }

    // Also try to create a git stash
    let stashRef: string | undefined;
    try {
      const { stdout } = await execAsync('git stash create', { cwd: this.projectRoot });
      if (stdout.trim()) {
        stashRef = stdout.trim();
      }
    } catch {
      // Git not available or not in a git repo
    }

    const snapshot: PreWriteSnapshot = {
      id,
      files: snapshotFiles,
      stashRef,
      createdAt: new Date(),
      taskId,
      subtaskId
    };

    this.snapshots.set(id, snapshot);
    return snapshot;
  }

  /**
   * Get a snapshot by ID
   */
  getSnapshot(id: string): PreWriteSnapshot | undefined {
    return this.snapshots.get(id);
  }

  /**
   * Clean up old snapshots
   */
  async cleanupSnapshots(maxAge: number = 24 * 60 * 60 * 1000): Promise<number> {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, snapshot] of this.snapshots) {
      if (now - snapshot.createdAt.getTime() > maxAge) {
        // Clean up backup files
        for (const file of snapshot.files) {
          if (file.backupPath) {
            try {
              await fs.unlink(file.backupPath);
            } catch {
              // Ignore cleanup errors
            }
          }
        }

        this.snapshots.delete(id);
        cleaned++;
      }
    }

    // Clean up backup directory
    try {
      const backupDir = path.join(this.projectRoot, '.guardian-backup');
      const entries = await fs.readdir(backupDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory() && !this.snapshots.has(entry.name)) {
          await fs.rm(path.join(backupDir, entry.name), { recursive: true, force: true });
        }
      }
    } catch {
      // Backup directory doesn't exist or can't be read
    }

    return cleaned;
  }

  // ===========================================================================
  // Main Audit Entry Point
  // ===========================================================================

  /**
   * Main audit entry point - run after EXECUTOR phase
   */
  async audit(context: AuditContext): Promise<AuditResult> {
    const startTime = Date.now();
    const issues: AuditIssue[] = [];
    const phasesCompleted: AuditPhase[] = [];

    const allFiles = [
      ...context.filesWritten,
      ...context.filesModified
    ];

    // Filter files based on config
    const filesToAudit = this.filterFiles(allFiles);

    console.log(`[Guardian] Auditing ${filesToAudit.length} files...`);

    // Run audit phases
    if (this.config.securityAudit) {
      const securityIssues = await this.securityAudit(filesToAudit);
      issues.push(...securityIssues);
      phasesCompleted.push('security');
      console.log(`[Guardian] Security audit: ${securityIssues.length} issues`);
    }

    if (this.config.diffAnalysis && context.snapshot) {
      const diffIssues = await this.diffAnalysis(filesToAudit, context.snapshot);
      issues.push(...diffIssues);
      phasesCompleted.push('diff_analysis');
      console.log(`[Guardian] Diff analysis: ${diffIssues.length} issues`);
    }

    if (this.config.typeCheck && this.capabilities) {
      const typeIssues = await this.typeCheck(filesToAudit);
      issues.push(...typeIssues);
      phasesCompleted.push('type_check');
      console.log(`[Guardian] Type check: ${typeIssues.length} issues`);
    }

    if (this.config.lintCheck && this.capabilities) {
      const lintIssues = await this.lintCheck(filesToAudit);
      issues.push(...lintIssues);
      phasesCompleted.push('lint');
      console.log(`[Guardian] Lint check: ${lintIssues.length} issues`);
    }

    if (this.config.qualityAudit) {
      const qualityIssues = await this.qualityAudit(filesToAudit);
      issues.push(...qualityIssues);
      phasesCompleted.push('quality');
      console.log(`[Guardian] Quality audit: ${qualityIssues.length} issues`);
    }

    if (this.config.regressionCheck) {
      const regressionIssues = await this.regressionCheck(context);
      issues.push(...regressionIssues);
      phasesCompleted.push('regression');
      console.log(`[Guardian] Regression check: ${regressionIssues.length} issues`);
    }

    // Generate summary
    const summary = this.generateSummary(issues);

    // Determine if rollback is required
    const { rollbackRequired, rollbackReason } = this.determineRollback(issues);

    const duration = Date.now() - startTime;

    // Update stats
    this.updateStats(issues, duration, !rollbackRequired);

    // Store audit result in memory
    await this.storeAuditResult(context, issues, summary, rollbackRequired);

    const result: AuditResult = {
      passed: !rollbackRequired,
      issues,
      rollbackRequired,
      rollbackReason,
      filesAudited: filesToAudit,
      filesModified: context.filesModified,
      auditDurationMs: duration,
      auditedAt: new Date(),
      phasesCompleted,
      summary
    };

    console.log(`[Guardian] Audit complete: ${result.passed ? 'PASSED' : 'FAILED'} (${issues.length} issues, ${duration}ms)`);

    return result;
  }

  /**
   * Filter files based on configuration
   */
  private filterFiles(files: string[]): string[] {
    return files.filter(file => {
      const normalizedFile = file.replace(/\\/g, '/');

      // Check skip patterns
      for (const pattern of this.config.skipPatterns) {
        if (this.matchGlob(normalizedFile, pattern)) {
          return false;
        }
      }

      // Check file size
      try {
        const absolutePath = this.resolvePath(file);
        const stats = require('fs').statSync(absolutePath);
        if (stats.size > this.config.maxFileSize) {
          return false;
        }
      } catch {
        // File doesn't exist, include it anyway
      }

      return true;
    });
  }

  /**
   * Simple glob matching
   */
  private matchGlob(file: string, pattern: string): boolean {
    const regexPattern = pattern
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\./g, '\\.');

    return new RegExp(`^${regexPattern}$`, 'i').test(file);
  }

  // ===========================================================================
  // Security Audit
  // ===========================================================================

  /**
   * Security-focused scan on written files
   */
  async securityAudit(files: string[]): Promise<AuditIssue[]> {
    const issues: AuditIssue[] = [];

    // If we have CodeReviewer, use its security scanning
    if (this.codeReviewer) {
      try {
        const result = await this.codeReviewer.securityReview(files);

        for (const finding of result.findings) {
          issues.push({
            id: randomUUID(),
            severity: finding.severity,
            category: 'security',
            file: finding.file,
            line: finding.line,
            message: `${finding.title}: ${finding.description}`,
            codeSnippet: finding.snippet,
            suggestion: finding.remediation,
            rule: finding.type,
            blocking: finding.severity === 'critical' || finding.severity === 'high',
            autoFixable: false
          });
        }
      } catch (error) {
        console.warn('[Guardian] CodeReviewer security scan failed:', error);
      }
    }

    // Also run our own pattern matching
    for (const file of files) {
      const absolutePath = this.resolvePath(file);

      try {
        const content = await fs.readFile(absolutePath, 'utf-8');
        const ext = path.extname(file);

        for (const pattern of SECURITY_PATTERNS) {
          // Check file type filter
          if (pattern.fileTypes && !pattern.fileTypes.includes(ext)) {
            continue;
          }

          const matches = content.matchAll(new RegExp(pattern.pattern));

          for (const match of matches) {
            const matchIndex = match.index ?? 0;
            const lineNumber = content.substring(0, matchIndex).split('\n').length;

            // Extract code snippet
            const lines = content.split('\n');
            const snippetStart = Math.max(0, lineNumber - 2);
            const snippetEnd = Math.min(lines.length, lineNumber + 2);
            const snippet = lines.slice(snippetStart, snippetEnd).join('\n');

            // Check for duplicate (CodeReviewer might have found it)
            const isDuplicate = issues.some(
              i => i.file === file && i.line === lineNumber && i.rule === pattern.id
            );

            if (!isDuplicate) {
              issues.push({
                id: randomUUID(),
                severity: pattern.severity,
                category: 'security',
                file,
                line: lineNumber,
                message: `${pattern.name}: ${pattern.description}`,
                codeSnippet: snippet,
                suggestion: pattern.suggestion,
                rule: pattern.id,
                blocking: pattern.blocking,
                autoFixable: false
              });
            }
          }
        }
      } catch {
        // File can't be read
      }
    }

    return issues;
  }

  // ===========================================================================
  // Regression Check
  // ===========================================================================

  /**
   * Run tests to check for regressions
   */
  async regressionCheck(_context: AuditContext): Promise<AuditIssue[]> {
    const issues: AuditIssue[] = [];

    try {
      // Detect and run test command
      const testCommand = this.config.testCommand || await this.detectTestCommand();

      if (!testCommand) {
        console.log('[Guardian] No test runner detected, skipping regression check');
        return issues;
      }

      console.log(`[Guardian] Running tests: ${testCommand}`);

      try {
        await execAsync(testCommand, {
          cwd: this.projectRoot,
          timeout: this.config.testTimeout
        });

        // Tests passed
        console.log('[Guardian] Tests passed');
      } catch (error) {
        // Tests failed
        const err = error as { stdout?: string; stderr?: string; message?: string };

        issues.push({
          id: randomUUID(),
          severity: 'high',
          category: 'regression',
          file: '',
          message: 'Test suite failed after code changes',
          codeSnippet: (err.stdout || err.stderr || err.message || '').substring(0, 1000),
          suggestion: 'Review test failures and fix breaking changes',
          rule: 'test-failure',
          blocking: true,
          autoFixable: false
        });

        // Try to parse individual test failures
        const testFailures = this.parseTestFailures(err.stdout || err.stderr || '');
        issues.push(...testFailures);
      }
    } catch (error) {
      console.warn('[Guardian] Regression check failed:', error);
    }

    return issues;
  }

  /**
   * Detect test command from package.json
   */
  private async detectTestCommand(): Promise<string | null> {
    try {
      const pkgPath = path.join(this.projectRoot, 'package.json');
      const pkgContent = await fs.readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(pkgContent);

      if (pkg.scripts?.test) {
        return 'npm test';
      }

      // Check for common test runners
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };

      if (deps['vitest']) return 'npx vitest run';
      if (deps['jest']) return 'npx jest';
      if (deps['mocha']) return 'npx mocha';
      if (deps['ava']) return 'npx ava';

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Parse test failures from output
   */
  private parseTestFailures(output: string): AuditIssue[] {
    const issues: AuditIssue[] = [];

    // Parse Jest/Vitest style failures
    const failurePattern = /FAIL\s+(\S+)/g;
    let match;

    while ((match = failurePattern.exec(output)) !== null) {
      const testFile = match[1];

      issues.push({
        id: randomUUID(),
        severity: 'high',
        category: 'regression',
        file: testFile,
        message: `Test file failed: ${testFile}`,
        rule: 'test-file-failure',
        blocking: true,
        autoFixable: false
      });
    }

    // Parse assertion failures
    const assertionPattern = /expect\(.*?\)\.[\w]+\(.*?\)/g;
    while ((match = assertionPattern.exec(output)) !== null) {
      issues.push({
        id: randomUUID(),
        severity: 'medium',
        category: 'regression',
        file: '',
        message: `Assertion failed: ${match[0].substring(0, 100)}`,
        rule: 'assertion-failure',
        blocking: false,
        autoFixable: false
      });
    }

    return issues;
  }

  // ===========================================================================
  // Diff Analysis
  // ===========================================================================

  /**
   * Diff analysis - what changed and is it safe?
   */
  async diffAnalysis(files: string[], snapshot: PreWriteSnapshot): Promise<AuditIssue[]> {
    const issues: AuditIssue[] = [];

    for (const file of files) {
      const snapshotFile = snapshot.files.find(f => f.path === file);

      if (!snapshotFile) {
        // New file, not in snapshot
        continue;
      }

      const absolutePath = this.resolvePath(file);

      try {
        const newContent = await fs.readFile(absolutePath, 'utf-8');

        // Get old content
        let oldContent = '';
        if (snapshotFile.content) {
          oldContent = snapshotFile.content;
        } else if (snapshotFile.backupPath) {
          oldContent = await fs.readFile(snapshotFile.backupPath, 'utf-8');
        }

        // Check for large changes
        const oldLines = oldContent.split('\n').length;
        const newLines = newContent.split('\n').length;
        const changeRatio = Math.abs(newLines - oldLines) / Math.max(oldLines, 1);

        if (changeRatio > 0.5 && Math.abs(newLines - oldLines) > 50) {
          issues.push({
            id: randomUUID(),
            severity: 'medium',
            category: 'quality',
            file,
            message: `Large change detected: ${Math.abs(newLines - oldLines)} lines ${newLines > oldLines ? 'added' : 'removed'} (${(changeRatio * 100).toFixed(1)}% change)`,
            suggestion: 'Large changes increase risk of bugs. Consider breaking into smaller commits.',
            rule: 'large-change',
            blocking: false,
            autoFixable: false
          });
        }

        // Check for deleted exports (potential breaking change)
        const exportPattern = /export\s+(?:const|function|class|type|interface|enum)\s+(\w+)/g;
        const oldExports = new Set([...oldContent.matchAll(exportPattern)].map(m => m[1]));
        const newExports = new Set([...newContent.matchAll(exportPattern)].map(m => m[1]));

        for (const exp of oldExports) {
          if (!newExports.has(exp)) {
            issues.push({
              id: randomUUID(),
              severity: 'high',
              category: 'compatibility',
              file,
              message: `Removed export: ${exp}`,
              suggestion: 'Removing exports can break dependent code. Consider deprecation warning first.',
              rule: 'removed-export',
              blocking: true,
              autoFixable: false
            });
          }
        }

        // Check for console.log additions (debugging code)
        if (!oldContent.includes('console.log') && newContent.includes('console.log')) {
          issues.push({
            id: randomUUID(),
            severity: 'low',
            category: 'quality',
            file,
            message: 'console.log added to production code',
            suggestion: 'Remove debugging statements before committing',
            rule: 'console-log',
            blocking: false,
            autoFixable: true
          });
        }

        // Check for TODO/FIXME additions
        const todoPattern = /(?:\/\/|\/\*|\*)\s*(TODO|FIXME|HACK|XXX)[\s:]/gi;
        const oldTodos = [...oldContent.matchAll(todoPattern)].length;
        const newTodos = [...newContent.matchAll(todoPattern)].length;

        if (newTodos > oldTodos) {
          issues.push({
            id: randomUUID(),
            severity: 'info',
            category: 'quality',
            file,
            message: `${newTodos - oldTodos} new TODO/FIXME comment(s) added`,
            suggestion: 'Ensure TODOs are tracked in issue tracker',
            rule: 'todo-added',
            blocking: false,
            autoFixable: false
          });
        }
      } catch {
        // File can't be read
      }
    }

    return issues;
  }

  // ===========================================================================
  // Type Check
  // ===========================================================================

  /**
   * Run TypeScript type checking on files
   */
  async typeCheck(files: string[]): Promise<AuditIssue[]> {
    const issues: AuditIssue[] = [];

    if (!this.capabilities) return issues;

    const tsFiles = files.filter(f =>
      f.endsWith('.ts') || f.endsWith('.tsx')
    );

    if (tsFiles.length === 0) return issues;

    try {
      const results = await this.capabilities.runTypeCheck(tsFiles);

      for (const result of results) {
        for (const error of result.errors) {
          issues.push({
            id: randomUUID(),
            severity: 'high',
            category: 'type_error',
            file: result.file,
            line: error.line,
            column: error.column,
            message: error.message,
            rule: `TS${error.code}`,
            blocking: true,
            autoFixable: false
          });
        }

        for (const warning of result.warnings) {
          issues.push({
            id: randomUUID(),
            severity: 'medium',
            category: 'type_error',
            file: result.file,
            line: warning.line,
            column: warning.column,
            message: warning.message,
            rule: `TS${warning.code}`,
            blocking: false,
            autoFixable: false
          });
        }
      }
    } catch (error) {
      console.warn('[Guardian] Type check failed:', error);
    }

    return issues;
  }

  // ===========================================================================
  // Lint Check
  // ===========================================================================

  /**
   * Run linting on files
   */
  async lintCheck(files: string[]): Promise<AuditIssue[]> {
    const issues: AuditIssue[] = [];

    if (!this.capabilities) return issues;

    const lintableFiles = files.filter(f =>
      f.endsWith('.ts') || f.endsWith('.tsx') ||
      f.endsWith('.js') || f.endsWith('.jsx')
    );

    if (lintableFiles.length === 0) return issues;

    try {
      const results = await this.capabilities.runLint(lintableFiles);

      for (const result of results) {
        for (const msg of result.messages) {
          issues.push({
            id: randomUUID(),
            severity: msg.severity === 'error' ? 'medium' : 'low',
            category: 'lint',
            file: result.file,
            line: msg.line,
            column: msg.column,
            message: msg.message,
            rule: msg.ruleId || 'unknown',
            blocking: false,
            autoFixable: msg.fix !== undefined
          });
        }
      }
    } catch (error) {
      console.warn('[Guardian] Lint check failed:', error);
    }

    return issues;
  }

  // ===========================================================================
  // Quality Audit
  // ===========================================================================

  /**
   * Quality-focused audit
   */
  async qualityAudit(files: string[]): Promise<AuditIssue[]> {
    const issues: AuditIssue[] = [];

    for (const file of files) {
      const absolutePath = this.resolvePath(file);

      try {
        const content = await fs.readFile(absolutePath, 'utf-8');
        const lines = content.split('\n');

        // Check for very long functions (simple heuristic)
        let functionStart = -1;
        let braceCount = 0;
        let inFunction = false;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];

          if (/(?:function|=>|async\s+function)/.test(line) && !inFunction) {
            functionStart = i;
            inFunction = true;
            braceCount = 0;
          }

          if (inFunction) {
            braceCount += (line.match(/\{/g) || []).length;
            braceCount -= (line.match(/\}/g) || []).length;

            if (braceCount === 0 && functionStart !== -1) {
              const functionLength = i - functionStart + 1;

              if (functionLength > 100) {
                issues.push({
                  id: randomUUID(),
                  severity: 'medium',
                  category: 'complexity',
                  file,
                  line: functionStart + 1,
                  message: `Function is ${functionLength} lines long`,
                  suggestion: 'Consider breaking into smaller functions for better readability',
                  rule: 'long-function',
                  blocking: false,
                  autoFixable: false
                });
              }

              inFunction = false;
              functionStart = -1;
            }
          }
        }

        // Check for very long lines
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].length > 200) {
            issues.push({
              id: randomUUID(),
              severity: 'low',
              category: 'style',
              file,
              line: i + 1,
              message: `Line is ${lines[i].length} characters long`,
              suggestion: 'Break long lines for better readability',
              rule: 'long-line',
              blocking: false,
              autoFixable: false
            });
          }
        }

        // Check for deeply nested code
        let maxIndent = 0;
        for (const line of lines) {
          const indent = line.match(/^(\s*)/)?.[1].length || 0;
          maxIndent = Math.max(maxIndent, indent);
        }

        if (maxIndent > 32) { // More than 8 levels at 4 spaces
          issues.push({
            id: randomUUID(),
            severity: 'medium',
            category: 'complexity',
            file,
            message: `Deep nesting detected (${Math.floor(maxIndent / 4)} levels)`,
            suggestion: 'Reduce nesting with early returns or function extraction',
            rule: 'deep-nesting',
            blocking: false,
            autoFixable: false
          });
        }
      } catch {
        // File can't be read
      }
    }

    return issues;
  }

  // ===========================================================================
  // Rollback
  // ===========================================================================

  /**
   * Rollback via git or file restore
   */
  async rollback(context: AuditContext): Promise<RollbackResult> {
    let method: RollbackMethod = 'file_backup';
    const filesRestored: string[] = [];
    const filesFailed: string[] = [];

    try {
      // Try git stash pop first if we have a stash ref
      if (context.snapshot?.stashRef) {
        try {
          await execAsync(`git stash apply ${context.snapshot.stashRef}`, {
            cwd: this.projectRoot
          });

          method = 'git_stash';

          // Mark all files as restored
          for (const file of context.snapshot.files) {
            filesRestored.push(file.path);
          }

          this.stats.rollbacksPerformed++;
          this.stats.successfulRollbacks++;

          return {
            success: true,
            filesRestored,
            filesFailed,
            method,
            rolledBackAt: new Date(),
            snapshotId: context.snapshot.id
          };
        } catch {
          console.log('[Guardian] Git stash apply failed, falling back to file restore');
        }
      }

      // Fall back to file-by-file restore
      if (context.snapshot) {
        for (const file of context.snapshot.files) {
          const absolutePath = this.resolvePath(file.path);

          try {
            if (!file.existed) {
              // File was created, delete it
              await fs.unlink(absolutePath);
              filesRestored.push(file.path);
            } else if (file.content) {
              // Restore from inline content
              await fs.writeFile(absolutePath, file.content);
              filesRestored.push(file.path);
            } else if (file.backupPath) {
              // Restore from backup
              const backupContent = await fs.readFile(file.backupPath, 'utf-8');
              await fs.writeFile(absolutePath, backupContent);
              filesRestored.push(file.path);
            }
          } catch (error) {
            console.warn(`[Guardian] Failed to restore ${file.path}:`, error);
            filesFailed.push(file.path);
          }
        }
      }

      // Try git checkout as last resort
      if (filesFailed.length > 0) {
        for (const file of filesFailed) {
          try {
            await execAsync(`git checkout -- "${file}"`, { cwd: this.projectRoot });
            filesFailed.splice(filesFailed.indexOf(file), 1);
            filesRestored.push(file);
            method = 'git_checkout';
          } catch {
            // Can't restore this file
          }
        }
      }

      this.stats.rollbacksPerformed++;
      if (filesFailed.length === 0) {
        this.stats.successfulRollbacks++;
      }

      return {
        success: filesFailed.length === 0,
        filesRestored,
        filesFailed,
        method,
        rolledBackAt: new Date(),
        snapshotId: context.snapshot?.id,
        error: filesFailed.length > 0 ? `Failed to restore ${filesFailed.length} files` : undefined
      };
    } catch (error) {
      this.stats.rollbacksPerformed++;

      return {
        success: false,
        filesRestored,
        filesFailed: context.snapshot?.files.map(f => f.path) || [],
        method: 'manual',
        error: error instanceof Error ? error.message : 'Unknown error',
        rolledBackAt: new Date()
      };
    }
  }

  // ===========================================================================
  // Veto Power
  // ===========================================================================

  /**
   * Veto power - can block completion
   */
  canComplete(result: AuditResult): boolean {
    // If rollback required, can't complete
    if (result.rollbackRequired) {
      return false;
    }

    // Check blocking issues
    const blockingIssues = result.issues.filter(i => i.blocking);
    if (blockingIssues.length > 0) {
      return false;
    }

    // Check severity threshold
    const severityOrder: AuditSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];
    const thresholdIndex = severityOrder.indexOf(this.config.blockingSeverity);

    for (let i = 0; i <= thresholdIndex; i++) {
      if (result.summary.bySeverity[severityOrder[i]] > 0) {
        return false;
      }
    }

    // Check max issues threshold
    if (result.issues.length > this.config.maxIssuesBeforeBlock) {
      return false;
    }

    return true;
  }

  /**
   * Determine if rollback is required
   */
  private determineRollback(issues: AuditIssue[]): {
    rollbackRequired: boolean;
    rollbackReason?: string;
  } {
    // Auto-rollback on critical issues
    if (this.config.autoRollbackOnCritical) {
      const criticalIssues = issues.filter(i => i.severity === 'critical');
      if (criticalIssues.length > 0) {
        return {
          rollbackRequired: true,
          rollbackReason: `${criticalIssues.length} critical issue(s): ${criticalIssues[0].message}`
        };
      }
    }

    // Check blocking issues at threshold severity
    const severityOrder: AuditSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];
    const thresholdIndex = severityOrder.indexOf(this.config.blockingSeverity);

    for (let i = 0; i <= thresholdIndex; i++) {
      const issuesAtSeverity = issues.filter(
        issue => issue.severity === severityOrder[i] && issue.blocking
      );

      if (issuesAtSeverity.length > 0) {
        return {
          rollbackRequired: true,
          rollbackReason: `Blocking ${severityOrder[i]} issue: ${issuesAtSeverity[0].message}`
        };
      }
    }

    return { rollbackRequired: false };
  }

  // ===========================================================================
  // Summary & Stats
  // ===========================================================================

  /**
   * Generate audit summary
   */
  private generateSummary(issues: AuditIssue[]): AuditSummary {
    const bySeverity: Record<AuditSeverity, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0
    };

    const byCategory: Record<AuditCategory, number> = {
      security: 0,
      regression: 0,
      quality: 0,
      performance: 0,
      type_error: 0,
      lint: 0,
      style: 0,
      complexity: 0,
      duplication: 0,
      deprecated: 0,
      compatibility: 0,
      other: 0
    };

    let blockingIssues = 0;
    let autoFixableIssues = 0;

    for (const issue of issues) {
      bySeverity[issue.severity]++;
      byCategory[issue.category]++;
      if (issue.blocking) blockingIssues++;
      if (issue.autoFixable) autoFixableIssues++;
    }

    return {
      totalIssues: issues.length,
      bySeverity,
      byCategory,
      blockingIssues,
      autoFixableIssues
    };
  }

  /**
   * Update statistics
   */
  private updateStats(issues: AuditIssue[], durationMs: number, passed: boolean): void {
    this.stats.totalAudits++;
    if (passed) {
      this.stats.passedAudits++;
    } else {
      this.stats.failedAudits++;
    }

    this.stats.totalIssues += issues.length;

    for (const issue of issues) {
      this.stats.issuesBySeverity[issue.severity]++;
      this.stats.issuesByCategory[issue.category]++;
    }

    // Update average duration
    this.stats.avgAuditDurationMs = (
      (this.stats.avgAuditDurationMs * (this.stats.totalAudits - 1)) + durationMs
    ) / this.stats.totalAudits;

    // Update top issues
    const ruleCounts = new Map<string, number>();
    for (const issue of issues) {
      if (issue.rule) {
        ruleCounts.set(issue.rule, (ruleCounts.get(issue.rule) || 0) + 1);
      }
    }

    this.stats.topIssues = Array.from(ruleCounts.entries())
      .map(([rule, count]) => ({ rule, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  /**
   * Store audit result in memory
   */
  private async storeAuditResult(
    context: AuditContext,
    issues: AuditIssue[],
    summary: AuditSummary,
    rollbackRequired: boolean
  ): Promise<void> {
    if (!this.memory) return;

    try {
      const content = `Guardian Audit Result:
Task: ${context.taskId}
Subtask: ${context.subtaskId}
Passed: ${!rollbackRequired}
Total Issues: ${summary.totalIssues}
Critical: ${summary.bySeverity.critical}
High: ${summary.bySeverity.high}
Medium: ${summary.bySeverity.medium}
Files Audited: ${context.filesModified.length + context.filesWritten.length}
${rollbackRequired ? `Rollback Required: Yes` : ''}`;

      await this.memory.store(content, {
        tags: ['guardian', 'audit', rollbackRequired ? 'failed' : 'passed'],
        importance: rollbackRequired ? 0.9 : 0.5
      });

      // Store critical issues separately
      for (const issue of issues.filter(i => i.severity === 'critical')) {
        await this.memory.store(
          `Critical Issue: ${issue.message} in ${issue.file}:${issue.line || 0}\n${issue.suggestion || ''}`,
          {
            tags: ['guardian', 'critical', issue.category],
            importance: 0.9
          }
        );
      }
    } catch {
      // Ignore storage errors
    }
  }

  // ===========================================================================
  // Utilities
  // ===========================================================================

  /**
   * Resolve file path to absolute
   */
  private resolvePath(file: string): string {
    return path.isAbsolute(file) ? file : path.join(this.projectRoot, file);
  }

  /**
   * Check if file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  // ===========================================================================
  // Configuration & Stats
  // ===========================================================================

  /**
   * Get statistics
   */
  getStats(): GuardianStats {
    return { ...this.stats };
  }

  /**
   * Get configuration
   */
  getConfig(): GuardianConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<GuardianConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Set CodeReviewer
   */
  setCodeReviewer(reviewer: CodeReviewer): void {
    this.codeReviewer = reviewer;
  }

  /**
   * Set CapabilitiesManager
   */
  setCapabilities(capabilities: CapabilitiesManager): void {
    this.capabilities = capabilities;
  }

  /**
   * Set MemoryEngine
   */
  setMemory(memory: MemoryEngine): void {
    this.memory = memory;
  }
}

export default PostExecGuardian;
