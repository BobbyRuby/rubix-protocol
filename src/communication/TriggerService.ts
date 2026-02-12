/**
 * TriggerService — Inter-Instance Autonomous Trigger System
 *
 * Allows any God-Agent instance to spawn another instance as a new Claude session
 * with a composed prompt. Reuses the `claude --print --prompt` spawn pattern from
 * SchedulerDaemon. Results flow back via comms messages.
 *
 * Safety: chain depth limit, concurrent limit, self-trigger rejection, kill switch.
 */

import { spawn, type ChildProcess } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { CommsStore } from './CommsStore.js';
import type { TriggerTaskRow } from './CommsStore.js';
import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync } from 'fs';

// ==========================================
// Types
// ==========================================

export interface TriggerInput {
  targetInstance: string;    // e.g. "instance_2"
  targetName?: string;       // e.g. "Axis"
  task: string;              // the actual work description
  priority?: 0 | 1 | 2;
  context?: string;          // optional extra context to inject
  chainDepth?: number;       // inherited from parent trigger (0 = root)
  maxChainDepth?: number;    // override default max (3)
}

export interface TriggerResult {
  triggerId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  result?: string;
  error?: string;
  durationMs?: number;
}

interface RunningProcess {
  child: ChildProcess;
  triggerId: string;
  startedAt: number;
}

// ==========================================
// TriggerService
// ==========================================

export class TriggerService {
  private commsStore: CommsStore;
  private dataDir: string;
  private projectRoot: string;
  private running: Map<string, RunningProcess> = new Map();

  // Safety defaults
  private maxChainDepth: number = 3;
  private maxConcurrent: number = 3;
  private enabled: boolean;

  constructor(commsStore: CommsStore, dataDir: string, projectRoot: string) {
    this.commsStore = commsStore;
    this.dataDir = dataDir;
    this.projectRoot = projectRoot;
    this.enabled = process.env.RUBIX_TRIGGER_ENABLED !== 'false';
  }

  /**
   * Spawn a new Claude session as the target instance with a composed prompt.
   * Returns immediately with triggerId. Session runs asynchronously.
   */
  async trigger(fromInstance: string, fromName: string | null, input: TriggerInput): Promise<TriggerResult> {
    // Safety checks
    if (!this.enabled) {
      return { triggerId: '', status: 'failed', error: 'Trigger system disabled (RUBIX_TRIGGER_ENABLED=false)' };
    }

    if (input.targetInstance === fromInstance) {
      return { triggerId: '', status: 'failed', error: 'Self-trigger rejected: cannot trigger your own instance' };
    }

    const chainDepth = input.chainDepth ?? 0;
    const maxDepth = input.maxChainDepth ?? this.maxChainDepth;
    if (chainDepth >= maxDepth) {
      return {
        triggerId: '',
        status: 'failed',
        error: `Chain depth limit reached (${chainDepth}/${maxDepth}). Cannot spawn further triggers.`
      };
    }

    const runningCount = this.commsStore.countRunningTriggers();
    if (runningCount >= this.maxConcurrent) {
      return {
        triggerId: '',
        status: 'failed',
        error: `Concurrent trigger limit reached (${runningCount}/${this.maxConcurrent}). Wait for running triggers to complete.`
      };
    }

    // Compose prompt
    const prompt = await this.composePrompt(fromInstance, fromName, input, chainDepth, maxDepth);

    // Create DB record
    const triggerId = uuidv4();
    this.commsStore.createTriggerTask({
      id: triggerId,
      fromInstance,
      targetInstance: input.targetInstance,
      prompt,
      rawTask: input.task,
      priority: input.priority,
      chainDepth,
      maxChainDepth: maxDepth,
      metadata: input.context ? { context: input.context } : undefined
    });

    // Spawn asynchronously
    this.spawnSession(triggerId, fromInstance, input.targetInstance, prompt);

    return { triggerId, status: 'pending' };
  }

  /**
   * Get status of a specific trigger or list recent triggers.
   */
  getStatus(triggerId?: string, filters?: { status?: string; limit?: number }): TriggerResult | TriggerTaskRow[] {
    if (triggerId) {
      const task = this.commsStore.getTriggerTask(triggerId);
      if (!task) {
        return { triggerId: triggerId, status: 'failed', error: 'Trigger not found' } as TriggerResult;
      }
      return this.rowToResult(task);
    }
    return this.commsStore.listTriggerTasks(filters);
  }

  /**
   * Cancel a running trigger session.
   */
  cancel(triggerId: string): TriggerResult {
    const task = this.commsStore.getTriggerTask(triggerId);
    if (!task) {
      return { triggerId, status: 'failed', error: 'Trigger not found' };
    }

    if (task.status !== 'running' && task.status !== 'pending') {
      return { triggerId, status: task.status as TriggerResult['status'], error: `Cannot cancel: status is ${task.status}` };
    }

    // Kill the process if running
    const proc = this.running.get(triggerId);
    if (proc) {
      try { proc.child.kill('SIGTERM'); } catch { /* already dead */ }
      this.running.delete(triggerId);
    }

    const now = new Date().toISOString();
    this.commsStore.updateTriggerTask(triggerId, {
      status: 'cancelled',
      completedAt: now,
      error: 'Cancelled by user'
    });

    return { triggerId, status: 'cancelled' };
  }

  // ==========================================
  // Private: Prompt Composition
  // ==========================================

