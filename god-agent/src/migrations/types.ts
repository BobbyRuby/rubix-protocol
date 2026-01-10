/**
 * Migration Types
 *
 * Shared types and interfaces for the God Agent migration system.
 */

/**
 * Configuration for migration operations
 */
export interface MigrationConfig {
  /** Data directory for God Agent storage */
  dataDir: string;
  /** If true, preview changes without storing */
  dryRun: boolean;
  /** Number of items to process per batch (for git commits) */
  batchSize: number;
  /** Show real-time progress output */
  progress: boolean;
  /** Resume from interrupted migration */
  resume: boolean;
  /** Project root directory */
  projectRoot: string;
}

/**
 * Result from a migration phase
 */
export interface MigrationResult {
  /** Name of the phase (git, skills, security, claude-md) */
  phase: string;
  /** Number of memory entries stored */
  entriesStored: number;
  /** Number of causal relations created */
  relationsCreated: number;
  /** List of errors encountered */
  errors: string[];
  /** Duration in milliseconds */
  duration: number;
  /** Whether this was a dry run */
  dryRun: boolean;
}

/**
 * State for resume capability
 */
export interface MigrationState {
  /** When migration started */
  startedAt: Date;
  /** List of completed phase names */
  completedPhases: string[];
  /** Last processed git commit SHA (for resume) */
  lastCommitSha?: string;
  /** Total entries stored across all phases */
  totalEntries: number;
  /** Total relations created */
  totalRelations: number;
}

/**
 * Parsed git commit data
 */
export interface GitCommit {
  /** Full SHA hash */
  sha: string;
  /** Short SHA (7 chars) */
  shortSha: string;
  /** Author name */
  author: string;
  /** Author email */
  email: string;
  /** Commit timestamp (unix) */
  timestamp: number;
  /** Commit subject line */
  subject: string;
  /** Parent commit SHA(s) */
  parents: string[];
  /** Files changed with stats */
  files: GitFileChange[];
  /** Total insertions */
  insertions: number;
  /** Total deletions */
  deletions: number;
}

/**
 * File change in a git commit
 */
export interface GitFileChange {
  /** File path */
  path: string;
  /** Lines added */
  insertions: number;
  /** Lines removed */
  deletions: number;
}

/**
 * Skill file definition
 */
export interface SkillFile {
  /** File path relative to project root */
  path: string;
  /** Tags to apply to entries */
  tags: string[];
  /** Description for logging */
  description: string;
}

/**
 * Security pattern definition
 */
export interface SecurityPattern {
  /** Pattern name */
  name: string;
  /** Description of the security pattern */
  description: string;
  /** Tags to apply */
  tags: string[];
  /** File paths to analyze */
  files: string[];
  /** Grep patterns to search for */
  patterns: string[];
}

/**
 * Progress callback for real-time updates
 */
export type ProgressCallback = (
  phase: string,
  current: number,
  total: number,
  message?: string
) => void;

/**
 * Default migration configuration
 */
export const DEFAULT_MIGRATION_CONFIG: Partial<MigrationConfig> = {
  dataDir: './data',
  dryRun: false,
  batchSize: 50,
  progress: true,
  resume: false,
};

/**
 * Skill files to migrate
 */
export const SKILL_FILES: SkillFile[] = [
  {
    path: '.claude/skills/dxf.md',
    tags: ['skill', 'dxf', 'python', 'ezdxf'],
    description: 'DXF/CAD generation with ezdxf',
  },
  {
    path: '.claude/skills/laravel-backend.md',
    tags: ['skill', 'laravel', 'php', 'backend'],
    description: 'Laravel backend patterns',
  },
  {
    path: '.claude/skills/tall-stack.md',
    tags: ['skill', 'tailwind', 'alpine', 'frontend'],
    description: 'TALL stack (Tailwind/Alpine/Laravel/Livewire)',
  },
  {
    path: '.claude/skills/nesc-joint-use-SKILL.md',
    tags: ['skill', 'nesc', 'clearance', 'engineering'],
    description: 'NESC joint-use clearance rules',
  },
  {
    path: '.claude/skills/nesc-clearance-tables-SKILL.md',
    tags: ['skill', 'nesc', 'tables', 'reference'],
    description: 'NESC clearance reference tables',
  },
  {
    path: '.claude/skills/make-ready-logic-SKILL.md',
    tags: ['skill', 'make-ready', 'engineering'],
    description: 'Make-ready engineering logic',
  },
];

/**
 * Security patterns to extract
 */
export const SECURITY_PATTERNS: SecurityPattern[] = [
  {
    name: 'authentication',
    description: 'Authentication and login flow',
    tags: ['security', 'auth', 'sanctum'],
    files: ['app/Http/Controllers/AuthController.php'],
    patterns: ['Auth::', 'login', 'logout', 'sanctum'],
  },
  {
    name: 'rate-limiting',
    description: 'Rate limiting middleware configuration',
    tags: ['security', 'rate-limit', 'middleware'],
    files: ['app/Http/Kernel.php', 'app/Providers/RouteServiceProvider.php'],
    patterns: ['RateLimiter', 'throttle', 'rate_limit'],
  },
  {
    name: 'multi-tenant',
    description: 'Multi-tenant company isolation',
    tags: ['security', 'multi-tenant', 'company'],
    files: ['app/Models/*.php'],
    patterns: ['company_id', 'belongsToCompany', 'scopeForCompany'],
  },
  {
    name: 'validation',
    description: 'Input validation patterns',
    tags: ['security', 'validation', 'xss'],
    files: ['app/Http/Requests/*.php'],
    patterns: ['rules()', 'authorize()', 'sanitize'],
  },
  {
    name: 'csrf',
    description: 'CSRF protection configuration',
    tags: ['security', 'csrf', 'middleware'],
    files: ['app/Http/Middleware/VerifyCsrfToken.php', 'config/session.php'],
    patterns: ['csrf', '_token', 'VerifyCsrfToken'],
  },
];
