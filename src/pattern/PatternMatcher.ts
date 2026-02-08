/**
 * Pattern Matcher
 *
 * Template-based pattern matching for structured information extraction.
 * Uses regex patterns with named slots for flexible matching.
 */

import type { SQLiteStorage } from '../storage/SQLiteStorage.js';
import type { PatternTemplate, PatternMatch, PatternMatcherConfig, PatternSlot, SlotValidationResult, PatternStats, PruneResult } from './types.js';
import { v4 as uuidv4 } from 'uuid';

export class PatternMatcher {
  private storage: SQLiteStorage;
  private config: PatternMatcherConfig;
  private compiledPatterns: Map<string, RegExp> = new Map();

  constructor(storage: SQLiteStorage, config: PatternMatcherConfig) {
    this.storage = storage;
    this.config = config;
  }

  /**
   * Register a new pattern template
   */
  registerTemplate(
    name: string,
    pattern: string,
    slots: PatternSlot[],
    priority: number = 0
  ): PatternTemplate {
    const template: PatternTemplate = {
      id: uuidv4(),
      name,
      pattern,
      slots,
      priority,
      createdAt: new Date()
    };

    this.storage.storePatternTemplate(template);
    this.compilePattern(template);

    return template;
  }

  /**
   * Get a template by name
   */
  getTemplate(name: string): PatternTemplate | null {
    return this.storage.getPatternTemplateByName(name);
  }

  /**
   * Compile a pattern template into a RegExp
   */
  private compilePattern(template: PatternTemplate): void {
    // Convert slot placeholders to regex capture groups
    // Pattern format: "User {name} wants to {action}"
    let regexPattern = template.pattern;

    // Escape special regex characters except our slot syntax
    regexPattern = regexPattern.replace(/[.*+?^${}()|[\]\\]/g, (match) => {
      if (match === '{' || match === '}') return match;
      return '\\' + match;
    });

    // Replace slot placeholders with named capture groups
    for (const slot of template.slots) {
      const slotPattern = `\\{${slot.name}\\}`;
      const captureGroup = this.getSlotRegex(slot);
      regexPattern = regexPattern.replace(new RegExp(slotPattern, 'g'), captureGroup);
    }

    const flags = this.config.caseSensitive ? 'g' : 'gi';
    this.compiledPatterns.set(template.id, new RegExp(regexPattern, flags));
  }

  /**
   * Get regex pattern for a slot type
   */
  private getSlotRegex(slot: PatternSlot): string {
    const name = slot.name;

    switch (slot.type) {
      case 'text':
        return `(?<${name}>[\\w\\s]+?)`;
      case 'entity':
        return `(?<${name}>[A-Z][a-z]+(?:\\s[A-Z][a-z]+)*)`;
      case 'date':
        return `(?<${name}>\\d{4}-\\d{2}-\\d{2}|\\d{1,2}/\\d{1,2}/\\d{2,4}|\\w+\\s\\d{1,2},?\\s\\d{4})`;
      case 'number':
        return `(?<${name}>-?\\d+(?:\\.\\d+)?)`;
      case 'any':
      default:
        return `(?<${name}>.+?)`;
    }
  }

  /**
   * Match text against all registered patterns
   * OPTIMIZED: Pre-fetch template priorities to avoid O(N²) sort queries
   */
  match(text: string): PatternMatch[] {
    const templates = this.storage.getAllPatternTemplates();
    const matches: PatternMatch[] = [];

    // OPTIMIZED: Build priority lookup map upfront (O(N) instead of O(N²))
    const priorityMap = new Map<string, number>(
      templates.map(t => [t.id, t.priority])
    );

    for (const template of templates) {
      // Ensure pattern is compiled
      if (!this.compiledPatterns.has(template.id)) {
        this.compilePattern(template);
      }

      const regex = this.compiledPatterns.get(template.id)!;
      const templateMatches = this.matchTemplate(text, template, regex);
      matches.push(...templateMatches);
    }

    // OPTIMIZED: Sort using pre-fetched priority map (no DB queries in comparator)
    matches.sort((a, b) => {
      const priorityA = priorityMap.get(a.templateId) ?? 0;
      const priorityB = priorityMap.get(b.templateId) ?? 0;
      const priorityDiff = priorityB - priorityA;
      if (priorityDiff !== 0) return priorityDiff;
      return b.confidence - a.confidence;
    });

    // Apply max matches limit
    return matches.slice(0, this.config.maxMatches);
  }

