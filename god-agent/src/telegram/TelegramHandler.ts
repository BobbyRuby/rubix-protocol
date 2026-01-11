import TelegramBotAPI from 'node-telegram-bot-api';
import { TelegramMessage, TaskRequest } from './types.js';
import type { TaskExecutor } from '../codex/TaskExecutor.js';
import type { CommunicationManager } from '../communication/CommunicationManager.js';
import type { MemoryEngine } from '../core/MemoryEngine.js';
import { PlanningSession } from '../codex/PlanningSession.js';

export class TelegramHandler {
  private taskExecutor: TaskExecutor | undefined;
  private comms: CommunicationManager | undefined;
  private engine: MemoryEngine | undefined;
  private activeTasks: Map<string, TaskRequest>;
  private defaultCodebase: string;

  /** Active planning session */
  private planningSession: PlanningSession | null = null;

  constructor(taskExecutor?: TaskExecutor, defaultCodebase?: string, engine?: MemoryEngine) {
    this.taskExecutor = taskExecutor;
    this.engine = engine;
    this.activeTasks = new Map();
    this.defaultCodebase = defaultCodebase || process.cwd();

    // Debug: Log what we received
    console.log('[TelegramHandler] Constructor called with:');
    console.log(`  - taskExecutor: ${taskExecutor ? 'provided' : 'undefined'}`);
    console.log(`  - defaultCodebase: ${defaultCodebase || '(not provided, using cwd)'}`);
    console.log(`  - engine: ${engine ? 'provided' : 'undefined'}`);

    if (engine) {
      console.log('[TelegramHandler] MemoryEngine connected for planning sessions');
    } else {
      console.warn('[TelegramHandler] WARNING: MemoryEngine not provided - /plan commands will fail');
    }
  }

  /**
   * Set the TaskExecutor instance (for late binding)
   */
  setTaskExecutor(executor: TaskExecutor): void {
    this.taskExecutor = executor;
  }

  /**
   * Set the MemoryEngine for planning sessions
   */
  setEngine(engine: MemoryEngine): void {
    this.engine = engine;
    console.log('[TelegramHandler] MemoryEngine connected for planning sessions');
  }

  /**
   * Set the CommunicationManager for escalation response forwarding.
   * When set, escalation responses are forwarded to CommunicationManager
   * instead of being treated as new tasks.
   */
  setComms(comms: CommunicationManager): void {
    this.comms = comms;
    console.log('[TelegramHandler] CommunicationManager connected for escalation forwarding');
  }

  async handleMessage(msg: TelegramMessage, bot: TelegramBotAPI): Promise<void> {
    const chatId = msg.chat.id;
    const text = msg.text || '';

    // Check if in active planning session first (non-command messages route there)
    if (this.planningSession?.isActive() && !text.startsWith('/')) {
      await this.handlePlanningMessage(msg, bot);
      return;
    }

    // Command routing
    if (text.startsWith('/start')) {
      await this.handleStartCommand(chatId, bot);
    } else if (text.startsWith('/help')) {
      await this.handleHelpCommand(chatId, bot);
    } else if (text.startsWith('/plan ') || text === '/plan') {
      await this.startPlanningSession(msg, bot);
    } else if (text === '/resume') {
      await this.resumePlanningSession(msg, bot);
    } else if (text === '/plans') {
      await this.listPlanningSessions(msg, bot);
    } else if (text === '/plan-status') {
      await this.showPlanStatus(msg, bot);
    } else if (text === '/execute') {
      await this.executePlan(msg, bot);
    } else if (text === '/cancel') {
      await this.cancelPlanningSession(msg, bot);
    } else if (text.startsWith('/task')) {
      await this.handleTaskCommand(msg, bot);
    } else if (text.startsWith('/status')) {
      await this.handleStatusCommand(chatId, bot);
    } else {
      await this.handleTextMessage(msg, bot);
    }
  }

