/**
 * ReviewReportGenerator
 *
 * Generates code review reports in multiple formats:
 * - HTML: Interactive dashboard with charts and code snippets
 * - JSON: Structured data for programmatic use
 * - Markdown: Human-readable format for documentation
 */

import * as fs from 'fs/promises';
import * as path from 'path';

import {
  type ReviewResult,
  type ReviewIssue,
  type ReviewStatistics,
  type ReportOptions,
  type ReportFormat,
  type ReviewSeverity,
  type ReviewCategory,
  type FileReviewResult
} from './types.js';

/**
 * ReviewReportGenerator - Multi-format report generation
 */
export class ReviewReportGenerator {
  private projectRoot: string;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = projectRoot;
  }

  /**
   * Generate a report in the specified format
   */
  async generate(
    result: ReviewResult & { statistics?: ReviewStatistics },
    options: ReportOptions
  ): Promise<string> {
    switch (options.format) {
      case 'html':
        return this.generateHTML(result, options);
      case 'json':
        return this.generateJSON(result, options);
      case 'markdown':
        return this.generateMarkdown(result, options);
      default:
        throw new Error(`Unsupported format: ${options.format}`);
    }
  }

  /**
   * Generate and save a report to disk
   */
  async saveReport(
    result: ReviewResult & { statistics?: ReviewStatistics },
    options: ReportOptions
  ): Promise<string> {
    const content = await this.generate(result, options);
    const outputPath = options.outputPath || this.getDefaultOutputPath(options.format);

    // Ensure directory exists
    const dir = path.dirname(outputPath);
    await fs.mkdir(dir, { recursive: true });

    await fs.writeFile(outputPath, content, 'utf-8');
    return outputPath;
  }

  /**
   * Get default output path for a format
   */
  private getDefaultOutputPath(format: ReportFormat): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const ext = format === 'markdown' ? 'md' : format;
    return path.join(this.projectRoot, 'review-reports', `review-${timestamp}.${ext}`);
  }

  // ===========================================================================
  // HTML Report Generation
  // ===========================================================================

  /**
   * Generate HTML report
   */
  generateHTML(
    result: ReviewResult & { statistics?: ReviewStatistics },
    options: ReportOptions
  ): string {
    const title = options.title || 'Code Review Report';
    const stats = result.statistics;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml(title)}</title>
  <style>
    ${this.getHTMLStyles(options.customStyles)}
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>${this.escapeHtml(title)}</h1>
      <div class="meta">
        <span class="status status-${result.status}">${result.status.toUpperCase()}</span>
        <span class="score">Score: ${result.summary.score}/100</span>
        <span class="duration">Duration: ${this.formatDuration(result.duration)}</span>
        <span class="date">Generated: ${new Date().toLocaleString()}</span>
      </div>
    </header>

    <!-- Summary Dashboard -->
    <section class="dashboard">
      <div class="card summary-card">
        <h2>Summary</h2>
        <p>${this.escapeHtml(result.summary.text)}</p>
        <div class="metrics">
          <div class="metric">
            <span class="metric-value">${result.summary.totalFiles}</span>
            <span class="metric-label">Files Reviewed</span>
          </div>
          <div class="metric">
            <span class="metric-value">${result.summary.totalIssues}</span>
            <span class="metric-label">Total Issues</span>
          </div>
          <div class="metric">
            <span class="metric-value">${result.summary.filesWithIssues}</span>
            <span class="metric-label">Files with Issues</span>
          </div>
          ${stats ? `
          <div class="metric">
            <span class="metric-value">${stats.totalCodeLines.toLocaleString()}</span>
            <span class="metric-label">Lines of Code</span>
          </div>
          ` : ''}
        </div>
      </div>

      <!-- Severity Breakdown -->
      <div class="card severity-card">
        <h2>Issues by Severity</h2>
        ${this.generateSeverityBars(result.summary.bySeverity)}
      </div>

      <!-- Category Breakdown -->
      <div class="card category-card">
        <h2>Issues by Category</h2>
        ${this.generateCategoryChart(result.summary.byCategory)}
      </div>
    </section>

    <!-- Approval Status -->
    <section class="approval">
      <div class="card ${result.approval.approved ? 'approved' : 'not-approved'}">
        <h2>${result.approval.approved ? 'Approved' : 'Changes Requested'}</h2>
        <p>${this.escapeHtml(result.approval.reason)}</p>
        ${result.approval.conditions ? `
        <h3>Conditions:</h3>
        <ul>
          ${result.approval.conditions.map(c => `<li>${this.escapeHtml(c)}</li>`).join('')}
        </ul>
        ` : ''}
        ${result.approval.requiresHumanReview ? `
        <p class="human-review-warning">Requires Human Review: ${this.escapeHtml(result.approval.humanReviewReason || '')}</p>
        ` : ''}
      </div>
    </section>

    <!-- Files Tree -->
    <section class="files-section">
      <h2>Files Reviewed (${result.filesReviewed.length})</h2>
      <div class="file-tree">
        ${this.generateFileTree(result.filesReviewed, result.issues, options)}
      </div>
    </section>

    <!-- Issues List -->
    <section class="issues-section">
      <h2>Issues (${result.issues.length})</h2>
      ${options.groupByCategory
        ? this.generateIssuesByCategory(result.issues, options)
        : options.groupByFile
          ? this.generateIssuesByFile(result.issues, options)
          : this.generateIssuesList(result.issues, options)
      }
    </section>

    ${result.security.length > 0 ? `
    <!-- Security Findings -->
    <section class="security-section">
      <h2>Security Findings (${result.security.length})</h2>
      <div class="security-findings">
        ${result.security.map(f => `
        <div class="finding severity-${f.severity}">
          <div class="finding-header">
            <span class="finding-type">${this.escapeHtml(f.type)}</span>
            <span class="badge severity-${f.severity}">${f.severity.toUpperCase()}</span>
            ${f.cweId ? `<span class="badge cwe">${f.cweId}</span>` : ''}
          </div>
          <h3>${this.escapeHtml(f.title)}</h3>
          <p>${this.escapeHtml(f.description)}</p>
          <div class="finding-location">
            <code>${this.escapeHtml(f.file)}:${f.line}</code>
          </div>
          ${f.snippet && options.includeSourceSnippets ? `
          <pre class="code-snippet"><code>${this.escapeHtml(f.snippet)}</code></pre>
          ` : ''}
          <div class="remediation">
            <strong>Remediation:</strong> ${this.escapeHtml(f.remediation)}
          </div>
          ${f.references.length > 0 ? `
          <div class="references">
            <strong>References:</strong>
            <ul>
              ${f.references.map(r => `<li><a href="${this.escapeHtml(r)}" target="_blank">${this.escapeHtml(r)}</a></li>`).join('')}
            </ul>
          </div>
          ` : ''}
        </div>
        `).join('')}
      </div>
    </section>
    ` : ''}

    ${options.includeFixes && result.suggestedFixes.length > 0 ? `
    <!-- Suggested Fixes -->
    <section class="fixes-section">
      <h2>Suggested Fixes (${result.suggestedFixes.length})</h2>
      <div class="fixes-list">
        ${result.suggestedFixes.map(fix => `
        <div class="fix">
          <h3>${this.escapeHtml(fix.description)}</h3>
          <div class="fix-location">
            <code>${this.escapeHtml(fix.file)} (lines ${fix.lineRange.start}-${fix.lineRange.end})</code>
          </div>
          <div class="fix-diff">
            <div class="original">
              <h4>Original:</h4>
              <pre><code>${this.escapeHtml(fix.original)}</code></pre>
            </div>
            <div class="fixed">
              <h4>Fixed:</h4>
              <pre><code>${this.escapeHtml(fix.fixed)}</code></pre>
            </div>
          </div>
          <div class="fix-meta">
            <span class="confidence">Confidence: ${fix.confidence}</span>
            ${fix.autoApplicable ? '<span class="auto-apply">Auto-applicable</span>' : ''}
          </div>
        </div>
        `).join('')}
      </div>
    </section>
    ` : ''}

    ${stats ? `
    <!-- Statistics -->
    <section class="stats-section">
      <h2>Statistics</h2>
      <div class="stats-grid">
        <div class="stat-item">
          <span class="stat-label">Files Scanned</span>
          <span class="stat-value">${stats.filesScanned}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Files with Issues</span>
          <span class="stat-value">${stats.filesWithIssues}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Average Issues/File</span>
          <span class="stat-value">${stats.averageIssuesPerFile.toFixed(2)}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Total Code Lines</span>
          <span class="stat-value">${stats.totalCodeLines.toLocaleString()}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Comment Lines</span>
          <span class="stat-value">${stats.totalCommentLines.toLocaleString()}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Code/Comment Ratio</span>
          <span class="stat-value">${stats.codeToCommentRatio.toFixed(1)}:1</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Execution Time</span>
          <span class="stat-value">${this.formatDuration(stats.executionTime)}</span>
        </div>
        ${stats.mostCommonIssueType ? `
        <div class="stat-item">
          <span class="stat-label">Most Common Issue</span>
          <span class="stat-value">${this.escapeHtml(stats.mostCommonIssueType)}</span>
        </div>
        ` : ''}
      </div>
    </section>
    ` : ''}

    ${result.notes.length > 0 ? `
    <!-- Notes -->
    <section class="notes-section">
      <h2>Notes</h2>
      <ul>
        ${result.notes.map(n => `<li>${this.escapeHtml(n)}</li>`).join('')}
      </ul>
    </section>
    ` : ''}

    <footer>
      <p>Generated by RUBIX Code Review Engine</p>
    </footer>
  </div>
