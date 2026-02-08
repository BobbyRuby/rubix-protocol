/**
 * StaticAnalyzer
 *
 * Static analysis using ESLint and TypeScript compiler.
 * Provides immediate feedback on code quality and type errors.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { glob } from 'glob';
import ts from 'typescript';

import type { AnalysisConfig } from '../types.js';
import type {
  LintResult,
  TypeCheckResult,
  AnalysisSummary
} from '../types.js';

/**
 * StaticAnalyzer - Static analysis operations
 */
export class StaticAnalyzer {
  private projectRoot: string;
  private config: AnalysisConfig;
  private tsProgram: ts.Program | null = null;
  private tsConfigPath: string | null = null;

  constructor(projectRoot: string, config: AnalysisConfig) {
    this.projectRoot = projectRoot;
    this.config = config;
  }

  /**
   * Initialize the analyzer
   */
  async initialize(): Promise<void> {
    // Find tsconfig.json
    const possiblePaths = [
      path.join(this.projectRoot, 'tsconfig.json'),
      path.join(this.projectRoot, 'tsconfig.build.json')
    ];

    for (const configPath of possiblePaths) {
      try {
        await fs.access(configPath);
        this.tsConfigPath = configPath;
        break;
      } catch {
        // Continue to next path
      }
    }

    if (this.config.typescript && this.tsConfigPath) {
      await this.initializeTypeScript();
    }
  }

  /**
   * Initialize TypeScript program
   */
  private async initializeTypeScript(): Promise<void> {
    if (!this.tsConfigPath) return;

    const configFile = ts.readConfigFile(this.tsConfigPath, ts.sys.readFile);
    if (configFile.error) {
      throw new Error(`Failed to read tsconfig: ${configFile.error.messageText}`);
    }

    const parsedConfig = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      this.projectRoot
    );

