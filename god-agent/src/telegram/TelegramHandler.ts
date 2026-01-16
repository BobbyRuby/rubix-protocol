import TelegramBotAPI from 'node-telegram-bot-api';
import { TelegramMessage, TaskRequest } from './types.js';
import type { TaskExecutor } from '../codex/TaskExecutor.js';
import type { CommunicationManager } from '../communication/CommunicationManager.js';
import type { MemoryEngine } from '../core/MemoryEngine.js';
import type { ContainmentManager } from '../codex/ContainmentManager.js';
import { PlanningSession } from '../codex/PlanningSession.js';
import { ConversationSession } from '../codex/ConversationSession.js';
import { InputCompressor } from '../prompts/InputCompressor.js';
import { AutoRecall } from '../memory/AutoRecall.js';

/** Image attachment for messages */
export interface ImageAttachment {
  base64: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
}

export class TelegramHandler {
  private taskExecutor: TaskExecutor | undefined;
  private comms: CommunicationManager | undefined;
  private engine: MemoryEngine | undefined;
  private containment: ContainmentManager | undefined;
  private activeTasks: Map<string, TaskRequest>;
  private defaultCodebase: string;

  /** AutoRecall for centralized brain */
  private autoRecall: AutoRecall;

  /** Active planning session */
  private planningSession: PlanningSession | null = null;

  /** Active conversation session */
  private conversationSession: ConversationSession | null = null;

  /** Awaiting confirmation for /execute */
  private awaitingExecuteConfirmation: boolean = false;

  /** Message queue for planning mode - messages sent while processing */
  private messageQueue: Array<{ text: string; image?: ImageAttachment }> = [];

  /** Flag to track if we're currently processing a planning message */
  private isProcessingPlanning: boolean = false;

