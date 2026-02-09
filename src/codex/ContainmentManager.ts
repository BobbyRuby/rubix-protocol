/**
 * ContainmentManager
 *
 * Path-based permission system for RUBIX autonomous operations.
 * Ensures the agent operates within defined boundaries.
 *
 * Default behavior:
 * - Project folder is always allowed (read-write)
 * - Outside project folder requires explicit permission or task confirmation
 * - Dangerous paths (secrets, keys, etc.) are always denied
 */

import { join, resolve, isAbsolute } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { minimatch } from 'minimatch';

/**
 * Permission level for a path
 */
export type PermissionLevel = 'deny' | 'read' | 'write' | 'read-write';

/**
 * Single path permission rule
 */
export interface PathPermission {
  /** Glob pattern to match */
  pattern: string;
  /** Permission level for matching paths */
  permission: PermissionLevel;
  /** Human-readable reason for this rule */
  reason?: string;
  /** Priority (higher = checked first). Default: 0 */
  priority?: number;
  /** If true, rule cannot be removed or overridden via MCP tools */
  immutable?: boolean;
}

/**
 * Result of a modification operation
 */
export interface ModifyResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Reason for failure (if any) */
  reason?: string;
}

/**
 * Containment configuration
 */
export interface ContainmentConfig {
  /** Enable containment checks (default: true) */
  enabled: boolean;
  /** Project root - always allowed for read-write */
  projectRoot: string;
  /** Path permission rules (checked in priority order) */
  permissions: PathPermission[];
  /** Default permission for unmatched paths (default: 'deny') */
  defaultPermission: PermissionLevel;
  /** Allow task-specific overrides via user confirmation */
  allowTaskOverrides: boolean;
}

/**
 * Persisted containment rules file format
 */
export interface ContainmentRulesFile {
  version: number;
  rules: Array<{
    pattern: string;
    permission: PermissionLevel;
    reason?: string;
    priority?: number;
  }>;
}

/**
 * Result of a permission check
 */
export interface PermissionResult {
  /** Whether the operation is allowed */
  allowed: boolean;
  /** Reason for the decision */
  reason: string;
  /** The rule that matched (if any) */
  matchedRule?: PathPermission;
  /** Whether this can be overridden with task confirmation */
  canOverride: boolean;
}

/**
 * Default containment configuration
 */