</body>
</html>`;
  }

  /**
   * Get HTML styles
   */
  private getHTMLStyles(customStyles?: string): string {
    const baseStyles = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      line-height: 1.6;
      color: #333;
      background: #f5f5f5;
    }
    .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
    header { background: #1a1a2e; color: white; padding: 30px; border-radius: 8px; margin-bottom: 20px; }
    header h1 { font-size: 2em; margin-bottom: 15px; }
    .meta { display: flex; gap: 20px; flex-wrap: wrap; align-items: center; }
    .status { padding: 5px 15px; border-radius: 20px; font-weight: bold; text-transform: uppercase; font-size: 0.85em; }
    .status-approved { background: #10b981; }
    .status-changes_requested { background: #f59e0b; }
    .status-blocked { background: #ef4444; }
    .status-pending { background: #6b7280; }
    .score { font-size: 1.2em; font-weight: bold; }
    .duration, .date { opacity: 0.8; font-size: 0.9em; }

    .dashboard { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-bottom: 30px; }
    .card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .card h2 { font-size: 1.3em; margin-bottom: 15px; color: #1a1a2e; border-bottom: 2px solid #eee; padding-bottom: 10px; }

    .metrics { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin-top: 15px; }
    .metric { text-align: center; padding: 15px; background: #f8f9fa; border-radius: 8px; }
    .metric-value { display: block; font-size: 2em; font-weight: bold; color: #1a1a2e; }
    .metric-label { font-size: 0.85em; color: #666; }

    .severity-bar { display: flex; align-items: center; margin: 8px 0; }
    .severity-label { width: 80px; font-weight: 500; text-transform: capitalize; }
    .severity-track { flex: 1; height: 24px; background: #eee; border-radius: 4px; overflow: hidden; }
    .severity-fill { height: 100%; transition: width 0.3s; display: flex; align-items: center; justify-content: flex-end; padding-right: 8px; color: white; font-size: 0.8em; font-weight: bold; }
    .severity-critical .severity-fill { background: #dc2626; }
    .severity-high .severity-fill { background: #ea580c; }
    .severity-medium .severity-fill { background: #ca8a04; }
    .severity-low .severity-fill { background: #16a34a; }
    .severity-info .severity-fill { background: #2563eb; }

    .category-item { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
    .category-item:last-child { border-bottom: none; }
    .category-name { text-transform: capitalize; }
    .category-count { font-weight: bold; background: #f3f4f6; padding: 2px 10px; border-radius: 12px; }

    .approval { margin-bottom: 30px; }
    .approval .card { border-left: 4px solid; }
    .approval .approved { border-color: #10b981; }
    .approval .not-approved { border-color: #ef4444; }
    .human-review-warning { color: #dc2626; font-weight: bold; margin-top: 10px; }

    section { margin-bottom: 30px; }
    section > h2 { font-size: 1.5em; margin-bottom: 15px; color: #1a1a2e; }

    .file-tree { background: white; border-radius: 8px; padding: 15px; }
    .file-item { display: flex; justify-content: space-between; align-items: center; padding: 10px 15px; border-bottom: 1px solid #eee; }
    .file-item:last-child { border-bottom: none; }
    .file-item:hover { background: #f8f9fa; }
    .file-name { font-family: monospace; }
    .file-stats { display: flex; gap: 15px; }
    .file-issues { font-weight: bold; }
    .file-sensitive { color: #dc2626; font-size: 0.85em; }

    .issues-section .issue { background: white; border-radius: 8px; padding: 15px; margin-bottom: 15px; border-left: 4px solid; }
    .issue.severity-critical { border-color: #dc2626; }
    .issue.severity-high { border-color: #ea580c; }
    .issue.severity-medium { border-color: #ca8a04; }
    .issue.severity-low { border-color: #16a34a; }
    .issue.severity-info { border-color: #2563eb; }

    .issue-header { display: flex; gap: 10px; align-items: center; margin-bottom: 10px; flex-wrap: wrap; }
    .badge { padding: 2px 8px; border-radius: 4px; font-size: 0.75em; font-weight: bold; text-transform: uppercase; }
    .badge.severity-critical { background: #fecaca; color: #dc2626; }
    .badge.severity-high { background: #fed7aa; color: #ea580c; }
    .badge.severity-medium { background: #fef08a; color: #ca8a04; }
    .badge.severity-low { background: #bbf7d0; color: #16a34a; }
    .badge.severity-info { background: #bfdbfe; color: #2563eb; }
    .badge.cwe { background: #e0e7ff; color: #4f46e5; }
    .badge.category { background: #f3e8ff; color: #7c3aed; }

    .issue-title { font-weight: bold; font-size: 1.1em; }
    .issue-location { font-family: monospace; color: #666; margin: 8px 0; }
    .code-snippet { background: #1e1e1e; color: #d4d4d4; padding: 15px; border-radius: 4px; overflow-x: auto; margin: 10px 0; font-size: 0.9em; }

    .security-section .finding { background: white; border-radius: 8px; padding: 20px; margin-bottom: 15px; }
    .finding-header { display: flex; gap: 10px; align-items: center; margin-bottom: 10px; }
    .finding-type { font-family: monospace; background: #f3f4f6; padding: 4px 8px; border-radius: 4px; }
    .remediation { background: #f0fdf4; padding: 10px; border-radius: 4px; margin-top: 10px; }
    .references { margin-top: 10px; }
    .references ul { margin-left: 20px; }
    .references a { color: #2563eb; }

    .fixes-section .fix { background: white; border-radius: 8px; padding: 20px; margin-bottom: 15px; }
    .fix-diff { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin: 15px 0; }
    .fix-diff h4 { margin-bottom: 8px; }
    .fix-diff pre { background: #1e1e1e; color: #d4d4d4; padding: 10px; border-radius: 4px; overflow-x: auto; }
    .original pre { border-left: 3px solid #ef4444; }
    .fixed pre { border-left: 3px solid #10b981; }
    .fix-meta { display: flex; gap: 15px; color: #666; font-size: 0.9em; }
    .auto-apply { color: #10b981; font-weight: bold; }

    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; background: white; padding: 20px; border-radius: 8px; }
    .stat-item { text-align: center; padding: 15px; }
    .stat-label { display: block; font-size: 0.85em; color: #666; margin-bottom: 5px; }
    .stat-value { display: block; font-size: 1.5em; font-weight: bold; color: #1a1a2e; }

    .notes-section ul { background: white; padding: 20px 20px 20px 40px; border-radius: 8px; }
    .notes-section li { margin: 8px 0; }

    footer { text-align: center; padding: 20px; color: #666; font-size: 0.9em; }

    .category-group { margin-bottom: 25px; }
    .category-group-header { background: #f3f4f6; padding: 10px 15px; border-radius: 8px 8px 0 0; font-weight: bold; text-transform: capitalize; }

    .file-group { margin-bottom: 25px; }
    .file-group-header { background: #f3f4f6; padding: 10px 15px; border-radius: 8px 8px 0 0; font-family: monospace; }
    `;

    return customStyles ? `${baseStyles}\n${customStyles}` : baseStyles;
  }

  /**
   * Generate severity bars HTML
   */
  private generateSeverityBars(bySeverity: Record<ReviewSeverity, number>): string {
    const total = Object.values(bySeverity).reduce((a, b) => a + b, 0) || 1;
    const severities: ReviewSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];

    return severities.map(severity => {
      const count = bySeverity[severity] || 0;
      const percentage = (count / total) * 100;
      return `
      <div class="severity-bar severity-${severity}">
        <span class="severity-label">${severity}</span>
        <div class="severity-track">
          <div class="severity-fill" style="width: ${Math.max(percentage, count > 0 ? 5 : 0)}%">
            ${count > 0 ? count : ''}
          </div>
        </div>
      </div>
      `;
    }).join('');
  }

  /**
   * Generate category chart HTML
   */
  private generateCategoryChart(byCategory: Record<ReviewCategory, number>): string {
    const entries = Object.entries(byCategory)
      .filter(([_, count]) => count > 0)
      .sort((a, b) => b[1] - a[1]);

    if (entries.length === 0) {
      return '<p>No issues by category</p>';
    }

    return entries.map(([category, count]) => `
      <div class="category-item">
        <span class="category-name">${category}</span>
        <span class="category-count">${count}</span>
      </div>
    `).join('');
  }

  /**
   * Generate file tree HTML
   */
  private generateFileTree(
    files: FileReviewResult[],
    _issues: ReviewIssue[],
    _options: ReportOptions
  ): string {
    return files.map(f => {
      return `
      <div class="file-item">
        <span class="file-name">${this.escapeHtml(f.file)}</span>
        <div class="file-stats">
          <span class="file-issues ${f.issueCount > 0 ? `severity-${f.highestSeverity || 'info'}` : ''}">
            ${f.issueCount} issues
          </span>
          ${f.isSensitive ? '<span class="file-sensitive">SENSITIVE</span>' : ''}
        </div>
      </div>
      `;
    }).join('');
  }

  /**
   * Generate issues list HTML
   */
  private generateIssuesList(issues: ReviewIssue[], options: ReportOptions): string {
    if (issues.length === 0) {
      return '<p>No issues found!</p>';
    }

    return issues.map(issue => this.generateIssueHTML(issue, options)).join('');
  }

  /**
   * Generate issues grouped by category
   */
  private generateIssuesByCategory(issues: ReviewIssue[], options: ReportOptions): string {
    const grouped = new Map<ReviewCategory, ReviewIssue[]>();

    for (const issue of issues) {
      const existing = grouped.get(issue.category) || [];
      existing.push(issue);
      grouped.set(issue.category, existing);
    }

    if (grouped.size === 0) {
      return '<p>No issues found!</p>';
    }

    return Array.from(grouped.entries()).map(([category, categoryIssues]) => `
      <div class="category-group">
        <div class="category-group-header">${category} (${categoryIssues.length})</div>
        ${categoryIssues.map(issue => this.generateIssueHTML(issue, options)).join('')}
      </div>
    `).join('');
  }

  /**
   * Generate issues grouped by file
   */
  private generateIssuesByFile(issues: ReviewIssue[], options: ReportOptions): string {
    const grouped = new Map<string, ReviewIssue[]>();

    for (const issue of issues) {
      const existing = grouped.get(issue.file) || [];
      existing.push(issue);
      grouped.set(issue.file, existing);
    }

    if (grouped.size === 0) {
      return '<p>No issues found!</p>';
    }

    return Array.from(grouped.entries()).map(([file, fileIssues]) => `
      <div class="file-group">
        <div class="file-group-header">${this.escapeHtml(file)} (${fileIssues.length})</div>
        ${fileIssues.map(issue => this.generateIssueHTML(issue, options)).join('')}
      </div>
    `).join('');
  }

  /**
   * Generate single issue HTML
   */
  private generateIssueHTML(issue: ReviewIssue, options: ReportOptions): string {
    return `
    <div class="issue severity-${issue.severity}">
      <div class="issue-header">
        <span class="badge severity-${issue.severity}">${issue.severity}</span>
        <span class="badge category">${issue.category}</span>
        ${issue.ruleId ? `<span class="badge">${this.escapeHtml(issue.ruleId)}</span>` : ''}
        ${issue.cweId ? `<span class="badge cwe">${issue.cweId}</span>` : ''}
      </div>
      <div class="issue-title">${this.escapeHtml(issue.title)}</div>
      <p>${this.escapeHtml(issue.description)}</p>
      <div class="issue-location">
        <code>${this.escapeHtml(issue.file)}:${issue.line}${issue.column ? `:${issue.column}` : ''}</code>
      </div>
      ${issue.snippet && options.includeSourceSnippets ? `
      <pre class="code-snippet"><code>${this.escapeHtml(issue.snippet)}</code></pre>
      ` : ''}
    </div>
    `;
  }

  // ===========================================================================
  // JSON Report Generation
  // ===========================================================================

  /**
   * Generate JSON report
   */
  generateJSON(
    result: ReviewResult & { statistics?: ReviewStatistics },
    options: ReportOptions
  ): string {
    const report = {
      meta: {
        title: options.title || 'Code Review Report',
        generatedAt: new Date().toISOString(),
        generator: 'RUBIX Code Review Engine'
      },
      summary: {
        status: result.status,
        score: result.summary.score,
        totalFiles: result.summary.totalFiles,
        filesWithIssues: result.summary.filesWithIssues,
        totalIssues: result.summary.totalIssues,
        duration: result.duration,
        text: result.summary.text
      },
      approval: result.approval,
      bySeverity: result.summary.bySeverity,
      byCategory: result.summary.byCategory,
      files: result.filesReviewed,
      issues: options.includeSourceSnippets
        ? result.issues
        : result.issues.map(i => ({ ...i, snippet: undefined })),
      security: result.security,
      style: result.style,
      tests: result.tests,
      suggestedFixes: options.includeFixes ? result.suggestedFixes : undefined,
      statistics: result.statistics,
      notes: result.notes
    };

    return JSON.stringify(report, null, 2);
  }

  // ===========================================================================
  // Markdown Report Generation
  // ===========================================================================

  /**
   * Generate Markdown report
   */
  generateMarkdown(
    result: ReviewResult & { statistics?: ReviewStatistics },
    options: ReportOptions
  ): string {
    const title = options.title || 'Code Review Report';
    const stats = result.statistics;

    let md = `# ${title}

**Status:** ${result.status.toUpperCase()}
**Score:** ${result.summary.score}/100
**Duration:** ${this.formatDuration(result.duration)}
**Generated:** ${new Date().toLocaleString()}

---

## Summary

${result.summary.text}

### Metrics

| Metric | Value |
|--------|-------|
| Files Reviewed | ${result.summary.totalFiles} |
| Files with Issues | ${result.summary.filesWithIssues} |
| Total Issues | ${result.summary.totalIssues} |
${stats ? `| Lines of Code | ${stats.totalCodeLines.toLocaleString()} |` : ''}
${stats ? `| Comment Lines | ${stats.totalCommentLines.toLocaleString()} |` : ''}

### Issues by Severity

| Severity | Count |
|----------|-------|
| Critical | ${result.summary.bySeverity.critical} |
| High | ${result.summary.bySeverity.high} |
| Medium | ${result.summary.bySeverity.medium} |
| Low | ${result.summary.bySeverity.low} |
| Info | ${result.summary.bySeverity.info} |

---

## Approval

**${result.approval.approved ? 'APPROVED' : 'CHANGES REQUESTED'}**

${result.approval.reason}

${result.approval.conditions ? `
### Conditions

${result.approval.conditions.map(c => `- ${c}`).join('\n')}
` : ''}

${result.approval.requiresHumanReview ? `
> **Requires Human Review:** ${result.approval.humanReviewReason || ''}
` : ''}

---

## Files Reviewed

| File | Issues | Severity | Sensitive |
|------|--------|----------|-----------|
${result.filesReviewed.map(f =>
  `| ${f.file} | ${f.issueCount} | ${f.highestSeverity || '-'} | ${f.isSensitive ? 'Yes' : 'No'} |`
).join('\n')}

---

## Issues

${result.issues.length === 0 ? '_No issues found!_' : ''}

${options.groupByCategory
  ? this.generateMarkdownIssuesByCategory(result.issues, options)
  : options.groupByFile
    ? this.generateMarkdownIssuesByFile(result.issues, options)
    : this.generateMarkdownIssuesList(result.issues, options)
}

${result.security.length > 0 ? `
---

## Security Findings

${result.security.map(f => `
### ${f.title}

- **Type:** ${f.type}
- **Severity:** ${f.severity.toUpperCase()}
- **Location:** \`${f.file}:${f.line}\`
${f.cweId ? `- **CWE:** ${f.cweId}` : ''}
${f.owaspCategory ? `- **OWASP:** ${f.owaspCategory}` : ''}

${f.description}

${f.snippet && options.includeSourceSnippets ? `
\`\`\`
${f.snippet}
\`\`\`
` : ''}

**Remediation:** ${f.remediation}

${f.references.length > 0 ? `
**References:**
${f.references.map(r => `- ${r}`).join('\n')}
` : ''}
`).join('\n')}
` : ''}

${options.includeFixes && result.suggestedFixes.length > 0 ? `
---

## Suggested Fixes

${result.suggestedFixes.map(fix => `
### ${fix.description}

**File:** \`${fix.file}\` (lines ${fix.lineRange.start}-${fix.lineRange.end})
**Confidence:** ${fix.confidence}
${fix.autoApplicable ? '**Auto-applicable:** Yes' : ''}

**Original:**
\`\`\`
${fix.original}
\`\`\`

**Fixed:**
\`\`\`
${fix.fixed}
\`\`\`
`).join('\n')}
` : ''}

${stats ? `
---