    this.tsProgram = ts.createProgram({
      rootNames: parsedConfig.fileNames,
      options: parsedConfig.options
    });
  }

  /**
   * Shutdown the analyzer
   */
  async shutdown(): Promise<void> {
    this.tsProgram = null;
  }

  /**
   * Run ESLint on files
   */
  async runLint(files?: string[]): Promise<LintResult[]> {
    if (!this.config.eslint) {
      return [];
    }

    const targetFiles = files ?? await this.getSourceFiles();
    const results: LintResult[] = [];

    try {
      // Dynamic import of ESLint to avoid issues if not installed
      const { ESLint } = await import('eslint');

      const eslint = new ESLint({
        cwd: this.projectRoot,
        overrideConfigFile: this.config.eslintConfig
      });

      const eslintResults = await eslint.lintFiles(targetFiles);

      for (const result of eslintResults) {
        const lintResult: LintResult = {
          file: path.relative(this.projectRoot, result.filePath),
          errorCount: result.errorCount,
          warningCount: result.warningCount,
          messages: result.messages.map(msg => ({
            ruleId: msg.ruleId ?? 'unknown',
            severity: msg.severity === 2 ? 'error' : 'warning',
            message: msg.message,
            line: msg.line,
            column: msg.column,
            endLine: msg.endLine,
            endColumn: msg.endColumn,
            fix: msg.fix ? {
              range: msg.fix.range as [number, number],
              text: msg.fix.text
            } : undefined
          }))
        };

        if (lintResult.errorCount > 0 || lintResult.warningCount > 0) {
          results.push(lintResult);
        }
      }
    } catch (error) {
      // ESLint not available or config error
      console.warn('ESLint analysis skipped:', error instanceof Error ? error.message : String(error));
    }

    return results;
  }

  /**
   * Run TypeScript type checking
   */
  async runTypeCheck(files?: string[]): Promise<TypeCheckResult[]> {
    if (!this.config.typescript || !this.tsProgram) {
      return [];
    }

    const results: TypeCheckResult[] = [];
    const targetFiles = new Set(files?.map(f => path.resolve(this.projectRoot, f)));

    // Get diagnostics
    const allDiagnostics = [
      ...this.tsProgram.getSemanticDiagnostics(),
      ...this.tsProgram.getSyntacticDiagnostics()
    ];

    // Group by file
    const diagnosticsByFile = new Map<string, ts.Diagnostic[]>();

    for (const diagnostic of allDiagnostics) {
      if (!diagnostic.file) continue;

      const filePath = diagnostic.file.fileName;

      // Filter to target files if specified
      if (targetFiles.size > 0 && !targetFiles.has(path.resolve(this.projectRoot, filePath))) {
        continue;
      }

      if (!diagnosticsByFile.has(filePath)) {
        diagnosticsByFile.set(filePath, []);
      }
      diagnosticsByFile.get(filePath)!.push(diagnostic);
    }

    // Convert to results
    for (const [filePath, diagnostics] of diagnosticsByFile) {
      const errors: TypeCheckResult['errors'] = [];
      const warnings: TypeCheckResult['warnings'] = [];

      for (const diagnostic of diagnostics) {
        const { line, character } = diagnostic.file!.getLineAndCharacterOfPosition(
          diagnostic.start ?? 0
        );

        const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');

        const entry = {
          code: diagnostic.code,
          message,
          line: line + 1,
          column: character + 1
        };

        if (diagnostic.category === ts.DiagnosticCategory.Error) {
          errors.push(entry);
        } else {
          warnings.push(entry);
        }
      }

      if (errors.length > 0 || warnings.length > 0) {
        results.push({
          file: path.relative(this.projectRoot, filePath),
          errors,
          warnings
        });
      }
    }

    return results;
  }

  /**
   * Run full analysis (lint + type check)
   */
  async analyze(files?: string[]): Promise<AnalysisSummary> {
    const [lintResults, typeResults] = await Promise.all([
      this.runLint(files),
      this.runTypeCheck(files)
    ]);

    let totalErrors = 0;
    let totalWarnings = 0;
    const allFiles = new Set<string>();

    for (const result of lintResults) {
      totalErrors += result.errorCount;
      totalWarnings += result.warningCount;
      allFiles.add(result.file);
    }

    for (const result of typeResults) {
      totalErrors += result.errors.length;
      totalWarnings += result.warnings.length;
      allFiles.add(result.file);
    }

    return {
      totalFiles: allFiles.size,
      totalErrors,
      totalWarnings,
      lintResults,
      typeResults
    };
  }

  /**
   * Get diagnostics for a specific file
   */
  async getFileDiagnostics(file: string): Promise<{
    lint: LintResult | null;
    types: TypeCheckResult | null;
  }> {
    const [lintResults, typeResults] = await Promise.all([
      this.runLint([file]),
      this.runTypeCheck([file])
    ]);

    return {
      lint: lintResults[0] ?? null,
      types: typeResults[0] ?? null
    };
  }

  /**
   * Fix auto-fixable ESLint issues
   */
  async fixLintIssues(files?: string[]): Promise<{
    fixedCount: number;
    remainingErrors: number;
  }> {
    if (!this.config.eslint) {
      return { fixedCount: 0, remainingErrors: 0 };
    }

    try {
      const { ESLint } = await import('eslint');

      const eslint = new ESLint({
        cwd: this.projectRoot,
        fix: true,
        overrideConfigFile: this.config.eslintConfig
      });

      const targetFiles = files ?? await this.getSourceFiles();
      const results = await eslint.lintFiles(targetFiles);

      // Write fixes
      await ESLint.outputFixes(results);

      // Count fixed and remaining
      let fixedCount = 0;
      let remainingErrors = 0;

      for (const result of results) {
        fixedCount += result.fixableErrorCount + result.fixableWarningCount;
        remainingErrors += result.errorCount - result.fixableErrorCount;
      }

      return { fixedCount, remainingErrors };
    } catch (error) {
      console.warn('ESLint fix skipped:', error instanceof Error ? error.message : String(error));
      return { fixedCount: 0, remainingErrors: 0 };
    }
  }

  /**
   * Get TypeScript project info
   */
  getTypeScriptInfo(): {
    version: string;
    target: string;
    module: string;
    files: number;
  } | null {
    if (!this.tsProgram) return null;

    const options = this.tsProgram.getCompilerOptions();
    const sourceFiles = this.tsProgram.getSourceFiles();

    return {
      version: ts.version,
      target: ts.ScriptTarget[options.target ?? ts.ScriptTarget.ES5],
      module: ts.ModuleKind[options.module ?? ts.ModuleKind.CommonJS],
      files: sourceFiles.filter(f => !f.isDeclarationFile).length
    };
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  private async getSourceFiles(): Promise<string[]> {
    const patterns = [
      path.join(this.projectRoot, 'src/**/*.ts'),
      path.join(this.projectRoot, 'src/**/*.tsx'),
      path.join(this.projectRoot, 'src/**/*.js'),
      path.join(this.projectRoot, 'src/**/*.jsx')
    ];

    const files: string[] = [];
    for (const pattern of patterns) {
      const matches = await glob(pattern, {
        ignore: ['**/node_modules/**', '**/*.d.ts']
      });
      files.push(...matches);
    }

    return files;
  }
}

export default StaticAnalyzer;