  /**
   * Match text against a specific template
   */
  private matchTemplate(
    text: string,
    template: PatternTemplate,
    regex: RegExp
  ): PatternMatch[] {
    const matches: PatternMatch[] = [];
    let match: RegExpExecArray | null;

    // Reset regex state
    regex.lastIndex = 0;

    while ((match = regex.exec(text)) !== null) {
      const bindings: Record<string, string> = {};
      let allValid = true;

      // Extract and validate slot bindings
      for (const slot of template.slots) {
        const value = match.groups?.[slot.name];

        if (slot.required && !value) {
          allValid = false;
          break;
        }

        if (value) {
          const validation = this.validateSlot(slot, value);
          if (!validation.valid) {
            allValid = false;
            break;
          }
          bindings[slot.name] = validation.normalizedValue ?? value;
        }
      }

      if (allValid) {
        // Calculate confidence based on match quality
        const confidence = this.calculateConfidence(text, match[0], template);

        if (confidence >= this.config.minConfidence) {
          matches.push({
            templateId: template.id,
            templateName: template.name,
            confidence,
            bindings,
            matchedText: match[0],
            startIndex: match.index,
            endIndex: match.index + match[0].length
          });
        }
      }
    }

    return matches;
  }

  /**
   * Validate a slot value
   */
  private validateSlot(slot: PatternSlot, value: string): SlotValidationResult {
    const trimmed = value.trim();

    // Type-specific validation
    switch (slot.type) {
      case 'number': {
        const num = parseFloat(trimmed);
        if (isNaN(num)) {
          return { valid: false, value: trimmed, error: 'Invalid number' };
        }
        return { valid: true, value: trimmed, normalizedValue: num.toString() };
      }

      case 'date': {
        const date = new Date(trimmed);
        if (isNaN(date.getTime())) {
          return { valid: false, value: trimmed, error: 'Invalid date' };
        }
        return { valid: true, value: trimmed, normalizedValue: date.toISOString().split('T')[0] };
      }

      case 'entity': {
        // Entity should start with capital letter
        if (!/^[A-Z]/.test(trimmed)) {
          return { valid: false, value: trimmed, error: 'Entity should start with capital letter' };
        }
        return { valid: true, value: trimmed };
      }

      case 'text':
      case 'any':
      default:
        return { valid: true, value: trimmed };
    }
  }

  /**
   * Calculate match confidence
   */
  private calculateConfidence(
    originalText: string,
    matchedText: string,
    template: PatternTemplate
  ): number {
    // Base confidence from coverage ratio
    const coverageRatio = matchedText.length / originalText.length;

    // Bonus for higher priority templates
    const priorityBonus = Math.min(template.priority * 0.05, 0.2);

    // Penalty for very short matches
    const lengthPenalty = matchedText.length < 10 ? 0.1 : 0;

    const confidence = Math.min(1.0, coverageRatio * 0.8 + 0.2 + priorityBonus - lengthPenalty);

    return Math.max(0, confidence);
  }

  /**
   * Match text against a specific named template
   */
  matchByTemplate(text: string, templateName: string): PatternMatch[] {
    const template = this.storage.getPatternTemplateByName(templateName);
    if (!template) return [];

    if (!this.compiledPatterns.has(template.id)) {
      this.compilePattern(template);
    }

    const regex = this.compiledPatterns.get(template.id)!;
    return this.matchTemplate(text, template, regex);
  }

