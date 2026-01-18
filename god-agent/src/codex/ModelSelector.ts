/**
 * ModelSelector - Cost-based model routing for RUBIX phases.
 *
 * Routes tasks to appropriate models based on complexity:
 * - Low complexity → Haiku (fast, cheap)
 * - Medium complexity → Sonnet (balanced)
 * - High complexity → Opus (best quality)
 *
 * ARCHITECT always uses Opus (it classifies complexity).
 */

export type TaskComplexity = 'low' | 'medium' | 'high';

export interface ModelConfig {
  haiku: string;
  sonnet: string;
  opus: string;
}

const DEFAULT_MODELS: ModelConfig = {
  haiku: 'claude-3-5-haiku-20241022',
  sonnet: 'claude-sonnet-4-20250514',
  opus: 'claude-opus-4-20250514'
};

export class ModelSelector {
  private models: ModelConfig;

  constructor(models?: Partial<ModelConfig>) {
    this.models = { ...DEFAULT_MODELS, ...models };
  }

  /**
   * Select model based on task complexity.
   */
  selectForComplexity(complexity: TaskComplexity): string {
    switch (complexity) {
      case 'low':
        return this.models.haiku;
      case 'medium':
        return this.models.sonnet;
      case 'high':
        return this.models.opus;
    }
  }

  /**
   * Select model for a specific phase.
   * ARCHITECT always uses Opus (it determines complexity).
   */
  selectForPhase(
    phase: 'context_scout' | 'architect' | 'engineer' | 'validator',
    complexity: TaskComplexity
  ): string {
    // ARCHITECT always Opus (it classifies complexity)
    if (phase === 'architect') {
      return this.models.opus;
    }
    return this.selectForComplexity(complexity);
  }

  /**
   * Get current model configuration.
   */
  getModels(): ModelConfig {
    return { ...this.models };
  }

  /**
   * Get model name for display (extracts from full model ID).
   */
  getModelName(modelId: string): string {
    if (modelId.includes('haiku')) return 'Haiku';
    if (modelId.includes('sonnet')) return 'Sonnet';
    if (modelId.includes('opus')) return 'Opus';
    return modelId;
  }
}

// Singleton instance
let instance: ModelSelector | null = null;

/**
 * Get or create ModelSelector singleton.
 * Pass models to reset configuration.
 */
export function getModelSelector(models?: Partial<ModelConfig>): ModelSelector {
  if (!instance || models) {
    instance = new ModelSelector(models);
  }
  return instance;
}

/**
 * Reset the ModelSelector singleton.
 */
export function resetModelSelector(): void {
  instance = null;
}
