/**
 * AutonomousDiscoveryEngine - Execute curiosity explorations
 *
 * Orchestrates:
 * - Budget checking
 * - Probe selection (3:1 pattern)
 * - Exploration execution
 * - Discovery storage
 */

import Anthropic from '@anthropic-ai/sdk';
import { CuriosityTracker } from './CuriosityTracker.js';
import { TokenBudgetManager } from './TokenBudgetManager.js';
import { WebExplorationStrategy } from './WebExplorationStrategy.js';
import {
  CuriosityProbe,
  DiscoveryReport,
  ExplorationResult,
  WebExplorationResult,
} from './types.js';
import {
  PROBE_FAILURE,
  PROBE_LOW_CONFIDENCE,
  PROBE_KNOWLEDGE_GAP,
  PROBE_SUCCESS_CONFIRM,
  type ProbeContext,
} from '../prompts/templates.js';
import { PlaywrightManager } from '../playwright/PlaywrightManager.js';

export interface AutonomousDiscoveryEngineConfig {
  curiosity: CuriosityTracker;
  budget: TokenBudgetManager;
  apiKey: string;
  model?: string;
  playwright?: PlaywrightManager;
}

/**
 * Keywords that suggest web exploration would be helpful
 */
const WEB_EXPLORATION_KEYWORDS = [
  'documentation', 'docs', 'how to', 'tutorial', 'guide',
  'best practices', 'example', 'library', 'framework', 'api',
  'reference', 'official', 'latest', 'new features', 'release',
  'migration', 'upgrade', 'changelog', 'what is', 'compare',
];

export class AutonomousDiscoveryEngine {
  private curiosity: CuriosityTracker;
  private budget: TokenBudgetManager;
  private client: Anthropic;
  private model: string;
  private playwright: PlaywrightManager;
  private webStrategy: WebExplorationStrategy;

  constructor(config: AutonomousDiscoveryEngineConfig) {
    this.curiosity = config.curiosity;
    this.budget = config.budget;
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.model = config.model || 'claude-sonnet-4-20250514';
    this.playwright = config.playwright || new PlaywrightManager();
    this.webStrategy = new WebExplorationStrategy(this.playwright);
  }

  /**
   * Main discovery cycle (called by scheduler - Mon/Wed/Fri)
   */
  async discoveryCycle(): Promise<DiscoveryReport> {
    console.log('[DiscoveryEngine] Starting discovery cycle');

    // 1. Check if we have probes remaining this week
    if (!this.budget.canExplore()) {
      console.log('[DiscoveryEngine] Weekly limit reached, skipping');
      return { skipped: true, reason: 'weekly_limit_reached' };
    }

    // 2. Determine if this is a HIGH or MODERATE slot (3:1 pattern)
    const slotType = this.budget.getNextProbeType();
    console.log(`[DiscoveryEngine] Slot type: ${slotType}`);

    // 3. Get the right probe for this slot
    const probe = slotType === 'high'
      ? await this.curiosity.getTopFailureProbe()
      : await this.curiosity.getModerateProbe();

    if (!probe) {
      console.log('[DiscoveryEngine] No pending probes, skipping');
      return { skipped: true, reason: 'no_pending_probes' };
    }

    console.log(`[DiscoveryEngine] Selected probe: ${probe.origin}|${probe.domain}`);

    // 4. Mark probe as being explored
    await this.curiosity.startExploring(probe.id);

    // 5. Execute exploration (up to 100K tokens)
    const budgetConfig = this.budget.getBudgetConfig();
    const result = await this.explore(probe, budgetConfig.tokensPerProbe);

    // 6. Record to budget
    this.budget.recordExploration(probe.id, result.tokensUsed, slotType);

    // 7. Record discovery
    await this.curiosity.recordDiscovery(probe.id, result);

    // 8. Increment cycle count
    this.curiosity.incrementCycle();

    return {
      completed: 1,
      probeId: probe.id,
      slotType,
      tokensUsed: result.tokensUsed,
      remainingThisWeek: this.budget.getRemainingProbes(),
      discoveries: [result],
    };
  }

  /**
   * Single exploration with token cap
   */
  private async explore(probe: CuriosityProbe, maxTokens: number): Promise<ExplorationResult> {
    // Check if web exploration would help
    const shouldBrowse = this.shouldUseWebExploration(probe);

    if (shouldBrowse) {
      console.log(`[DiscoveryEngine] Using web browsing for: ${probe.question}`);
      return await this.webExplore(probe, maxTokens);
    }

    // Standard text-only exploration
    return await this.textExplore(probe, maxTokens);
  }