  async handleCallbackQuery(query: any, bot: TelegramBotAPI): Promise<void> {
    const data = query.data;
    const chatId = query.message.chat.id;

    // Check if this is an escalation callback (contains 'rid' and 'opt')
    if (this.comms && data) {
      try {
        const parsed = JSON.parse(data);
        if (parsed.rid && parsed.opt) {
          // This is an escalation button click - forward to CommunicationManager
          console.log('[TelegramHandler] Forwarding escalation callback:', parsed.opt);
          await this.comms.handleTelegramResponse({
            text: parsed.opt,
            callbackData: data
          });
          await bot.answerCallbackQuery(query.id, { text: 'Response received!' });
          return;
        }
      } catch {
        // Not JSON, continue with normal handling
      }
    }

    if (data.startsWith('task_')) {
      const taskId = data.replace('task_', '');
      await this.handleTaskAction(taskId, chatId, bot);
    }

    await bot.answerCallbackQuery(query.id);
  }

  private async handleStartCommand(chatId: number, bot: TelegramBotAPI): Promise<void> {
    const welcomeMessage = `
Welcome to Rubix!

I can help you execute various tasks and code generation.

Available commands:
/help - Show help message
/task <description> - Execute a task immediately
/plan <description> - Start a planning session
/resume - Resume last planning session
/plans - List all planning sessions
/status - Check active tasks

Just send me a message describing what you need!
    `.trim();

    await bot.sendMessage(chatId, welcomeMessage);
  }

  private async handleHelpCommand(chatId: number, bot: TelegramBotAPI): Promise<void> {
    const helpMessage = `
Rubix Help

**Task Commands:**
- /task <description> - Execute a task immediately
- /status - Show active task status

**Planning Commands:**
- /plan <description> - Start a new planning session
- /resume - Resume your last planning session
- /plans - List all your planning sessions
- /plan-status - Show current plan status
- /execute - Approve plan and start execution
- /cancel - Cancel current planning session

**Examples:**
- /task Fix the API endpoint for user authentication
- /plan Build a full-stack calculator app with history

**Planning Mode:**
Use /plan when you want to think through a project before coding.
The conversation is stored in memory - no context limits!
When ready, use /execute to run the plan.
    `.trim();

    await bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
  }

  // ===========================================================================
  // PLANNING SESSION HANDLERS
  // ===========================================================================

  private async startPlanningSession(msg: TelegramMessage, bot: TelegramBotAPI): Promise<void> {
    const chatId = msg.chat.id;
    const text = msg.text || '';
    const description = text.replace('/plan ', '').trim();

    if (!description) {
      await bot.sendMessage(chatId, 'Please provide a description after /plan\n\nExample: /plan Build a REST API for user management');
      return;
    }

    if (!this.engine) {
      await bot.sendMessage(chatId, 'MemoryEngine not configured. Planning mode requires memory storage.');
      return;
    }

    // Cancel any existing session
    if (this.planningSession) {
      await this.planningSession.cancel();
    }

    await bot.sendMessage(chatId, `🎯 *Starting planning session*\n\n"${description}"\n\nLet's think this through together...`, { parse_mode: 'Markdown' });

    try {
      this.planningSession = new PlanningSession(this.engine, {
        taskDescription: description,
        codebase: this.defaultCodebase,
        chatId
      });

      const response = await this.planningSession.start();
      await this.sendConversationalMessages(chatId, response, bot);
    } catch (error) {
      console.error('[TelegramHandler] Failed to start planning session:', error);
      await bot.sendMessage(chatId, `Failed to start planning session: ${error instanceof Error ? error.message : 'Unknown error'}`);
      this.planningSession = null;
    }
  }

