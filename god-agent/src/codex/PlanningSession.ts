/**
 * PlanningSession
 *
 * Core session manager for memory-backed unlimited planning.
 * Stores ALL exchanges in memory, enabling massive multi-day planning sessions.
 *
 * Key Features:
 * - Unlimited conversation length (bypasses context window via memory)
 * - Semantic retrieval of relevant past exchanges
 * - Session persistence for resume capability
 * - Plan document generation and tracking
 * - Foundation for multi-model collaboration
 */

import { v4 as uuidv4 } from 'uuid';
import type { MemoryEngine } from '../core/MemoryEngine.js';
import { MemorySource } from '../core/types.js';
import { PlanningAgent, type PlanDocument, type PlanningExchange, type ImageContent } from './PlanningAgent.js';
import type { TaskSubmission } from './TaskExecutor.js';
import { getLLMCompressor } from '../memory/LLMCompressor.js';

/**
 * Standalone decompression helper for static methods and contexts without instance access.
 */
async function decompressMemoryContent(content: string, tags: string[]): Promise<string> {
  if (!tags.includes('llm-compressed')) {
    return content;
  }

  try {
    const compressor = getLLMCompressor();
    if (compressor.isAvailable()) {
      return await compressor.decompress(content);
    }
  } catch {
    // Not initialized or failed
  }

  return content;
}

/**
 * Configuration for a planning session
 */
export interface PlanningSessionConfig {
  /** Resume an existing session (optional) */
  id?: string;
  /** Description of what we're planning */
  taskDescription: string;
  /** Codebase path */
  codebase: string;
  /** Telegram chat ID for this session */
  chatId: number;
  /** Optional Anthropic API key (uses env if not provided) */
  apiKey?: string;
}

/**
 * Session metadata stored in memory
 */
interface SessionMeta {
  id: string;
  taskDescription: string;
  codebase: string;
  chatId: number;
  createdAt: string;
  lastActivityAt: string;
  exchangeCount: number;
  status: 'active' | 'approved' | 'executed' | 'cancelled';
  planVersion: number;
}

/**
 * Status of a planning session
 */
export interface PlanningStatus {
  sessionId: string;
  taskDescription: string;
  exchangeCount: number;
  hasPlan: boolean;
  openQuestions: number;
  status: 'active' | 'approved' | 'executed' | 'cancelled';
  lastActivity: Date;
}

/**
 * Summary of a session for listing
 */
export interface SessionSummary {
  id: string;
  taskDescription: string;
  createdAt: Date;
  lastActivity: Date;
  exchangeCount: number;
  status: string;
}

/**
 * PlanningSession - Memory-backed unlimited planning conversations
 */
export class PlanningSession {
  private engine: MemoryEngine;
  private agent: PlanningAgent;
  private config: PlanningSessionConfig;
  private id: string;

  /** In-memory cache of exchanges (subset for continuity) */
  private recentExchanges: PlanningExchange[] = [];

  /** Current plan document */
  private currentPlan?: PlanDocument;

  /** Key decisions made */
  private decisions: string[] = [];

  /** Session metadata */
  private meta: SessionMeta;

  /** Track last stored exchange for chaining */
  private lastExchangeId?: string;

  /** Track metadata entry ID to update instead of creating duplicates */
  private metaEntryId?: string;

  /**
   * Decompress LLM-compressed content.
   */
  private async decompressContent(content: string, tags: string[]): Promise<string> {
    if (!tags.includes('llm-compressed')) {
      return content;
    }

    try {
      const compressor = getLLMCompressor();
      if (compressor.isAvailable()) {
        return await compressor.decompress(content);
      }
    } catch {
      // Not initialized or failed
    }

    return content;
  }