## Statistics

| Metric | Value |
|--------|-------|
| Files Scanned | ${stats.filesScanned} |
| Files with Issues | ${stats.filesWithIssues} |
| Average Issues/File | ${stats.averageIssuesPerFile.toFixed(2)} |
| Total Code Lines | ${stats.totalCodeLines.toLocaleString()} |
| Comment Lines | ${stats.totalCommentLines.toLocaleString()} |
| Code/Comment Ratio | ${stats.codeToCommentRatio.toFixed(1)}:1 |
| Execution Time | ${this.formatDuration(stats.executionTime)} |
${stats.mostCommonIssueType ? `| Most Common Issue | ${stats.mostCommonIssueType} |` : ''}
` : ''}

${result.notes.length > 0 ? `
---

## Notes

${result.notes.map(n => `- ${n}`).join('\n')}
` : ''}

---

_Generated by RUBIX Code Review Engine_
`;

    return md;
  }

  /**
   * Generate Markdown issues list
   */
  private generateMarkdownIssuesList(issues: ReviewIssue[], options: ReportOptions): string {
    return issues.map(issue => this.generateMarkdownIssue(issue, options)).join('\n');
  }

  /**
   * Generate Markdown issues by category
   */
  private generateMarkdownIssuesByCategory(issues: ReviewIssue[], options: ReportOptions): string {
    const grouped = new Map<ReviewCategory, ReviewIssue[]>();

    for (const issue of issues) {
      const existing = grouped.get(issue.category) || [];
      existing.push(issue);
      grouped.set(issue.category, existing);
    }

    return Array.from(grouped.entries()).map(([category, categoryIssues]) => `
### ${category.charAt(0).toUpperCase() + category.slice(1)} (${categoryIssues.length})

${categoryIssues.map(issue => this.generateMarkdownIssue(issue, options)).join('\n')}
`).join('\n');
  }

  /**
   * Generate Markdown issues by file
   */
  private generateMarkdownIssuesByFile(issues: ReviewIssue[], options: ReportOptions): string {
    const grouped = new Map<string, ReviewIssue[]>();

    for (const issue of issues) {
      const existing = grouped.get(issue.file) || [];
      existing.push(issue);
      grouped.set(issue.file, existing);
    }

    return Array.from(grouped.entries()).map(([file, fileIssues]) => `
### \`${file}\` (${fileIssues.length})

${fileIssues.map(issue => this.generateMarkdownIssue(issue, options)).join('\n')}
`).join('\n');
  }

  /**
   * Generate single Markdown issue
   */
  private generateMarkdownIssue(issue: ReviewIssue, options: ReportOptions): string {
    return `
#### ${issue.title}

- **Severity:** ${issue.severity.toUpperCase()}
- **Category:** ${issue.category}
- **Location:** \`${issue.file}:${issue.line}${issue.column ? `:${issue.column}` : ''}\`
${issue.ruleId ? `- **Rule:** ${issue.ruleId}` : ''}
${issue.cweId ? `- **CWE:** ${issue.cweId}` : ''}

${issue.description}

${issue.snippet && options.includeSourceSnippets ? `
\`\`\`
${issue.snippet}
\`\`\`
` : ''}
`;
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Escape HTML special characters
   */
  private escapeHtml(text: string): string {
    const escapeMap: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    return text.replace(/[&<>"']/g, char => escapeMap[char] || char);
  }

  /**
   * Format duration in milliseconds to human-readable string
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }
}

export default ReviewReportGenerator;
