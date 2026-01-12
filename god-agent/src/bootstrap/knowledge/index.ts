/**
 * Self-Knowledge Data - RUBIX Architecture as Compressed Memories
 *
 * All entries are pre-compressed for efficient storage.
 * Use memoryCompressor.autoDecode() to expand when reading.
 */

import type { SelfKnowledgeEntry } from '../../memory/types.js';

// Import all knowledge modules
import { SYSTEM_KNOWLEDGE } from './system.js';
import { DEPARTMENT_KNOWLEDGE } from './departments.js';
import { CODEX_KNOWLEDGE } from './codex.js';
import { CORE_KNOWLEDGE } from './core.js';
import { MCP_TOOL_KNOWLEDGE } from './mcp-tools.js';
import { CAPABILITY_KNOWLEDGE } from './capabilities.js';
import { WORKFLOW_KNOWLEDGE } from './workflows.js';

/**
 * Complete self-knowledge entries.
 */
export const SELF_KNOWLEDGE: SelfKnowledgeEntry[] = [
  ...SYSTEM_KNOWLEDGE,
  ...DEPARTMENT_KNOWLEDGE,
  ...CODEX_KNOWLEDGE,
  ...CORE_KNOWLEDGE,
  ...MCP_TOOL_KNOWLEDGE,
  ...CAPABILITY_KNOWLEDGE,
  ...WORKFLOW_KNOWLEDGE,
];
