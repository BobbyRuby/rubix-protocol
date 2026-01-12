/**
 * MemoryCompressor - Bidirectional memory compression engine.
 *
 * Encode: Human text → Pure tokens (for storage)
 * Decode: Pure tokens → Human text (for reading)
 *
 * Rules (same as prompt compression):
 * - No articles (a, an, the)
 * - No pronouns (you, I, we)
 * - No politeness (please, thanks)
 * - No hedging (maybe, might, could)
 * - No filler (basically, actually, really)
 * - No explanatory prose
 */

import {
  MemoryType,
  CompressionSchema,
  CompressionResult,
  ParsedKeyValue,
  TYPE_PREFIXES,
} from './types.js';
import { COMPRESSION_SCHEMAS } from './CompressionSchemas.js';

export class MemoryCompressor {
  private schemas: Map<MemoryType, CompressionSchema>;

  constructor() {
    this.schemas = new Map();
    this.registerCoreSchemas();
  }

  /**
   * Register all built-in compression schemas.
   */
  private registerCoreSchemas(): void {
    for (const [type, schema] of Object.entries(COMPRESSION_SCHEMAS)) {
      this.schemas.set(type as MemoryType, schema);
    }
  }

  /**
   * Compress human-readable text to pure tokens.
   */
  encode(content: string, type: MemoryType): CompressionResult {
    const schema = this.schemas.get(type);
    const compressed = schema
      ? schema.encode(content)
      : this.genericEncode(content);

    return {
      compressed,
      originalLength: content.length,
      compressedLength: compressed.length,
      ratio: 1 - compressed.length / content.length,
      tokensSaved: this.estimateTokensSaved(content.length, compressed.length),
    };
  }

  /**
   * Expand compressed tokens to human-readable text.
   */
  decode(compressed: string, type?: MemoryType): string {
    const detectedType = type || this.detectType(compressed);
    const schema = this.schemas.get(detectedType);

    return schema
      ? schema.decode(compressed)
      : this.genericDecode(compressed);
  }

  /**
   * Auto-detect type and decode.
   */
  autoDecode(compressed: string): string {
    const type = this.detectType(compressed);
    return this.decode(compressed, type);
  }

  /**
   * Register a custom compression schema.
   */
  registerSchema(type: MemoryType, schema: CompressionSchema): void {
    this.schemas.set(type, schema);
  }

  /**
   * Detect memory type from compressed content.
   */
  detectType(compressed: string): MemoryType {
    const firstLine = compressed.split('\n')[0];

    for (const [prefix, type] of Object.entries(TYPE_PREFIXES)) {
      if (firstLine.startsWith(prefix)) {
        return type;
      }
    }

    return 'generic';
  }

  /**
   * Check if content is already compressed.
   */
  isCompressed(content: string): boolean {
    const firstLine = content.split('\n')[0];
    return Object.keys(TYPE_PREFIXES).some(prefix => firstLine.startsWith(prefix));
  }

  /**
   * Generic compression for untyped content.
   * Strips common filler words and collapses whitespace.
   */
  private genericEncode(text: string): string {
    // Remove articles
    let compressed = text.replace(/\b(a|an|the)\b/gi, '');

    // Remove pronouns
    compressed = compressed.replace(/\b(you|I|we|they|he|she|it|your|my|our)\b/gi, '');

    // Remove politeness
    compressed = compressed.replace(/\b(please|thanks|thank you|kindly)\b/gi, '');

    // Remove hedging
    compressed = compressed.replace(/\b(maybe|might|could|would|should|perhaps|possibly)\b/gi, '');

    // Remove filler
    compressed = compressed.replace(/\b(basically|actually|really|very|just|simply|quite)\b/gi, '');

    // Remove "is a/an" patterns
    compressed = compressed.replace(/\bis an?\b/gi, ':');

    // Collapse multiple spaces
    compressed = compressed.replace(/\s+/g, ' ');

    // Collapse multiple newlines
    compressed = compressed.replace(/\n+/g, '\n');

    // Trim
    compressed = compressed.trim();

    return compressed;
  }

  /**
   * Generic decompression (minimal expansion).
   */
  private genericDecode(compressed: string): string {
    // If it has key:value format, expand it
    if (compressed.includes(':') && compressed.includes('\n')) {
      const lines = compressed.split('\n');
      const expanded: string[] = [];

      for (const line of lines) {
        const colonIdx = line.indexOf(':');
        if (colonIdx > 0) {
          const key = line.slice(0, colonIdx);
          const value = line.slice(colonIdx + 1);
          expanded.push(`${this.expandKey(key)}: ${value}`);
        } else {
          expanded.push(line);
        }
      }

      return expanded.join('\n');
    }

    return compressed;
  }

  /**
   * Expand abbreviated keys to readable form.
   */
  private expandKey(key: string): string {
    const expansions: Record<string, string> = {
      COMP: 'Component',
      DEPT: 'Department',
      TOOL: 'Tool',
      CAP: 'Capability',
      FLOW: 'Workflow',
      CFG: 'Configuration',
      ERR: 'Error Pattern',
      PAT: 'Success Pattern',
      SYS: 'System',
      TYPE: 'Type',
      DOES: 'Function',
      IN: 'Inputs',
      OUT: 'Outputs',
      DEPS: 'Dependencies',
      LOC: 'Location',
      ROLE: 'Role',
      AGENTS: 'Sub-Agents',
      PHASE: 'Phase',
      STEPS: 'Steps',
      ACTORS: 'Actors',
      API: 'API',
      SUBS: 'Subsystems',
      LINES: 'Lines',
      USE: 'Use Cases',
      LANG: 'Languages',
      MODE: 'Modes',
      CORE: 'Core Components',
      STORE: 'Storage',
      EMBED: 'Embedding',
      LEARN: 'Learning',
      COMMS: 'Communication',
      BUDGET: 'Budget',
    };

    return expansions[key] || key;
  }

  /**
   * Estimate tokens saved based on character reduction.
   * Rough estimate: 1 token ≈ 4 characters
   */
  private estimateTokensSaved(originalLen: number, compressedLen: number): number {
    const charsSaved = originalLen - compressedLen;
    return Math.floor(charsSaved / 4);
  }

  /**
   * Get compression statistics for all registered schemas.
   */
  getSchemaStats(): { type: MemoryType; registered: boolean }[] {
    const allTypes: MemoryType[] = [
      'component',
      'department',
      'mcp_tool',
      'capability',
      'workflow',
      'config',
      'error_pattern',
      'success_pattern',
      'system',
      'generic',
    ];

    return allTypes.map(type => ({
      type,
      registered: this.schemas.has(type),
    }));
  }
}

/**
 * Parse key:value format into object.
 */
export function parseKeyValue(compressed: string): ParsedKeyValue {
  const result: ParsedKeyValue = {};
  const lines = compressed.split('\n');

  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      result[key] = value;
    }
  }

  return result;
}

/**
 * Expand arrow-separated verbs to sentence.
 */
export function expandVerbs(verbChain: string): string {
  if (!verbChain) return '';

  const verbs = verbChain.split('→').map(v => v.trim());

  if (verbs.length === 1) {
    return verbs[0];
  }

  // Convert verb chain to sentence
  return verbs.join(', then ');
}

/**
 * Expand comma-separated list to readable list.
 */
export function expandList(list: string): string {
  if (!list) return '';

  const items = list.split(',').map(i => i.trim());

  if (items.length === 1) {
    return items[0];
  }

  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }

  const last = items.pop();
  return `${items.join(', ')}, and ${last}`;
}

// Singleton instance
export const memoryCompressor = new MemoryCompressor();