  /**
   * Get a simple response for common conversational messages.
   * Returns null if the message requires full agent processing.
   */
  private getSimpleResponse(input: string): string | null {
    const msg = input.trim().toLowerCase().replace(/[!?.]+$/, '');

    // Greetings
    if (/^(hi|hello|hey|yo|sup|hiya)$/.test(msg)) {
      return "Hey! What would you like to work on today?";
    }

    // Thanks
    if (/^(thanks|thank you|thx|ty|cheers)$/.test(msg)) {
      return "You're welcome! Anything else you need?";
    }

    // Acknowledgments
    if (/^(ok|okay|sure|got it|understood|makes sense|cool|great|nice|perfect)$/.test(msg)) {
      return "Great! Let me know when you're ready to continue.";
    }

    // Affirmatives
    if (/^(yes|yeah|yep|yup|y)$/.test(msg)) {
      return "Got it! What's next?";
    }

    // Negatives
    if (/^(no|nope|nah|n)$/.test(msg)) {
      return "No problem. What would you like to do instead?";
    }

    // Farewells
    if (/^(bye|goodbye|cya|later|see ya)$/.test(msg)) {
      return "See you later! Session saved - use /resume to continue anytime.";
    }

    return null; // Not a simple message, proceed with full agent
  }

  constructor(engine: MemoryEngine, config: PlanningSessionConfig) {
    this.engine = engine;
    this.config = config;
    this.id = config.id || uuidv4();

    // Initialize planning agent
    const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY required for planning sessions');
    }

    this.agent = new PlanningAgent({ apiKey, codebaseRoot: config.codebase });

    // Initialize session metadata
    this.meta = {
      id: this.id,
      taskDescription: config.taskDescription,
      codebase: config.codebase,
      chatId: config.chatId,
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      exchangeCount: 0,
      status: 'active',
      planVersion: 0
    };