  /**
   * Extract structured data from text using patterns
   */
  extract(text: string): Record<string, Record<string, string>> {
    const matches = this.match(text);
    const extracted: Record<string, Record<string, string>> = {};

    for (const match of matches) {
      if (!extracted[match.templateName]) {
        extracted[match.templateName] = {};
      }
      Object.assign(extracted[match.templateName], match.bindings);
    }

    return extracted;
  }

  /**
   * Get all registered templates
   */
  getAllTemplates(): PatternTemplate[] {
    return this.storage.getAllPatternTemplates();
  }

  /**
   * Clear compiled pattern cache
   */
  clearCache(): void {
    this.compiledPatterns.clear();
  }

  /**
   * Reload patterns from storage
   */
  reload(): void {
    this.clearCache();
    const templates = this.storage.getAllPatternTemplates();
    for (const template of templates) {
      this.compilePattern(template);
    }
  }

  // ==========================================
  // SUCCESS TRACKING
  // ==========================================

  /**
   * Record a pattern use (success or failure)
   */
  recordUse(patternId: string, success: boolean): void {
    this.storage.recordPatternUse(patternId, success);
  }

  /**
   * Record use for a pattern match
   */
  recordMatchUse(match: PatternMatch, success: boolean): void {
    this.storage.recordPatternUse(match.templateId, success);
  }

  /**
   * Get statistics for a pattern
   */
  getStats(patternId: string): PatternStats | null {
    const row = this.storage.getPatternStats(patternId);
    if (!row) return null;

    return {
      patternId: row.pattern_id,
      useCount: row.use_count,
      successCount: row.success_count,
      successRate: row.success_rate,
      lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : undefined
    };
  }

  /**
   * Get statistics for all patterns
   */
  getAllStats(): PatternStats[] {
    const rows = this.storage.getAllPatternStats();
    return rows.map(row => ({
      patternId: row.pattern_id,
      useCount: row.use_count,
      successCount: row.success_count,
      successRate: row.success_rate,
      lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : undefined
    }));
  }

  // ==========================================
  // PATTERN PRUNING
  // ==========================================

  /**
   * Get patterns that are candidates for pruning
   */
  getPruneCandidates(): Array<{
    pattern: PatternTemplate;
    stats: PatternStats;
  }> {
    const threshold = this.config.pruneThreshold ?? 0.4;
    const minUses = this.config.pruneMinUses ?? 100;

    const candidates = this.storage.getPruneCandidatePatterns(threshold, minUses);
    const result: Array<{ pattern: PatternTemplate; stats: PatternStats }> = [];

    for (const c of candidates) {
      const pattern = this.storage.getPatternTemplate(c.pattern_id);
      if (pattern) {
        result.push({
          pattern,
          stats: {
            patternId: c.pattern_id,
            useCount: c.use_count,
            successCount: Math.round(c.use_count * c.success_rate),
            successRate: c.success_rate,
            lastUsedAt: undefined
          }
        });
      }
    }

    return result;
  }

  /**
   * Prune patterns with low success rates
   *
   * @returns Information about pruned patterns
   */
  prunePatterns(): PruneResult {
    const threshold = this.config.pruneThreshold ?? 0.4;
    const minUses = this.config.pruneMinUses ?? 100;

    const candidates = this.storage.getPruneCandidatePatterns(threshold, minUses);
    const pruned: PruneResult['patterns'] = [];

    for (const c of candidates) {
      const success = this.storage.deletePatternTemplate(c.pattern_id);
      if (success) {
        // Remove from compiled cache
        this.compiledPatterns.delete(c.pattern_id);
        pruned.push({
          id: c.pattern_id,
          name: c.name,
          useCount: c.use_count,
          successRate: c.success_rate
        });
      }
    }

    return {
      pruned: pruned.length,
      patterns: pruned
    };
  }

  /**
   * Delete a specific pattern
   */
  deletePattern(patternId: string): boolean {
    this.compiledPatterns.delete(patternId);
    return this.storage.deletePatternTemplate(patternId);
  }
}
