/**
 * System Overview Knowledge
 */

import type { SelfKnowledgeEntry } from '../../memory/types.js';

export const SYSTEM_KNOWLEDGE: SelfKnowledgeEntry[] = [
  {
    type: 'system',
    compressed: `SYS:god-agent
MODE:mcp|cli|daemon
CORE:MemoryEngine,CODEX,RUBIX
STORE:sqlite+hnsw
EMBED:768dim
LEARN:Sona+TinyDancer
COMMS:telegram,phone,sms,slack,discord,email`,
  },
];
