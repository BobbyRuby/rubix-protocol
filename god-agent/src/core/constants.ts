/**
 * Core Constants
 *
 * System-wide constants for RUBIX/god-agent.
 */

/**
 * Tags that identify RUBIX system knowledge (preserved during assimilate)
 *
 * Entries with these tags survive the assimilate command.
 * Everything else is considered project-specific and gets wiped.
 */
export const SYSTEM_TAGS = [
  'rubix:core',       // Core system knowledge
  'rubix:config',     // Configuration patterns
  'rubix:learning',   // Sona learning patterns
  'rubix:failure',    // Failure recovery patterns (system-level)
  'rubix:capability', // Capability patterns
  'rubix:meta',       // Meta-knowledge about RUBIX itself
  'rubix:self'        // Self-knowledge (token format architecture)
] as const;

export type SystemTag = typeof SYSTEM_TAGS[number];

/**
 * Check if a tag is a system tag
 */
export function isSystemTag(tag: string): tag is SystemTag {
  return SYSTEM_TAGS.includes(tag as SystemTag);
}

/**
 * Check if an entry has any system tags
 */
export function hasSystemTags(tags: string[]): boolean {
  return tags.some(isSystemTag);
}
