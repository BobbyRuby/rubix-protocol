/**
 * SkillDetector - Detects skills/technologies from task descriptions
 *
 * Maps keywords to polyglot memory tags for automatic context loading.
 * Used by PhasedExecutor and PlanningSession to inject relevant
 * polyglot knowledge before execution.
 *
 * Flow: Task → Detect Skills → Query polyglot:* tags → Inject knowledge → Execute
 */

import type { MemoryEngine } from '../core/MemoryEngine.js';

/**
 * Keyword → polyglot tags mapping.
 *
 * Each keyword maps to specific polyglot tags that will be used
 * to query memory for relevant knowledge.
 */
const SKILL_TAG_MAP: Record<string, string[]> = {
  // Platforms
  'laravel': ['polyglot:laravel', 'polyglot:platform'],
  'django': ['polyglot:django', 'polyglot:platform'],
  'rails': ['polyglot:rails', 'polyglot:platform'],
  'ruby on rails': ['polyglot:rails', 'polyglot:platform'],
  'springboot': ['polyglot:springboot', 'polyglot:platform'],
  'spring boot': ['polyglot:springboot', 'polyglot:platform'],
  'spring-boot': ['polyglot:springboot', 'polyglot:platform'],
  'nodejs': ['polyglot:nodejs', 'polyglot:platform'],
  'node.js': ['polyglot:nodejs', 'polyglot:platform'],
  'node js': ['polyglot:nodejs', 'polyglot:platform'],
  'nextjs': ['polyglot:nextjs', 'polyglot:platform'],
  'next.js': ['polyglot:nextjs', 'polyglot:platform'],
  'next js': ['polyglot:nextjs', 'polyglot:platform'],
  'dotnet': ['polyglot:dotnet', 'polyglot:platform'],
  '.net': ['polyglot:dotnet', 'polyglot:platform'],
  'asp.net': ['polyglot:dotnet', 'polyglot:platform'],
  'wordpress': ['polyglot:wordpress', 'polyglot:platform'],

  // Patterns
  'api': ['polyglot:api', 'polyglot:pattern'],
  'rest': ['polyglot:api', 'polyglot:pattern'],
  'restful': ['polyglot:api', 'polyglot:pattern'],
  'graphql': ['polyglot:api', 'polyglot:pattern'],
  'database': ['polyglot:database', 'polyglot:pattern'],
  'sql': ['polyglot:database', 'polyglot:pattern'],
  'postgres': ['polyglot:database', 'polyglot:pattern'],
  'mysql': ['polyglot:database', 'polyglot:pattern'],
  'mongodb': ['polyglot:database', 'polyglot:pattern'],
  'auth': ['polyglot:auth', 'polyglot:pattern'],
  'authentication': ['polyglot:auth', 'polyglot:pattern'],
  'authorization': ['polyglot:auth', 'polyglot:pattern'],
  'login': ['polyglot:auth', 'polyglot:pattern'],
  'oauth': ['polyglot:auth', 'polyglot:pattern'],
  'jwt': ['polyglot:auth', 'polyglot:pattern'],
  'deploy': ['polyglot:deployment', 'polyglot:pattern'],
  'deployment': ['polyglot:deployment', 'polyglot:pattern'],
  'docker': ['polyglot:deployment', 'polyglot:pattern'],
  'kubernetes': ['polyglot:deployment', 'polyglot:pattern'],
  'ci/cd': ['polyglot:deployment', 'polyglot:pattern'],

  // Tools
  'git': ['polyglot:git', 'polyglot:tool'],
  'github': ['polyglot:git', 'polyglot:tool'],
  'gitlab': ['polyglot:git', 'polyglot:tool'],
  'playwright': ['polyglot:playwright', 'polyglot:tool'],
  'puppeteer': ['polyglot:playwright', 'polyglot:tool'],
  'selenium': ['polyglot:playwright', 'polyglot:tool'],
  'test': ['polyglot:testing', 'polyglot:tool'],
  'testing': ['polyglot:testing', 'polyglot:tool'],
  'jest': ['polyglot:testing', 'polyglot:tool'],
  'vitest': ['polyglot:testing', 'polyglot:tool'],
  'pytest': ['polyglot:testing', 'polyglot:tool'],
  'lint': ['polyglot:linting', 'polyglot:tool'],
  'linting': ['polyglot:linting', 'polyglot:tool'],
  'eslint': ['polyglot:linting', 'polyglot:tool'],
  'prettier': ['polyglot:linting', 'polyglot:tool'],
  'vite': ['polyglot:vite', 'polyglot:tool'],
  'webpack': ['polyglot:vite', 'polyglot:tool'],
  'npm': ['polyglot:packagemgr', 'polyglot:tool'],
  'yarn': ['polyglot:packagemgr', 'polyglot:tool'],
  'pnpm': ['polyglot:packagemgr', 'polyglot:tool'],
  'pip': ['polyglot:packagemgr', 'polyglot:tool'],
  'composer': ['polyglot:packagemgr', 'polyglot:tool'],
};

