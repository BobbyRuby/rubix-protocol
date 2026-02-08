/**
 * Security Migration
 *
 * Extracts security patterns from the codebase and stores them in God Agent memory.
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { MemoryEngine } from '../core/MemoryEngine.js';
import { MemorySource, CausalRelationType } from '../core/types.js';
import type {
  MigrationConfig,
  MigrationResult,
  ProgressCallback,
} from './types.js';

/**
 * Extract authentication patterns
 */
function extractAuthPatterns(projectRoot: string): string {
  const patterns: string[] = [];

  // Check AuthController
  const authController = join(projectRoot, 'app/Http/Controllers/AuthController.php');
  if (existsSync(authController)) {
    const content = readFileSync(authController, 'utf-8');

    // Look for login method
    const loginMatch = content.match(/function\s+login[\s\S]*?(?=\n\s*(?:public|protected|private)\s+function|\n\})/);
    if (loginMatch) {
      patterns.push(`Authentication Login Method:\n${loginMatch[0].substring(0, 500)}...`);
    }

    // Look for sanctum usage
    if (content.includes('sanctum') || content.includes('createToken')) {
      patterns.push('Uses Laravel Sanctum for API token authentication');
    }
  }

  // Check for auth middleware
  const kernel = join(projectRoot, 'app/Http/Kernel.php');
  if (existsSync(kernel)) {
    const content = readFileSync(kernel, 'utf-8');
    const authMiddleware = content.match(/['"]auth['"]\s*=>\s*[\s\S]*?(?=,\n)/g);
    if (authMiddleware) {
      patterns.push(`Auth Middleware Configuration:\n${authMiddleware.join('\n')}`);
    }
  }

  return patterns.join('\n\n---\n\n');
}

/**
 * Extract rate limiting configuration
 */
function extractRateLimitPatterns(projectRoot: string): string {
  const patterns: string[] = [];

  // Check RouteServiceProvider for rate limiters
  const routeProvider = join(projectRoot, 'app/Providers/RouteServiceProvider.php');
  if (existsSync(routeProvider)) {
    const content = readFileSync(routeProvider, 'utf-8');
    const rateLimitMatch = content.match(/RateLimiter::for[\s\S]*?}\);/g);
    if (rateLimitMatch) {
      patterns.push(`Rate Limiter Definitions:\n${rateLimitMatch.join('\n\n')}`);
    }
  }

  // Check Kernel for throttle middleware
  const kernel = join(projectRoot, 'app/Http/Kernel.php');
  if (existsSync(kernel)) {
    const content = readFileSync(kernel, 'utf-8');
    if (content.includes('throttle')) {
      const throttleMatch = content.match(/['"]throttle.*['"]/g);
      if (throttleMatch) {
        patterns.push(`Throttle Middleware Usage:\n${throttleMatch.join('\n')}`);
      }
    }
  }

  return patterns.join('\n\n---\n\n');
}

/**
 * Extract multi-tenant isolation patterns
 */
function extractMultiTenantPatterns(projectRoot: string): string {
  const patterns: string[] = [];
  const modelsDir = join(projectRoot, 'app/Models');

  if (existsSync(modelsDir)) {
    const modelFiles = readdirSync(modelsDir).filter((f) => f.endsWith('.php'));

    for (const file of modelFiles) {
      const content = readFileSync(join(modelsDir, file), 'utf-8');

      // Check for company_id relationship
      if (content.includes('company_id')) {
        const belongsTo = content.match(/belongsTo\(Company::class/);
        const scope = content.match(/scope.*company/i);

        if (belongsTo || scope) {
          patterns.push(`${file}: Has company_id isolation${belongsTo ? ' (belongsTo)' : ''}${scope ? ' (scope)' : ''}`);
        }
      }
    }
  }

  if (patterns.length > 0) {
    return `Multi-Tenant Isolation Pattern:\nModels with company_id scoping:\n${patterns.join('\n')}`;
  }

  return '';
}

/**
 * Extract CSRF protection configuration
 */
function extractCsrfPatterns(projectRoot: string): string {
  const patterns: string[] = [];

  // Check VerifyCsrfToken middleware
  const csrfMiddleware = join(projectRoot, 'app/Http/Middleware/VerifyCsrfToken.php');
  if (existsSync(csrfMiddleware)) {
    const content = readFileSync(csrfMiddleware, 'utf-8');
    const exceptMatch = content.match(/\$except\s*=\s*\[[\s\S]*?\]/);
    if (exceptMatch) {
      patterns.push(`CSRF Exceptions:\n${exceptMatch[0]}`);
    }
  }

  // Check session config
  const sessionConfig = join(projectRoot, 'config/session.php');
  if (existsSync(sessionConfig)) {
    const content = readFileSync(sessionConfig, 'utf-8');

    // Extract relevant settings
    const httpOnly = content.match(/['"]http_only['"]\s*=>\s*\w+/);
    const sameSite = content.match(/['"]same_site['"]\s*=>\s*['"]?\w+['"]?/);
    const secure = content.match(/['"]secure['"]\s*=>\s*\w+/);

    if (httpOnly || sameSite || secure) {
      patterns.push(`Session Cookie Security:\n${[httpOnly?.[0], sameSite?.[0], secure?.[0]].filter(Boolean).join('\n')}`);
    }
  }

  return patterns.join('\n\n---\n\n');
}

/**
 * Extract validation patterns from Form Requests
 */
function extractValidationPatterns(projectRoot: string): string {
  const patterns: string[] = [];
  const requestsDir = join(projectRoot, 'app/Http/Requests');

  if (existsSync(requestsDir)) {
    const requestFiles = readdirSync(requestsDir).filter((f) => f.endsWith('.php'));

    // Sample a few request files
    const sampleFiles = requestFiles.slice(0, 5);

    for (const file of sampleFiles) {
      const content = readFileSync(join(requestsDir, file), 'utf-8');

      // Extract rules method
      const rulesMatch = content.match(/function\s+rules[\s\S]*?return\s*\[[\s\S]*?\];/);
      if (rulesMatch) {
        patterns.push(`${file}:\n${rulesMatch[0].substring(0, 400)}${rulesMatch[0].length > 400 ? '...' : ''}`);
      }
    }

    if (requestFiles.length > 5) {
      patterns.push(`... and ${requestFiles.length - 5} more Form Request classes`);
    }
  }

  if (patterns.length > 0) {
    return `Input Validation Patterns (Form Requests):\n\n${patterns.join('\n\n')}`;
  }

  return '';
}

/**
 * Migrate security patterns to God Agent memory
 */
export async function migrateSecurity(
  engine: MemoryEngine,
  config: MigrationConfig,
  onProgress?: ProgressCallback
): Promise<MigrationResult> {
  const startTime = Date.now();
  const result: MigrationResult = {
    phase: 'security',
    entriesStored: 0,
    relationsCreated: 0,
    errors: [],
    duration: 0,
    dryRun: config.dryRun,
  };

  const securityEntries: { name: string; id?: string }[] = [];

  // Extract patterns using specialized functions
  const extractions = [
    {
      name: 'authentication',
      tags: ['security', 'auth', 'sanctum'],
      extract: () => extractAuthPatterns(config.projectRoot),
    },
    {
      name: 'rate-limiting',
      tags: ['security', 'rate-limit', 'middleware'],
      extract: () => extractRateLimitPatterns(config.projectRoot),
    },
    {
      name: 'multi-tenant',
      tags: ['security', 'multi-tenant', 'company'],
      extract: () => extractMultiTenantPatterns(config.projectRoot),
    },
    {
      name: 'csrf-protection',
      tags: ['security', 'csrf', 'middleware'],
      extract: () => extractCsrfPatterns(config.projectRoot),
    },
    {
      name: 'input-validation',
      tags: ['security', 'validation', 'xss'],
      extract: () => extractValidationPatterns(config.projectRoot),
    },
  ];

  onProgress?.('security', 0, extractions.length, 'Extracting security patterns...');

  for (let i = 0; i < extractions.length; i++) {
    const extraction = extractions[i];

    try {
      const content = extraction.extract();

      if (content && content.length > 50) {
        if (!config.dryRun) {
          const entry = await engine.store(content, {
            tags: extraction.tags,
            source: MemorySource.TOOL_OUTPUT,
            importance: 0.8,
            context: {
              securityPattern: extraction.name,
              extractedFrom: 'codebase-analysis',
            },
          });
          securityEntries.push({ name: extraction.name, id: entry.id });
        } else {
          securityEntries.push({ name: extraction.name });
        }
        result.entriesStored++;

        onProgress?.('security', i + 1, extractions.length, `Extracted: ${extraction.name}`);
      } else {
        onProgress?.('security', i + 1, extractions.length, `Skipped: ${extraction.name} (no patterns found)`);
      }
    } catch (error) {
      const errorMsg = `Failed to extract ${extraction.name}: ${error instanceof Error ? error.message : error}`;
      result.errors.push(errorMsg);
    }
  }

  // Create 'prevents' relations between security patterns
  // CSRF prevents XSS, Rate limiting prevents DoS, etc.
  if (!config.dryRun && securityEntries.length >= 2) {
    const csrf = securityEntries.find((e) => e.name === 'csrf-protection');
    const validation = securityEntries.find((e) => e.name === 'input-validation');
    const rateLimit = securityEntries.find((e) => e.name === 'rate-limiting');
    const auth = securityEntries.find((e) => e.name === 'authentication');

    // CSRF + Validation prevents XSS
    if (csrf?.id && validation?.id) {
      engine.addCausalRelation(
        [csrf.id, validation.id],
        [], // Target is implicit (XSS attack)
        CausalRelationType.PREVENTS,
        0.85,
        { metadata: { prevents: 'xss-attack' } }
      );
      result.relationsCreated++;
    }

    // Rate limiting prevents DoS
    if (rateLimit?.id) {
      engine.addCausalRelation(
        [rateLimit.id],
        [],
        CausalRelationType.PREVENTS,
        0.9,
        { metadata: { prevents: 'dos-attack' } }
      );
      result.relationsCreated++;
    }

    // Auth enables all other security
    if (auth?.id) {
      const otherIds = securityEntries
        .filter((e) => e.id && e.name !== 'authentication')
        .map((e) => e.id!);

      if (otherIds.length > 0) {
        engine.addCausalRelation(
          [auth.id],
          otherIds,
          CausalRelationType.ENABLES,
          0.7,
          { metadata: { relationship: 'auth-foundation' } }
        );
        result.relationsCreated++;
      }
    }
  }

  result.duration = Date.now() - startTime;
  return result;
}
