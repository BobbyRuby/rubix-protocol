/**
 * Prompts Module
 *
 * Centralized prompt compression and templates.
 * All prompts: pure function, zero fluff.
 */

export { PromptCompressor, PC } from './PromptCompressor.js';
export { InputCompressor, IC, type CompressedPrompt } from './InputCompressor.js';
export { SelfKnowledgeCompressor, SKC, type RubixKnowledge } from './SelfKnowledgeCompressor.js';
export { SelfKnowledgeInjector, SKI, type RubixSubsystem } from './SelfKnowledgeInjector.js';
export * from './templates.js';
