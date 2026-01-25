/**
 * Review Module
 *
 * RUBIX automated code review system.
 * Features:
 * - Security vulnerability scanning
 * - Style/lint checking
 * - Logic review
 * - Test coverage analysis
 * - EventEmitter progress tracking
 * - Parallel file processing
 * - Rich statistics
 * - Stop/Resume capability
 * - Review history
 * - Multi-format report generation (HTML, JSON, Markdown)
 */

export { CodeReviewer } from './CodeReviewer.js';
export { ReviewReportGenerator } from './ReportGenerator.js';
export { JS_SECURITY_PATTERNS, getPatternsForExtension, isFalsePositive } from './SecurityPatterns.js';
export * from './types.js';
