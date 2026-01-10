/**
 * Code Review Types
 *
 * Type definitions for the CODEX code review system.
 * Supports self-review, security checking, and automated review workflows.
 */

// =============================================================================
// Review Request Types
// =============================================================================

/**
 * Request for a code review
 */
export interface ReviewRequest {
  /** Unique review ID */
  id: string;
  /** Files to review (relative paths) */
  files: string[];
  /** Type of review to perform */
  type: ReviewType;
  /** Git diff to review (if available) */
  diff?: string;
  /** Commit message or description */
  description?: string;
  /** Base branch for comparison */
  baseBranch?: string;
  /** Target branch */
  targetBranch?: string;
  /** Additional context for the review */
  context?: string;
  /** Review configuration overrides */
  config?: Partial<ReviewConfig>;
}

/**
 * Type of review to perform
 */
export type ReviewType =
  | 'full'           // Complete review (security + style + logic + tests)
  | 'security'       // Security-focused review only
  | 'style'          // Style and formatting only
  | 'logic'          // Logic and correctness review
  | 'quick'          // Quick sanity check
  | 'pre-commit';    // Pre-commit validation

/**
 * Review configuration
 */
export interface ReviewConfig {
  /** Enable security vulnerability scanning */
  security: boolean;
  /** Enable style/lint checking */
  style: boolean;
  /** Enable logic review */
  logic: boolean;
  /** Enable test coverage check */
  tests: boolean;
  /** Severity threshold for blocking */
  blockingSeverity: ReviewSeverity;
  /** Maximum issues before auto-blocking */
  maxIssues: number;
  /** Files/patterns to always flag for review */
  sensitivePatterns: string[];
  /** Custom rules to apply */
  customRules?: CustomReviewRule[];
}

/**
 * Default review configuration
 */
export const DEFAULT_REVIEW_CONFIG: ReviewConfig = {
  security: true,
  style: true,
  logic: true,
  tests: true,
  blockingSeverity: 'critical',
  maxIssues: 50,
  sensitivePatterns: [
    '**/*.env*',
    '**/secrets*',
    '**/credentials*',
    '**/auth/**',
    '**/payment/**',
    '**/api/keys*',
    '**/config/production*',
    '**/migrations/**'
  ]
};

// =============================================================================
// Review Result Types
// =============================================================================

/**
 * Complete review result
 */
export interface ReviewResult {
  /** Review request ID */
  requestId: string;
  /** Overall status */
  status: ReviewStatus;
  /** Review summary */
  summary: ReviewSummary;
  /** All issues found */
  issues: ReviewIssue[];
  /** Security-specific findings */
  security: SecurityFinding[];
  /** Style/lint issues */
  style: StyleIssue[];
  /** Test coverage results */
  tests?: TestCoverageResult;
  /** Files reviewed */
  filesReviewed: FileReviewResult[];
  /** Time taken for review */
  duration: number;
  /** Reviewer notes */
  notes: string[];
  /** Approval status */
  approval: ApprovalStatus;
  /** Suggested fixes */
  suggestedFixes: SuggestedFix[];
}

/**
 * Review status
 */
export type ReviewStatus =
  | 'approved'       // Ready to merge
  | 'changes_requested' // Needs fixes
  | 'blocked'        // Critical issues found
  | 'pending'        // Review in progress
  | 'failed';        // Review process failed

/**
 * Review summary
 */
export interface ReviewSummary {
  /** Total files reviewed */
  totalFiles: number;
  /** Files with issues */
  filesWithIssues: number;
  /** Total issues found */
  totalIssues: number;
  /** Issues by severity */
  bySeverity: Record<ReviewSeverity, number>;
  /** Issues by category */
  byCategory: Record<ReviewCategory, number>;
  /** Overall score (0-100) */
  score: number;
  /** Human-readable summary */
  text: string;
}

/**
 * Approval status
 */
