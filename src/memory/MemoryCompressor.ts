/**
 * MemoryCompressor - Bidirectional memory compression engine.
 *
 * Encode: Human text → Pure tokens (for storage)
 * Decode: Pure tokens → Human text (for reading)
 *
 * Format: position0|position1|position2|...
 * Machine knows schema → position = meaning → no keys needed.
 *
 * Principles:
 * - Strip the bullshit, pure function, compress into pure tokens
 * - No NLP strings, pure efficiency
 * - Machine understands tokens, humans get decoded output
 */

import {
  MemoryType,
  CompressionSchema,
  CompressionResult,
  TYPE_DETECTION_PATTERNS,
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
   * Auto-detects type if not provided.
   */
  encode(content: string, type?: MemoryType): CompressionResult {
    const detectedType = type || this.detectTypeFromContent(content);
    const schema = this.schemas.get(detectedType);
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
   * Detect memory type from COMPRESSED content (positional tokens).
   */
  detectType(compressed: string): MemoryType {
    // Check for pipe-delimited positional format
    if (compressed.includes('|')) {
      const segments = compressed.split('|');

      for (const pattern of TYPE_DETECTION_PATTERNS) {
        if (pattern.test(segments)) {
          return pattern.type;
        }
      }
    }

    // Legacy: Check for KEY: prefix format
    const firstLine = compressed.split('\n')[0];
    for (const [prefix, type] of Object.entries(TYPE_PREFIXES)) {
      if (firstLine.startsWith(prefix)) {
        return type;
      }
    }

    return 'generic';
  }

  /**
   * Detect memory type from UNCOMPRESSED human-readable content.
   * Used for auto-detecting before encoding.
   */
  detectTypeFromContent(text: string): MemoryType {
    // Auto-detect memory type from human-readable content

    // Bug/Issue fix patterns
    if (/\b(bug|issue|problem)[:\s]+\w+/i.test(text) ||
        /\bstatus[:\s]*(fixed|open|wip|resolved)/i.test(text) ||
        (/\bsymptom/i.test(text) && /\bfix/i.test(text))) {
      return 'bug_fix';
    }

    // Error pattern
    if (/\b(error|exception)[:\s]/i.test(text) ||
        /\b\w+(Error|Exception)\b/.test(text) ||
        (/\bsymptom/i.test(text) && /\broot\s*cause/i.test(text))) {
      return 'error_pattern';
    }

    // MCP Tool
    if (/\bgod_\w+\b/.test(text)) {
      return 'mcp_tool';
    }

    // Component (PascalCase names with action verbs)
    if (/\b(TaskExecutor|MemoryEngine|CodeGenerator|SelfHealer|Manager|Engine|Service)\b/.test(text) ||
        (/\b[A-Z][a-zA-Z]+[A-Z][a-zA-Z]+\b/.test(text) &&
         /\b(orchestrat|execut|manag|handl|process|generat)\w+/i.test(text))) {
      return 'component';
    }

    // Department
    if (/\b(Researcher|Architect|Engineer|Validator|Guardian)\b/i.test(text) ||
        /\b(VP of|department|sub-?agent)/i.test(text)) {
      return 'department';
    }

    // Capability
    if (/\b(LSP|Git|AST|Profiler|Debug|REPL|capability|IDE power)/i.test(text) ||
        /\b(go-?to-?definition|find-?references|diagnostics)\b/i.test(text)) {
      return 'capability';
    }

    // Workflow
    if (/\b(workflow|flow|cycle|process)\b/i.test(text) &&
        (/→|->|\bthen\b|\bstep/i.test(text))) {
      return 'workflow';
    }

    // Configuration
    if (/\b(config|configuration|setting)\b/i.test(text) ||
        /\b[A-Z_]{3,}=/g.test(text)) {
      return 'config';
    }

    // Success pattern
    if (/\b(success|pattern)\b/i.test(text) &&
        /\b(because|due to|works? when|rate)\b/i.test(text)) {
      return 'success_pattern';
    }

    // System overview
    if (/\b(system|god-agent|rubix)\b/i.test(text) &&
        /\b(mode|storage|embed|core)\b/i.test(text)) {
      return 'system';
    }

    // Dev feature
    if (/\b(feature|module|enhancement|refactor)\b/i.test(text) &&
        /\b(purpose|export|wiring)\b/i.test(text)) {
      return 'dev_feature';
    }

    // Architecture insight
    if (/\b(arch|architecture|insight|lesson)\b/i.test(text) &&
        /\b(pattern|rule|component)\b/i.test(text)) {
      return 'arch_insight';
    }

    return 'generic';
  }

  /**
   * Check if content is already compressed.
   */
  isCompressed(content: string): boolean {
    // Check for pipe-delimited format
    if (content.includes('|')) {
      const segments = content.split('|');
      // At least 3 segments and mostly short segments
      if (segments.length >= 3 && segments.every(s => s.length < 100)) {
        return true;
      }
    }

    // Legacy: Check for KEY: prefix format
    const firstLine = content.split('\n')[0];
    return Object.keys(TYPE_PREFIXES).some(prefix => firstLine.startsWith(prefix));
  }

  /**
   * Generic compression for untyped content.
   * Strips common filler words and collapses whitespace.
   */
  private genericEncode(text: string): string {
    return text
      .replace(/\b(a|an|the)\b/gi, '')
      .replace(/\b(you|I|we|they|he|she|it|your|my|our|their)\b/gi, '')
      .replace(/\b(please|thanks|thank you|kindly)\b/gi, '')
      .replace(/\b(maybe|might|could|would|should|perhaps|possibly)\b/gi, '')
      .replace(/\b(basically|actually|really|very|just|simply|quite)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Generic decompression (minimal expansion).
   */
  private genericDecode(compressed: string): string {
    // For pipe-delimited, just return as-is
    if (compressed.includes('|') && !compressed.includes('\n')) {
      return compressed;
    }

    // For key:value format, expand keys
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
      BUG: 'Bug',
      DEV: 'Feature',
      ARCH: 'Architecture',
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
      LINES: 'Lines',
      USE: 'Use Cases',
      LANG: 'Languages',
      MODE: 'Modes',
      CORE: 'Core Components',
      STORE: 'Storage',
      EMBED: 'Embedding',
      BUDGET: 'Budget',
      STATUS: 'Status',
      SYMPTOM: 'Symptom',
      ROOT: 'Root Cause',
      FIX: 'Fix',
      LESSON: 'Lesson',
      PURPOSE: 'Purpose',
      EXPORTS: 'Exports',
      WIRING: 'Integration',
      INSIGHT: 'Insight',
      PATTERN: 'Pattern',
      RULE: 'Rule',
      COMPS: 'Components',
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
      'bug_fix',
      'dev_feature',
      'arch_insight',
      'generic',
    ];

    return allTypes.map(type => ({
      type,
      registered: this.schemas.has(type),
    }));
  }
}

/**
 * Parse pipe-delimited positional tokens into array.
 */
export function parseTokens(compressed: string): string[] {
  return compressed.split('|');
}

/**
 * Expand dot-separated list to readable form.
 */
export function expandDotList(list: string): string {
  if (!list) return '';
  return list.split('.').join(', ');
}

/**
 * Expand arrow-separated verbs to sentence.
 */
export function expandVerbs(verbChain: string): string {
  if (!verbChain) return '';
  const verbs = verbChain.split('→').map(v => v.trim());
  if (verbs.length === 1) return verbs[0];
  return verbs.join(', then ');
}

/**
 * Expand comma-separated list to readable list.
 */
export function expandList(list: string): string {
  if (!list) return '';
  const items = list.split(',').map(i => i.trim());
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  const last = items.pop();
  return `${items.join(', ')}, and ${last}`;
}

// Singleton instance
export const memoryCompressor = new MemoryCompressor();
