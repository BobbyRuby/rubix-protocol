/**
 * Example: Using the conversation schema to store RUBIX sub-agent logs
 *
 * This demonstrates how to use the conversation schema to efficiently
 * store sub-agent conversation logs in memory.
 */

import { COMPRESSION_SCHEMAS } from '../src/memory/CompressionSchemas.js';
import type { MemoryType } from '../src/memory/types.js';

interface ConversationLog {
  taskId: string;
  department: 'researcher' | 'architect' | 'engineer' | 'validator' | 'guardian';
  attempt: number;
  model: 'sonnet' | 'opus';
  toolsUsed: { name: string; count: number }[];
  filesModified: string[];
  success: boolean;
  duration: number; // milliseconds
  errorType?: string;
  summary: string;
}

/**
 * Convert a ConversationLog object to a text format for encoding
 */
function conversationToText(log: ConversationLog): string {
  const toolsText = log.toolsUsed
    .map(t => `${t.name}(${t.count})`)
    .join(', ');

  const filesText = log.filesModified.join(', ');
  const outcomeText = log.success ? 'success' : 'failed';

  let text = `Task: ${log.taskId}
Department: ${log.department}
Attempt: ${log.attempt}
Model: ${log.model}`;

  if (toolsText) {
    text += `\nTools: ${toolsText}`;
  }

  if (filesText) {
    text += `\nFiles: ${filesText}`;
  }

  text += `\nOutcome: ${outcomeText}
Duration: ${log.duration}ms`;

  if (log.errorType) {
    text += `\nError: ${log.errorType}`;
  }

  text += `\nSummary: ${log.summary}`;

  return text;
}

// Example 1: Successful code generation by Engineer
const engineerLog: ConversationLog = {
  taskId: 'BUILD-AUTH-001',
  department: 'engineer',
  attempt: 1,
  model: 'sonnet',
  toolsUsed: [
    { name: 'Read', count: 5 },
    { name: 'Write', count: 3 },
    { name: 'Edit', count: 2 }
  ],
  filesModified: [
    'src/auth/JWTManager.ts',
    'src/auth/TokenValidator.ts',
    'src/middleware/authenticate.ts'
  ],
  success: true,
  duration: 67000,
  summary: 'Implemented JWT authentication with token refresh'
};

// Example 2: Failed validation by Validator
const validatorLog: ConversationLog = {
  taskId: 'BUILD-AUTH-001',
  department: 'validator',
  attempt: 2,
  model: 'opus',
  toolsUsed: [
    { name: 'Read', count: 8 },
    { name: 'Bash', count: 5 }
  ],
  filesModified: ['tests/auth.test.ts'],
  success: false,
  duration: 23000,
  errorType: 'test',
  summary: 'Integration tests failing for token refresh endpoint'
};

// Example 3: Research phase
const researcherLog: ConversationLog = {
  taskId: 'BUILD-AUTH-001',
  department: 'researcher',
  attempt: 1,
  model: 'sonnet',
  toolsUsed: [
    { name: 'Read', count: 15 },
    { name: 'Glob', count: 3 },
    { name: 'Grep', count: 7 }
  ],
  filesModified: [],
  success: true,
  duration: 42000,
  summary: 'Analyzed existing auth system and identified security gaps'
};

// Compress and store
console.log('=== RUBIX Department Conversation Logs ===\n');

const logs = [
  { name: 'Engineer (Success)', log: engineerLog },
  { name: 'Validator (Failed)', log: validatorLog },
  { name: 'Researcher (Analysis)', log: researcherLog }
];

logs.forEach(({ name, log }) => {
  console.log(`${name}:`);
  const text = conversationToText(log);
  const compressed = COMPRESSION_SCHEMAS.conversation.encode(text);

  console.log(`  Original: ${text.length} chars`);
  console.log(`  Compressed: ${compressed.length} chars`);
  console.log(`  Ratio: ${Math.round((1 - compressed.length / text.length) * 100)}% reduction`);
  console.log(`  Format: ${compressed}`);
  console.log();
});

// Demonstrate decompression
console.log('=== Decompressed Output ===\n');

const sampleCompressed = COMPRESSION_SCHEMAS.conversation.encode(
  conversationToText(engineerLog)
);

console.log('Compressed:', sampleCompressed);
console.log('\nHuman-readable:');
console.log(COMPRESSION_SCHEMAS.conversation.decode(sampleCompressed));

// Show how to integrate with MemoryEngine
console.log('\n\n=== Integration with MemoryEngine ===\n');
console.log(`
// Store conversation log in memory
await memoryEngine.store(
  conversationToText(engineerLog),
  {
    type: 'conversation' as MemoryType,
    tags: ['rubix', 'engineer', 'auth', 'jwt'],
    importance: 0.8,
    source: 'tool_output'
  }
);

// Query similar conversations
const similar = await memoryEngine.query(
  'JWT authentication implementation',
  { tags: ['conversation', 'engineer'] }
);

// Results are automatically decompressed
similar.forEach(result => {
  console.log(result.content); // Human-readable format
});
`);