export interface ApprovalStatus {
  /** Whether the review is approved */
  approved: boolean;
  /** Reason for approval/rejection */
  reason: string;
  /** Conditions for approval (if conditionally approved) */
  conditions?: string[];
  /** Requires human review */
  requiresHumanReview: boolean;
  /** Why human review is needed */
  humanReviewReason?: string;
}

// =============================================================================
// Issue Types
// =============================================================================

/**
 * Issue severity levels
 */
export type ReviewSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/**
 * Issue categories
 */
export type ReviewCategory =
  | 'security'
  | 'performance'
  | 'logic'
  | 'style'
  | 'maintainability'
  | 'documentation'
  | 'testing'
  | 'accessibility'
  | 'compatibility';

/**
 * Review issue
 */
export interface ReviewIssue {
  /** Unique issue ID */
  id: string;
  /** Issue severity */
  severity: ReviewSeverity;
  /** Issue category */
  category: ReviewCategory;
  /** Issue title */
  title: string;
  /** Detailed description */
  description: string;
  /** File where issue was found */
  file: string;
  /** Line number (start) */
  line: number;
  /** End line number */
  endLine?: number;
  /** Column number */
  column?: number;
  /** Code snippet with issue */
  snippet?: string;
  /** Rule ID (if from linter) */
  ruleId?: string;
  /** Suggested fix */
  fix?: SuggestedFix;
  /** Related issues */
  relatedIssues?: string[];
  /** CWE ID (for security issues) */
  cweId?: string;
  /** OWASP category (for security issues) */
  owaspCategory?: string;
}

/**
 * Security-specific finding
 */
