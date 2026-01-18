/**
 * SkillDetector - Detects skills/technologies from task descriptions
 *
 * Maps keywords to polyglot memory tags for automatic context loading.
 * Used by PhasedExecutor and PlanningSession to inject relevant
 * polyglot knowledge before execution.
 *
 * Flow: Task → Detect Skills → Query polyglot:* tags → Inject knowledge → Execute
 */

import { getCodexLogger } from './Logger.js';
import type { MemoryEngine } from '../core/MemoryEngine.js';

/**
 * OPTIMIZED: Module-level regex cache to avoid recompilation on every call.
 * Key format: "pattern:flags"
 */
const REGEX_CACHE = new Map<string, RegExp>();

/**
 * Get a cached regex or create and cache a new one.
 */
function getCachedRegex(pattern: string, flags: string): RegExp {
  const key = `${pattern}:${flags}`;
  let regex = REGEX_CACHE.get(key);
  if (!regex) {
    regex = new RegExp(pattern, flags);
    REGEX_CACHE.set(key, regex);
  }
  return regex;
}

/**
 * Keyword → polyglot tags mapping.
 *
 * Each keyword maps to specific polyglot tags that will be used
 * to query memory for relevant knowledge.
 */
const SKILL_TAG_MAP: Record<string, string[]> = {
  // Platforms (removed useless polyglot:platform category tag)
  'laravel': ['polyglot:laravel'],
  'django': ['polyglot:django'],
  'rails': ['polyglot:rails'],
  'ruby on rails': ['polyglot:rails'],
  'springboot': ['polyglot:springboot'],
  'spring boot': ['polyglot:springboot'],
  'spring-boot': ['polyglot:springboot'],
  'nodejs': ['polyglot:nodejs'],
  'node.js': ['polyglot:nodejs'],
  'node js': ['polyglot:nodejs'],
  'nextjs': ['polyglot:nextjs'],
  'next.js': ['polyglot:nextjs'],
  'next js': ['polyglot:nextjs'],
  'dotnet': ['polyglot:dotnet'],
  '.net': ['polyglot:dotnet'],
  'asp.net': ['polyglot:dotnet'],
  'wordpress': ['polyglot:wordpress'],

  // Patterns (removed useless polyglot:pattern category tag)
  'api': ['polyglot:api'],
  'rest': ['polyglot:api'],
  'restful': ['polyglot:api'],
  'graphql': ['polyglot:api'],
  'database': ['polyglot:database'],
  'sql': ['polyglot:database'],
  'postgres': ['polyglot:database'],
  'mysql': ['polyglot:database'],
  'mongodb': ['polyglot:database'],
  'auth': ['polyglot:auth'],
  'authentication': ['polyglot:auth'],
  'authorization': ['polyglot:auth'],
  'login': ['polyglot:auth'],
  'oauth': ['polyglot:auth'],
  'jwt': ['polyglot:auth'],
  'deploy': ['polyglot:deployment'],
  'deployment': ['polyglot:deployment'],
  'docker': ['polyglot:deployment'],
  'kubernetes': ['polyglot:deployment'],
  'ci/cd': ['polyglot:deployment'],

  // Tools (removed useless polyglot:tool category tag)
  'git': ['polyglot:git'],
  'github': ['polyglot:git'],
  'gitlab': ['polyglot:git'],
  'playwright': ['polyglot:playwright'],
  'puppeteer': ['polyglot:playwright'],
  'selenium': ['polyglot:playwright'],
  'test': ['polyglot:testing'],
  'testing': ['polyglot:testing'],
  'jest': ['polyglot:testing'],
  'vitest': ['polyglot:testing'],
  'pytest': ['polyglot:testing'],
  'lint': ['polyglot:linting'],
  'linting': ['polyglot:linting'],
  'eslint': ['polyglot:linting'],
  'prettier': ['polyglot:linting'],
  'vite': ['polyglot:vite'],
  'webpack': ['polyglot:vite'],
  'npm': ['polyglot:packagemgr'],
  'yarn': ['polyglot:packagemgr'],
  'pnpm': ['polyglot:packagemgr'],
  'pip': ['polyglot:packagemgr'],
  'composer': ['polyglot:packagemgr'],
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
 * // Returns: ['polyglot:laravel', 'polyglot:api', 'polyglot:auth']
 * ```
 */
export function detectSkills(text: string): string[] {
  const lower = text.toLowerCase();
  const detected = new Set<string>();
  const matchedKeywords: string[] = [];

  for (const [keyword, tags] of Object.entries(SKILL_TAG_MAP)) {
    // Use word boundary-aware matching for short keywords to avoid false positives
    if (keyword.length <= 3) {
      // OPTIMIZED: Use cached regex instead of compiling new RegExp on every call
      const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = getCachedRegex(`\\b${escapedKeyword}\\b`, 'i');
      if (regex.test(lower)) {
        matchedKeywords.push(keyword);
        tags.forEach(t => detected.add(t));
      }
    } else {
      // For longer keywords, simple includes is fine
      if (lower.includes(keyword)) {
        matchedKeywords.push(keyword);
        tags.forEach(t => detected.add(t));
      }
    }
  }

  const detectedSkills = Array.from(detected);

  // Log skill detection
  if (detectedSkills.length > 0) {
    const logger = getCodexLogger();
    logger.logResponse(
      'SKILL_DETECTOR',
      `Input: ${text.substring(0, 200)}`,
      JSON.stringify({
        inputLength: text.length,
        matchedKeywords,
        detectedTags: detectedSkills
      }, null, 2),
      detectedSkills.length,
      undefined,
      'skill_detector'
    );
  }

  return detectedSkills;
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
  const logger = getCodexLogger();

  if (skills.length === 0) {
    return { context: '', entriesFound: 0, matchedTags: [] };
  }

  // Log polyglot loading start
  logger.logResponse(
    'POLYGLOT_LOAD_START',
    `Skills: ${skills.join(', ')}`,
    JSON.stringify({
      skillsCount: skills.length,
      skills
    }, null, 2),
    0,
    undefined,
    'skill_detector'
  );

  try {
    // Query memory for polyglot knowledge matching the detected skills
    // Use tagMatchAll: false (OR logic) to find entries with ANY of the detected tags
    // e.g., "Laravel API" should return both laravel entries AND api entries
    const results = await engine.query('polyglot knowledge patterns best practices', {
      topK: 10,
      filters: { tags: skills, tagMatchAll: false },
      minScore: 0.2
    });

    if (results.length === 0) {
      console.log(`[SkillDetector] No polyglot entries found for tags: ${skills.join(', ')}`);

      logger.logResponse(
        'POLYGLOT_LOAD_EMPTY',
        `No entries found for: ${skills.join(', ')}`,
        JSON.stringify({
          skills,
          entriesFound: 0
        }, null, 2),
        0,
        undefined,
        'skill_detector'
      );

      return { context: '', entriesFound: 0, matchedTags: skills };
    }

    // Format results for prompt injection
    const contextParts: string[] = [];
    const seenContent = new Set<string>(); // Dedupe by content hash
    const entrySummaries: Array<{ id: string; tags: string[]; contentLength: number }> = [];

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

      entrySummaries.push({
        id: r.entry.id,
        tags: polyglotTags,
        contentLength: r.entry.content.length
      });
    }

    const formattedContext = contextParts.length > 0
      ? `\n## POLYGLOT KNOWLEDGE (auto-loaded)\n${contextParts.join('\n\n')}`
      : '';

    console.log(`[SkillDetector] Loaded ${results.length} polyglot entries (${formattedContext.length} chars)`);

    // Log polyglot loading complete
    logger.logResponse(
      'POLYGLOT_LOAD_COMPLETE',
      `Loaded ${results.length} entries`,
      JSON.stringify({
        skills,
        entriesFound: results.length,
        entries: entrySummaries,
        contextLength: formattedContext.length
      }, null, 2),
      results.length,
      undefined,
      'skill_detector'
    );

    return {
      context: formattedContext,
      entriesFound: results.length,
      matchedTags: skills
    };
  } catch (error) {
    console.error('[SkillDetector] Error loading polyglot context:', error);

    // Log error
    logger.logResponse(
      'POLYGLOT_LOAD_ERROR',
      `Error loading polyglot context`,
      JSON.stringify({
        skills,
        error: error instanceof Error ? error.message : String(error)
      }, null, 2),
      0,
      undefined,
      'skill_detector',
      error instanceof Error ? error.message : String(error)
    );

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