export const DEFAULT_CONTAINMENT_CONFIG: ContainmentConfig = {
  enabled: true,
  projectRoot: process.cwd(),
  defaultPermission: 'deny',
  allowTaskOverrides: true,
  permissions: [
    // === IMMUTABLE SECURITY RULES (cannot be removed or overridden via MCP) ===
    { pattern: '**/.env', permission: 'deny', reason: 'Environment secrets', priority: 100, immutable: true },
    { pattern: '**/.env.*', permission: 'deny', reason: 'Environment secrets', priority: 100, immutable: true },
    { pattern: '**/.env.local', permission: 'deny', reason: 'Local environment secrets', priority: 100, immutable: true },
    { pattern: '**/credentials*', permission: 'deny', reason: 'Credentials file', priority: 100, immutable: true },
    { pattern: '**/secrets*', permission: 'deny', reason: 'Secrets file', priority: 100, immutable: true },
    { pattern: '**/*.key', permission: 'deny', reason: 'Private key file', priority: 100, immutable: true },
    { pattern: '**/*.pem', permission: 'deny', reason: 'Certificate/key file', priority: 100, immutable: true },
    { pattern: '**/*.p12', permission: 'deny', reason: 'Certificate file', priority: 100, immutable: true },
    { pattern: '**/*_rsa', permission: 'deny', reason: 'RSA private key', priority: 100, immutable: true },
    { pattern: '**/*_dsa', permission: 'deny', reason: 'DSA private key', priority: 100, immutable: true },
    { pattern: '**/*_ed25519', permission: 'deny', reason: 'ED25519 private key', priority: 100, immutable: true },
    { pattern: '~/.ssh/**', permission: 'deny', reason: 'SSH keys directory', priority: 100, immutable: true },
    { pattern: '**/id_rsa*', permission: 'deny', reason: 'SSH private key', priority: 100, immutable: true },
    { pattern: '**/id_dsa*', permission: 'deny', reason: 'SSH private key', priority: 100, immutable: true },
    { pattern: '**/id_ed25519*', permission: 'deny', reason: 'SSH private key', priority: 100, immutable: true },
    { pattern: '**/.git/config', permission: 'read', reason: 'Git config (may contain tokens)', priority: 90, immutable: true },
    { pattern: '**/.npmrc', permission: 'deny', reason: 'NPM config (may contain tokens)', priority: 100, immutable: true },
    { pattern: '**/.pypirc', permission: 'deny', reason: 'PyPI config (may contain tokens)', priority: 100, immutable: true },

    // === SYSTEM PATHS (read-only or deny) - immutable for safety ===
    { pattern: '/etc/**', permission: 'read', reason: 'System config (read-only)', priority: 80, immutable: true },
    { pattern: '/var/**', permission: 'deny', reason: 'System data', priority: 80, immutable: true },
    { pattern: '/usr/**', permission: 'read', reason: 'System binaries (read-only)', priority: 80, immutable: true },
    { pattern: '/boot/**', permission: 'deny', reason: 'Boot partition', priority: 80, immutable: true },
    { pattern: '/sbin/**', permission: 'deny', reason: 'System binaries', priority: 80, immutable: true },
    { pattern: '/proc/**', permission: 'deny', reason: 'Process filesystem', priority: 80, immutable: true },
    { pattern: '/sys/**', permission: 'deny', reason: 'Kernel filesystem', priority: 80, immutable: true },

    // === DEVELOPMENT PATHS (controlled access - NOT immutable, can be adjusted) ===
    { pattern: '**/node_modules/**', permission: 'read', reason: 'Dependencies (read-only)', priority: 50 },
    { pattern: '**/vendor/**', permission: 'read', reason: 'Vendor dependencies (read-only)', priority: 50 },
    { pattern: '**/.git/**', permission: 'read', reason: 'Git internals (read-only)', priority: 50 },
    { pattern: '**/dist/**', permission: 'read-write', reason: 'Build output', priority: 40 },
    { pattern: '**/build/**', permission: 'read-write', reason: 'Build output', priority: 40 },
    { pattern: '**/package.json', permission: 'read-write', reason: 'Package manifest', priority: 30 },
    { pattern: '**/package-lock.json', permission: 'read-write', reason: 'Package lock', priority: 30 },
    { pattern: '**/tsconfig*.json', permission: 'read-write', reason: 'TypeScript config', priority: 30 },
    { pattern: '**/composer.json', permission: 'read-write', reason: 'Composer manifest', priority: 30 },
    { pattern: '**/composer.lock', permission: 'read-write', reason: 'Composer lock', priority: 30 },
  ]
};

/**
 * ContainmentManager - Enforces path-based permissions
 */
export class ContainmentManager {
  private config: ContainmentConfig;
  private sortedPermissions: PathPermission[] = [];
  private taskOverrides: Map<string, Set<string>> = new Map();
  /** Session-scoped permissions (cleared on restart) */
  private sessionPermissions: PathPermission[] = [];
  /** User-defined rules (persisted to file) */
  private userRules: PathPermission[] = [];
  /** Path to containment.json for persistence */
  private rulesFilePath: string | null = null;

  constructor(config: Partial<ContainmentConfig> = {}) {
    this.config = { ...DEFAULT_CONTAINMENT_CONFIG, ...config };
    // Sort permissions by priority (descending)
    this.resortPermissions();
  }

  /**
   * Set the path for rules persistence and load existing rules
   */
  setRulesFilePath(dataDir: string): void {
    this.rulesFilePath = join(dataDir, 'containment.json');
    this.loadRules();
  }