  /**
   * Text-only exploration using Claude
   */
  private async textExplore(probe: CuriosityProbe, maxTokens: number): Promise<ExplorationResult> {
    const startTime = Date.now();

    try {
      // Build compressed prompt based on probe origin
      const prompt = this.buildPrompt(probe);

      // Execute with extended thinking for complex explorations
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: Math.min(4096, maxTokens),
        messages: [{ role: 'user', content: prompt }],
      });

      // Parse response
      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const parsed = this.parseResponse(text, probe.origin);

      // Calculate tokens used
      const tokensUsed = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);

      return {
        probeId: probe.id,
        success: true,
        tokensUsed,
        findings: parsed.findings || text.slice(0, 500),
        cause: parsed.cause,
        fix: parsed.fix,
        patternUpdate: parsed.patternUpdate,
        storedFacts: parsed.storedFacts || [],
        confidence: parsed.confidence || 0.5,
        durationMs: Date.now() - startTime,
        explorationMethod: 'text',
      };
    } catch (error) {
      console.error('[DiscoveryEngine] Exploration error:', error);
      return {
        probeId: probe.id,
        success: false,
        tokensUsed: 0,
        findings: `Exploration failed: ${(error as Error).message}`,
        storedFacts: [],
        confidence: 0,
        durationMs: Date.now() - startTime,
        explorationMethod: 'text',
      };
    }
  }

  /**
   * Web-based exploration using Playwright
   */
  private async webExplore(probe: CuriosityProbe, maxTokens: number): Promise<ExplorationResult> {
    try {
      // Run web exploration
      const webResult = await this.webStrategy.explore(probe);

      if (!webResult.success) {
        console.log(`[DiscoveryEngine] Web exploration failed, falling back to text`);
        // Fall back to text exploration
        return await this.textExplore(probe, maxTokens);
      }

      // Analyze web findings with Claude
      return await this.analyzeWebFindings(probe, webResult, maxTokens);
    } catch (error) {
      console.error('[DiscoveryEngine] Web exploration error:', error);
      // Fall back to text exploration
      return await this.textExplore(probe, maxTokens);
    }
  }

  /**
   * Analyze web exploration findings with Claude
   */
  private async analyzeWebFindings(
    probe: CuriosityProbe,
    webResult: WebExplorationResult,
    maxTokens: number
  ): Promise<ExplorationResult> {
    const startTime = Date.now();

    try {
      // Build prompt with web content
      const webContentSummary = webResult.pageContents
        .map(p => `## ${p.title}\nURL: ${p.url}\n\n${p.text.slice(0, 2000)}`)
        .join('\n\n---\n\n');

      const prompt = `You are analyzing web research results for a curiosity exploration.

**Original Question:** ${probe.question}
**Domain:** ${probe.domain}
**Origin:** ${probe.origin}

**Web Research Results:**
Visited ${webResult.visitedUrls.length} pages:
${webResult.visitedUrls.map(u => `- ${u}`).join('\n')}

**Extracted Content:**
${webContentSummary.slice(0, 8000)}

---

Based on this web research, provide your analysis in JSON format:
{
  "findings": "Key discoveries and insights from the web content",
  "cause": "Root cause or explanation (if applicable)",
  "fix": "Recommended solution or approach (if applicable)",
  "pattern_update": "How this changes our understanding or patterns",
  "store": ["Key fact 1 to remember", "Key fact 2 to remember"],
  "confidence": 0.8,
  "sources": ["Most useful URLs"]
}`;

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: Math.min(4096, maxTokens),
        messages: [{ role: 'user', content: prompt }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const parsed = this.parseResponse(text, probe.origin);
      const tokensUsed = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);

      return {
        probeId: probe.id,
        success: true,
        tokensUsed,
        findings: parsed.findings || text.slice(0, 500),
        cause: parsed.cause,
        fix: parsed.fix,
        patternUpdate: parsed.patternUpdate,
        storedFacts: parsed.storedFacts || [],
        confidence: parsed.confidence || 0.7,
        durationMs: Date.now() - startTime,
        explorationMethod: 'web',
        screenshots: webResult.screenshots,
        visitedUrls: webResult.visitedUrls,
        pageContents: webResult.pageContents,
      };
    } catch (error) {
      console.error('[DiscoveryEngine] Analysis error:', error);
      // Return web results without Claude analysis
      return {
        probeId: probe.id,
        success: true,
        tokensUsed: 0,
        findings: `Web exploration visited ${webResult.visitedUrls.length} pages. Content extracted but analysis failed: ${(error as Error).message}`,
        storedFacts: webResult.visitedUrls,
        confidence: 0.4,
        durationMs: Date.now() - startTime,
        explorationMethod: 'web',
        screenshots: webResult.screenshots,
        visitedUrls: webResult.visitedUrls,
        pageContents: webResult.pageContents,
      };
    }
  }

  /**
   * Determine if web exploration would help for this probe
   */
  private shouldUseWebExploration(probe: CuriosityProbe): boolean {
    // If probe has explicit web config, use it
    if (probe.webConfig) {
      return true;
    }

    // If probe has explicit exploration method, respect it
    if (probe.explorationMethod === 'web' || probe.explorationMethod === 'hybrid') {
      return true;
    }
    if (probe.explorationMethod === 'text') {
      return false;
    }

    // Check question and domain for web-friendly keywords
    const searchText = `${probe.question} ${probe.domain}`.toLowerCase();

    return WEB_EXPLORATION_KEYWORDS.some(kw => searchText.includes(kw));
  }

  /**
   * Get the web exploration strategy (for external use)
   */
  getWebStrategy(): WebExplorationStrategy {
    return this.webStrategy;
  }

  /**
   * Build compressed prompt for probe
   */
  private buildPrompt(probe: CuriosityProbe): string {
    const ctx: ProbeContext = {
      domain: probe.domain,
      errorType: probe.errorType,
      errorMsg: probe.errorMessage,
      stackTrace: probe.stackTrace,
      patternName: probe.patternName,
      successRate: probe.successRate,
      uses: probe.estimatedTokens, // Reusing for uses count
      recentFailures: [],
      question: probe.question,
      relatedPatterns: probe.relatedPatterns,
      context: probe.context,
    };

    switch (probe.origin) {
      case 'failure':
        return PROBE_FAILURE(ctx);
      case 'low_confidence':
        return PROBE_LOW_CONFIDENCE(ctx);
      case 'knowledge_gap':
        return PROBE_KNOWLEDGE_GAP(ctx);
      case 'success_confirmation':
        return PROBE_SUCCESS_CONFIRM(ctx);
      default:
        return PROBE_FAILURE(ctx);
    }
  }

  /**
   * Parse response based on expected format
   */
  private parseResponse(
    text: string,
    _origin: string
  ): {
    findings?: string;
    cause?: string;
    fix?: string;
    patternUpdate?: string;
    storedFacts?: string[];
    confidence?: number;
  } {
    // Try to parse as JSON first
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          findings: parsed.learned || parsed.why_works || parsed.why_failing || text.slice(0, 300),
          cause: parsed.cause,
          fix: parsed.fix || parsed.improve,
          patternUpdate: parsed.pattern_update,
          storedFacts: parsed.store || parsed.key_factors || [],
          confidence: parsed.confidence,
        };
      } catch {
        // Fall through to text parsing
      }
    }

    // Extract key information from text
    return {
      findings: text.slice(0, 500),
      confidence: 0.5,
      storedFacts: [],
    };
  }

  /**
   * Manually trigger exploration of a specific probe
   */
  async exploreProbe(probeId: string): Promise<ExplorationResult | null> {
    const probe = await this.curiosity.getProbe(probeId);
    if (!probe) {
      console.log(`[DiscoveryEngine] Probe not found: ${probeId}`);
      return null;
    }

    if (probe.status !== 'pending') {
      console.log(`[DiscoveryEngine] Probe not pending: ${probe.status}`);
      return null;
    }

    await this.curiosity.startExploring(probeId);
    const budgetConfig = this.budget.getBudgetConfig();
    const result = await this.explore(probe, budgetConfig.tokensPerProbe);
    await this.curiosity.recordDiscovery(probeId, result);

    return result;
  }

  /**
   * Get current status
   */
  async getStatus(): Promise<{
    weeklyStats: ReturnType<TokenBudgetManager['getWeeklyStats']>;
    probeStats: Awaited<ReturnType<CuriosityTracker['getStats']>>;
    cycleCount: number;
  }> {
    return {
      weeklyStats: this.budget.getWeeklyStats(),
      probeStats: await this.curiosity.getStats(),
      cycleCount: this.curiosity.getCycleCount(),
    };
  }
}