/**
 * Detect skills/technologies mentioned in text.
 *
 * Scans the input text for keywords and returns unique polyglot tags.
 *
 * @param text - Task description or specification to analyze
 * @returns Array of unique polyglot tags (e.g., ['polyglot:laravel', 'polyglot:platform'])
 *
 * @example
 * ```typescript
 * const skills = detectSkills("Build a Laravel REST API with authentication");
 * // Returns: ['polyglot:laravel', 'polyglot:platform', 'polyglot:api', 'polyglot:pattern', 'polyglot:auth']
 * ```
 */
export function detectSkills(text: string): string[] {
  const lower = text.toLowerCase();
  const detected = new Set<string>();

  for (const [keyword, tags] of Object.entries(SKILL_TAG_MAP)) {
    // Use word boundary-aware matching for short keywords to avoid false positives
    if (keyword.length <= 3) {
      // For short keywords (api, git, npm, etc.), require word boundaries
      const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (regex.test(lower)) {
        tags.forEach(t => detected.add(t));
      }
    } else {
      // For longer keywords, simple includes is fine
      if (lower.includes(keyword)) {
        tags.forEach(t => detected.add(t));
      }
    }
  }

  return Array.from(detected);
}

/**
 * Result from polyglot context loading.
 */
export interface PolyglotContextResult {
  /** Formatted context string for injection into prompts */
  context: string;
  /** Number of polyglot entries found */
  entriesFound: number;
  /** Tags that were matched */
  matchedTags: string[];
}

/**
 * Load polyglot knowledge from memory based on detected skills.
 *
 * Queries the memory engine for entries matching the skill tags
 * and formats them for prompt injection.
 *
 * @param engine - MemoryEngine instance for querying
 * @param skills - Array of polyglot tags from detectSkills()
 * @returns Formatted polyglot context string, or empty if no matches
 *
 * @example
 * ```typescript
 * const skills = detectSkills("Build a Laravel REST API");
 * const context = await loadPolyglotContext(engine, skills);
 * // Returns formatted polyglot knowledge for Laravel and API patterns
 * ```
 */
export async function loadPolyglotContext(
  engine: MemoryEngine,
  skills: string[]
): Promise<PolyglotContextResult> {
  if (skills.length === 0) {
    return { context: '', entriesFound: 0, matchedTags: [] };
  }

  try {
    // Query memory for polyglot knowledge matching the detected skills
    const results = await engine.query('polyglot knowledge patterns best practices', {
      topK: 10,
      filters: { tags: skills },
      minScore: 0.2
    });

    if (results.length === 0) {
      console.log(`[SkillDetector] No polyglot entries found for tags: ${skills.join(', ')}`);
      return { context: '', entriesFound: 0, matchedTags: skills };
    }

    // Format results for prompt injection
    const contextParts: string[] = [];
    const seenContent = new Set<string>(); // Dedupe by content hash

    for (const r of results) {
      const tags = r.entry.metadata.tags || [];
      const polyglotTags = tags.filter((t: string) => t.startsWith('polyglot:'));

      // Skip duplicates
      const contentHash = r.entry.content.substring(0, 100);
      if (seenContent.has(contentHash)) continue;
      seenContent.add(contentHash);

      // Truncate long content
      const content = r.entry.content.length > 800
        ? r.entry.content.substring(0, 800) + '...'
        : r.entry.content;

      contextParts.push(
        `### ${polyglotTags.join(', ')}\n${content}`
      );
    }

    const formattedContext = contextParts.length > 0
      ? `\n## POLYGLOT KNOWLEDGE (auto-loaded)\n${contextParts.join('\n\n')}`
      : '';

    console.log(`[SkillDetector] Loaded ${results.length} polyglot entries (${formattedContext.length} chars)`);

    return {
      context: formattedContext,
      entriesFound: results.length,
      matchedTags: skills
    };
  } catch (error) {
    console.error('[SkillDetector] Error loading polyglot context:', error);
    return { context: '', entriesFound: 0, matchedTags: skills };
  }
}

/**
 * Get all available skill keywords for documentation/debugging.
 */
export function getAvailableSkills(): string[] {
  return Object.keys(SKILL_TAG_MAP).sort();
}

/**
 * Get tag mapping for a specific keyword.
 */
export function getTagsForKeyword(keyword: string): string[] | undefined {
  return SKILL_TAG_MAP[keyword.toLowerCase()];
}