  /**
   * Load user rules from containment.json
   */
  loadRules(): void {
    if (!this.rulesFilePath || !existsSync(this.rulesFilePath)) {
      return;
    }

    try {
      const content = readFileSync(this.rulesFilePath, 'utf-8');
      const data: ContainmentRulesFile = JSON.parse(content);

      if (data.version !== 1) {
        console.warn(`[Containment] Unknown rules file version: ${data.version}`);
        return;
      }

      // Load rules with user priority range (max 89)
      this.userRules = data.rules.map(rule => ({
        pattern: rule.pattern,
        permission: rule.permission,
        reason: rule.reason || `User rule: ${rule.pattern}`,
        priority: Math.min(rule.priority ?? 60, 89),
        immutable: false
      }));

      this.resortPermissions();
      console.log(`[Containment] Loaded ${this.userRules.length} user rules from ${this.rulesFilePath}`);
    } catch (error) {
      console.error(`[Containment] Failed to load rules:`, error);
    }
  }

  /**
   * Save user rules to containment.json
   */
  saveRules(): void {
    if (!this.rulesFilePath) {
      console.warn('[Containment] No rules file path set, cannot save');
      return;
    }

    try {
      // Ensure directory exists
      const dir = dirname(this.rulesFilePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const data: ContainmentRulesFile = {
        version: 1,
        rules: this.userRules.map(rule => ({
          pattern: rule.pattern,
          permission: rule.permission,
          reason: rule.reason,
          priority: rule.priority
        }))
      };

      writeFileSync(this.rulesFilePath, JSON.stringify(data, null, 2));
      console.log(`[Containment] Saved ${this.userRules.length} user rules to ${this.rulesFilePath}`);
    } catch (error) {
      console.error(`[Containment] Failed to save rules:`, error);
    }
  }

  /**
   * Get all user-defined rules (for display/CLI)
   */
  getUserRules(): PathPermission[] {
    return [...this.userRules];
  }

  /**
   * Add a user rule (persisted to file)
   */
  addUserRule(pattern: string, permission: PermissionLevel, reason?: string, priority?: number): ModifyResult {
    const normalizedPattern = pattern.replace(/\\/g, '/');

    // Cap priority to 89
    const cappedPriority = Math.min(priority ?? 60, 89);

    // Check if trying to allow what immutable rules deny
    if (permission !== 'deny') {
      const conflictingImmutable = this.config.permissions.find(p =>
        p.immutable &&
        p.permission === 'deny' &&
        this.patternsOverlap(normalizedPattern, p.pattern)
      );
      if (conflictingImmutable) {
        this.auditLog('addUserRule', { pattern: normalizedPattern, permission }, false);
        return {
          success: false,
          reason: `Cannot override immutable security rule: ${conflictingImmutable.pattern}`
        };
      }
    }

    // Check if rule already exists
    const existingIndex = this.userRules.findIndex(r => r.pattern === normalizedPattern);
    if (existingIndex >= 0) {
      // Update existing rule
      this.userRules[existingIndex] = {
        pattern: normalizedPattern,
        permission,
        reason: reason || `User rule: ${normalizedPattern}`,
        priority: cappedPriority,
        immutable: false
      };
    } else {
      // Add new rule
      this.userRules.push({
        pattern: normalizedPattern,
        permission,
        reason: reason || `User rule: ${normalizedPattern}`,
        priority: cappedPriority,
        immutable: false
      });
    }

    this.resortPermissions();
    this.saveRules();
    this.auditLog('addUserRule', { pattern: normalizedPattern, permission, priority: cappedPriority }, true);
    return { success: true };
  }

  /**
   * Remove a user rule by pattern
   */
  removeUserRule(pattern: string): ModifyResult {
    const normalizedPattern = pattern.replace(/\\/g, '/');
    const index = this.userRules.findIndex(r => r.pattern === normalizedPattern);

    if (index === -1) {
      return { success: false, reason: `User rule not found: ${pattern}` };
    }

    this.userRules.splice(index, 1);
    this.resortPermissions();
    this.saveRules();
    this.auditLog('removeUserRule', { pattern: normalizedPattern }, true);
    return { success: true };
  }

  /**
   * Check if an operation is allowed on a path
   */
  checkPermission(path: string, operation: 'read' | 'write'): PermissionResult {
    // If containment is disabled, allow everything
    if (!this.config.enabled) {
      return { allowed: true, reason: 'Containment disabled', canOverride: false };
    }

    // Normalize the path
    const normalizedPath = this.normalizePath(path);

    // Check if within project root - always allowed
    if (this.isInProjectRoot(normalizedPath)) {
      // But still check for dangerous patterns within project
      const dangerousMatch = this.checkDangerousPatterns(normalizedPath);
      if (dangerousMatch) {
        return {
          allowed: false,
          reason: dangerousMatch.reason || 'Dangerous file pattern',
          matchedRule: dangerousMatch,
          canOverride: false // Never allow override for dangerous patterns
        };
      }
      return { allowed: true, reason: 'Within project root', canOverride: false };
    }

    // Check explicit permissions
    const matchingRule = this.findMatchingPermission(normalizedPath);
    if (matchingRule) {
      const allowed = this.permissionAllows(matchingRule.permission, operation);
      return {
        allowed,
        reason: matchingRule.reason || `Matched pattern: ${matchingRule.pattern}`,
        matchedRule: matchingRule,
        canOverride: this.config.allowTaskOverrides && !this.isDangerousPattern(matchingRule)
      };
    }

    // Apply default permission
    const allowed = this.permissionAllows(this.config.defaultPermission, operation);
    return {
      allowed,
      reason: `Default permission: ${this.config.defaultPermission}`,
      canOverride: this.config.allowTaskOverrides
    };
  }

  /**
   * Add a task-specific override (requires user confirmation)
   */
  addTaskOverride(taskId: string, path: string): void {
    if (!this.taskOverrides.has(taskId)) {
      this.taskOverrides.set(taskId, new Set());
    }
    this.taskOverrides.get(taskId)!.add(this.normalizePath(path));
  }

  /**
   * Check if a path has a task-specific override
   */
  hasTaskOverride(taskId: string, path: string): boolean {
    const overrides = this.taskOverrides.get(taskId);
    if (!overrides) return false;
    return overrides.has(this.normalizePath(path));
  }

  /**
   * Clear task overrides when task completes
   */
  clearTaskOverrides(taskId: string): void {
    this.taskOverrides.delete(taskId);
  }

  /**
   * Add a session-scoped permission (temporary, clears on restart)
   * Still respects immutable security rules.
   */
  addSessionPermission(pattern: string, permission: PermissionLevel, reason?: string): ModifyResult {
    // Normalize pattern
    const normalizedPattern = pattern.replace(/\\/g, '/');

    // Check if trying to allow what immutable rules deny
    // Note: We don't block the addition, we just warn - the priority system handles it
    // Security rules at priority 100 will still be checked first

    // Add session permission at priority 15 (above defaults, below everything else)
    this.sessionPermissions.push({
      pattern: normalizedPattern,
      permission,
      reason: reason || `Session access: ${normalizedPattern}`,
      priority: 15
    });

    // Re-sort all permissions
    this.resortPermissions();

    this.auditLog('addSessionPermission', { pattern: normalizedPattern, permission }, true);
    return { success: true };
  }

  /**
   * Remove a session permission by pattern
   */
  removeSessionPermission(pattern: string): ModifyResult {
    const normalizedPattern = pattern.replace(/\\/g, '/');
    const index = this.sessionPermissions.findIndex(p => p.pattern === normalizedPattern);
    if (index === -1) {
      return { success: false, reason: 'Session permission not found' };
    }
    this.sessionPermissions.splice(index, 1);
    this.resortPermissions();
    this.auditLog('removeSessionPermission', { pattern: normalizedPattern }, true);
    return { success: true };
  }

  /**
   * List current session permissions
   */
  getSessionPermissions(): PathPermission[] {
    return [...this.sessionPermissions];
  }

  /**
   * Clear all session permissions
   */
  clearSessionPermissions(): void {
    this.sessionPermissions = [];
    this.resortPermissions();
    this.auditLog('clearSessionPermissions', {}, true);
  }

  /**
   * Add a new permission rule
   * Returns ModifyResult indicating success/failure
   */
  addPermission(permission: PathPermission): ModifyResult {
    // Cap priority to 89 - cannot exceed immutable level (90+)
    const cappedPermission = {
      ...permission,
      priority: Math.min(permission.priority ?? 0, 89)
    };

    // Check if trying to allow what immutable rules deny
    if (cappedPermission.permission !== 'deny') {
      const conflictingImmutable = this.sortedPermissions.find(p =>
        p.immutable &&
        p.permission === 'deny' &&
        this.patternsOverlap(cappedPermission.pattern, p.pattern)
      );
      if (conflictingImmutable) {
        this.auditLog('addPermission', { pattern: permission.pattern, permission: permission.permission }, false);
        return {
          success: false,
          reason: `Cannot override immutable security rule: ${conflictingImmutable.pattern}`
        };
      }
    }

    this.config.permissions.push(cappedPermission);
    this.resortPermissions();
    this.auditLog('addPermission', { pattern: cappedPermission.pattern, permission: cappedPermission.permission }, true);
    return { success: true };
  }

  /**
   * Remove a permission rule by pattern
   * Returns ModifyResult indicating success/failure
   */
  removePermission(pattern: string): ModifyResult {
    const rule = this.config.permissions.find(p => p.pattern === pattern);

    // Check if rule exists
    if (!rule) {
      return { success: false, reason: `Rule not found: ${pattern}` };
    }

    // Check if rule is immutable
    if (rule.immutable) {
      this.auditLog('removePermission', { pattern }, false);
      return {
        success: false,
        reason: `Cannot remove immutable security rule: ${pattern}`
      };
    }

    // Remove the rule
    const index = this.config.permissions.indexOf(rule);
    this.config.permissions.splice(index, 1);
    this.resortPermissions();
    this.auditLog('removePermission', { pattern }, true);
    return { success: true };
  }

  /**
   * Check if two glob patterns could potentially overlap
   *
   * CONSERVATIVE approach: Only block DIRECT override attempts.
   * The priority system (immutable rules at 100 vs user rules capped at 89)
   * ensures security even when we allow broad patterns.
   */
  private patternsOverlap(newPattern: string, existingPattern: string): boolean {
    // Normalize patterns
    const normNew = newPattern.replace(/\\/g, '/');
    const normExisting = existingPattern.replace(/\\/g, '/');

    // 1. Exact match - direct override attempt
    if (normNew === normExisting) {
      return true;
    }

    // 2. If new pattern contains wildcards, it's a BROAD permission request
    //    Let the priority system handle it - immutable rules will still win
    if (normNew.includes('*') || normNew.includes('?')) {
      return false;
    }

    // 3. For specific paths (no wildcards), check if it matches the deny pattern
    //    e.g., "C:/project/.env" should be blocked by "**/.env"
    if (minimatch(normNew, normExisting, { dot: true })) {
      return true;
    }

    // 4. Check basename for patterns like "**/.env*" or "**/secrets*"
    //    Only applies when new pattern has a non-empty basename
    const newBase = normNew.split('/').pop() || '';
    const existingBase = normExisting.split('/').pop() || '';
    if (newBase && existingBase.includes('*') && minimatch(newBase, existingBase, { dot: true })) {
      return true;
    }

    return false;
  }

  /**
   * Get current configuration
   */
  getConfig(): ContainmentConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   * Returns ModifyResult indicating success/failure
   * NOTE: Cannot disable containment via MCP tools for security
   */
  updateConfig(updates: Partial<ContainmentConfig>): ModifyResult {
    // Security: Cannot disable containment via MCP
    if (updates.enabled === false) {
      this.auditLog('updateConfig', { attempted: 'enabled: false' }, false);
      return {
        success: false,
        reason: 'Containment cannot be disabled via MCP tools. Use RUBIX_CONTAINMENT_DISABLED=true at startup if needed.'
      };
    }

    // Apply valid updates
    const safeUpdates = { ...updates };
    delete safeUpdates.enabled; // Remove enabled from updates (only true is valid anyway)

    this.config = { ...this.config, ...safeUpdates };
    if (safeUpdates.permissions) {
      this.resortPermissions();
    }
    this.auditLog('updateConfig', safeUpdates, true);
    return { success: true };
  }

  /**
   * Set project root
   */
  setProjectRoot(projectRoot: string): void {
    this.config.projectRoot = resolve(projectRoot);
  }

  /**
   * Normalize a path for comparison
   */
  private normalizePath(path: string): string {
    // Expand ~ to home directory
    if (path.startsWith('~')) {
      const home = process.env.HOME || process.env.USERPROFILE || '';
      path = join(home, path.slice(1));
    }

    // Make absolute and normalize
    if (!isAbsolute(path)) {
      path = resolve(path);
    }

    // Normalize separators for cross-platform
    return path.replace(/\\/g, '/');
  }

  /**
   * Check if path is within project root
   */
  private isInProjectRoot(normalizedPath: string): boolean {
    const normalizedRoot = this.normalizePath(this.config.projectRoot);
    return normalizedPath.startsWith(normalizedRoot + '/') || normalizedPath === normalizedRoot;
  }

  /**
   * Find matching permission rule
   */
  private findMatchingPermission(normalizedPath: string): PathPermission | undefined {
    for (const rule of this.sortedPermissions) {
      if (this.matchesPattern(normalizedPath, rule.pattern)) {
        return rule;
      }
    }
    return undefined;
  }

  /**
   * Check for dangerous patterns (high-priority deny rules)
   */
  private checkDangerousPatterns(normalizedPath: string): PathPermission | undefined {
    for (const rule of this.sortedPermissions) {
      if ((rule.priority ?? 0) >= 90 && rule.permission === 'deny') {
        if (this.matchesPattern(normalizedPath, rule.pattern)) {
          return rule;
        }
      }
    }
    return undefined;
  }

  /**
   * Check if a rule is for dangerous patterns
   */
  private isDangerousPattern(rule: PathPermission): boolean {
    return (rule.priority ?? 0) >= 90 && rule.permission === 'deny';
  }

  /**
   * Check if a path matches a pattern
   */
  private matchesPattern(path: string, pattern: string): boolean {
    // Normalize pattern
    let normalizedPattern = pattern.replace(/\\/g, '/');

    // Expand ~ in pattern
    if (normalizedPattern.startsWith('~')) {
      const home = (process.env.HOME || process.env.USERPROFILE || '').replace(/\\/g, '/');
      normalizedPattern = home + normalizedPattern.slice(1);
    }

    // Use minimatch for glob matching
    return minimatch(path, normalizedPattern, {
      dot: true,
      nocase: process.platform === 'win32',
      matchBase: !normalizedPattern.includes('/')
    });
  }

  /**
   * Check if permission level allows operation
   */
  private permissionAllows(permission: PermissionLevel, operation: 'read' | 'write'): boolean {
    if (permission === 'deny') return false;
    if (permission === 'read-write') return true;
    return permission === operation;
  }

  /**
   * Re-sort all permissions (config + user + session) by priority
   */
  private resortPermissions(): void {
    // Combine config permissions + user rules + session permissions
    const allPermissions = [...this.config.permissions, ...this.userRules, ...this.sessionPermissions];
    this.sortedPermissions = allPermissions.sort(
      (a, b) => (b.priority ?? 0) - (a.priority ?? 0)
    );
  }

  /**
   * Audit log for security-relevant operations
   */
  private auditLog(action: string, details: Record<string, unknown>, allowed: boolean): void {
    const entry = {
      timestamp: new Date().toISOString(),
      component: 'ContainmentManager',
      action,
      details,
      allowed,
      source: 'mcp'
    };
    console.log(`[Containment Audit] ${JSON.stringify(entry)}`);
  }
}

export default ContainmentManager;