    console.log(`[PlanningSession] Created session ${this.id}`);
  }

  // ===========================================================================
  // PUBLIC LIFECYCLE METHODS
  // ===========================================================================

  /**
   * Check if session is active
   */
  isActive(): boolean {
    return this.meta.status === 'active';
  }

  /**
   * Get session ID
   */
  getId(): string {
    return this.id;
  }

  /**
   * Get task description
   */
  getTaskDescription(): string {
    return this.config.taskDescription;
  }

  /**
   * Get exchange count
   */
  getExchangeCount(): number {
    return this.meta.exchangeCount;
  }

  /**
   * Start a new planning session
   */
  async start(): Promise<string> {
    console.log(`[PlanningSession] Starting session for: ${this.config.taskDescription}`);

    // Get initial response from Claude
    const response = await this.agent.startSession(this.config.taskDescription);

    // Store the initial exchange
    await this.storeExchange(
      `I want to plan: ${this.config.taskDescription}`,
      'user'
    );
    await this.storeExchange(response, 'assistant');

    // Store session metadata AFTER exchanges so count is accurate
    await this.storeSessionMeta();

    return response;
  }

  /**
   * Continue the planning conversation
   * @param userMessage Text message from user
   * @param image Optional image attachment
   * @param maxIterations Optional max tool iterations (default 10, increased for queued messages)
   */
  async chat(userMessage: string, image?: ImageContent, maxIterations?: number): Promise<string> {
    if (!this.isActive()) {
      return 'This planning session is no longer active. Start a new session with /plan';
    }

    // Check for simple conversational messages - no API call needed (only if no image)
    if (!image) {
      const simpleResponse = this.getSimpleResponse(userMessage);
      if (simpleResponse) {
        console.log(`[PlanningSession] Simple response for: ${userMessage}`);
        await this.storeExchange(userMessage, 'user');
        await this.storeExchange(simpleResponse, 'assistant');
        return simpleResponse;
      }
    }

    console.log(`[PlanningSession] Chat: ${userMessage.substring(0, 50)}...${image ? ' [with image]' : ''}${maxIterations ? ` [maxIter: ${maxIterations}]` : ''}`);

    // Store user message (note: we can't store images in memory, just note that one was attached)
    const storedMessage = image ? `${userMessage} [Image attached]` : userMessage;
    await this.storeExchange(storedMessage, 'user');

    // Build context from memory
    const retrievedContext = await this.retrieveRelevantContext(userMessage);

    // Debug: Log what context is being passed to agent
    console.log(`[PlanningSession] Chat context:`, {
      hasCurrentPlan: !!this.currentPlan,
      planTitle: this.currentPlan?.title || 'N/A',
      decisionsCount: this.decisions.length,
      recentExchangesCount: this.recentExchanges.length,
      retrievedContextLength: retrievedContext.length
    });

    // Get response from Claude with context (and optional image)
    const response = await this.agent.respond(userMessage, {
      taskDescription: this.config.taskDescription,
      retrievedContext,
      recentExchanges: this.recentExchanges.slice(-10),
      currentPlan: this.currentPlan,
      decisions: this.decisions,
      image,
      maxIterations
    });

    // Store assistant response
    await this.storeExchange(response, 'assistant');

    // Check if response contains a decision
    if (this.containsDecision(userMessage, response)) {
      await this.extractAndStoreDecision(userMessage, response);
    }

    // Generate initial plan after 2 exchanges, then update on EVERY exchange
    // Plan evolves continuously as conversation progresses
    const shouldGeneratePlan = !this.currentPlan && this.meta.exchangeCount >= 2;
    const shouldUpdatePlan = this.currentPlan && this.meta.exchangeCount > 0;

    if (shouldGeneratePlan || shouldUpdatePlan) {
      console.log(`[PlanningSession] ${shouldGeneratePlan ? 'Generating initial' : 'Updating'} plan at exchange ${this.meta.exchangeCount}`);
      await this.updatePlanDocument();
    }

    // Persist session metadata with updated exchange count
    await this.storeSessionMeta();

    return response;
  }

  /**
   * Resume an existing session
   * @returns Welcome back message with context summary
   */
  async resume(): Promise<string> {
    console.log(`[PlanningSession] Resuming session ${this.id}`);

    // Load session metadata
    await this.loadSessionMeta();

    // Load recent exchanges
    await this.loadRecentExchanges();

    // Load current plan if exists
    await this.loadCurrentPlan();

    // Load decisions
    await this.loadDecisions();

    // Force plan generation if we have enough exchanges but no plan
    if (!this.currentPlan && this.meta.exchangeCount >= 2) {
      console.log('[PlanningSession] No plan loaded, generating from history...');
      await this.updatePlanDocument();
    }

    // Generate resume summary
    const summary = this.generateResumeSummary();

    return summary;
  }

  /**
   * Approve the plan
   * @returns The approved plan document
   */
  async approve(): Promise<PlanDocument> {
    console.log(`[PlanningSession] Approving plan for session ${this.id}`);

    // Generate final plan document
    await this.updatePlanDocument();

    if (!this.currentPlan) {
      throw new Error('No plan document generated. Continue the conversation to build a plan.');
    }

    // Mark as approved
    this.meta.status = 'approved';
    await this.storeSessionMeta();

    // Store approved plan with special tag
    await this.engine.store(JSON.stringify(this.currentPlan, null, 2), {
      tags: [
        'planning',
        'plan-document',
        'approved',
        `session:${this.id}`,
        `codebase:${this.config.codebase}`
      ],
      source: MemorySource.AGENT_INFERENCE,
      importance: 0.95,
      confidence: 0.9,
      sessionId: this.id
    });

    console.log(`[PlanningSession] Plan approved: ${this.currentPlan.title}`);

    return this.currentPlan;
  }

  /**
   * Convert approved plan to TaskSubmission for execution
   */
  async toTaskSubmission(): Promise<TaskSubmission> {
    if (this.meta.status !== 'approved') {
      throw new Error('Plan must be approved before execution. Use /execute first.');
    }

    if (!this.currentPlan) {
      throw new Error('No plan document available.');
    }

    // Build detailed specification from plan
    const specification = this.buildSpecificationFromPlan();

    // Mark as executed
    this.meta.status = 'executed';
    await this.storeSessionMeta();

    console.log(`[PlanningSession] Converted to TaskSubmission: ${this.currentPlan.title}`);

    return {
      description: this.config.taskDescription,
      specification,
      codebase: this.config.codebase,
      constraints: this.currentPlan.considerations
    };
  }

  /**
   * Cancel the session
   */
  async cancel(): Promise<void> {
    this.meta.status = 'cancelled';
    await this.storeSessionMeta();
    console.log(`[PlanningSession] Session ${this.id} cancelled`);
  }

  /**
   * Get current status
   */
  async getStatus(): Promise<PlanningStatus> {
    return {
      sessionId: this.id,
      taskDescription: this.config.taskDescription,
      exchangeCount: this.meta.exchangeCount,
      hasPlan: !!this.currentPlan,
      openQuestions: this.currentPlan?.openQuestions.length || 0,
      status: this.meta.status,
      lastActivity: new Date(this.meta.lastActivityAt)
    };
  }

  /**
   * Get current plan document
   */
  getPlan(): PlanDocument | undefined {
    return this.currentPlan;
  }

  /**
   * Preview the current plan without approving
   * Generates/updates the plan document but keeps session active
   * @returns The current plan, or null if not enough context yet
   */
  async previewPlan(): Promise<PlanDocument | null> {
    await this.updatePlanDocument();
    return this.currentPlan || null;
  }

  /**
   * Inject an exchange into the session
   * Used by ConversationSession when converting to PlanningSession
   */
  async injectExchange(role: 'user' | 'assistant', content: string): Promise<void> {
    await this.storeExchange(content, role);
  }

  // ===========================================================================
  // STATIC METHODS
  // ===========================================================================

  /**
   * List all planning sessions for a chat
   */
  static async listSessions(
    engine: MemoryEngine,
    chatId: number,
    limit: number = 10
  ): Promise<SessionSummary[]> {
    console.log(`[PlanningSession] Listing sessions for chat ${chatId}`);

    const results = await engine.query('planning session metadata', {
      topK: limit * 3, // Get extra to filter
      filters: {
        tags: ['planning', 'session-meta', `chat:${chatId}`]
      }
    });

    console.log(`[PlanningSession] Query returned ${results.length} results`);

    const summaries: SessionSummary[] = [];

    for (const r of results) {
      const tags = r.entry.metadata.tags || [];
      let content = r.entry.content;

      // Decompress if needed (LLM or legacy compression)
      content = await decompressMemoryContent(content, tags);

      try {
        const meta = JSON.parse(content) as SessionMeta;
        summaries.push({
          id: meta.id,
          taskDescription: meta.taskDescription,
          createdAt: new Date(meta.createdAt),
          lastActivity: new Date(meta.lastActivityAt),
          exchangeCount: meta.exchangeCount,
          status: meta.status
        });
      } catch (e) {
        // Skip entries that aren't valid session metadata JSON
        console.warn(`[PlanningSession] Skipping non-JSON entry`);
      }
    }

    // Sort by last activity descending
    summaries.sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());

    console.log(`[PlanningSession] Found ${summaries.length} valid sessions`);
    return summaries.slice(0, limit);
  }

  /**
   * List ALL planning sessions across all chats
   * Useful for debugging and admin purposes
   */
  static async listAllSessions(
    engine: MemoryEngine,
    limit: number = 20
  ): Promise<SessionSummary[]> {
    console.log(`[PlanningSession] Listing ALL sessions (no chat filter)`);

    // Query with just planning + session-meta tags
    const results = await engine.query('planning session', {
      topK: limit * 3,
      filters: {
        tags: ['planning', 'session-meta']
      }
    });

    console.log(`[PlanningSession] Query returned ${results.length} results`);

    const summaries: SessionSummary[] = [];

    for (const r of results) {
      const tags = r.entry.metadata.tags || [];
      let content = r.entry.content;

      // Decompress if needed (LLM or legacy compression)
      content = await decompressMemoryContent(content, tags);

      try {
        const meta = JSON.parse(content) as SessionMeta;
        summaries.push({
          id: meta.id,
          taskDescription: meta.taskDescription,
          createdAt: new Date(meta.createdAt),
          lastActivity: new Date(meta.lastActivityAt),
          exchangeCount: meta.exchangeCount,
          status: meta.status
        });
      } catch (e) {
        // Skip entries that aren't valid session metadata JSON
        console.warn(`[PlanningSession] Skipping non-JSON entry`);
      }
    }

    summaries.sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());
    console.log(`[PlanningSession] Found ${summaries.length} total sessions`);
    return summaries.slice(0, limit);
  }

  /**
   * Load an existing session by ID
   */
  static async load(
    engine: MemoryEngine,
    sessionId: string,
    config: Omit<PlanningSessionConfig, 'id'>
  ): Promise<PlanningSession> {
    const session = new PlanningSession(engine, { ...config, id: sessionId });
    await session.resume();
    return session;
  }

  /**
   * Delete a planning session and all its data
   * @returns Number of entries deleted
   */
  static async deleteSession(engine: MemoryEngine, sessionId: string): Promise<number> {
    console.log(`[PlanningSession] Deleting session ${sessionId}`);

    // Find all entries with this session tag
    const results = await engine.query('session data', {
      topK: 500, // Get all related entries
      filters: {
        tags: [`session:${sessionId}`]
      }
    });

    console.log(`[PlanningSession] Found ${results.length} entries to delete`);

    let deleted = 0;
    for (const r of results) {
      if (engine.deleteEntry(r.entry.id)) {
        deleted++;
      }
    }

    console.log(`[PlanningSession] Deleted ${deleted} entries`);
    return deleted;
  }

  // ===========================================================================
  // PRIVATE MEMORY METHODS
  // ===========================================================================

  /**
   * Store an exchange in memory
   */
  private async storeExchange(content: string, role: 'user' | 'assistant'): Promise<string | undefined> {
    const exchange: PlanningExchange = {
      id: uuidv4(),
      role,
      content,
      timestamp: new Date()
    };

    // Generate summary for better retrieval (async, don't wait)
    let summary: string | undefined;
    if (content.length > 200) {
      try {
        summary = await this.agent.summarizeForRetrieval(content);
      } catch {
        summary = content.substring(0, 200) + '...';
      }
    }

    // Store in memory - gracefully handle L-Score threshold failures
    let entryId: string | undefined;
    try {
      const entry = await this.engine.store(content, {
        tags: [
          'planning',
          'exchange',
          `session:${this.id}`,
          `codebase:${this.config.codebase}`,
          `chat:${this.config.chatId}`,
          role
        ],
        source: role === 'user' ? MemorySource.USER_INPUT : MemorySource.AGENT_INFERENCE,
        importance: 0.85,
        confidence: 1.0,
        sessionId: this.id,
        parentIds: this.lastExchangeId ? [this.lastExchangeId] : undefined,
        context: summary ? { summary } : undefined
      });

      exchange.memoryId = entry.id;
      this.lastExchangeId = entry.id;
      entryId = entry.id;
      console.log(`[PlanningSession] Stored ${role} exchange (${content.length} chars)`);
    } catch (error) {
      // L-Score threshold or other storage failures shouldn't crash the session
      const errorName = error instanceof Error ? error.name : 'Unknown';
      console.warn(`[PlanningSession] Storage failed (${errorName}), continuing without persistence`);
    }

    // Update local cache regardless of storage success
    this.recentExchanges.push(exchange);
    if (this.recentExchanges.length > 10) {
      this.recentExchanges.shift();
    }

    // Update metadata
    this.meta.exchangeCount++;
    this.meta.lastActivityAt = new Date().toISOString();

    return entryId;
  }

  /**
   * Retrieve relevant context for a query
   */
  private async retrieveRelevantContext(query: string, limit: number = 15): Promise<string> {
    const results = await this.engine.query(query, {
      topK: limit,
      filters: {
        tags: [`session:${this.id}`],
        minImportance: 0.5
      }
    });

    if (results.length === 0) {
      return '';
    }

    // Format results
    const parts: string[] = [];

    for (const r of results) {
      const tags = r.entry.metadata.tags || [];
      let content = r.entry.content;

      // Decompress if needed (LLM or legacy compression)
      content = await this.decompressContent(content, tags);

      const role = tags.includes('user') ? 'USER' : 'ASSISTANT';
      const truncated = content.length > 500 ? content.substring(0, 500) + '...' : content;

      parts.push(`[${role}] ${truncated}`);
    }

    console.log(`[PlanningSession] Retrieved ${results.length} relevant exchanges`);

    return parts.join('\n\n');
  }

  /**
   * Store session metadata
   */
  private async storeSessionMeta(): Promise<void> {
    try {
      const content = JSON.stringify(this.meta);

      // Update existing entry if we have one, otherwise create new
      if (this.metaEntryId) {
        await this.engine.updateEntry(this.metaEntryId, { content });
      } else {
        const entry = await this.engine.store(content, {
          tags: [
            'planning',
            'session-meta',
            `session:${this.id}`,
            `chat:${this.config.chatId}`,
            `codebase:${this.config.codebase}`
          ],
          source: MemorySource.SYSTEM,
          importance: 0.9,
          sessionId: this.id
        });
        this.metaEntryId = entry.id;
      }
    } catch (error) {
      console.warn(`[PlanningSession] Meta storage failed, session may not be resumable`);
    }
  }

  /**
   * Load session metadata from memory
   */
  private async loadSessionMeta(): Promise<void> {
    const results = await this.engine.query('session metadata', {
      topK: 1,
      filters: {
        tags: ['planning', 'session-meta', `session:${this.id}`]
      }
    });

    if (results.length > 0) {
      try {
        const tags = results[0].entry.metadata.tags || [];
        let content = results[0].entry.content;

        // Decompress if needed (LLM or legacy compression)
        content = await this.decompressContent(content, tags);

        this.meta = JSON.parse(content);
        this.metaEntryId = results[0].entry.id; // Track for updates
        console.log(`[PlanningSession] Loaded metadata: ${this.meta.exchangeCount} exchanges`);
      } catch {
        console.warn('[PlanningSession] Failed to parse session metadata');
      }
    }
  }

  /**
   * Load recent exchanges from memory
   */
  private async loadRecentExchanges(): Promise<void> {
    const results = await this.engine.query('recent exchange', {
      topK: 20,
      filters: {
        tags: ['planning', 'exchange', `session:${this.id}`]
      }
    });

    this.recentExchanges = await Promise.all(results.map(async r => {
      const tags = r.entry.metadata.tags || [];
      let content = r.entry.content;

      // Decompress if needed (LLM or legacy compression)
      content = await this.decompressContent(content, tags);

      return {
        id: r.entry.id,
        role: (tags.includes('user') ? 'user' : 'assistant') as 'user' | 'assistant',
        content,
        timestamp: new Date(r.entry.createdAt),
        memoryId: r.entry.id
      };
    }));

    // Sort by timestamp (oldest first for conversation order)
    this.recentExchanges.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    // Keep last 10
    if (this.recentExchanges.length > 10) {
      this.recentExchanges = this.recentExchanges.slice(-10);
    }

    if (this.recentExchanges.length > 0) {
      this.lastExchangeId = this.recentExchanges[this.recentExchanges.length - 1].memoryId;
    }

    console.log(`[PlanningSession] Loaded ${this.recentExchanges.length} recent exchanges`);
  }

  /**
   * Load current plan from memory
   */
  private async loadCurrentPlan(): Promise<void> {
    const results = await this.engine.query('plan document', {
      topK: 1,
      filters: {
        tags: ['planning', 'plan-document', `session:${this.id}`]
      }
    });

    if (results.length > 0) {
      try {
        const tags = results[0].entry.metadata.tags || [];
        let content = results[0].entry.content;

        // Decompress if needed (LLM or legacy compression)
        content = await this.decompressContent(content, tags);

        this.currentPlan = JSON.parse(content);
        console.log(`[PlanningSession] Loaded plan: ${this.currentPlan?.title}`);
      } catch {
        console.warn('[PlanningSession] Failed to parse plan document');
      }
    }
  }

  /**
   * Load decisions from memory
   */
  private async loadDecisions(): Promise<void> {
    const results = await this.engine.query('decision', {
      topK: 20,
      filters: {
        tags: ['planning', 'decision', `session:${this.id}`]
      }
    });

    this.decisions = await Promise.all(results.map(async r => {
      const tags = r.entry.metadata.tags || [];
      let content = r.entry.content;

      // Decompress if needed (LLM or legacy compression)
      content = await this.decompressContent(content, tags);

      return content;
    }));
    console.log(`[PlanningSession] Loaded ${this.decisions.length} decisions`);
  }

  /**
   * Update the plan document based on conversation
   */
  private async updatePlanDocument(): Promise<void> {
    // Get conversation summary
    const allExchanges = await this.engine.query('exchange', {
      topK: 100,
      filters: {
        tags: ['planning', 'exchange', `session:${this.id}`]
      }
    });

    if (allExchanges.length < 4) {
      console.log('[PlanningSession] Not enough exchanges for plan generation yet');
      return;
    }

    // Build summary from exchanges
    const summaryParts = await Promise.all(allExchanges
      .slice(-30) // Last 30 exchanges
      .map(async r => {
        const tags = r.entry.metadata.tags || [];
        let content = r.entry.content;

        // Decompress if needed (LLM or legacy compression)
        content = await this.decompressContent(content, tags);

        const role = tags.includes('user') ? 'USER' : 'ASSISTANT';
        return `[${role}] ${content.substring(0, 300)}...`;
      }));

    const conversationSummary = summaryParts.join('\n\n');

    // Generate plan document
    try {
      this.currentPlan = await this.agent.generatePlanDocument(
        this.config.taskDescription,
        conversationSummary,
        this.currentPlan
      );

      // Detect if this is a fallback plan (JSON parsing failed)
      const isFallback = this.currentPlan.considerations?.some(
        c => c.includes('Plan generation failed')
      );
      if (isFallback) {
        console.warn('[PlanningSession] Using fallback plan due to JSON parsing failure');
      }

      // Store updated plan
      this.meta.planVersion++;
      await this.engine.store(JSON.stringify(this.currentPlan, null, 2), {
        tags: [
          'planning',
          'plan-document',
          `session:${this.id}`,
          `codebase:${this.config.codebase}`,
          `version:${this.meta.planVersion}`
        ],
        source: MemorySource.AGENT_INFERENCE,
        importance: 0.9,
        confidence: 0.85,
        sessionId: this.id
      });

      console.log(`[PlanningSession] Updated plan v${this.meta.planVersion}: ${this.currentPlan.title}`);
    } catch (error) {
      console.error('[PlanningSession] Failed to update plan:', error);
    }
  }

  /**
   * Check if exchange contains a decision
   */
  private containsDecision(userMessage: string, _response: string): boolean {
    const decisionPatterns = [
      /\b(decided|choosing|going with|prefer|let's do|will use)\b/i,
      /\b(yes|no|option [a-z]|choice [0-9])\b/i,
      /\b(sounds good|that works|perfect|agreed)\b/i
    ];

    return decisionPatterns.some(p => p.test(userMessage));  // Only user's words count as decisions
  }

  /**
   * Extract and store a decision
   */
  private async extractAndStoreDecision(userMessage: string, response: string): Promise<void> {
    const decision = `User: ${userMessage.substring(0, 100)}... | Claude: ${response.substring(0, 200)}...`;

    // Always add to local cache
    this.decisions.push(decision);

    // Try to persist, but don't fail if L-Score too low
    try {
      await this.engine.store(decision, {
        tags: [
          'planning',
          'decision',
          `session:${this.id}`,
          `codebase:${this.config.codebase}`
        ],
        source: MemorySource.USER_INPUT,
        importance: 0.95,
        sessionId: this.id,
        parentIds: this.lastExchangeId ? [this.lastExchangeId] : undefined
      });
      console.log(`[PlanningSession] Stored decision`);
    } catch (error) {
      console.warn(`[PlanningSession] Decision storage failed, kept in local cache`);
    }
  }

  /**
   * Generate summary for resuming session
   */
  private generateResumeSummary(): string {
    const parts: string[] = [
      `**Welcome back to your planning session!**`,
      '',
      `**Task:** ${this.config.taskDescription}`,
      `**Exchanges:** ${this.meta.exchangeCount}`,
      ''
    ];

    if (this.currentPlan) {
      parts.push(`**Current Plan:** ${this.currentPlan.title ?? 'Untitled'}`);
      parts.push(`**Approach:** ${(this.currentPlan.approach ?? '').substring(0, 200)}...`);

      if ((this.currentPlan.openQuestions?.length ?? 0) > 0) {
        parts.push('');
        parts.push('**Open Questions:**');
        this.currentPlan.openQuestions!.slice(0, 3).forEach(q => {
          parts.push(`- ${q}`);
        });
      }
    }

    if (this.recentExchanges.length > 0) {
      parts.push('');
      parts.push('**Last exchange:**');
      const last = this.recentExchanges[this.recentExchanges.length - 1];
      parts.push(`> ${last.content.substring(0, 200)}...`);
    }

    parts.push('');
    parts.push('_Continue the conversation, or use /execute when ready._');

    return parts.join('\n');
  }

  /**
   * Build specification from plan for TaskSubmission
   */
  private buildSpecificationFromPlan(): string {
    if (!this.currentPlan) {
      return this.config.taskDescription;
    }

    const parts: string[] = [
      `# ${this.currentPlan.title ?? 'Untitled Plan'}`,
      '',
      this.currentPlan.description ?? '',
      '',
      '## Goals',
      ...(this.currentPlan.goals ?? []).map(g => `- ${g}`),
      '',
      '## Approach',
      this.currentPlan.approach ?? '',
      ''
    ];

    if ((this.currentPlan.components?.length ?? 0) > 0) {
      parts.push('## Components');
      for (const comp of this.currentPlan.components!) {
        parts.push(`### ${comp.name ?? 'Component'}`);
        parts.push(comp.description ?? '');
        if ((comp.subtasks?.length ?? 0) > 0) {
          parts.push('**Tasks:**');
          comp.subtasks!.forEach(t => parts.push(`- ${t}`));
        }
        parts.push('');
      }
    }

    if ((this.currentPlan.considerations?.length ?? 0) > 0) {
      parts.push('## Important Considerations');
      this.currentPlan.considerations!.forEach(c => parts.push(`- ${c}`));
      parts.push('');
    }

    if (this.decisions.length > 0) {
      parts.push('## Key Decisions Made');
      this.decisions.slice(0, 10).forEach(d => parts.push(`- ${d.substring(0, 150)}`));
    }

    return parts.join('\n');
  }
}

export default PlanningSession;
