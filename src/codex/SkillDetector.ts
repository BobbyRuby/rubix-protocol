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
  'wp': ['polyglot:wordpress'],
  'plugin': ['polyglot:wordpress'],
  'php': ['polyglot:php'],

  // JavaScript ecosystem
  'javascript': ['polyglot:javascript'],
  'js': ['polyglot:javascript'],
  'typescript': ['polyglot:javascript'],
  'jquery': ['polyglot:javascript'],
  'react': ['polyglot:javascript'],
  'vue': ['polyglot:javascript'],

  // Leaflet (dedicated entry)
  'leaflet': ['polyglot:leaflet'],
  'geojson': ['polyglot:leaflet'],
  'marker': ['polyglot:leaflet'],
  'tile': ['polyglot:leaflet'],

  // 3D frameworks
  'three.js': ['polyglot:threejs'],
  'threejs': ['polyglot:threejs'],
  'three js': ['polyglot:threejs'],
  'babylon': ['polyglot:babylonjs'],
  'babylonjs': ['polyglot:babylonjs'],
  'babylon.js': ['polyglot:babylonjs'],
  'r3f': ['polyglot:r3f'],
  'react-three-fiber': ['polyglot:r3f'],
  'react three fiber': ['polyglot:r3f'],
  'drei': ['polyglot:r3f'],
  'fiber': ['polyglot:r3f'],
  'aframe': ['polyglot:aframe'],
  'a-frame': ['polyglot:aframe'],
  'a frame': ['polyglot:aframe'],
  'webvr': ['polyglot:aframe'],
  'webxr': ['polyglot:aframe'],
  'webgl': ['polyglot:js3d'],

  // Python
  'python': ['polyglot:python'],

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
  /** Number of entries from local memory */
  localCount?: number;
  /** Number of entries from shared/core brain memory */
  sharedCount?: number;
}

/**
 * Load polyglot knowledge from memory based on detected skills.
 *
 * Queries the memory engine for entries matching the skill tags
 * and formats them for prompt injection.
 *
 * Supports multi-source queries for shared knowledge:
 * - Primary engine: Local project memory (project-specific patterns)
 * - Additional engines: Shared core brain memory (cross-project knowledge)
 *
 * @param engine - Primary MemoryEngine instance (local project memory)
 * @param skills - Array of polyglot tags from detectSkills()
 * @param additionalEngines - Optional additional engines (e.g., core brain)
 * @returns Formatted polyglot context string, or empty if no matches
 *
 * @example
 * ```typescript
 * const skills = detectSkills("Build a Laravel REST API");
 * const context = await loadPolyglotContext(engine, skills);
 * // Returns formatted polyglot knowledge for Laravel and API patterns
 *
 * // With core brain:
 * const context = await loadPolyglotContext(localEngine, skills, [coreBrainEngine]);
 * // Returns merged results from local + shared memory
 * ```
 */
export async function loadPolyglotContext(
  engine: MemoryEngine,
  skills: string[],
  additionalEngines?: MemoryEngine[]
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
    // === MULTI-SOURCE QUERY ===
    // Query both local and additional engines (e.g., core brain)
    const queryOptions = {
      topK: 10,
      filters: { tags: skills, tagMatchAll: false },
      minScore: 0.2
    };

    // Query local memory
    const localResults = await engine.query('polyglot knowledge patterns best practices', queryOptions);

    // Query additional engines (shared memory)
    const sharedResults: Array<{ result: any; source: string }> = [];
    if (additionalEngines && additionalEngines.length > 0) {
      for (let i = 0; i < additionalEngines.length; i++) {
        try {
          const results = await additionalEngines[i].query(
            'polyglot knowledge patterns best practices',
            queryOptions
          );
          sharedResults.push(
            ...results.map(r => ({ result: r, source: `shared_${i}` }))
          );
        } catch (error) {
          console.warn(`[SkillDetector] Failed to query additional engine ${i}:`, error);
        }
      }
    }

    // Merge and deduplicate results
    const allResults = [
      ...localResults.map(r => ({ result: r, source: 'local' })),
      ...sharedResults
    ];

    // Sort by score (descending) and take top results
    allResults.sort((a, b) => b.result.score - a.result.score);
    const topResults = allResults.slice(0, 15); // Take top 15 total

    const localCount = topResults.filter(r => r.source === 'local').length;
    const sharedCount = topResults.filter(r => r.source.startsWith('shared_')).length;

    if (topResults.length === 0) {
      console.log(`[SkillDetector] No polyglot entries found for tags: ${skills.join(', ')}`);

      logger.logResponse(
        'POLYGLOT_LOAD_EMPTY',
        `No entries found for: ${skills.join(', ')}`,
        JSON.stringify({
          skills,
          entriesFound: 0,
          localCount: 0,
          sharedCount: 0
        }, null, 2),
        0,
        undefined,
        'skill_detector'
      );

      return { context: '', entriesFound: 0, matchedTags: skills, localCount: 0, sharedCount: 0 };
    }

    // Format results for prompt injection
    const contextParts: string[] = [];
    const seenContent = new Set<string>(); // Dedupe by content hash
    const entrySummaries: Array<{ id: string; tags: string[]; contentLength: number; source: string }> = [];

    for (const { result: r, source } of topResults) {
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

      // Add source label for debugging
      const sourceLabel = source === 'local' ? '[Local]' : '[Shared]';
      contextParts.push(
        `### ${sourceLabel} ${polyglotTags.join(', ')}\n${content}`
      );

      entrySummaries.push({
        id: r.entry.id,
        tags: polyglotTags,
        contentLength: r.entry.content.length,
        source
      });
    }

    const formattedContext = contextParts.length > 0
      ? `\n## POLYGLOT KNOWLEDGE (auto-loaded)\n${contextParts.join('\n\n')}`
      : '';

    console.log(
      `[SkillDetector] Loaded ${topResults.length} polyglot entries ` +
      `(${localCount} local, ${sharedCount} shared, ${formattedContext.length} chars)`
    );

    // Log polyglot loading complete
    logger.logResponse(
      'POLYGLOT_LOAD_COMPLETE',
      `Loaded ${topResults.length} entries (${localCount} local, ${sharedCount} shared)`,
      JSON.stringify({
        skills,
        entriesFound: topResults.length,
        localCount,
        sharedCount,
        entries: entrySummaries,
        contextLength: formattedContext.length
      }, null, 2),
      topResults.length,
      undefined,
      'skill_detector'
    );

    return {
      context: formattedContext,
      entriesFound: topResults.length,
      matchedTags: skills,
      localCount,
      sharedCount
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