  private async composePrompt(
    fromInstance: string,
    fromName: string | null,
    input: TriggerInput,
    chainDepth: number,
    maxDepth: number
  ): Promise<string> {
    const sections: string[] = [];

    // 1. User style memories
    const styleContent = this.loadStyleMemories();
    if (styleContent) {
      sections.push(`## USER STYLE & PREFERENCES\n${styleContent}`);
    }

    // 2. Instance identity directive
    const targetDisplay = input.targetName
      ? `${input.targetName} (${input.targetInstance})`
      : input.targetInstance;
    const fromDisplay = fromName
      ? `${fromName} (${fromInstance})`
      : fromInstance;

    sections.push([
      `## INSTANCE IDENTITY`,
      `You are ${targetDisplay}.`,
      `Call god_comms_heartbeat with instanceId="${input.targetInstance}"${input.targetName ? `, name="${input.targetName}"` : ''} first.`
    ].join('\n'));

    // 3. Trigger context
    const depthWarning = chainDepth >= maxDepth - 1
      ? `\n**WARNING: You are at the maximum chain depth. Do NOT call god_comms_trigger to spawn further instances.**`
      : '';

    sections.push([
      `## TRIGGER CONTEXT`,
      `Triggered by ${fromDisplay}. Chain depth: ${chainDepth + 1}/${maxDepth}.${depthWarning}`,
      `When you complete your task, the result will automatically be sent back to ${fromDisplay} via comms.`
    ].join('\n'));

    // 4. Task
    let taskSection = `## TASK\n${input.task}`;
    if (input.context) {
      taskSection += `\n\n### Additional Context\n${input.context}`;
    }
    sections.push(taskSection);

    return sections.join('\n\n');
  }

  /**
   * Load user style memories from memory.db (always_recall / user_style tags).
   * Direct SQLite read — no embeddings needed, just tag filter.
   */
  private loadStyleMemories(): string | null {
    try {
      const memoryDbPath = join(this.dataDir, 'memory.db');
      if (!existsSync(memoryDbPath)) return null;

      const db = new Database(memoryDbPath, { readonly: true });
      try {
        const rows = db.prepare(`
          SELECT DISTINCT me.content FROM memory_entries me
          JOIN memory_tags mt ON me.id = mt.entry_id
          WHERE mt.tag IN ('always_recall', 'user_style', 'user_preferences')
          ORDER BY me.importance DESC, me.updated DESC
          LIMIT 10
        `).all() as Array<{ content: string }>;

        if (rows.length === 0) return null;

        return rows.map(r => r.content).join('\n\n---\n\n');
      } finally {
        db.close();
      }
    } catch {
      return null;
    }
  }

  // ==========================================
  // Private: Session Spawning
  // ==========================================

  private spawnSession(triggerId: string, fromInstance: string, targetInstance: string, prompt: string): void {
    const now = new Date().toISOString();

    // Mark as running
    this.commsStore.updateTriggerTask(triggerId, {
      status: 'running',
      startedAt: now
    });

    const child = spawn('claude', ['--print', '--prompt', prompt], {
      cwd: this.projectRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32'
    });

    // Track PID
    if (child.pid) {
      this.commsStore.updateTriggerTask(triggerId, { pid: child.pid });
    }

    const startTime = Date.now();
    this.running.set(triggerId, { child, triggerId, startedAt: startTime });

    let output = '';
    let errorOutput = '';

    child.stdout?.on('data', (data) => {
      output += data.toString();
    });

    child.stderr?.on('data', (data) => {
      errorOutput += data.toString();
    });

    child.on('close', (code) => {
      this.running.delete(triggerId);
      const completedAt = new Date().toISOString();
      const durationMs = Date.now() - startTime;

      if (code === 0) {
        // Truncate result if extremely large (>100KB)
        const result = output.length > 100_000
          ? output.substring(0, 100_000) + '\n\n[truncated — full output was ' + output.length + ' chars]'
          : output.trim();

        this.commsStore.updateTriggerTask(triggerId, {
          status: 'completed',
          result,
          completedAt
        });

        // Send result back to triggering instance via comms
        const msgId = this.commsStore.send(targetInstance, {
          to: fromInstance,
          type: 'response',
          priority: 1,
          subject: `Trigger result: ${triggerId.substring(0, 8)}`,
          payload: {
            triggerId,
            status: 'completed',
            durationMs,
            resultPreview: result.substring(0, 2000),
            fullResultAvailable: result.length > 2000
          }
        });
        this.commsStore.updateTriggerTask(triggerId, { responseMessageId: msgId });
      } else {
        const error = errorOutput.trim() || `Claude exited with code ${code}`;
        this.commsStore.updateTriggerTask(triggerId, {
          status: 'failed',
          error,
          completedAt
        });

        // Notify triggering instance of failure
        this.commsStore.send(targetInstance, {
          to: fromInstance,
          type: 'response',
          priority: 2,
          subject: `Trigger FAILED: ${triggerId.substring(0, 8)}`,
          payload: {
            triggerId,
            status: 'failed',
            durationMs,
            error
          }
        });
      }
    });

    child.on('error', (err) => {
      this.running.delete(triggerId);
      const completedAt = new Date().toISOString();

      this.commsStore.updateTriggerTask(triggerId, {
        status: 'failed',
        error: err.message,
        completedAt
      });

      this.commsStore.send(targetInstance, {
        to: fromInstance,
        type: 'response',
        priority: 2,
        subject: `Trigger FAILED: ${triggerId.substring(0, 8)}`,
        payload: {
          triggerId,
          status: 'failed',
          error: err.message
        }
      });
    });
  }

  // ==========================================
  // Private: Helpers
  // ==========================================

  private rowToResult(row: TriggerTaskRow): TriggerResult {
    const result: TriggerResult = {
      triggerId: row.id,
      status: row.status as TriggerResult['status']
    };
    if (row.result) result.result = row.result;
    if (row.error) result.error = row.error;
    if (row.started_at && row.completed_at) {
      result.durationMs = new Date(row.completed_at).getTime() - new Date(row.started_at).getTime();
    }
    return result;
  }
}
