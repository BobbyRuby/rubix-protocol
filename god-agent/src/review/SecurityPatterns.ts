/**
 * SecurityPatterns
 *
 * Common security vulnerability patterns for code review.
 * Based on OWASP Top 10 2021 and common security issues.
 */

import type { SecurityPattern } from './types.js';

/**
 * JavaScript/TypeScript security patterns
 */
export const JS_SECURITY_PATTERNS: SecurityPattern[] = [
  // =========================================================================
  // A01:2021 - Broken Access Control
  // =========================================================================
  {
    id: 'SEC001',
    type: 'broken_access',
    name: 'Missing authorization check',
    description: 'Route or function may be missing authorization checks',
    pattern: /router\.(get|post|put|delete|patch)\s*\([^,]+,\s*(?!.*auth|.*authorize|.*requireAuth)/i,
    extensions: ['.js', '.ts', '.mjs'],
    severity: 'high',
    cweId: 'CWE-862',
    owaspCategory: 'A01:2021',
    remediation: 'Add authorization middleware to protected routes',
    confidence: 'medium'
  },

  // =========================================================================
  // A02:2021 - Cryptographic Failures
  // =========================================================================
  {
    id: 'SEC002',
    type: 'crypto_failure',
    name: 'Weak hashing algorithm',
    description: 'Use of weak hashing algorithms (MD5, SHA1)',
    pattern: /crypto\.create(Hash|Hmac)\s*\(\s*['"`](md5|sha1)['"`]/i,
    extensions: ['.js', '.ts', '.mjs'],
    severity: 'high',
    cweId: 'CWE-328',
    owaspCategory: 'A02:2021',
    remediation: 'Use SHA-256 or stronger hashing algorithms',
    confidence: 'high'
  },
  {
    id: 'SEC003',
    type: 'crypto_failure',
    name: 'Hardcoded encryption key',
    description: 'Encryption key appears to be hardcoded',
    pattern: /(?:encrypt|decrypt|cipher|aes|des)\s*[=(]\s*['"`][A-Za-z0-9+/=]{16,}['"`]/i,
    extensions: ['.js', '.ts', '.mjs'],
    severity: 'critical',
    cweId: 'CWE-321',
    owaspCategory: 'A02:2021',
    remediation: 'Use environment variables or key management service for encryption keys',
    confidence: 'medium'
  },

  // =========================================================================
  // A03:2021 - Injection
  // =========================================================================
  {
    id: 'SEC004',
    type: 'injection',
    name: 'SQL injection vulnerability',
    description: 'Potential SQL injection via string concatenation',
    pattern: /(?:query|execute|raw)\s*\(\s*['"`].*\$\{|(?:query|execute|raw)\s*\(\s*[^'"`]*\+/i,
    extensions: ['.js', '.ts', '.mjs'],
    severity: 'critical',
    cweId: 'CWE-89',
    owaspCategory: 'A03:2021',
    remediation: 'Use parameterized queries or prepared statements',
    confidence: 'high'
  },
  {
    id: 'SEC005',
    type: 'injection',
    name: 'Command injection vulnerability',
    description: 'Potential command injection via exec/spawn with user input',
    pattern: /(?:exec|execSync|spawn|spawnSync)\s*\([^)]*(?:\$\{|req\.|params\.|query\.|body\.)/i,
    extensions: ['.js', '.ts', '.mjs'],
    severity: 'critical',
    cweId: 'CWE-78',
    owaspCategory: 'A03:2021',
    remediation: 'Validate and sanitize input, use allowlists for commands',
    confidence: 'high'
  },
  {
    id: 'SEC006',
    type: 'xss',
    name: 'Cross-Site Scripting (XSS)',
    description: 'Potential XSS via innerHTML or dangerouslySetInnerHTML',
    pattern: /(?:innerHTML|dangerouslySetInnerHTML)\s*=|\.html\s*\([^)]*(?:\$\{|req\.|params\.|query\.|body\.)/i,
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.mjs'],
    severity: 'high',
    cweId: 'CWE-79',
    owaspCategory: 'A03:2021',
    remediation: 'Use textContent instead of innerHTML, sanitize HTML with DOMPurify',
    confidence: 'high'
  },

  // =========================================================================
  // A05:2021 - Security Misconfiguration
  // =========================================================================
  {
    id: 'SEC007',
    type: 'security_misconfig',
    name: 'CORS wildcard origin',
    description: 'CORS configured with wildcard origin',
    pattern: /(?:cors|Access-Control-Allow-Origin)\s*[:=]\s*['"`]\*['"`]/i,
    extensions: ['.js', '.ts', '.mjs'],
    severity: 'medium',
    cweId: 'CWE-942',
    owaspCategory: 'A05:2021',
    remediation: 'Configure CORS with specific allowed origins',
    confidence: 'high'
  },
  {
    id: 'SEC008',
    type: 'security_misconfig',
    name: 'Debug mode in production',
    description: 'Debug mode or verbose logging may be enabled',
    pattern: /(?:DEBUG|debug)\s*[:=]\s*(?:true|1|['"`]true['"`])/i,
    extensions: ['.js', '.ts', '.mjs', '.json'],
    severity: 'medium',
    cweId: 'CWE-489',
    owaspCategory: 'A05:2021',
    remediation: 'Disable debug mode in production environments',
    confidence: 'medium',
    falsePositiveIndicators: [/if\s*\(.*NODE_ENV.*development/i]
  },

  // =========================================================================
  // Hardcoded Secrets
  // =========================================================================
  {
    id: 'SEC009',
    type: 'hardcoded_secrets',
    name: 'Hardcoded API key',
    description: 'API key appears to be hardcoded in source code',
    pattern: /(?:api[_-]?key|apikey|api[_-]?secret)\s*[:=]\s*['"`][A-Za-z0-9_\-]{20,}['"`]/i,
    extensions: ['.js', '.ts', '.mjs', '.jsx', '.tsx'],
    severity: 'critical',
    cweId: 'CWE-798',
    remediation: 'Use environment variables for API keys',
    confidence: 'high'
  },
  {
    id: 'SEC010',
    type: 'hardcoded_secrets',
    name: 'Hardcoded password',
    description: 'Password appears to be hardcoded in source code',
    pattern: /(?:password|passwd|pwd|secret)\s*[:=]\s*['"`][^'"`]{8,}['"`]/i,
    extensions: ['.js', '.ts', '.mjs', '.jsx', '.tsx'],
    severity: 'critical',
    cweId: 'CWE-798',
    remediation: 'Use environment variables or secrets management for passwords',
    confidence: 'medium',
    falsePositiveIndicators: [/placeholder|example|test|mock|dummy/i]
  },
  {
    id: 'SEC011',
    type: 'hardcoded_secrets',
    name: 'AWS credentials',
    description: 'AWS access key appears to be hardcoded',
    pattern: /(?:AKIA|ASIA)[A-Z0-9]{16}/,
    extensions: ['.js', '.ts', '.mjs', '.jsx', '.tsx', '.json', '.env'],
    severity: 'critical',
    cweId: 'CWE-798',
    remediation: 'Use IAM roles or environment variables for AWS credentials',
    confidence: 'high'
  },
  {
    id: 'SEC012',
    type: 'hardcoded_secrets',
    name: 'Private key in code',
    description: 'Private key appears to be in source code',
    pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/,
    extensions: ['.js', '.ts', '.mjs', '.jsx', '.tsx', '.pem', '.key'],
    severity: 'critical',
    cweId: 'CWE-321',
    remediation: 'Store private keys in secure key management systems',
    confidence: 'high'
  },
  {
    id: 'SEC013',
    type: 'hardcoded_secrets',
    name: 'JWT secret',
    description: 'JWT secret appears to be hardcoded',
    pattern: /jwt\.sign\s*\([^,]+,\s*['"`][^'"`]{10,}['"`]/i,
    extensions: ['.js', '.ts', '.mjs'],
    severity: 'critical',
    cweId: 'CWE-798',
    remediation: 'Use environment variables for JWT secrets',
    confidence: 'high'
  },

  // =========================================================================
  // A07:2021 - Identification and Authentication Failures
  // =========================================================================
  {
    id: 'SEC014',
    type: 'broken_auth',
    name: 'Weak password validation',
    description: 'Password validation may be too weak',
    pattern: /password\.length\s*[<>=]+\s*[0-7]\b/i,
    extensions: ['.js', '.ts', '.mjs'],
    severity: 'medium',
    cweId: 'CWE-521',
    owaspCategory: 'A07:2021',
    remediation: 'Enforce minimum password length of 8+ characters with complexity requirements',
    confidence: 'high'
  },
  {
    id: 'SEC015',
    type: 'broken_auth',
    name: 'Session without expiry',
    description: 'Session configuration may be missing expiry',
    pattern: /session\s*\(\s*\{(?:(?!maxAge|expires|cookie).)*\}\s*\)/is,
    extensions: ['.js', '.ts', '.mjs'],
    severity: 'medium',
    cweId: 'CWE-613',
    owaspCategory: 'A07:2021',
    remediation: 'Set session expiry with maxAge or expires option',
    confidence: 'low'
  },

  // =========================================================================
  // Path Traversal
  // =========================================================================
  {
    id: 'SEC016',
    type: 'path_traversal',
    name: 'Path traversal vulnerability',
    description: 'Potential path traversal via unsanitized file path',
    pattern: /(?:readFile|writeFile|createReadStream|createWriteStream|unlink|rmdir)\s*\([^)]*(?:\$\{|req\.|params\.|query\.|body\.)/i,
    extensions: ['.js', '.ts', '.mjs'],
    severity: 'high',
    cweId: 'CWE-22',
    remediation: 'Validate and sanitize file paths, use path.resolve and check for path traversal',
    confidence: 'high'
  },

  // =========================================================================
  // Unsafe JavaScript Patterns
  // =========================================================================
  {
    id: 'SEC017',
    type: 'unsafe_eval',
    name: 'Unsafe eval usage',
    description: 'Use of eval() which can execute arbitrary code',
    pattern: /\beval\s*\(/,
    extensions: ['.js', '.ts', '.mjs', '.jsx', '.tsx'],
    severity: 'high',
    cweId: 'CWE-95',
    remediation: 'Avoid eval(), use JSON.parse for JSON, or Function constructor for limited cases',
    confidence: 'high',
    falsePositiveIndicators: [/eslint-disable|@ts-ignore/]
  },
  {
    id: 'SEC018',
    type: 'unsafe_eval',
    name: 'Unsafe Function constructor',
    description: 'Use of Function constructor which can execute arbitrary code',
    pattern: /new\s+Function\s*\([^)]*(?:\$\{|req\.|params\.|query\.|body\.)/i,
    extensions: ['.js', '.ts', '.mjs', '.jsx', '.tsx'],
    severity: 'high',
    cweId: 'CWE-95',
    remediation: 'Avoid dynamic code execution with Function constructor',
    confidence: 'high'
  },
  {
    id: 'SEC019',
    type: 'prototype_pollution',
    name: 'Potential prototype pollution',
    description: 'Object merging without prototype pollution protection',
    pattern: /Object\.assign\s*\(\s*\{\s*\}\s*,\s*(?:req\.|params\.|query\.|body\.)|\.\.\.(?:req\.|params\.|query\.|body\.)/i,
    extensions: ['.js', '.ts', '.mjs', '.jsx', '.tsx'],
    severity: 'medium',
    cweId: 'CWE-1321',
    remediation: 'Use Object.create(null) or validate input keys to prevent __proto__ pollution',
    confidence: 'medium'
  },

  // =========================================================================
  // A10:2021 - Server-Side Request Forgery (SSRF)
  // =========================================================================
  {
    id: 'SEC020',
    type: 'ssrf',
    name: 'Potential SSRF vulnerability',
    description: 'URL from user input used in server-side request',
    pattern: /(?:fetch|axios|request|http\.get|https\.get)\s*\([^)]*(?:\$\{|req\.|params\.|query\.|body\.)/i,
    extensions: ['.js', '.ts', '.mjs'],
    severity: 'high',
    cweId: 'CWE-918',
    owaspCategory: 'A10:2021',
    remediation: 'Validate and whitelist allowed URLs/domains for server-side requests',
    confidence: 'medium'
  },

  // =========================================================================
  // Open Redirect
  // =========================================================================
  {
    id: 'SEC021',
    type: 'open_redirect',
    name: 'Open redirect vulnerability',
    description: 'Redirect URL may come from user input',
    pattern: /res\.redirect\s*\([^)]*(?:\$\{|req\.|params\.|query\.|body\.)/i,
    extensions: ['.js', '.ts', '.mjs'],
    severity: 'medium',
    cweId: 'CWE-601',
    remediation: 'Validate redirect URLs against a whitelist of allowed destinations',
    confidence: 'high'
  },

  // =========================================================================
  // ReDoS - Regular Expression Denial of Service
  // =========================================================================
  {
    id: 'SEC022',
    type: 'regex_dos',
    name: 'Potential ReDoS pattern',
    description: 'Regular expression may be vulnerable to ReDoS attacks',
    pattern: /new\s+RegExp\s*\([^)]*(?:\$\{|req\.|params\.|query\.|body\.)/i,
    extensions: ['.js', '.ts', '.mjs'],
    severity: 'medium',
    cweId: 'CWE-1333',
    remediation: 'Validate and limit user-controlled regex patterns, use safe-regex library',
    confidence: 'medium'
  },

  // =========================================================================
  // A09:2021 - Security Logging and Monitoring Failures
  // =========================================================================
  {
    id: 'SEC023',
    type: 'logging_monitoring',
    name: 'Sensitive data in logs',
    description: 'Potentially logging sensitive information',
    pattern: /console\.\w+\s*\([^)]*(?:password|secret|token|key|credential|ssn|credit.?card)/i,
    extensions: ['.js', '.ts', '.mjs', '.jsx', '.tsx'],
    severity: 'medium',
    cweId: 'CWE-532',
    owaspCategory: 'A09:2021',
    remediation: 'Avoid logging sensitive information, mask sensitive data in logs',
    confidence: 'medium'
  }
];

/**
 * Get all security patterns for a file extension
 */
export function getPatternsForExtension(extension: string): SecurityPattern[] {
  return JS_SECURITY_PATTERNS.filter(p =>
    p.extensions.includes(extension.toLowerCase())
  );
}

/**
 * Check if a match is likely a false positive
 */
export function isFalsePositive(pattern: SecurityPattern, content: string, matchIndex: number): boolean {
  if (!pattern.falsePositiveIndicators) return false;

  // Check surrounding context (100 chars before and after)
  const start = Math.max(0, matchIndex - 100);
  const end = Math.min(content.length, matchIndex + 100);
  const context = content.substring(start, end);

  return pattern.falsePositiveIndicators.some(fp => fp.test(context));
}

export default JS_SECURITY_PATTERNS;
