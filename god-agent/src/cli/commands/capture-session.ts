/**
 * Capture Session Command
 *
 * Process a Claude Code session transcript and store learnings in God Agent memory.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname, basename } from 'path';
import { MemoryEngine, MemorySource, CausalRelationType } from '../../index.js';

/**
 * Transcript entry structure
 */
interface TranscriptEntry {
  type: 'user' | 'assistant' | 'system';
  message?: {
    role: string;
    content: string | ContentBlock[];
  };
  timestamp?: number;
}

interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: string;
}

interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  timestamp?: number;
}

interface SessionData {
  sessionId: string;
  project: string;
  startTime?: number;
  endTime?: number;
  userPrompts: string[];
  toolCalls: ToolCall[];
  filesModified: string[];
  commandsRun: string[];
  errors: string[];
}

/**
 * State file for tracking captured sessions
 */
interface CapturedSessionsState {
  capturedSessions: Record<string, string>; // sessionId -> timestamp
  lastScan: string;
}

/**
 * Load or create state file
 */
function loadState(dataDir: string): CapturedSessionsState {
  const statePath = join(dataDir, 'captured-sessions.json');
  if (existsSync(statePath)) {
    try {
      return JSON.parse(readFileSync(statePath, 'utf-8'));
    } catch {
      // Corrupted file, start fresh
    }
  }
  return { capturedSessions: {}, lastScan: new Date().toISOString() };
}

/**
 * Save state file
 */
