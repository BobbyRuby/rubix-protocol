/**
 * ConversationSession - Lightweight conversation storage
 *
 * Stores exchanges without automatic plan generation.
 * Use /rubixallize to convert to a PlanningSession.
 */

import type { MemoryEngine } from '../core/MemoryEngine.js';
import { PlanningSession } from './PlanningSession.js';
import { PlanningAgent, type ImageContent } from './PlanningAgent.js';

export interface ConversationExchange {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export class ConversationSession {
  private engine: MemoryEngine;
  private chatId: number;
  private exchanges: ConversationExchange[];
  private agent: PlanningAgent | null = null;
  private codebase: string;

  constructor(engine: MemoryEngine, chatId: number, codebase: string = process.cwd()) {
    this.engine = engine;
    this.chatId = chatId;
    this.exchanges = [];
    this.codebase = codebase;
  }

  /**
   * Initialize the planning agent (lazy initialization)
   */
  private getAgent(): PlanningAgent {
    if (!this.agent) {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error('ANTHROPIC_API_KEY required for conversational mode');
      }
      this.agent = new PlanningAgent({ apiKey, codebaseRoot: this.codebase });
      // Connect memory engine for recall
      this.agent.setMemoryEngine(this.engine);
    }
    return this.agent;
  }

  /**
   * Send a message and get a response
   * Stores both in the conversation history
   * @param userMessage Text message from user
   * @param image Optional image attachment
   */
  async chat(userMessage: string, image?: ImageContent): Promise<string> {
    // Store user message (note if image was attached)
    const storedMessage = image ? `${userMessage} [Image attached]` : userMessage;
    this.exchanges.push({
      role: 'user',
      content: storedMessage,
      timestamp: new Date()
    });

    // Build context from recent exchanges (last 20)
    const context = this.exchanges.slice(-20).map(e =>
      `${e.role.toUpperCase()}: ${e.content}`
    ).join('\n\n');

    // Get Claude response (conversational, no plan generation, with optional image)
    const agent = this.getAgent();
    const response = await agent.chat(context, userMessage, image);

    // Store assistant response
    this.exchanges.push({
      role: 'assistant',
      content: response,
      timestamp: new Date()
    });

    return response;
  }

  /**
   * Check if conversation is empty
   */
  isEmpty(): boolean {
    return this.exchanges.length === 0;
  }

  /**
   * Get exchange count
   */
  getExchangeCount(): number {
    return this.exchanges.length;
  }

  /**
   * Convert this conversation to a PlanningSession
   * Used by /rubixallize command
   */
  async toPlanningSession(): Promise<PlanningSession> {
    const agent = this.getAgent();

    // Synthesize task description from conversation
    const taskDescription = await agent.synthesizeTaskDescription(this.exchanges);

    // Create planning session with pre-loaded context
    const session = new PlanningSession(this.engine, {
      taskDescription,
      codebase: this.codebase,
      chatId: this.chatId
    });

    // Inject conversation history
    for (const exchange of this.exchanges) {
      await session.injectExchange(exchange.role, exchange.content);
    }

    return session;
  }

  /**
   * Get conversation summary for display
   */
  getSummary(): string {
    const userCount = this.exchanges.filter(e => e.role === 'user').length;
    const assistantCount = this.exchanges.filter(e => e.role === 'assistant').length;
    return `${userCount} messages from you, ${assistantCount} responses`;
  }
}