export interface SecurityFinding {
  /** Finding ID */
  id: string;
  /** Vulnerability type */
  type: SecurityVulnerabilityType;
  /** Severity */
  severity: ReviewSeverity;
  /** Title */
  title: string;
  /** Description */
  description: string;
  /** File location */
  file: string;
  /** Line number */
  line: number;
  /** Vulnerable code snippet */
  snippet?: string;
  /** CWE ID */
  cweId?: string;
  /** OWASP Top 10 category */
  owaspCategory?: string;
  /** CVE if known */
  cve?: string;
  /** Remediation advice */
  remediation: string;
  /** References */
  references: string[];
  /** Confidence level */
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Security vulnerability types (OWASP Top 10 2021 + common issues)
 */
export type SecurityVulnerabilityType =
  | 'injection'              // A03:2021 - SQL, NoSQL, OS, LDAP injection
  | 'broken_auth'            // A07:2021 - Authentication failures
  | 'sensitive_data'         // A02:2021 - Sensitive data exposure
  | 'xxe'                    // A05:2021 - XML External Entities
  | 'broken_access'          // A01:2021 - Broken Access Control
  | 'security_misconfig'     // A05:2021 - Security Misconfiguration
  | 'xss'                    // A03:2021 - Cross-Site Scripting
  | 'insecure_deserialization' // A08:2021 - Insecure Deserialization
  | 'vulnerable_components'  // A06:2021 - Vulnerable Components
  | 'logging_monitoring'     // A09:2021 - Logging & Monitoring Failures
  | 'ssrf'                   // A10:2021 - Server-Side Request Forgery
  | 'crypto_failure'         // A02:2021 - Cryptographic Failures
  | 'hardcoded_secrets'      // Hardcoded credentials/API keys
  | 'path_traversal'         // Path traversal attacks
  | 'open_redirect'          // Open redirect vulnerabilities
  | 'csrf'                   // Cross-Site Request Forgery
  | 'prototype_pollution'    // Prototype pollution (JS specific)
  | 'regex_dos'              // ReDoS - Regular Expression DoS
  | 'unsafe_eval'            // Unsafe use of eval/Function
  | 'other';

/**
 * Style/lint issue
 */
export interface StyleIssue {
  /** Issue ID */
  id: string;
  /** Severity */
  severity: ReviewSeverity;
  /** Rule that was violated */
  rule: string;
  /** Message */
  message: string;
  /** File */
  file: string;
  /** Line */
  line: number;
  /** Column */
  column?: number;
  /** End line */
  endLine?: number;
  /** End column */
  endColumn?: number;
  /** Source (eslint, prettier, etc.) */
  source: 'eslint' | 'prettier' | 'typescript' | 'custom';
  /** Auto-fixable */
  fixable: boolean;
  /** Fix to apply */
  fix?: string;
}

/**
 * Test coverage result
 */
export interface TestCoverageResult {
  /** Overall coverage percentage */
  overall: number;
  /** Line coverage */
  lines: number;
  /** Branch coverage */
  branches: number;
  /** Function coverage */
  functions: number;
  /** Statement coverage */
  statements: number;
  /** Uncovered files */
  uncoveredFiles: string[];
  /** Coverage delta (if comparing to base) */
  delta?: number;
  /** Meets threshold */
  meetsThreshold: boolean;
  /** Required threshold */
  threshold: number;
}

/**
 * File-level review result
 */
export interface FileReviewResult {
  /** File path */
  file: string;
  /** Issues in this file */
  issueCount: number;
  /** Highest severity in this file */
  highestSeverity: ReviewSeverity | null;
  /** Is this a sensitive file */
  isSensitive: boolean;
  /** Lines added */
  linesAdded: number;
  /** Lines removed */
  linesRemoved: number;
  /** Complexity delta */
  complexityDelta?: number;
}

// =============================================================================
// Fix Types
// =============================================================================

/**
 * Suggested fix for an issue
 */
export interface SuggestedFix {
  /** Fix ID */
  id: string;
  /** Related issue ID */
  issueId: string;
  /** Description of the fix */
  description: string;
  /** File to modify */
  file: string;
  /** Original code */
  original: string;
  /** Fixed code */
  fixed: string;
  /** Line range */
  lineRange: { start: number; end: number };
  /** Confidence that this fix is correct */
  confidence: 'high' | 'medium' | 'low';
  /** Auto-applicable */
  autoApplicable: boolean;
}

// =============================================================================
// Custom Rule Types
// =============================================================================

/**
 * Custom review rule
 */
export interface CustomReviewRule {
  /** Rule ID */
  id: string;
  /** Rule name */
  name: string;
  /** Description */
  description: string;
  /** Pattern to match */
  pattern: string | RegExp;
  /** File patterns to apply to */
  filePatterns: string[];
  /** Severity when matched */
  severity: ReviewSeverity;
  /** Category */
  category: ReviewCategory;
  /** Message template */
  messageTemplate: string;
  /** Is this pattern forbidden? */
  forbidden?: boolean;
  /** Is this pattern required? */
  required?: boolean;
}

// =============================================================================
// Review Event Types
// =============================================================================

/**
 * Review event for logging and notifications
 */
export interface ReviewEvent {
  /** Event type */
  type: ReviewEventType;
  /** Event timestamp */
  timestamp: Date;
  /** Review ID */
  reviewId: string;
  /** Event details */
  details: Record<string, unknown>;
}

/**
 * Review event types
 */
export type ReviewEventType =
  | 'review_started'
  | 'review_completed'
  | 'issue_found'
  | 'security_alert'
  | 'fix_suggested'
  | 'fix_applied'
  | 'human_review_required'
  | 'approval_granted'
  | 'approval_denied';

// =============================================================================
// Security Pattern Types
// =============================================================================

/**
 * Security pattern for detection
 */
export interface SecurityPattern {
  /** Pattern ID */
  id: string;
  /** Vulnerability type */
  type: SecurityVulnerabilityType;
  /** Pattern name */
  name: string;
  /** Description */
  description: string;
  /** Regex pattern to match */
  pattern: RegExp;
  /** File extensions to check */
  extensions: string[];
  /** Severity */
  severity: ReviewSeverity;
  /** CWE ID */
  cweId?: string;
  /** OWASP category */
  owaspCategory?: string;
  /** Remediation advice */
  remediation: string;
  /** Confidence level */
  confidence: 'high' | 'medium' | 'low';
  /** False positive indicators */
  falsePositiveIndicators?: RegExp[];
}