  private async handlePlanningMessage(msg: TelegramMessage, bot: TelegramBotAPI): Promise<void> {
    const chatId = msg.chat.id;
    const text = msg.text || '';

    if (!this.planningSession) {
      await bot.sendMessage(chatId, 'No active planning session. Start one with /plan');
      return;
    }

    // Thinking indicator
    await bot.sendMessage(chatId, '💭');

    try {
      const response = await this.planningSession.chat(text);
      await this.sendConversationalMessages(chatId, response, bot);
    } catch (error) {
      console.error('[TelegramHandler] Planning chat error:', error);
      await bot.sendMessage(chatId, `Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async resumePlanningSession(msg: TelegramMessage, bot: TelegramBotAPI): Promise<void> {
    const chatId = msg.chat.id;

    if (!this.engine) {
      await bot.sendMessage(chatId, 'MemoryEngine not configured. Cannot resume planning sessions.');
      return;
    }

    try {
      // Get recent sessions for this chat
      const sessions = await PlanningSession.listSessions(this.engine, chatId, 1);

      if (sessions.length === 0) {
        await bot.sendMessage(chatId, 'No planning sessions found. Start one with /plan');
        return;
      }

      const latest = sessions[0];
      await bot.sendMessage(chatId, `📂 Resuming: "${latest.taskDescription}"...`);

      this.planningSession = await PlanningSession.load(this.engine, latest.id, {
        taskDescription: latest.taskDescription,
        codebase: this.defaultCodebase,
        chatId
      });

      const summary = await this.planningSession.resume();
      await this.sendConversationalMessages(chatId, summary, bot);
    } catch (error) {
      console.error('[TelegramHandler] Failed to resume session:', error);
      await bot.sendMessage(chatId, `Failed to resume: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async listPlanningSessions(msg: TelegramMessage, bot: TelegramBotAPI): Promise<void> {
    const chatId = msg.chat.id;

    if (!this.engine) {
      await bot.sendMessage(chatId, 'MemoryEngine not configured.');
      return;
    }

    try {
      const sessions = await PlanningSession.listSessions(this.engine, chatId, 10);

      if (sessions.length === 0) {
        await bot.sendMessage(chatId, 'No planning sessions found. Start one with /plan');
        return;
      }

      const lines = sessions.map((s, i) => {
        const date = s.lastActivity.toLocaleDateString();
        const status = s.status === 'active' ? '🟢' : s.status === 'approved' ? '✅' : '⚪';
        return `${i + 1}. ${status} ${s.taskDescription.substring(0, 40)}...\n   ${date} • ${s.exchangeCount} exchanges`;
      });

      await bot.sendMessage(chatId, `📋 *Your Planning Sessions*\n\n${lines.join('\n\n')}\n\nUse /resume to continue the most recent session.`, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('[TelegramHandler] Failed to list sessions:', error);
      await bot.sendMessage(chatId, `Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async showPlanStatus(msg: TelegramMessage, bot: TelegramBotAPI): Promise<void> {
    const chatId = msg.chat.id;

    if (!this.planningSession) {
      await bot.sendMessage(chatId, 'No active planning session. Start one with /plan');
      return;
    }

    try {
      const status = await this.planningSession.getStatus();
      const plan = this.planningSession.getPlan();

      let message = `📊 *Planning Session Status*\n\n`;
      message += `**Task:** ${status.taskDescription.substring(0, 100)}\n`;
      message += `**Exchanges:** ${status.exchangeCount}\n`;
      message += `**Status:** ${status.status}\n`;

      if (plan) {
        message += `\n**Current Plan:** ${plan.title}\n`;
        message += `**Complexity:** ${plan.estimatedComplexity}\n`;
        message += `**Components:** ${plan.components.length}\n`;
        if (status.openQuestions > 0) {
          message += `**Open Questions:** ${status.openQuestions}\n`;
        }
      } else {
        message += '\n_No plan document generated yet. Continue the conversation._';
      }

      message += '\n\nUse /execute when ready, or /cancel to abort.';

      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      await bot.sendMessage(chatId, `Error getting status: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async executePlan(msg: TelegramMessage, bot: TelegramBotAPI): Promise<void> {
    const chatId = msg.chat.id;

    if (!this.planningSession) {
      await bot.sendMessage(chatId, 'No active planning session. Start one with /plan');
      return;
    }

    if (!this.taskExecutor) {
      await bot.sendMessage(chatId, 'TaskExecutor not configured. Cannot execute plans.');
      return;
    }

    try {
      // Approve the plan
      await bot.sendMessage(chatId, '✅ Approving plan...');
      const plan = await this.planningSession.approve();

      // Show the final plan
      let planSummary = `📋 *Final Plan: ${plan.title}*\n\n`;
      planSummary += `${plan.description}\n\n`;
      planSummary += `**Goals:**\n`;
      plan.goals.slice(0, 5).forEach(g => { planSummary += `• ${g}\n`; });
      if (plan.components.length > 0) {
        planSummary += `\n**Components:** ${plan.components.map(c => c.name).join(', ')}\n`;
      }
      planSummary += `\n**Complexity:** ${plan.estimatedComplexity}`;

      await bot.sendMessage(chatId, planSummary, { parse_mode: 'Markdown' });

      // Convert to task submission
      const taskSubmission = await this.planningSession.toTaskSubmission();

      // Clear the planning session
      this.planningSession = null;

      await bot.sendMessage(chatId, '🚀 Starting RUBIX execution...');

      // Execute the task
      const result = await this.taskExecutor.execute(taskSubmission);

      const summary = result.summary || (result.success ? 'Task completed' : 'Task failed');
      await bot.sendMessage(chatId, `${result.success ? '✅' : '❌'} Execution ${result.success ? 'completed' : 'failed'}!\n\n${summary}`);

      // Send as document if result is large
      if (summary.length > 1000) {
        try {
          await bot.sendDocument(chatId, Buffer.from(summary, 'utf8'), {
            caption: `Execution result for: ${plan.title}`
          }, {
            filename: `execution_result.txt`,
            contentType: 'text/plain; charset=utf-8'
          });
        } catch (docError) {
          console.error('[TelegramHandler] Failed to send document:', docError);
        }
      }
    } catch (error) {
      console.error('[TelegramHandler] Execution failed:', error);
      await bot.sendMessage(chatId, `Execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async cancelPlanningSession(msg: TelegramMessage, bot: TelegramBotAPI): Promise<void> {
    const chatId = msg.chat.id;

    if (!this.planningSession) {
      await bot.sendMessage(chatId, 'No active planning session to cancel.');
      return;
    }

    try {
      await this.planningSession.cancel();
      this.planningSession = null;
      await bot.sendMessage(chatId, '❌ Planning session cancelled.');
    } catch (error) {
      await bot.sendMessage(chatId, `Error cancelling: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Send long responses as multiple messages for better readability
   */
  private async sendConversationalMessages(chatId: number, response: string, bot: TelegramBotAPI): Promise<void> {
    const MAX_LENGTH = 3500;

    if (response.length <= MAX_LENGTH) {
      await bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
      return;
    }

    // Split by double newlines (paragraphs)
    const paragraphs = response.split('\n\n');
    let current = '';

    for (const para of paragraphs) {
      if ((current + '\n\n' + para).length > MAX_LENGTH) {
        if (current) {
          try {
            await bot.sendMessage(chatId, current.trim(), { parse_mode: 'Markdown' });
          } catch {
            // Retry without markdown if it fails
            await bot.sendMessage(chatId, current.trim());
          }
          await this.delay(500);  // Small delay between messages
        }
        current = para;
      } else {
        current += (current ? '\n\n' : '') + para;
      }
    }

    if (current) {
      try {
        await bot.sendMessage(chatId, current.trim(), { parse_mode: 'Markdown' });
      } catch {
        await bot.sendMessage(chatId, current.trim());
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ===========================================================================
  // TASK HANDLERS
  // ===========================================================================

  private async handleTaskCommand(msg: TelegramMessage, bot: TelegramBotAPI): Promise<void> {
    const chatId = msg.chat.id;
    const text = msg.text || '';
    const taskDescription = text.replace('/task', '').trim();

    if (!taskDescription) {
      await bot.sendMessage(chatId, 'Please provide a task description after /task');
      return;
    }

    if (!this.taskExecutor) {
      await bot.sendMessage(chatId, 'TaskExecutor not configured. Please set up RUBIX first.');
      return;
    }

    const taskId = this.generateTaskId();
    const taskRequest: TaskRequest = {
      id: taskId,
      description: taskDescription,
      userId: msg.from?.id || 0,
      chatId: chatId,
      timestamp: Date.now()
    };

    this.activeTasks.set(taskId, taskRequest);

    await bot.sendMessage(chatId, `Task started: ${taskDescription}\nTask ID: ${taskId}`);

    try {
      // Use the correct TaskExecutor API
      const result = await this.taskExecutor.execute({
        description: taskDescription,
        specification: 'IMPORTANT: Before starting, please escalate and ask any clarifying questions about requirements, target location, technology choices, or concerns you have. Do not assume - ask first.',
        codebase: this.defaultCodebase
      });

      const summary = result.summary || (result.success ? 'Task completed' : 'Task failed');
      await bot.sendMessage(chatId, `Task ${result.success ? 'completed' : 'failed'}!\n\nResult:\n${summary}`);

      // Send as document if result is large
      if (summary.length > 1000) {
        try {
          await bot.sendDocument(chatId, Buffer.from(summary, 'utf8'), {
            caption: `Task result for: ${taskDescription}`
          }, {
            filename: `task_${taskId}_result.txt`,
            contentType: 'text/plain; charset=utf-8'
          });
        } catch (docError) {
          console.error('[TelegramHandler] Failed to send document:', docError);
          // Main message already sent above, this is just a bonus
        }
      }

      this.activeTasks.delete(taskId);
    } catch (error) {
      console.error('Task execution error:', error);
      await bot.sendMessage(chatId, `Task failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      this.activeTasks.delete(taskId);
    }
  }

  private async handleStatusCommand(chatId: number, bot: TelegramBotAPI): Promise<void> {
    const userTasks = Array.from(this.activeTasks.values())
      .filter(task => task.chatId === chatId);

    // Show planning status if in a session
    if (this.planningSession?.isActive()) {
      const status = await this.planningSession.getStatus();
      await bot.sendMessage(chatId, `📝 Active planning session: "${status.taskDescription.substring(0, 50)}..."\n${status.exchangeCount} exchanges so far.\n\nUse /plan-status for details.`);
      return;
    }

    if (userTasks.length === 0) {
      // Also check RUBIX status if available
      if (this.taskExecutor) {
        const status = this.taskExecutor.getStatus();
        if (status.currentTask) {
          const progressMsg = `Current RUBIX task: ${status.currentTask.description}\nProgress: ${status.estimatedProgress}%\nSubtasks: ${status.subtasksComplete}/${status.subtasksComplete + status.subtasksRemaining}`;
          await bot.sendMessage(chatId, progressMsg);
          return;
        }
      }
      await bot.sendMessage(chatId, 'No active tasks');
      return;
    }

    const statusMessage = userTasks.map(task =>
      `${task.id}: ${task.description.substring(0, 50)}${task.description.length > 50 ? '...' : ''}`
    ).join('\n');

    await bot.sendMessage(chatId, `Active tasks:\n\n${statusMessage}`);
  }

  private async handleTextMessage(msg: TelegramMessage, bot: TelegramBotAPI): Promise<void> {
    const chatId = msg.chat.id;
    const text = msg.text || '';

    // Check if CommunicationManager has pending escalation requests
    // If so, forward ANY message as the response (not just replies to [RUBIX])
    if (this.comms) {
      const telegramChannel = (this.comms as any).channels?.get('telegram');
      if (telegramChannel?.hasPendingRequests?.()) {
        console.log('[TelegramHandler] Forwarding message to pending escalation:', text.slice(0, 50));
        await this.comms.handleTelegramResponse({ text });
        await bot.sendMessage(chatId, '✓ Response received');
        return;
      }
    }

    // Legacy check: Reply to [RUBIX] message
    const replyTo = (msg as any).reply_to_message;
    if (this.comms && replyTo?.text?.includes('[RUBIX]')) {
      // Forward to CommunicationManager as escalation response
      console.log('[TelegramHandler] Forwarding escalation reply:', text.slice(0, 50));
      await this.comms.handleTelegramResponse({
        text,
        replyToText: replyTo.text
      });
      await bot.sendMessage(chatId, '✓ Response received');
      return;
    }

    if (!this.taskExecutor) {
      await bot.sendMessage(chatId, 'TaskExecutor not configured. Use /task command or set up RUBIX first.');
      return;
    }

    await bot.sendMessage(chatId, `Processing: ${text}`);

    try {
      const result = await this.taskExecutor.execute({
        description: text,
        specification: 'IMPORTANT: Before starting, please escalate and ask any clarifying questions about requirements, target location, technology choices, or concerns you have. Do not assume - ask first.',
        codebase: this.defaultCodebase
      });

      const summary = result.summary || (result.success ? 'Completed' : 'Failed');
      await bot.sendMessage(chatId, `Result:\n${summary}`);
    } catch (error) {
      console.error('Message processing error:', error);
      await bot.sendMessage(chatId, `Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async handleTaskAction(taskId: string, chatId: number, bot: TelegramBotAPI): Promise<void> {
    const task = this.activeTasks.get(taskId);
    if (!task) {
      await bot.sendMessage(chatId, `Task ${taskId} not found`);
      return;
    }

    await bot.sendMessage(chatId, `Task ${taskId}: ${task.description}`);
  }

  private generateTaskId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