function saveState(dataDir: string, state: CapturedSessionsState): void {
  const statePath = join(dataDir, 'captured-sessions.json');
  const dir = dirname(statePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

/**
 * Mark session as captured
 */
function markSessionCaptured(dataDir: string, sessionId: string): void {
  const state = loadState(dataDir);
  state.capturedSessions[sessionId] = new Date().toISOString();
  state.lastScan = new Date().toISOString();
  saveState(dataDir, state);
}

/**
 * Check if session already captured
 */
function isSessionCaptured(dataDir: string, sessionId: string): boolean {
  const state = loadState(dataDir);
  return sessionId in state.capturedSessions;
}

/**
 * Parse transcript JSONL file
 */
function parseTranscript(transcriptPath: string): TranscriptEntry[] {
  const content = readFileSync(transcriptPath, 'utf-8');
  const lines = content.trim().split('\n');
  const entries: TranscriptEntry[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // Skip malformed lines
    }
  }

  return entries;
}

/**
 * Extract session data from transcript entries
 */
function extractSessionData(
  entries: TranscriptEntry[],
  sessionId: string,
  project: string
): SessionData {
  const data: SessionData = {
    sessionId,
    project,
    userPrompts: [],
    toolCalls: [],
    filesModified: [],
    commandsRun: [],
    errors: [],
  };

  let firstTimestamp: number | undefined;
  let lastTimestamp: number | undefined;

  for (const entry of entries) {
    // Track timestamps
    if (entry.timestamp) {
      if (!firstTimestamp) firstTimestamp = entry.timestamp;
      lastTimestamp = entry.timestamp;
    }

    // Extract user prompts
    if (entry.type === 'user' && entry.message?.content) {
      const content = typeof entry.message.content === 'string'
        ? entry.message.content
        : entry.message.content.map(b => b.text || '').join(' ');
      if (content.trim()) {
        data.userPrompts.push(content.trim());
      }
    }

    // Extract tool calls from assistant messages
    if (entry.type === 'assistant' && entry.message?.content) {
      const blocks = Array.isArray(entry.message.content)
        ? entry.message.content
        : [];

      for (const block of blocks) {
        if (block.type === 'tool_use' && block.name && block.input) {
          const toolCall: ToolCall = {
            name: block.name,
            input: block.input,
            timestamp: entry.timestamp,
          };
          data.toolCalls.push(toolCall);

          // Track file modifications
          if (['Edit', 'Write'].includes(block.name)) {
            const filePath = block.input.file_path as string;
            if (filePath && !data.filesModified.includes(filePath)) {
              data.filesModified.push(filePath);
            }
          }

          // Track commands
          if (block.name === 'Bash') {
            const command = block.input.command as string;
            if (command) {
              data.commandsRun.push(command);
            }
          }
        }

        // Check for errors in text
        if (block.type === 'text' && block.text) {
          if (block.text.toLowerCase().includes('error') ||
              block.text.toLowerCase().includes('failed')) {
            // Extract error context (first 200 chars)
            const errorSnippet = block.text.substring(0, 200);
            if (!data.errors.some(e => e.includes(errorSnippet.substring(0, 50)))) {
              data.errors.push(errorSnippet);
            }
          }
        }
      }
    }
  }

  data.startTime = firstTimestamp;
  data.endTime = lastTimestamp;

  return data;
}

/**
 * Create session summary content
 */
function createSessionSummary(data: SessionData): string {
  const duration = data.startTime && data.endTime
    ? Math.round((data.endTime - data.startTime) / 60000)
    : 0;

  const projectName = basename(data.project);

  let summary = `Session ${data.sessionId.substring(0, 8)} - ${projectName}\n`;
  summary += `Duration: ${duration} minutes\n`;
  summary += `Files modified: ${data.filesModified.length}\n`;
  summary += `Commands run: ${data.commandsRun.length}\n`;
  summary += `User prompts: ${data.userPrompts.length}\n`;

  if (data.filesModified.length > 0) {
    summary += `\nFiles:\n`;
    for (const file of data.filesModified.slice(0, 10)) {
      summary += `- ${file}\n`;
    }
    if (data.filesModified.length > 10) {
      summary += `... and ${data.filesModified.length - 10} more\n`;
    }
  }

  if (data.errors.length > 0) {
    summary += `\nErrors encountered: ${data.errors.length}\n`;
  }

  return summary;
}

/**
 * Store session data in God Agent
 */
async function storeSessionData(
  engine: MemoryEngine,
  data: SessionData,
  verbose: boolean
): Promise<{ entriesStored: number; relationsCreated: number }> {
  let entriesStored = 0;
  let relationsCreated = 0;
  const projectName = basename(data.project);
  const baseTags = ['session', 'claude-code', projectName, 'full-capture'];

  // Store session summary (high importance)
  const summary = createSessionSummary(data);
  const summaryEntry = await engine.store(summary, {
    tags: [...baseTags, 'summary', `session:${data.sessionId}`],
    source: MemorySource.SYSTEM,
    importance: 0.9,
    sessionId: data.sessionId,
    context: {
      type: 'session-summary',
      filesModified: data.filesModified.length,
      commandsRun: data.commandsRun.length,
      duration: data.startTime && data.endTime
        ? Math.round((data.endTime - data.startTime) / 60000)
        : 0,
    },
  });
  entriesStored++;
  if (verbose) console.log(chalk.dim(`  Stored session summary`));

  const entryIds: string[] = [summaryEntry.id];

  // Store user prompts (importance: 0.7)
  for (let i = 0; i < data.userPrompts.length; i++) {
    const prompt = data.userPrompts[i];
    if (prompt.length < 10) continue; // Skip very short prompts

    const entry = await engine.store(`User: ${prompt.substring(0, 1000)}`, {
      tags: [...baseTags, 'user-prompt'],
      source: MemorySource.USER_INPUT,
      importance: 0.7,
      sessionId: data.sessionId,
      parentIds: [summaryEntry.id],
      context: {
        type: 'user-prompt',
        promptIndex: i,
      },
    });
    entriesStored++;
    entryIds.push(entry.id);
  }
  if (verbose && data.userPrompts.length > 0) {
    console.log(chalk.dim(`  Stored ${data.userPrompts.length} user prompts`));
  }

  // Store tool calls (importance: 0.6-0.8)
  for (const toolCall of data.toolCalls) {
    // Determine importance based on tool type
    let importance = 0.6;
    let tags = [...baseTags, 'tool-call', toolCall.name.toLowerCase()];

    if (['Edit', 'Write'].includes(toolCall.name)) {
      importance = 0.8;
      tags.push('file-modification');
    } else if (toolCall.name === 'Bash') {
      importance = 0.7;
      tags.push('command');
    }

    // Build content
    let content = `Tool: ${toolCall.name}\n`;
    if (toolCall.name === 'Edit' || toolCall.name === 'Write') {
      content += `File: ${toolCall.input.file_path}\n`;
    } else if (toolCall.name === 'Bash') {
      content += `Command: ${(toolCall.input.command as string)?.substring(0, 200)}\n`;
    } else if (toolCall.name === 'Read') {
      content += `File: ${toolCall.input.file_path}\n`;
    } else if (toolCall.name === 'Grep') {
      content += `Pattern: ${toolCall.input.pattern}\n`;
    } else {
      content += `Input: ${JSON.stringify(toolCall.input).substring(0, 200)}\n`;
    }

    const entry = await engine.store(content, {
      tags,
      source: MemorySource.TOOL_OUTPUT,
      importance,
      sessionId: data.sessionId,
      parentIds: [summaryEntry.id],
      context: {
        type: 'tool-call',
        toolName: toolCall.name,
      },
    });
    entriesStored++;
    entryIds.push(entry.id);
  }
  if (verbose && data.toolCalls.length > 0) {
    console.log(chalk.dim(`  Stored ${data.toolCalls.length} tool calls`));
  }

  // Create causal relations: summary -> prompts -> tool calls
  if (entryIds.length > 2) {
    // Link prompts to tool calls in sequence
    for (let i = 1; i < entryIds.length - 1; i++) {
      engine.addCausalRelation(
        [entryIds[i]],
        [entryIds[i + 1]],
        CausalRelationType.PRECEDES,
        0.7,
        { metadata: { relationship: 'session-sequence' } }
      );
      relationsCreated++;
    }
  }

  return { entriesStored, relationsCreated };
}

export const captureSessionCommand = new Command('capture-session')
  .description('Capture a Claude Code session transcript into God Agent memory')
  .requiredOption('-t, --transcript <path>', 'Path to transcript JSONL file')
  .requiredOption('-s, --session-id <id>', 'Session ID')
  .option('-p, --project <path>', 'Project directory', process.cwd())
  .option('-d, --data-dir <path>', 'God Agent data directory', './data')
  .option('-v, --verbose', 'Show detailed output', false)
  .option('--force', 'Force re-capture even if already captured', false)
  .action(async (options) => {
    const spinner = ora('Capturing session...').start();

    try {
      // Check if already captured
      if (!options.force && isSessionCaptured(options.dataDir, options.sessionId)) {
        spinner.info(`Session ${options.sessionId.substring(0, 8)} already captured`);
        return;
      }

      // Check transcript exists
      if (!existsSync(options.transcript)) {
        spinner.fail(`Transcript not found: ${options.transcript}`);
        process.exit(1);
      }

      // Initialize engine
      const engine = new MemoryEngine({ dataDir: options.dataDir });
      await engine.initialize();

      // Parse transcript
      spinner.text = 'Parsing transcript...';
      const entries = parseTranscript(options.transcript);

      if (entries.length === 0) {
        spinner.warn('No entries found in transcript');
        await engine.close();
        return;
      }

      // Extract session data
      spinner.text = 'Extracting session data...';
      const sessionData = extractSessionData(
        entries,
        options.sessionId,
        options.project
      );

      // Store in God Agent
      spinner.text = 'Storing in God Agent...';
      const result = await storeSessionData(engine, sessionData, options.verbose);

      // Mark as captured
      markSessionCaptured(options.dataDir, options.sessionId);

      await engine.close();

      spinner.succeed(
        `Captured session ${options.sessionId.substring(0, 8)}: ` +
        `${result.entriesStored} entries, ${result.relationsCreated} relations`
      );

    } catch (error) {
      spinner.fail(chalk.red('Failed to capture session'));
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Export helper functions for capture-missing command
export { loadState, saveState, isSessionCaptured, markSessionCaptured };
