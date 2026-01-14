/**
 * Memory Compression Types
 *
 * Bidirectional compression for token-efficient memory storage.
 * Format: position0|position1|position2|...
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
  | 'conversation'    // Sub-agent conversation log
  | 'context_bundle'  // Inter-phase: Phase 1 output (CTX tokens)
  | 'design'          // Inter-phase: Phase 2 output (DES tokens)
  | 'exec_plan'       // Inter-phase: Phase 3 output (PLAN tokens)
  | 'validation'      // Inter-phase: Phase 4 output (VAL tokens)
  | 'generic';        // Fallback for untyped content

/**
 * Compression schema interface.
 * Defines bidirectional encode/decode for a memory type.
 */
export interface CompressionSchema {
  /**
   * Compress human-readable text to tokens.
   * Input: Natural language description
   * Output: Positional pipe-delimited tokens
   */
  encode: (text: string) => string;

  /**
   * Expand compressed tokens to human-readable.
   * Input: Positional pipe-delimited tokens
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
 * Type detection patterns for compressed tokens.
 *
 * Format: Each type has a unique pattern based on first segment(s).
 * Position 0 determines type in most cases.
 */
export const TYPE_DETECTION_PATTERNS: Array<{
  type: MemoryType;
  test: (segments: string[]) => boolean;
}> = [
  // MCP Tool: god_* prefix
  {
    type: 'mcp_tool',
    test: (s) => s[0]?.startsWith('god_'),
  },
  // Bug Fix: status code F/O/W in position 1
  {
    type: 'bug_fix',
    test: (s) => s.length >= 7 && ['F', 'O', 'W'].includes(s[1]),
  },
  // Department: role code D/G/I/Q/R in position 1
  {
    type: 'department',
    test: (s) => s.length === 6 && ['D', 'G', 'I', 'Q', 'R'].includes(s[1]) &&
                  /^(Researcher|Architect|Engineer|Validator|Guardian|Department)$/i.test(s[0]),
  },
  // Component: type code O/F/S/M/E/H in position 1
  {
    type: 'component',
    test: (s) => s.length === 6 && ['O', 'F', 'S', 'M', 'E', 'H'].includes(s[1]) &&
                  /^[A-Z][a-zA-Z]+$/.test(s[0]),
  },
  // Capability: known IDE capabilities
  {
    type: 'capability',
    test: (s) => /^(LSP|GIT|AST|PROFILER|DEBUG|REPL|DEPS?|DOCS?|DATABASE|STACK(?:TRACE)?|CAP)$/i.test(s[0]),
  },
  // Workflow: step patterns (dot-separated)
  {
    type: 'workflow',
    test: (s) => s.length === 4 && s[1]?.includes('.') && !s[0].includes('_'),
  },
  // Config: uppercase name, vars
  {
    type: 'config',
    test: (s) => s.length === 3 && /^[A-Z_]+$/.test(s[0]),
  },
  // Error Pattern: 5 segments with id
  {
    type: 'error_pattern',
    test: (s) => s.length === 5 && (/^(I\d+|ISSUE-\d+|\w+Error|\w+Exception|ERR)$/i.test(s[0])),
  },
  // Success Pattern: 4 segments
  {
    type: 'success_pattern',
    test: (s) => s.length === 4 && s[0]?.includes('_'),
  },
  // System: 5 segments with modes
  {
    type: 'system',
    test: (s) => s.length === 5 && s[1]?.includes('.') && s[0]?.includes('-'),
  },
  // Dev Feature: type code M/E/R in position 1
  {
    type: 'dev_feature',
    test: (s) => s.length === 6 && ['M', 'E', 'R'].includes(s[1]) && /^[A-Z]/.test(s[0]),
  },
  // Arch Insight: type code L/P/R in position 1
  {
    type: 'arch_insight',
    test: (s) => s.length === 6 && ['L', 'P', 'R'].includes(s[1]) && s[0]?.includes('_'),
  },
  // Conversation: 10 segments with model S/O in position 3
  {
    type: 'conversation',
    test: (s) => s.length === 10 && ['S', 'O'].includes(s[3]) &&
                  /^(researcher|architect|engineer|validator|guardian)$/i.test(s[1]),
  },
  // Context Bundle: CTX prefix (inter-phase Phase 1)
  {
    type: 'context_bundle',
    test: (s) => s[0] === 'CTX',
  },
  // Design: DES prefix (inter-phase Phase 2)
  {
    type: 'design',
    test: (s) => s[0] === 'DES',
  },
  // Exec Plan: PLAN prefix (inter-phase Phase 3)
  {
    type: 'exec_plan',
    test: (s) => s[0] === 'PLAN',
  },
  // Validation: VAL prefix (inter-phase Phase 4)
  {
    type: 'validation',
    test: (s) => s[0] === 'VAL',
  },
];

/**
 * Type prefixes for legacy format detection (backwards compatibility).
 * @deprecated Use TYPE_DETECTION_PATTERNS for new positional format.
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
  'CONV:': 'conversation',
};
