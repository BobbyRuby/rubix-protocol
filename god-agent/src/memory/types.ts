/**
 * Memory Compression Types
 *
 * Bidirectional compression for token-efficient memory storage.
 */

/**
 * Memory entry types for schema selection.
 */
export type MemoryType =
  | 'component'       // System component (TaskExecutor, MemoryEngine, etc.)
  | 'department'      // RUBIX department (Researcher, Architect, etc.)
  | 'mcp_tool'        // MCP tool definition
  | 'capability'      // IDE capability (LSP, Git, AST, etc.)
  | 'workflow'        // Execution flow
  | 'config'          // Configuration knowledge
  | 'error_pattern'   // Known error + resolution
  | 'success_pattern' // Proven successful approach
  | 'system'          // System overview
  | 'bug_fix'         // Bug discovered and fixed
  | 'dev_feature'     // New feature/module developed
  | 'arch_insight'    // Architecture lesson learned
  | 'generic';        // Fallback for untyped content

/**
 * Compression schema interface.
 * Defines bidirectional encode/decode for a memory type.
 */
export interface CompressionSchema {
  /**
   * Compress human-readable text to tokens.
   * Input: Natural language description
   * Output: Compressed key:value format
   */
  encode: (text: string) => string;

  /**
   * Expand compressed tokens to human-readable.
   * Input: Compressed key:value format
   * Output: Natural language description
   */
  decode: (compressed: string) => string;
}

/**
 * Pre-compressed self-knowledge entry.
 */
export interface SelfKnowledgeEntry {
  type: MemoryType;
  compressed: string;
  tags?: string[];
}

/**
 * Compression result with metrics.
 */
export interface CompressionResult {
  compressed: string;
  originalLength: number;
  compressedLength: number;
  ratio: number; // 0-1, higher = more compression
  tokensSaved: number; // Estimated token savings
}

/**
 * Parsed key-value structure from compressed format.
 */
export type ParsedKeyValue = Record<string, string>;

/**
 * Type prefixes for auto-detection.
 */
export const TYPE_PREFIXES: Record<string, MemoryType> = {
  'COMP:': 'component',
  'DEPT:': 'department',
  'TOOL:': 'mcp_tool',
  'CAP:': 'capability',
  'FLOW:': 'workflow',
  'CFG:': 'config',
  'ERR:': 'error_pattern',
  'PAT:': 'success_pattern',
  'SYS:': 'system',
  'BUG:': 'bug_fix',
  'DEV:': 'dev_feature',
  'ARCH:': 'arch_insight',
};