  constructor(taskExecutor?: TaskExecutor, defaultCodebase?: string, engine?: MemoryEngine) {
    this.taskExecutor = taskExecutor;
    this.engine = engine;
    this.activeTasks = new Map();
    this.defaultCodebase = defaultCodebase || process.cwd();

    // Initialize AutoRecall (centralized brain)
    this.autoRecall = new AutoRecall({
      enabled: true,
      topK: 5,
      minScore: 0.3,
      debug: process.env.AUTORECALL_DEBUG === 'true'
    });

    // Wire AutoRecall to engine if available
    if (engine) {
      this.autoRecall.setEngine(engine);
    }

    // Debug: Log what we received
    console.log('[TelegramHandler] Constructor called with:');
    console.log(`  - taskExecutor: ${taskExecutor ? 'provided' : 'undefined'}`);
    console.log(`  - defaultCodebase: ${defaultCodebase || '(not provided, using cwd)'}`);
    console.log(`  - engine: ${engine ? 'provided' : 'undefined'}`);
    console.log(`  - autoRecall: enabled`);

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
    // Wire AutoRecall to engine (centralized brain)
    this.autoRecall.setEngine(engine);
    console.log('[TelegramHandler] MemoryEngine connected for planning sessions and AutoRecall');
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

  /**
   * Set the ContainmentManager for path permission management.
   * Enables /paths, /path-add, /path-remove commands.
   */
  setContainment(containment: ContainmentManager): void {
    this.containment = containment;
    console.log('[TelegramHandler] ContainmentManager connected for path management');
  }

  async handleMessage(msg: TelegramMessage, bot: TelegramBotAPI): Promise<void> {
    const chatId = msg.chat.id;
    const text = msg.text || (msg as any).caption || '';  // Also check caption for photos

    // Check if message has an image
    const hasPhoto = !!(msg as any).photo || ((msg as any).document?.mime_type?.startsWith('image/'));

    // Check for /execute confirmation responses
    if (this.awaitingExecuteConfirmation) {
      if (/^(yes|y|go|confirm|do it)$/i.test(text.trim())) {
        this.awaitingExecuteConfirmation = false;
        await this.executeApprovedPlan(msg, bot);
        return;
      } else if (/^(no|n|cancel|back|wait)$/i.test(text.trim())) {
        this.awaitingExecuteConfirmation = false;
        // Context-aware response
        if (this.planningSession) {
          const taskDesc = this.planningSession.getTaskDescription();
          const exchanges = this.planningSession.getExchangeCount();
          await bot.sendMessage(
            chatId,
            `↩️ Back to planning: "${taskDesc.substring(0, 50)}${taskDesc.length > 50 ? '...' : ''}"\n\n` +
            `📝 ${exchanges} exchanges so far. Continue refining your plan or /execute again when ready.`
          );
        } else {
          await bot.sendMessage(chatId, '↩️ Back to planning. Continue the conversation or /execute again when ready.');
        }
        return;
      }
      // Any other message = back to planning mode
      this.awaitingExecuteConfirmation = false;
    }

    // Debug logging for troubleshooting routing issues
    if (process.env.TELEGRAM_DEBUG === 'true') {
      console.log(`[TelegramHandler] Routing check:`, {
        hasPlanningSession: !!this.planningSession,
        isActive: this.planningSession?.isActive?.() ?? 'N/A',
        awaitingConfirmation: this.awaitingExecuteConfirmation,
        text: text.substring(0, 30),
        isCommand: text.startsWith('/')
      });
    }

    // Check if in active planning session first (non-command messages route there)
    // Also handle photos in planning mode
    if (this.planningSession?.isActive() && !text.startsWith('/')) {
      await this.handlePlanningMessage(msg, bot, hasPhoto ? await this.extractImage(msg, bot) : null);
      return;
    }

    // Handle photos outside of planning mode -> route to conversational
    if (hasPhoto && !text.startsWith('/')) {
      const image = await this.extractImage(msg, bot);
      if (image) {
        await this.handleConversationalMessage(msg, bot, image);
        return;
      }
    }

    // Command routing
    if (text.startsWith('/start')) {
      await this.handleStartCommand(chatId, bot);
    } else if (text.startsWith('/help')) {
      await this.handleHelpCommand(chatId, bot);
    } else if (text.startsWith('/plan ') || text === '/plan') {
      await this.startPlanningSession(msg, bot);
    } else if (text === '/resume' || text.startsWith('/resume ')) {
      await this.resumePlanningSession(msg, bot);
    } else if (text === '/plans' || text.startsWith('/plans ')) {
      await this.listPlanningSessions(msg, bot);
    } else if (text.startsWith('/delete ')) {
      await this.deletePlanningSession(msg, bot);
    } else if (text === '/plan-status') {
      await this.showPlanStatus(msg, bot);
    } else if (text === '/execute') {
      await this.executePlan(msg, bot);
    } else if (text === '/rubixallize') {
      await this.handleRubixallizeCommand(msg, bot);
    } else if (text === '/confirm') {
      await this.confirmDeletion(msg, bot);
    } else if (text === '/cancel') {
      await this.handleCancelCommand(msg, bot);
    } else if (text.startsWith('/task')) {
      await this.handleTaskCommand(msg, bot);
    } else if (text.startsWith('/status')) {
      await this.handleStatusCommand(chatId, bot);
    } else if (text === '/config') {
      await this.handleConfigCommand(msg, bot);
    } else if (text === '/paths') {
      await this.handlePathsCommand(chatId, bot);
    } else if (text.startsWith('/path-add')) {
      await this.handlePathAddCommand(msg, bot);
    } else if (text.startsWith('/path-remove')) {
      await this.handlePathRemoveCommand(msg, bot);
    } else if (text === '/wait' || text.startsWith('/wait ')) {
      await this.handleWaitCommand(msg, bot);
    } else if (text === '/restart') {
      await this.handleRestartCommand(chatId, bot);
    } else {
      await this.handleConversationalMessage(msg, bot);
    }
  }

  async handleCallbackQuery(query: any, bot: TelegramBotAPI): Promise<void> {
    const data = query.data;
    const chatId = query.message.chat.id;

    // Check if this is JSON callback data
    if (data) {
      try {
        const parsed = JSON.parse(data);

        // Escalation callback (contains 'rid' and 'opt')
        if (parsed.rid && parsed.opt && this.comms) {
          console.log('[TelegramHandler] Forwarding escalation callback:', parsed.opt);
          await this.comms.handleTelegramResponse({
            text: parsed.opt,
            callbackData: data
          });
          await bot.answerCallbackQuery(query.id, { text: 'Response received!' });
          return;
        }

        // Plan list button callbacks (resume/delete)
        if (parsed.action === 'resume') {
          const fakeMsg = { ...query.message, text: `/resume ${parsed.num}` } as TelegramMessage;
          await bot.answerCallbackQuery(query.id, { text: `Resuming session ${parsed.num}...` });
          await this.resumePlanningSession(fakeMsg, bot);
          return;
        }

        if (parsed.action === 'delete') {
          const fakeMsg = { ...query.message, text: `/delete ${parsed.num}` } as TelegramMessage;
          await bot.answerCallbackQuery(query.id);
          await this.deletePlanningSession(fakeMsg, bot);
          return;
        }

        // Execute confirmation button callbacks
        if (parsed.action === 'execute_yes') {
          this.awaitingExecuteConfirmation = false;
          const fakeMsg = { ...query.message, text: 'yes' } as TelegramMessage;
          await this.executeApprovedPlan(fakeMsg, bot);
          await bot.answerCallbackQuery(query.id, { text: 'Executing...' });
          return;
        }

        if (parsed.action === 'execute_no') {
          this.awaitingExecuteConfirmation = false;
          await bot.answerCallbackQuery(query.id, { text: 'Continuing planning' });
          if (this.planningSession) {
            await bot.sendMessage(chatId, '↩️ Back to planning. Continue or /execute when ready.');
          }
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
*RUBIX - Autonomous Developer Agent*

*Quick Start:*
Chat naturally → /rubixallize → /execute
Or: /plan <idea> → discuss → /execute

━━━━━━━━━━━━━━━━━━━━━━━━

*Conversation Mode*
Just chat! I remember everything.
• /rubixallize - Turn chat into executable plan

*Immediate Execution*
• /task <desc> - Run task now (no planning)
• /status - Check running task progress

*Planning Sessions*
• /plan <desc> - Start new planning session
• /plans - List your sessions (most recent 3)
• /plans all - List ALL sessions (any chat)
• /resume - Resume most recent session
• /resume N - Resume session #N from list
• /delete N - Delete session #N from list
• /plan-status - Current plan details
• /execute - Preview & run the plan
• /cancel - Abandon current session

*Path Permissions*
• /paths - Show allowed paths
• /path-add <path> rw - Add read-write access
• /path-add <path> read - Add read-only access
• /path-remove <pattern> - Remove access

*During Execution*
• /wait - Add 10 min to escalation timeout
• /wait N - Add N minutes

*System*
• /config - Show configuration
• /restart - Restart RUBIX system

━━━━━━━━━━━━━━━━━━━━━━━━

*Workflow Example:*
1. /plans all - Browse old plans
2. /resume 2 - Load plan #2
3. Continue discussing...
4. /execute - Run when ready

*Or start fresh:*
1. /plan Build a REST API
2. Discuss requirements...
3. /execute - Approve & run
    `.trim();

    await this.safeSendMarkdown(bot, chatId, helpMessage);
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

  private async handlePlanningMessage(msg: TelegramMessage, bot: TelegramBotAPI, image?: ImageAttachment | null): Promise<void> {
    const chatId = msg.chat.id;
    const text = msg.text || (msg as any).caption || '';

    if (!this.planningSession) {
      await bot.sendMessage(chatId, 'No active planning session. Start one with /plan');
      return;
    }

    // If already processing, queue this message for inclusion in current response
    if (this.isProcessingPlanning) {
      this.messageQueue.push({ text, image: image || undefined });
      await bot.sendMessage(chatId, `📝 +${this.messageQueue.length} message${this.messageQueue.length > 1 ? 's' : ''} queued`);
      return;
    }

    // Start processing
    this.isProcessingPlanning = true;

    // Thinking indicator (with image acknowledgment)
    if (image) {
      await bot.sendMessage(chatId, '🖼️💭');
    } else {
      await bot.sendMessage(chatId, '💭');
    }

    try {
      // Collect initial message with explicit type
      let combinedMessages: Array<{ text: string; image?: ImageAttachment }> = [
        { text, image: image || undefined }
      ];

      // Base iteration budget
      let iterationBudget = 10;

      // Check for queued messages before processing
      if (this.messageQueue.length > 0) {
        combinedMessages = [...combinedMessages, ...this.messageQueue];
        iterationBudget += this.messageQueue.length * 5;
        this.messageQueue = [];
        console.log(`[TelegramHandler] Processing ${combinedMessages.length} messages, iteration budget: ${iterationBudget}`);
      }

      // Build combined user input
      const combinedText = combinedMessages.map(m => m.text).join('\n\n---\n\n');
      const combinedImage = combinedMessages.find(m => m.image)?.image;  // Use first image if any

      const response = await this.planningSession.chat(combinedText, combinedImage, iterationBudget);
      await this.sendConversationalMessages(chatId, response, bot);
    } catch (error) {
      console.error('[TelegramHandler] Planning chat error:', error);
      await bot.sendMessage(chatId, `Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      this.isProcessingPlanning = false;

      // Check if more messages arrived during processing - process them
      if (this.messageQueue.length > 0) {
        // Recursively process queued messages
        const nextMsg = this.messageQueue.shift()!;
        const fakeTgMsg = { ...msg, text: nextMsg.text };
        await this.handlePlanningMessage(fakeTgMsg, bot, nextMsg.image || null);
      }
    }
  }

  private async resumePlanningSession(msg: TelegramMessage, bot: TelegramBotAPI): Promise<void> {
    const chatId = msg.chat.id;
    const text = msg.text || '';

    if (!this.engine) {
      await bot.sendMessage(chatId, 'MemoryEngine not configured. Cannot resume planning sessions.');
      return;
    }

    try {
      // Check for /resume N syntax (e.g., /resume 2)
      const match = text.match(/\/resume\s+(\d+)/);
      let targetSession: import('../codex/PlanningSession.js').SessionSummary | undefined;

      if (match) {
        const index = parseInt(match[1], 10) - 1; // Convert to 0-based
        if (this.cachedSessionList.length > 0 && index >= 0 && index < this.cachedSessionList.length) {
          targetSession = this.cachedSessionList[index];
        } else {
          await bot.sendMessage(chatId, `Invalid session number. Use /plans first to see available sessions.`);
          return;
        }
      } else {
        // Default: get most recent session for this chat
        const sessions = await PlanningSession.listSessions(this.engine, chatId, 1);
        if (sessions.length === 0) {
          await bot.sendMessage(chatId, 'No planning sessions found. Start one with /plan\n\nOr use /plans all to see all sessions.');
          return;
        }
        targetSession = sessions[0];
      }

      await bot.sendMessage(chatId, `📂 Resuming: "${targetSession.taskDescription}"...`);

      this.planningSession = await PlanningSession.load(this.engine, targetSession.id, {
        taskDescription: targetSession.taskDescription,
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

  /** Cached session list for /resume N selection */
  private cachedSessionList: import('../codex/PlanningSession.js').SessionSummary[] = [];

  /** Pending deletion awaiting confirmation */
  private pendingDeletion: { chatId: number; session: import('../codex/PlanningSession.js').SessionSummary; index: number } | null = null;

  private async listPlanningSessions(msg: TelegramMessage, bot: TelegramBotAPI): Promise<void> {
    const chatId = msg.chat.id;
    const text = msg.text || '';

    if (!this.engine) {
      await bot.sendMessage(chatId, 'MemoryEngine not configured.');
      return;
    }

    try {
      // Check for /plans all flag
      const showAll = text.includes(' all');

      let sessions: import('../codex/PlanningSession.js').SessionSummary[];
      if (showAll) {
        sessions = await PlanningSession.listAllSessions(this.engine, 100); // Show all
      } else {
        sessions = await PlanningSession.listSessions(this.engine, chatId, 10);
        // Fallback: if no sessions found by chatId, try listing all sessions
        if (sessions.length === 0) {
          console.log('[TelegramHandler] No sessions for chatId, trying all sessions');
          sessions = await PlanningSession.listAllSessions(this.engine, 10);
        }
      }

      // Cache for /resume N
      this.cachedSessionList = sessions;

      if (sessions.length === 0) {
        await bot.sendMessage(chatId, 'No planning sessions found. Start one with /plan');
        return;
      }

      // Build session list text (without inline commands - buttons handle that)
      const lines = sessions.map((s, i) => {
        const date = s.lastActivity.toLocaleDateString();
        const status = s.status === 'active' ? '🟢' : s.status === 'approved' ? '✅' : s.status === 'executed' ? '🏁' : '⚪';
        const num = i + 1;
        return `${num}. ${status} ${s.taskDescription.substring(0, 40)}...\n   ${date} • ${s.exchangeCount} exchanges`;
      });

      // Build inline keyboard with Resume/Delete buttons for each session
      const keyboard = sessions.map((_, i) => {
        const num = i + 1;
        return [
          { text: `▶️ Resume ${num}`, callback_data: JSON.stringify({ action: 'resume', num }) },
          { text: `🗑️ Delete ${num}`, callback_data: JSON.stringify({ action: 'delete', num }) }
        ];
      });

      const title = showAll ? '📋 *All Planning Sessions*' : '📋 *Your Planning Sessions*';
      await bot.sendMessage(
        chatId,
        `${title}\n\n${lines.join('\n\n')}`,
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: keyboard }
        }
      );
    } catch (error) {
      console.error('[TelegramHandler] Failed to list sessions:', error);
      await bot.sendMessage(chatId, `Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Delete a planning session by number (from cached list)
   * Usage: /delete N (e.g., /delete 2)
   */
  private async deletePlanningSession(msg: TelegramMessage, bot: TelegramBotAPI): Promise<void> {
    const chatId = msg.chat.id;
    const text = (msg.text || '').trim();

    if (!this.engine) {
      await bot.sendMessage(chatId, 'MemoryEngine not configured.');
      return;
    }

    try {
      // Parse /delete N syntax
      const match = text.match(/\/delete\s+(\d+)/);
      if (!match) {
        await bot.sendMessage(chatId, 'Usage: /delete N (e.g., /delete 2)\n\nUse /plans first to see available sessions.');
        return;
      }

      const index = parseInt(match[1], 10) - 1; // Convert to 0-based

      // Check cached session list
      if (this.cachedSessionList.length === 0) {
        await bot.sendMessage(chatId, 'No session list cached. Use /plans first to see available sessions.');
        return;
      }

      if (index < 0 || index >= this.cachedSessionList.length) {
        await bot.sendMessage(chatId, `Invalid session number. Valid range: 1-${this.cachedSessionList.length}`);
        return;
      }

      const targetSession = this.cachedSessionList[index];

      // Store pending deletion and ask for confirmation
      this.pendingDeletion = { chatId, session: targetSession, index };

      await bot.sendMessage(
        chatId,
        `⚠️ *Confirm Delete*\n\nYou're about to delete:\n"${targetSession.taskDescription.substring(0, 60)}..."\n\n${targetSession.exchangeCount} exchanges will be permanently deleted.\n\n→ /confirm - Delete permanently\n→ /cancel - Keep the session`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      console.error('[TelegramHandler] Failed to delete session:', error);
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
        message += `**Complexity:** ${plan.estimatedComplexity ?? 'medium'}\n`;
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
      // Preview the plan (don't approve yet)
      await bot.sendMessage(chatId, '📋 Generating current plan...');
      const plan = await this.planningSession.previewPlan();

      if (!plan) {
        await bot.sendMessage(chatId, 'Not enough context to generate a plan yet. Continue the conversation first.');
        return;
      }

      // Show the plan with details
      let planSummary = `📋 *Current Plan: ${plan.title || 'Untitled'}*\n\n`;
      planSummary += `${plan.description || 'No description'}\n\n`;

      if (plan.goals?.length > 0) {
        planSummary += `*Goals:*\n`;
        plan.goals.slice(0, 5).forEach(g => { planSummary += `• ${g}\n`; });
      }

      if (plan.components?.length > 0) {
        planSummary += `\n*Components:*\n`;
        plan.components.forEach(c => {
          const desc = c.description || '';
          planSummary += `• *${c.name || 'Unnamed'}*: ${desc.substring(0, 80)}${desc.length > 80 ? '...' : ''}\n`;
        });
      }

      if (plan.openQuestions?.length > 0) {
        planSummary += `\n⚠️ *Open Questions:*\n`;
        plan.openQuestions.slice(0, 3).forEach(q => { planSummary += `• ${q}\n`; });
      }

      if (plan.considerations?.some(c => c.includes('Plan generation failed'))) {
        planSummary += `\n⚠️ *Warning:* Plan was auto-generated due to parsing issues.\n`;
      }

      planSummary += `\n*Complexity:* ${plan.estimatedComplexity ?? 'medium'}`;

      await this.safeSendMarkdown(bot, chatId, planSummary);

      // Show inline buttons for execute confirmation
      await bot.sendMessage(chatId, 'Execute this plan?', {
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Yes, Execute', callback_data: JSON.stringify({ action: 'execute_yes' }) },
            { text: '❌ No, Continue', callback_data: JSON.stringify({ action: 'execute_no' }) }
          ]]
        }
      });

      // Set confirmation state
      this.awaitingExecuteConfirmation = true;

    } catch (error) {
      console.error('[TelegramHandler] Plan preview failed:', error);
      await bot.sendMessage(chatId, `Failed to generate plan: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async executeApprovedPlan(msg: TelegramMessage, bot: TelegramBotAPI): Promise<void> {
    const chatId = msg.chat.id;

    if (!this.planningSession || !this.taskExecutor) {
      await bot.sendMessage(chatId, 'Session expired. Please start a new /plan');
      return;
    }

    try {
      // NOW approve the plan
      await bot.sendMessage(chatId, '✅ Approving plan...');
      const plan = await this.planningSession.approve();

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

  /**
   * Context-aware cancel command - handles multiple scenarios
   */
  private async handleCancelCommand(msg: TelegramMessage, bot: TelegramBotAPI): Promise<void> {
    const chatId = msg.chat.id;

    // Priority 1: Cancel running task execution
    if (this.taskExecutor?.isRunning?.()) {
      const cancelled = this.taskExecutor.cancel();
      if (cancelled) {
        await bot.sendMessage(chatId, '🛑 Task cancelled. Current subtask aborted.');
        return;
      }
    }

    // Priority 2: Cancel pending deletion
    if (this.pendingDeletion && this.pendingDeletion.chatId === chatId) {
      this.pendingDeletion = null;
      await bot.sendMessage(chatId, '🚫 Deletion cancelled. Session kept.');
      return;
    }

    // Priority 3: Cancel active planning session
    if (this.planningSession) {
      try {
        await this.planningSession.cancel();
        this.planningSession = null;
        await bot.sendMessage(chatId, '❌ Planning session cancelled.');
        return;
      } catch (error) {
        await bot.sendMessage(chatId, `Error cancelling: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return;
      }
    }

    await bot.sendMessage(chatId, 'Nothing to cancel.');
  }

  /**
   * Confirm a pending deletion
   */
  private async confirmDeletion(msg: TelegramMessage, bot: TelegramBotAPI): Promise<void> {
    const chatId = msg.chat.id;

    if (!this.pendingDeletion || this.pendingDeletion.chatId !== chatId) {
      await bot.sendMessage(chatId, 'No pending deletion to confirm.');
      return;
    }

    if (!this.engine) {
      await bot.sendMessage(chatId, 'MemoryEngine not configured.');
      this.pendingDeletion = null;
      return;
    }

    try {
      const { session, index } = this.pendingDeletion;

      const deleted = await PlanningSession.deleteSession(this.engine, session.id);

      // Clear from cache
      this.cachedSessionList.splice(index, 1);

      // If this was the active session, clear it
      if (this.planningSession && this.planningSession.getId() === session.id) {
        this.planningSession = null;
      }

      this.pendingDeletion = null;
      await bot.sendMessage(chatId, `✅ Deleted session and ${deleted} related entries.`);
    } catch (error) {
      console.error('[TelegramHandler] Failed to confirm deletion:', error);
      await bot.sendMessage(chatId, `Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      this.pendingDeletion = null;
    }
  }

  /**
   * Send long responses as multiple messages for better readability
   */
  private async sendConversationalMessages(chatId: number, response: string, bot: TelegramBotAPI): Promise<void> {
    const MAX_LENGTH = 3500;

    if (response.length <= MAX_LENGTH) {
      await this.safeSendMarkdown(bot, chatId, response);
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

  /**
   * Handle conversational messages (non-command text)
   * Messages are stored in conversation session for later crystallization
   */
  private async handleConversationalMessage(msg: TelegramMessage, bot: TelegramBotAPI, image?: ImageAttachment | null): Promise<void> {
    const chatId = msg.chat.id;
    const text = (msg.text || (msg as any).caption || '').trim();

    // Allow messages with just images (no text required)
    if (!text && !image) return;

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

    // Initialize conversation session if needed
    if (!this.conversationSession && this.engine) {
      this.conversationSession = new ConversationSession(
        this.engine,
        chatId,
        this.defaultCodebase || process.cwd()
      );
      console.log('[TelegramHandler] Started new conversation session');
    }

    if (!this.conversationSession) {
      await bot.sendMessage(chatId, '❌ Conversation mode requires MemoryEngine. Use /task for direct execution.');
      return;
    }

    try {
      // Send typing indicator (with image acknowledgment)
      if (image) {
        await bot.sendMessage(chatId, '🖼️');
      }
      await bot.sendChatAction(chatId, 'typing');

      // Get response from Claude (with optional image)
      const response = await this.conversationSession.chat(text || 'What do you see in this image?', image || undefined);

      // Send response (may need chunking for long responses)
      if (response.length > 4000) {
        const chunks = response.match(/.{1,4000}/gs) || [];
        for (const chunk of chunks) {
          await this.safeSendMarkdown(bot, chatId, chunk);
        }
      } else {
        await this.safeSendMarkdown(bot, chatId, response);
      }
    } catch (error) {
      console.error('[TelegramHandler] Conversation error:', error);
      await bot.sendMessage(chatId, '❌ Error in conversation. Try again or use /task for direct execution.');
    }
  }

  /**
   * Handle /rubixallize command - crystallize conversation into a plan
   */
  private async handleRubixallizeCommand(msg: TelegramMessage, bot: TelegramBotAPI): Promise<void> {
    const chatId = msg.chat.id;

    // Check if there's a conversation to crystallize
    if (!this.conversationSession || this.conversationSession.isEmpty()) {
      await bot.sendMessage(chatId,
        '❌ No conversation to crystallize.\n\n' +
        'Chat with me first to discuss what you want to build, then use /rubixallize to create a plan.'
      );
      return;
    }

    try {
      await bot.sendMessage(chatId, '🔮 Crystallizing conversation into a plan...');
      await bot.sendChatAction(chatId, 'typing');

      // Convert conversation to planning session
      const summary = this.conversationSession.getSummary();
      this.planningSession = await this.conversationSession.toPlanningSession();

      // Clear conversation session
      this.conversationSession = null;

      // Get plan preview
      const plan = await this.planningSession.previewPlan();

      if (!plan) {
        await bot.sendMessage(chatId,
          '❌ Could not generate plan from conversation. Try adding more context about what you want to build.',
          { parse_mode: 'Markdown' }
        );
        return;
      }

      // Build component list for display
      const componentList = plan.components
        .map((c, i) => `${i + 1}. *${c.name}*: ${c.description}`)
        .join('\n');

      // Send plan preview
      await bot.sendMessage(chatId,
        `✨ *Crystallized from ${summary}*\n\n` +
        `*${plan.title}*\n${plan.description}\n\n` +
        `*Components:*\n${componentList}\n\n` +
        `Use /execute to run this plan, or /cancel to discard.`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      console.error('[TelegramHandler] Rubixallize error:', error);
      await bot.sendMessage(chatId, '❌ Failed to crystallize conversation: ' + (error as Error).message);
    }
  }

  // ===========================================================================
  // CONFIGURATION HANDLERS
  // ===========================================================================

  private async handleConfigCommand(msg: TelegramMessage, bot: TelegramBotAPI): Promise<void> {
    const chatId = msg.chat.id;

    let message = '⚙️ *RUBIX Configuration*\n\n';

    // Path permissions summary
    if (this.containment) {
      const rules = this.containment.getUserRules();
      message += `📂 *Allowed Paths:* ${rules.length}\n`;
    }

    // Engine status
    if (this.engine) {
      const stats = await this.engine.getStats();
      message += `🧠 *Memory:* ${stats.totalEntries} entries\n`;
    }

    // Executor status
    if (this.taskExecutor) {
      const status = this.taskExecutor.getStatus();
      message += `🔧 *Executor:* ${status.currentTask ? 'Active' : 'Idle'}\n`;
    }

    message += '\n*Commands:*\n';
    message += '`/paths` - List allowed paths\n';
    message += '`/path-add <path> [rw|read]` - Add path\n';
    message += '`/path-remove <pattern>` - Remove path\n';

    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  }

  private async handlePathsCommand(chatId: number, bot: TelegramBotAPI): Promise<void> {
    if (!this.containment) {
      await bot.sendMessage(chatId, '⚠️ Containment not configured');
      return;
    }

    const rules = this.containment.getUserRules();

    if (rules.length === 0) {
      await bot.sendMessage(chatId,
        '📂 *Allowed Paths*\n\nNo custom paths configured.\n\nAdd with: `/path-add E:/ rw`',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    let message = '📂 *Allowed Paths*\n\n';
    for (const rule of rules) {
      const icon = rule.permission === 'read' ? '📖' : '📝';
      message += `${icon} \`${rule.pattern}\` (${rule.permission})\n`;
    }
    message += '\n_Use `/path-add` or `/path-remove`_';

    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  }

  private async handlePathAddCommand(msg: TelegramMessage, bot: TelegramBotAPI): Promise<void> {
    const chatId = msg.chat.id;
    const text = msg.text || '';

    // Parse: /path-add E:/ rw   OR   /path-add "D:/My Folder" read
    // Try quoted path first, then unquoted
    const quotedMatch = text.match(/\/path-add\s+["']([^"']+)["']\s*(read|rw|read-write)?/i);
    const unquotedMatch = text.match(/\/path-add\s+(\S+)\s*(read|rw|read-write)?/i);
    const match = quotedMatch || unquotedMatch;

    if (!match) {
      await bot.sendMessage(chatId,
        '❌ Usage: `/path-add <path> [permission]`\n\n' +
        'Examples:\n' +
        '`/path-add E:/ rw`\n' +
        '`/path-add D:/projects read`\n\n' +
        'Permissions: `read` | `rw` (read-write)',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const pattern = match[1].trim();
    const permArg = (match[2] || 'rw').toLowerCase();
    const permission = permArg === 'rw' ? 'read-write' : permArg;

    if (!this.containment) {
      await bot.sendMessage(chatId, '⚠️ Containment not configured');
      return;
    }

    const result = this.containment.addUserRule(pattern, permission as 'read' | 'read-write', 'Added via Telegram');

    if (result.success) {
      const icon = permission === 'read' ? '📖' : '📝';
      await bot.sendMessage(chatId, `${icon} Added: \`${pattern}\` (${permission})`, { parse_mode: 'Markdown' });
    } else {
      await bot.sendMessage(chatId, `❌ Failed: ${result.reason}`);
    }
  }

  private async handlePathRemoveCommand(msg: TelegramMessage, bot: TelegramBotAPI): Promise<void> {
    const chatId = msg.chat.id;
    const text = msg.text || '';

    const pattern = text.replace('/path-remove', '').trim();

    if (!pattern) {
      await bot.sendMessage(chatId,
        '❌ Usage: `/path-remove <pattern>`\n\n' +
        'Example: `/path-remove E:/**`',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (!this.containment) {
      await bot.sendMessage(chatId, '⚠️ Containment not configured');
      return;
    }

    const result = this.containment.removeUserRule(pattern);

    if (result.success) {
      await bot.sendMessage(chatId, `🗑️ Removed: \`${pattern}\``, { parse_mode: 'Markdown' });
    } else {
      await bot.sendMessage(chatId, `❌ Failed: ${result.reason}`);
    }
  }

  private async handleWaitCommand(msg: TelegramMessage, bot: TelegramBotAPI): Promise<void> {
    const chatId = msg.chat.id;
    const text = msg.text || '';

    // Parse optional minutes argument (default 10)
    const match = text.match(/\/wait\s*(\d+)?/);
    const minutes = match?.[1] ? parseInt(match[1], 10) : 10;

    if (!this.comms) {
      await bot.sendMessage(chatId, '⚠️ No communication manager configured');
      return;
    }

    const result = this.comms.extendTimeout(minutes);

    if (result.extended) {
      const timeStr = result.newTimeout
        ? result.newTimeout.toLocaleTimeString()
        : 'extended';
      await bot.sendMessage(
        chatId,
        `⏰ Extended timeout by ${minutes} minutes\n` +
        `New deadline: ${timeStr}\n\n` +
        `Use /wait again to add more time.`,
        { parse_mode: 'Markdown' }
      );
    } else {
      // No pending escalations - check if there's an active task
      if (this.taskExecutor) {
        const status = this.taskExecutor.getStatus();
        if (status.currentTask) {
          await bot.sendMessage(
            chatId,
            '⚠️ No pending escalation to extend.\n\n' +
            `Task status: ${status.currentTask.status}\n` +
            'Use /status for more details.'
          );
        } else {
          await bot.sendMessage(chatId, '⚠️ No pending escalation or active task to extend.');
        }
      } else {
        await bot.sendMessage(chatId, '⚠️ No pending escalation or active task to extend.');
      }
    }
  }

  /**
   * Handle /restart command - restarts the entire system
   */
  private async handleRestartCommand(chatId: number, bot: TelegramBotAPI): Promise<void> {
    await bot.sendMessage(chatId, '🔄 Restarting system in 3 seconds...');

    // Spawn restart script detached so it survives this process dying
    const { spawn } = await import('child_process');
    const path = await import('path');
    const restartScript = path.join(process.cwd(), 'restart.bat');

    spawn('cmd.exe', ['/c', restartScript], {
      detached: true,
      stdio: 'ignore',
      shell: true
    }).unref();

    // Give message time to send, then exit
    setTimeout(() => process.exit(0), 1000);
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

    // Compress the task description
    const compressed = InputCompressor.compress(taskDescription);
    const compressionMsg = compressed.ratio > 0.05
      ? `\n📦 Compressed: ${Math.round(compressed.ratio * 100)}% (~${compressed.tokensSaved} tokens saved)`
      : '';

    const taskId = this.generateTaskId();
    const taskRequest: TaskRequest = {
      id: taskId,
      description: compressed.compressed,
      userId: msg.from?.id || 0,
      chatId: chatId,
      timestamp: Date.now()
    };

    this.activeTasks.set(taskId, taskRequest);

    await bot.sendMessage(chatId, `Task started: ${compressed.compressed}\nTask ID: ${taskId}${compressionMsg}`);

    try {
      // AutoRecall: Query memory for relevant context (centralized brain)
      let specification = 'IMPORTANT: Before starting, please escalate and ask any clarifying questions about requirements, target location, technology choices, or concerns you have. Do not assume - ask first.';

      try {
        const recallResult = await this.autoRecall.recall('task', { description: taskDescription });
        if (recallResult.memories.length > 0) {
          const recalledContext = recallResult.memories
            .map(m => `- ${m.content.slice(0, 300)}${m.content.length > 300 ? '...' : ''} (score: ${m.score.toFixed(2)})`)
            .join('\n');
          specification = `[Recalled Context from Memory]\n${recalledContext}\n\n${specification}`;

          if (process.env.AUTORECALL_DEBUG === 'true') {
            console.log(`[TelegramHandler] AutoRecall: Found ${recallResult.memories.length} memories in ${recallResult.recallTimeMs}ms`);
          }
        }
      } catch (recallError) {
        // AutoRecall failures should not block the task
        if (process.env.AUTORECALL_DEBUG === 'true') {
          console.error('[TelegramHandler] AutoRecall error:', recallError);
        }
      }

      // Use the correct TaskExecutor API (with compressed description)
      const result = await this.taskExecutor.execute({
        description: compressed.compressed,
        specification,
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

  /**
   * Download an image from Telegram and convert to base64
   */
  private async downloadImage(bot: TelegramBotAPI, fileId: string): Promise<ImageAttachment | null> {
    try {
      // Get file info from Telegram
      const file = await bot.getFile(fileId);
      if (!file.file_path) {
        console.error('[TelegramHandler] No file_path in Telegram response');
        return null;
      }

      // Download the file
      const token = (bot as any).token;
      const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

      const response = await fetch(fileUrl);
      if (!response.ok) {
        console.error(`[TelegramHandler] Failed to download image: ${response.status}`);
        return null;
      }

      const buffer = await response.arrayBuffer();
      const base64 = Buffer.from(buffer).toString('base64');

      // Determine media type from file extension
      const ext = file.file_path.split('.').pop()?.toLowerCase();
      let mediaType: ImageAttachment['mediaType'] = 'image/jpeg';
      if (ext === 'png') mediaType = 'image/png';
      else if (ext === 'gif') mediaType = 'image/gif';
      else if (ext === 'webp') mediaType = 'image/webp';

      console.log(`[TelegramHandler] Downloaded image: ${file.file_path} (${Math.round(base64.length / 1024)}KB)`);
      return { base64, mediaType };
    } catch (error) {
      console.error('[TelegramHandler] Error downloading image:', error);
      return null;
    }
  }

  /**
   * Extract image from Telegram message if present
   * Returns the largest available photo size
   */
  private async extractImage(msg: TelegramMessage, bot: TelegramBotAPI): Promise<ImageAttachment | null> {
    // Check for photo (array of sizes, last is largest)
    const photo = (msg as any).photo;
    if (photo && Array.isArray(photo) && photo.length > 0) {
      const largest = photo[photo.length - 1];
      return this.downloadImage(bot, largest.file_id);
    }

    // Check for document that is an image
    const doc = (msg as any).document;
    if (doc && doc.mime_type?.startsWith('image/')) {
      return this.downloadImage(bot, doc.file_id);
    }

    return null;
  }

  /**
   * Safely send a message with Markdown, falling back to plain text on parse errors.
   * Telegram's Markdown parser chokes on unescaped special chars in paths.
   */
  private async safeSendMarkdown(
    bot: TelegramBotAPI,
    chatId: number,
    text: string
  ): Promise<void> {
    try {
      await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    } catch (error: unknown) {
      // Check if it's a Telegram markdown parse error
      const telegramError = error as { response?: { body?: { description?: string } } };
      if (telegramError.response?.body?.description?.includes("can't parse entities")) {
        // Fall back to plain text
        await bot.sendMessage(chatId, text);
      } else {
        throw error;
      }
    }
  }
}
