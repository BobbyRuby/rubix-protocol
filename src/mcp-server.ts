#!/usr/bin/env node
/**
 * God Agent MCP Server
 *
 * Model Context Protocol server exposing god-agent memory tools to Claude Code.
 * Binds to localhost only for security.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { readdirSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';

import { MemoryEngine, MemorySource, CausalRelationType, ReasoningRoute } from './index.js';
import { FailureMemoryService } from './failure/FailureMemoryService.js';
import type { FailureStats } from './failure/types.js';
import { SchedulerDaemon, TriggerType, TaskStatus } from './scheduler/index.js';
import type { ScheduleTrigger, TaskNotification } from './scheduler/index.js';
import { PlaywrightManager, VerificationService, ConsoleCapture } from './playwright/index.js';
import type { ActionType, AssertionType } from './playwright/index.js';
import { TaskExecutor } from './codex/TaskExecutor.js';
import { CollaborativePartner } from './codex/CollaborativePartner.js';
import { ContainmentManager } from './codex/ContainmentManager.js';
import type { StatusReport, WorkLogEntry } from './codex/types.js';
import { TaskStatus as CodexTaskStatus } from './codex/types.js';
import { CapabilitiesManager, WolframManager } from './capabilities/index.js';
import type { RefactorOperation } from './capabilities/index.js';
import { CodeReviewer } from './review/index.js';
import type { ReviewType, ReviewConfig } from './review/index.js';
import { NotificationService } from './notification/index.js';
import type { NotificationType, NotificationUrgency } from './notification/index.js';
import { ConfigurationManager } from './config/index.js';
import type { CodexConfiguration, PartialCodexConfiguration } from './config/index.js';
import { CommunicationManager } from './communication/index.js';
import type { ChannelType, CommunicationConfig, EscalationResponse, EscalationFallbackResponse } from './communication/index.js';
import { CommsStore } from './communication/CommsStore.js';
import type { InboxFilters, MessageType, MessagePriority, TriggerTaskRow } from './communication/CommsStore.js';
import { TriggerService } from './communication/TriggerService.js';
import type { TriggerResult } from './communication/TriggerService.js';
import { DaemonDetector } from './utils/DaemonDetector.js';
import { getCodexLLMConfig, getCuriosityConfig } from './core/config.js';
import { CuriosityTracker } from './curiosity/CuriosityTracker.js';
import { TokenBudgetManager } from './curiosity/TokenBudgetManager.js';
import { AutonomousDiscoveryEngine } from './curiosity/AutonomousDiscoveryEngine.js';
import type { ProbeStatus } from './curiosity/types.js';
import { memoryCompressor } from './memory/MemoryCompressor.js';
import { LLMCompressor } from './memory/LLMCompressor.js';
import type { MemoryType } from './memory/types.js';
import { AutoRecall, type RecallResult, type RecalledMemory } from './memory/AutoRecall.js';
import { SelfKnowledgeBootstrap } from './bootstrap/SelfKnowledgeBootstrap.js';
import { SelfKnowledgeCompressor } from './prompts/SelfKnowledgeCompressor.js';
import { createRuntimeContext } from './context/RuntimeContext.js';
import { getSanitizer } from './core/OutputSanitizer.js';
import { ReflexionService } from './reflexion/index.js';
import type { ReflexionStats, ReflectionContext } from './reflexion/index.js';
import { AgentCardGenerator } from './discovery/index.js';
import type { AgentCard } from './discovery/index.js';
import { PostExecGuardian } from './guardian/index.js';
import type { AuditResult, AuditContext } from './guardian/index.js';
import { MemoryDistillationService } from './distillation/index.js';
import type { DistillationConfig, DistillationStats, DistillationType, ManualDistillationOptions } from './distillation/index.js';

// ==========================================
// Tool Input Schemas (Zod)
// ==========================================

const StoreInputSchema = z.object({
  content: z.string().describe('The content to store in memory'),
  type: z.enum(['component', 'department', 'mcp_tool', 'capability', 'workflow', 'config', 'error_pattern', 'success_pattern', 'system', 'bug_fix', 'dev_feature', 'arch_insight', 'generic'])
    .optional()
    .describe('Memory type for compression schema (auto-detected if not provided)'),
  tags: z.array(z.string()).optional().describe('Tags for categorization'),
  source: z.enum(['user_input', 'agent_inference', 'tool_output', 'system', 'external'])
    .optional()
    .describe('Source type of the information'),
  importance: z.number().min(0).max(1).optional().describe('Importance score 0-1'),
  parentIds: z.array(z.string()).optional().describe('IDs of parent entries for provenance'),
  confidence: z.number().min(0).max(1).optional().describe('Confidence score 0-1'),
  sessionId: z.string().optional().describe('Session identifier'),
  agentId: z.string().optional().describe('Agent identifier')
});

const QueryInputSchema = z.object({
  query: z.string().describe('Search query for semantic similarity'),
  topK: z.number().min(1).max(100).optional().describe('Number of results to return'),
  tags: z.array(z.string()).optional().describe('Filter by tags'),
  minImportance: z.number().min(0).max(1).optional().describe('Minimum importance threshold'),
  sources: z.array(z.enum(['user_input', 'agent_inference', 'tool_output', 'system', 'external']))
    .optional()
    .describe('Filter by source types'),
  includeProvenance: z.boolean().optional().describe('Include L-Score and provenance info')
});

const TraceInputSchema = z.object({
  entryId: z.string().describe('ID of the entry to trace'),
  depth: z.number().min(1).max(50).optional().describe('Maximum depth to trace')
});

const CausalInputSchema = z.object({
  sourceIds: z.array(z.string()).describe('Source entry IDs'),
  targetIds: z.array(z.string()).describe('Target entry IDs'),
  type: z.enum(['causes', 'enables', 'prevents', 'correlates', 'precedes', 'triggers'])
    .describe('Type of causal relationship'),
  strength: z.number().min(0).max(1).optional().describe('Relationship strength 0-1'),
  ttl: z.number().min(1).optional().describe('Time-to-live in milliseconds. Relation expires after this duration.')
});

const CleanupExpiredInputSchema = z.object({
  dryRun: z.boolean().optional().describe('If true, only report expired relations without deleting')
});

const FindCausalInputSchema = z.object({
  sourceId: z.string().describe('Source entry ID'),
  targetId: z.string().describe('Target entry ID'),
  maxDepth: z.number().min(1).max(20).optional().describe('Maximum path depth')
});

const EditInputSchema = z.object({
  entryId: z.string().describe('ID of entry to edit'),
  content: z.string().optional().describe('New content (will re-embed for semantic search)'),
  tags: z.array(z.string()).optional().describe('New tags (replaces all existing tags)'),
  importance: z.number().min(0).max(1).optional().describe('New importance score'),
  source: z.enum(['user_input', 'agent_inference', 'tool_output', 'system', 'external'])
    .optional()
    .describe('New source type')
});

const DeleteInputSchema = z.object({
  entryId: z.string().describe('ID of entry to delete'),
  confirm: z.boolean().describe('Must be true to confirm deletion')
});

const CheckpointInputSchema = z.object({
  overwrite: z.boolean().optional().describe('Overwrite the most recent checkpoint instead of creating new')
});

const LearnInputSchema = z.object({
  trajectoryId: z.string().describe('Trajectory ID from a previous queryWithLearning call'),
  quality: z.number().min(0).max(1).describe('Quality score 0-1 (0 = useless, 1 = perfect)'),
  route: z.string().optional().describe('Optional reasoning route categorization'),
  memrlQueryId: z.string().optional().describe('MemRL query ID (auto-uses last query if omitted)')
});

const PrunePatternsInputSchema = z.object({
  dryRun: z.boolean().optional().describe('If true, only report what would be pruned without actually deleting')
});

const ShadowSearchInputSchema = z.object({
  query: z.string().describe('The claim or statement to find contradictions for'),
  threshold: z.number().min(0).max(1).optional().describe('Minimum refutation strength (0-1, default: 0.5)'),
  topK: z.number().min(1).max(50).optional().describe('Number of contradictions to return (default: 10)'),
  contradictionType: z.enum(['direct_negation', 'counterargument', 'falsification', 'alternative', 'exception'])
    .optional()
    .describe('Filter by type of contradiction'),
  includeProvenance: z.boolean().optional().describe('Include L-Score for reliability weighting'),
  tags: z.array(z.string()).optional().describe('Filter contradicting entries by tags'),
  minImportance: z.number().min(0).max(1).optional().describe('Minimum importance of contradicting entries')
});

const EnhanceInputSchema = z.object({
  entryId: z.string().describe('ID of the memory entry to enhance'),
  includeWeights: z.boolean().optional().describe('Include neighbor weights used in aggregation')
});

const EnhanceBatchInputSchema = z.object({
  entryIds: z.array(z.string()).describe('IDs of memory entries to enhance'),
  maxBatchSize: z.number().min(1).max(100).optional().describe('Maximum batch size (default: 50)')
});

const RouteQueryInputSchema = z.object({
  query: z.string().describe('The query to route to optimal reasoning strategy'),
  preferredRoute: z.enum([
    'pattern_match', 'causal_forward', 'causal_backward',
    'temporal_causal', 'hybrid', 'direct_retrieval', 'adversarial'
  ]).optional().describe('Preferred route (will be used if circuit is not open)'),
  previousRoute: z.enum([
    'pattern_match', 'causal_forward', 'causal_backward',
    'temporal_causal', 'hybrid', 'direct_retrieval', 'adversarial'
  ]).optional().describe('Previous route used in this session (for continuity)')
});

const RecordRoutingResultInputSchema = z.object({
  route: z.enum([
    'pattern_match', 'causal_forward', 'causal_backward',
    'temporal_causal', 'hybrid', 'direct_retrieval', 'adversarial'
  ]).describe('The route that was executed'),
  success: z.boolean().describe('Whether the execution was successful')
});

const ResetCircuitInputSchema = z.object({
  route: z.enum([
    'pattern_match', 'causal_forward', 'causal_backward',
    'temporal_causal', 'hybrid', 'direct_retrieval', 'adversarial'
  ]).optional().describe('Route to reset (omit to reset all)')
});

// ==========================================
// Scheduler Tool Input Schemas (Phase 9)
// ==========================================

const ScheduleTriggerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('datetime'),
    at: z.string().describe('ISO datetime string for when to execute')
  }),
  z.object({
    type: z.literal('cron'),
    pattern: z.string().describe('Cron expression (e.g., "0 9 * * 1-5" for weekdays at 9am)')
  }),
  z.object({
    type: z.literal('event'),
    event: z.string().describe('Event name to listen for (e.g., "trading_complete")')
  }),
  z.object({
    type: z.literal('file'),
    path: z.string().describe('File path to watch'),
    event: z.enum(['created', 'modified', 'deleted']).describe('File event type')
  }),
  z.object({
    type: z.literal('manual')
  })
]);

const ScheduleInputSchema = z.object({
  name: z.string().describe('Name of the scheduled task'),
  description: z.string().optional().describe('Optional task description'),
  prompt: z.string().describe('Task prompt (use {context} placeholder for memory context)'),
  trigger: ScheduleTriggerSchema.describe('When to trigger the task'),
  contextIds: z.array(z.string()).optional().describe('Memory IDs to load as context'),
  contextQuery: z.string().optional().describe('Query to run for fresh context'),
  priority: z.number().min(1).max(10).optional().describe('Priority 1-10 (higher = more important)'),
  notification: z.object({
    onComplete: z.boolean().optional().describe('Notify when task completes'),
    onDecision: z.boolean().optional().describe('Notify when decision needed'),
    onFailure: z.boolean().optional().describe('Notify on failure')
  }).optional().describe('Notification settings')
});

const TriggerInputSchema = z.object({
  taskId: z.string().optional().describe('Specific task ID to trigger'),
  event: z.string().optional().describe('Event name to fire (triggers all listening tasks)')
});

const TasksInputSchema = z.object({
  status: z.enum(['pending', 'running', 'completed', 'failed', 'paused', 'cancelled', 'all'])
    .optional().describe('Filter by status'),
  limit: z.number().min(1).max(100).optional().describe('Maximum results to return')
});

const TaskIdInputSchema = z.object({
  taskId: z.string().describe('Task ID')
});

// ==========================================
// Playwright Tool Input Schemas (RUBIX)
// ==========================================

const PlaywrightLaunchInputSchema = z.object({
  browser: z.enum(['chromium', 'firefox', 'webkit']).optional()
    .describe('Browser to use (default: chromium)'),
  headless: z.boolean().optional()
    .describe('Run in headless mode (default: true)'),
  viewport: z.object({
    width: z.number().min(320).max(3840),
    height: z.number().min(240).max(2160)
  }).optional().describe('Viewport size')
});

const PlaywrightNavigateInputSchema = z.object({
  sessionId: z.string().describe('Browser session ID'),
  url: z.string().url().describe('URL to navigate to'),
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).optional()
    .describe('When to consider navigation complete')
});

const PlaywrightScreenshotInputSchema = z.object({
  sessionId: z.string().describe('Browser session ID'),
  fullPage: z.boolean().optional().describe('Capture full page (default: false)'),
  selector: z.string().optional().describe('Element selector to screenshot'),
  label: z.string().optional().describe('Label for the screenshot'),
  returnBase64: z.boolean().optional().describe('Return base64 encoded image')
});

const PlaywrightActionInputSchema = z.object({
  sessionId: z.string().describe('Browser session ID'),
  selector: z.string().describe('CSS selector for target element'),
  action: z.enum(['click', 'dblclick', 'type', 'fill', 'clear', 'check', 'uncheck', 'select', 'hover', 'focus', 'press'])
    .describe('Action to perform'),
  value: z.string().optional().describe('Value for type/fill/select actions'),
  key: z.string().optional().describe('Key for press action (e.g., "Enter", "Tab")'),
  force: z.boolean().optional().describe('Force action (skip actionability checks)')
});

const PlaywrightAssertInputSchema = z.object({
  sessionId: z.string().describe('Browser session ID'),
  type: z.enum(['visible', 'hidden', 'enabled', 'disabled', 'checked', 'unchecked', 'text', 'value', 'attribute', 'count', 'url', 'title'])
    .describe('Type of assertion'),
  selector: z.string().optional().describe('CSS selector (not needed for url/title)'),
  expected: z.union([z.string(), z.number()]).optional().describe('Expected value'),
  attribute: z.string().optional().describe('Attribute name for attribute assertion')
});

const PlaywrightConsoleInputSchema = z.object({
  sessionId: z.string().describe('Browser session ID'),
  clear: z.boolean().optional().describe('Clear console logs after returning')
});

const PlaywrightCloseInputSchema = z.object({
  sessionId: z.string().describe('Browser session ID to close')
});

const PlaywrightVerifyInputSchema = z.object({
  url: z.string().url().describe('URL to verify'),
  screenshot: z.boolean().optional().describe('Take a screenshot (default: true)'),
  checkConsole: z.boolean().optional().describe('Check for console errors (default: true)'),
  assertVisible: z.array(z.string()).optional().describe('Selectors that should be visible')
});

// ==========================================
// RUBIX Tool Input Schemas
// ==========================================

const CodexDoInputSchema = z.object({
  description: z.string().describe('Task description - what you want RUBIX to do'),
  specification: z.string().optional().describe('Detailed specification or requirements'),
  codebase: z.string().describe('Path to the codebase or project name'),
  constraints: z.array(z.string()).optional().describe('Constraints or requirements to follow'),
  verificationUrl: z.string().url().optional().describe('URL for verification (if web app)'),
  dryRun: z.boolean().optional().describe('Preview decomposition without executing')
});

const CodexAnswerInputSchema = z.object({
  escalationId: z.string().describe('ID of the escalation to answer'),
  answer: z.string().describe('Your answer or resolution'),
  optionIndex: z.number().optional().describe('Index of selected option (if applicable)')
});

const CodexDecisionInputSchema = z.object({
  decisionId: z.string().describe('ID of the decision to answer'),
  answer: z.string().describe('Your decision'),
  optionIndex: z.number().optional().describe('Index of selected option (if applicable)')
});

const CodexEstimateInputSchema = z.object({
  description: z.string().describe('Task description'),
  specification: z.string().optional().describe('Detailed specification'),
  codebase: z.string().describe('Path to codebase'),
});

// ==========================================
// Configuration Tool Input Schemas
// ==========================================

const ConfigGetInputSchema = z.object({
  section: z.enum(['escalation', 'workMode', 'playwright', 'review', 'notifications', 'memory', 'all'])
    .optional()
    .describe('Configuration section to retrieve (default: all)')
});

const ConfigSetInputSchema = z.object({
  escalation: z.object({
    maxAttemptsBeforeEscalate: z.number().min(1).max(10).optional(),
    autonomousDecisions: z.array(z.string()).optional(),
    requireApproval: z.array(z.string()).optional()
  }).optional().describe('Escalation settings'),
  workMode: z.object({
    notifyOnProgress: z.boolean().optional(),
    notifyOnComplete: z.boolean().optional(),
    notifyOnBlocked: z.boolean().optional(),
    batchDecisions: z.boolean().optional(),
    deepWorkDefault: z.boolean().optional()
  }).optional().describe('Work mode settings'),
  playwright: z.object({
    defaultMode: z.enum(['headless', 'visible']).optional(),
    screenshotOnFailure: z.boolean().optional(),
    captureConsole: z.boolean().optional(),
    timeout: z.number().min(1000).max(300000).optional()
  }).optional().describe('Playwright settings'),
  review: z.object({
    autoReview: z.boolean().optional(),
    securityScan: z.boolean().optional(),
    requireHumanReview: z.array(z.string()).optional(),
    autoApproveIf: z.array(z.string()).optional()
  }).optional().describe('Review settings'),
  notifications: z.object({
    console: z.boolean().optional(),
    slack: z.object({
      webhookUrl: z.string(),
      channel: z.string().optional(),
      username: z.string().optional(),
      iconEmoji: z.string().optional()
    }).optional(),
    discord: z.object({
      webhookUrl: z.string(),
      username: z.string().optional(),
      avatarUrl: z.string().optional()
    }).optional()
  }).optional().describe('Notification settings'),
  memory: z.object({
    storeFailures: z.boolean().optional(),
    storeSuccesses: z.boolean().optional(),
    pruneAfterDays: z.number().min(1).optional()
  }).optional().describe('Memory settings')
});

const ConfigLoadInputSchema = z.object({
  path: z.string().optional().describe('Path to codex.yaml (searches if not provided)')
});

const ConfigSaveInputSchema = z.object({
  path: z.string().optional().describe('Path to save configuration to')
});

// ==========================================
// Collaborative Partner Tool Input Schemas
// ==========================================

const PartnerConfigInputSchema = z.object({
  enabled: z.boolean().optional().describe('Enable/disable collaborative partner features'),
  thresholds: z.object({
    credibilityHardGate: z.number().min(0).max(1).optional().describe('Credibility below this = BLOCK (default: 0.3)'),
    credibilityWarnGate: z.number().min(0).max(1).optional().describe('Credibility below this = WARN (default: 0.5)'),
    lScoreHardGate: z.number().min(0).max(1).optional().describe('L-Score below this = BLOCK (default: 0.2)'),
    lScoreWarnGate: z.number().min(0).max(1).optional().describe('L-Score below this = WARN (default: 0.5)')
  }).optional().describe('Challenge thresholds'),
  behaviors: z.object({
    proactiveCuriosity: z.boolean().optional().describe('Ask questions before executing'),
    challengeDecisions: z.boolean().optional().describe('Use shadow search to find problems'),
    hardGateHighRisk: z.boolean().optional().describe('Require override for risky decisions')
  }).optional().describe('Behavior flags')
});

const PartnerChallengeInputSchema = z.object({
  approach: z.string().describe('The approach/plan to assess for potential issues'),
  taskDescription: z.string().optional().describe('Description of the current task'),
  subtaskDescription: z.string().optional().describe('Description of the current subtask')
});

const ContainmentCheckInputSchema = z.object({
  path: z.string().describe('File path to check'),
  operation: z.enum(['read', 'write']).describe('Operation type')
});

const ContainmentConfigInputSchema = z.object({
  enabled: z.boolean().optional().describe('Enable/disable containment'),
  projectRoot: z.string().optional().describe('Project root path (always allowed)'),
  defaultPermission: z.enum(['deny', 'read', 'write', 'read-write']).optional().describe('Default for unmatched paths')
});

const ContainmentAddRuleInputSchema = z.object({
  pattern: z.string().describe('Glob pattern to match (e.g., "**/.env*")'),
  permission: z.enum(['deny', 'read', 'write', 'read-write']).describe('Permission for matching paths'),
  reason: z.string().optional().describe('Human-readable reason'),
  priority: z.number().optional().describe('Priority (higher = checked first)')
});

const ContainmentRemoveRuleInputSchema = z.object({
  pattern: z.string().describe('Glob pattern to remove')
});

// ==========================================
// Capabilities Tool Input Schemas
// ==========================================

// LSP Schemas
const LSPStartInputSchema = z.object({
  languageId: z.string().optional().describe('Language ID (default: typescript)')
});

const LSPDefinitionInputSchema = z.object({
  file: z.string().describe('File path'),
  line: z.number().describe('Line number (1-based)'),
  column: z.number().describe('Column number (1-based)')
});

const LSPReferencesInputSchema = z.object({
  file: z.string().describe('File path'),
  line: z.number().describe('Line number (1-based)'),
  column: z.number().describe('Column number (1-based)'),
  includeDeclaration: z.boolean().optional().describe('Include declaration in results')
});

const LSPSymbolsInputSchema = z.object({
  query: z.string().describe('Symbol search query')
});

const LSPDiagnosticsInputSchema = z.object({
  file: z.string().optional().describe('File path (optional, all files if not specified)')
});

// Git Schemas
const GitBlameInputSchema = z.object({
  file: z.string().describe('File path'),
  startLine: z.number().optional().describe('Start line (1-based)'),
  endLine: z.number().optional().describe('End line (1-based)')
});

const GitBisectInputSchema = z.object({
  good: z.string().describe('Known good commit/tag'),
  bad: z.string().describe('Known bad commit/tag (default: HEAD)'),
  testCommand: z.string().describe('Command to test if commit is good')
});

const GitHistoryInputSchema = z.object({
  file: z.string().optional().describe('File path (optional, all files if not specified)'),
  limit: z.number().optional().describe('Number of commits to return'),
  author: z.string().optional().describe('Filter by author')
});

const GitDiffInputSchema = z.object({
  file: z.string().optional().describe('File path (optional, all files if not specified)'),
  commit: z.string().optional().describe('Commit to diff against (default: HEAD)'),
  staged: z.boolean().optional().describe('Show staged changes only')
});

// AST Schemas
const ASTParseInputSchema = z.object({
  file: z.string().describe('File path to parse')
});

const ASTQueryInputSchema = z.object({
  file: z.string().describe('File path'),
  nodeType: z.string().describe('Node type to find (e.g., "FunctionDeclaration", "ImportDeclaration")')
});

const ASTRefactorInputSchema = z.object({
  type: z.enum(['rename', 'extract', 'inline', 'move']).describe('Refactoring type'),
  target: z.string().describe('Target (format: "file:symbolName" for rename)'),
  newValue: z.string().optional().describe('New name/location for rename/move'),
  scope: z.string().optional().describe('Scope for rename (file path or "all")')
});

const ASTSymbolsInputSchema = z.object({
  file: z.string().describe('File path')
});

// Analysis Schemas
const AnalyzeLintInputSchema = z.object({
  files: z.array(z.string()).optional().describe('Files to lint (default: all source files)')
});

const AnalyzeTypesInputSchema = z.object({
  files: z.array(z.string()).optional().describe('Files to type-check (default: all)')
});

const AnalyzeDepsInputSchema = z.object({
  entryPoint: z.string().describe('Entry point file for dependency analysis')
});

const AnalyzeImpactInputSchema = z.object({
  file: z.string().describe('File to analyze impact for')
});

// Debug Schemas
const DebugStartInputSchema = z.object({
  script: z.string().describe('Script to debug'),
  args: z.array(z.string()).optional().describe('Script arguments')
});

const DebugBreakpointInputSchema = z.object({
  file: z.string().describe('File path'),
  line: z.number().describe('Line number'),
  condition: z.string().optional().describe('Conditional breakpoint expression'),
  remove: z.boolean().optional().describe('Remove breakpoint instead of adding'),
  breakpointId: z.string().optional().describe('Breakpoint ID to remove (required when remove=true)')
});

const DebugStepInputSchema = z.object({
  action: z.enum(['continue', 'stepOver', 'stepInto', 'stepOut']).describe('Step action')
});

const DebugEvalInputSchema = z.object({
  expression: z.string().describe('Expression to evaluate')
});

// Stack Trace Schemas
const StackParseInputSchema = z.object({
  error: z.string().describe('Error message or stack trace string')
});

const StackContextInputSchema = z.object({
  file: z.string().describe('File path'),
  line: z.number().describe('Line number'),
  contextLines: z.number().optional().describe('Number of surrounding lines (default: 5)')
});

// Database Schemas
const DBSchemaInputSchema = z.object({
  connectionString: z.string().optional().describe('Database connection string (uses config if not provided)')
});

const DBTypesInputSchema = z.object({
  exportFormat: z.enum(['interface', 'type', 'class']).optional().describe('TypeScript export format'),
  addNullable: z.boolean().optional().describe('Add null types for nullable columns'),
  addOptional: z.boolean().optional().describe('Make nullable fields optional')
});

// Profiler Schemas
const ProfileStartInputSchema = z.object({
  script: z.string().describe('Script to profile'),
  args: z.array(z.string()).optional().describe('Script arguments'),
  duration: z.number().optional().describe('Max duration in seconds (default: 30)')
});

// Docs Schemas
const DocsFetchInputSchema = z.object({
  url: z.string().url().describe('Documentation URL to fetch')
});

const DocsSearchInputSchema = z.object({
  query: z.string().describe('Search query'),
  package: z.string().optional().describe('Package name to search docs for')
});

// Code Review Schemas
const ReviewInputSchema = z.object({
  files: z.array(z.string()).describe('Files to review (relative paths)'),
  type: z.enum(['full', 'security', 'style', 'logic', 'quick', 'pre-commit'])
    .optional()
    .default('full')
    .describe('Type of review'),
  diff: z.string().optional().describe('Git diff to review'),
  description: z.string().optional().describe('Commit message or description'),
  baseBranch: z.string().optional().describe('Base branch for comparison'),
  targetBranch: z.string().optional().describe('Target branch')
});

const QuickReviewInputSchema = z.object({
  files: z.array(z.string()).describe('Files to review')
});

const SecurityReviewInputSchema = z.object({
  files: z.array(z.string()).describe('Files to scan for security issues')
});

const ReviewConfigInputSchema = z.object({
  security: z.boolean().optional().describe('Enable security scanning'),
  style: z.boolean().optional().describe('Enable style checking'),
  logic: z.boolean().optional().describe('Enable logic review'),
  tests: z.boolean().optional().describe('Enable test coverage check'),
  blockingSeverity: z.enum(['critical', 'high', 'medium', 'low', 'info'])
    .optional()
    .describe('Minimum severity to block'),
  maxIssues: z.number().optional().describe('Maximum issues before blocking'),
  sensitivePatterns: z.array(z.string()).optional()
    .describe('File patterns to flag as sensitive')
});

// Notification Schemas
const NotifyInputSchema = z.object({
  type: z.enum(['complete', 'blocked', 'decision', 'review_ready', 'progress', 'error', 'escalation', 'approval', 'info'])
    .describe('Notification type'),
  urgency: z.enum(['low', 'normal', 'high', 'critical'])
    .optional()
    .default('normal')
    .describe('Urgency level'),
  title: z.string().describe('Notification title'),
  message: z.string().describe('Notification message'),
  taskId: z.string().optional().describe('Associated task ID'),
  task: z.string().optional().describe('Task description'),
  summary: z.string().optional().describe('Short summary'),
  context: z.string().optional().describe('Additional context'),
  actions: z.array(z.object({
    label: z.string(),
    url: z.string().optional(),
    style: z.enum(['primary', 'secondary', 'danger']).optional()
  })).optional().describe('Available actions')
});

const NotifySlackConfigSchema = z.object({
  webhookUrl: z.string().describe('Slack webhook URL'),
  channel: z.string().optional().describe('Default channel'),
  username: z.string().optional().describe('Bot username'),
  iconEmoji: z.string().optional().describe('Bot icon emoji'),
  enabled: z.boolean().default(true).describe('Enable Slack notifications')
});

const NotifyDiscordConfigSchema = z.object({
  webhookUrl: z.string().describe('Discord webhook URL'),
  username: z.string().optional().describe('Bot username'),
  avatarUrl: z.string().optional().describe('Bot avatar URL'),
  enabled: z.boolean().default(true).describe('Enable Discord notifications')
});

const NotifyPreferencesSchema = z.object({
  onComplete: z.boolean().optional().describe('Notify on task completion'),
  onBlocked: z.boolean().optional().describe('Notify when blocked'),
  onDecision: z.boolean().optional().describe('Notify when decision needed'),
  onReviewReady: z.boolean().optional().describe('Notify when review ready'),
  onProgress: z.boolean().optional().describe('Notify on progress'),
  onError: z.boolean().optional().describe('Notify on errors'),
  minUrgency: z.enum(['low', 'normal', 'high', 'critical']).optional()
    .describe('Minimum urgency to notify')
});

// ==========================================
// Failure Learning Tool Input Schemas (Stage 7)
// ==========================================

const FailureRecordInputSchema = z.object({
  taskId: z.string().describe('Task ID'),
  subtaskId: z.string().describe('Subtask ID'),
  attemptNumber: z.number().describe('Attempt number'),
  approach: z.string().describe('Approach that was tried'),
  error: z.string().describe('Error message'),
  errorType: z.enum(['syntax', 'type', 'runtime', 'test', 'integration', 'timeout', 'unknown'])
    .describe('Error type classification'),
  consoleErrors: z.array(z.string()).optional().describe('Console errors'),
  screenshot: z.string().optional().describe('Screenshot path'),
  stackTrace: z.string().optional().describe('Stack trace'),
  context: z.string().describe('Failure context'),
  subtaskType: z.string().describe('Subtask type (research, design, code, test, integrate, verify, review)')
});

const FailureQueryInputSchema = z.object({
  error: z.string().describe('Error message to find similar failures for'),
  context: z.string().optional().describe('Context to improve matching'),
  topK: z.number().optional().describe('Maximum results (default: 10)'),
  minScore: z.number().optional().describe('Minimum similarity score (default: 0.5)')
});

const FailureResolveInputSchema = z.object({
  failureId: z.string().describe('Failure ID to resolve'),
  approach: z.string().describe('Approach that resolved the failure')
});

// ==========================================
// Reflexion Tool Input Schemas
// ==========================================

const ReflexionQueryInputSchema = z.object({
  query: z.string().describe('Search query for past reflections'),
  topK: z.number().min(1).max(50).optional().describe('Number of results (default: 10)'),
  minSimilarity: z.number().min(0).max(1).optional().describe('Minimum similarity score (default: 0.5)')
});

const ReflexionGenerateInputSchema = z.object({
  failureId: z.string().describe('Failure memory ID to generate reflection for'),
  taskDescription: z.string().optional().describe('Description of the task that failed'),
  subtaskDescription: z.string().optional().describe('Description of the subtask that failed'),
  previousAttempts: z.array(z.object({
    approach: z.string(),
    error: z.string()
  })).optional().describe('Previous failed attempts')
});

// ==========================================
// Agent Card Tool Input Schemas
// ==========================================

const AgentCardInputSchema = z.object({
  format: z.enum(['full', 'summary', 'capabilities']).optional()
    .describe('Output format (default: full)'),
  includeSchemas: z.boolean().optional()
    .describe('Include JSON schemas for inputs/outputs (default: false)')
});

// ==========================================
// Guardian Tool Input Schemas
// ==========================================

const GuardianAuditInputSchema = z.object({
  files: z.array(z.string()).describe('Files to audit'),
  auditTypes: z.array(z.enum(['security', 'regression', 'quality', 'types', 'lint']))
    .optional()
    .describe('Types of audits to run (default: all)'),
  codebaseRoot: z.string().optional().describe('Codebase root directory')
});

// ==========================================
// Deep Work Tool Input Schemas (Stage 8)
// ==========================================

const DeepWorkStartInputSchema = z.object({
  taskId: z.string().optional().describe('Task ID to associate'),
  focusLevel: z.enum(['shallow', 'normal', 'deep']).optional()
    .describe('Focus level (default: normal)'),
  allowProgress: z.boolean().optional().describe('Allow progress notifications'),
  allowBlocked: z.boolean().optional().describe('Allow blocked notifications'),
  allowComplete: z.boolean().optional().describe('Allow completion notifications'),
  allowUrgent: z.boolean().optional().describe('Allow urgent notifications'),
  batchNonUrgent: z.boolean().optional().describe('Batch non-urgent notifications')
});

const DeepWorkLogInputSchema = z.object({
  sessionId: z.string().optional().describe('Session ID (optional, defaults to current)'),
  limit: z.number().optional().describe('Maximum entries to return')
});

const DeepWorkCheckpointInputSchema = z.object({
  summary: z.string().describe('Checkpoint summary/description')
});

// ==========================================
// Tool Definitions
// ==========================================

const TOOLS: Tool[] = [
  {
    name: 'god_store',
    description: `Store information in Rubix memory with automatic compression.

    ALL content is compressed to pure positional tokens for efficiency.
    Machine stores tokens, humans get decoded output via god_query_expanded.

    Use this to save:
    - Session context and learnings
    - Security events and patterns (use type: 'error_pattern' or 'bug_fix')
    - Codebase architecture decisions (use type: 'arch_insight')
    - User preferences and patterns

    L-Score calculated automatically based on lineage depth and confidence.`,
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The content to store (human-readable, will be compressed)' },
        type: {
          type: 'string',
          enum: ['component', 'department', 'mcp_tool', 'capability', 'workflow', 'config', 'error_pattern', 'success_pattern', 'system', 'bug_fix', 'dev_feature', 'arch_insight', 'generic'],
          description: 'Memory type for compression schema (auto-detected if not provided)'
        },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization' },
        source: {
          type: 'string',
          enum: ['user_input', 'agent_inference', 'tool_output', 'system', 'external'],
          description: 'Source type'
        },
        importance: { type: 'number', minimum: 0, maximum: 1, description: 'Importance 0-1' },
        parentIds: { type: 'array', items: { type: 'string' }, description: 'Parent entry IDs for provenance' },
        confidence: { type: 'number', minimum: 0, maximum: 1, description: 'Confidence 0-1' },
        sessionId: { type: 'string', description: 'Session identifier' },
        agentId: { type: 'string', description: 'Agent identifier' }
      },
      required: ['content']
    }
  },
  {
    name: 'god_query',
    description: `Semantic search through Rubix memory.

    Returns memories ranked by similarity to your query, with optional L-Score for reliability.
    Useful for:
    - Finding related past context
    - Checking previous decisions
    - Looking up security patterns
    - Retrieving codebase knowledge`,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        topK: { type: 'number', minimum: 1, maximum: 100, description: 'Number of results' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
        minImportance: { type: 'number', minimum: 0, maximum: 1, description: 'Min importance' },
        sources: {
          type: 'array',
          items: { type: 'string', enum: ['user_input', 'agent_inference', 'tool_output', 'system', 'external'] },
          description: 'Filter by source types'
        },
        includeProvenance: { type: 'boolean', description: 'Include L-Score' }
      },
      required: ['query']
    }
  },
  {
    name: 'god_trace',
    description: `Trace the provenance lineage of a memory entry.

    Shows:
    - L-Score (reliability score)
    - Lineage depth
    - Parent entries
    - Reliability category (high/medium/low/unreliable)

    Use to validate information reliability before trusting it.`,
    inputSchema: {
      type: 'object',
      properties: {
        entryId: { type: 'string', description: 'Entry ID to trace' },
        depth: { type: 'number', minimum: 1, maximum: 50, description: 'Max depth' }
      },
      required: ['entryId']
    }
  },
  {
    name: 'god_causal',
    description: `Add a causal relationship between memory entries.

    Relationship types:
    - causes: Direct causation
    - enables: Prerequisite
    - prevents: Prevention
    - correlates: Correlation
    - precedes: Temporal
    - triggers: Event trigger

    Supports temporal hyperedges with TTL:
    - Set ttl (milliseconds) to create relationships that auto-expire
    - Useful for market correlations that are regime-dependent
    - Example: ttl: 604800000 (7 days) for short-term correlations

    Useful for tracking: security_event→response→outcome chains`,
    inputSchema: {
      type: 'object',
      properties: {
        sourceIds: { type: 'array', items: { type: 'string' }, description: 'Source IDs' },
        targetIds: { type: 'array', items: { type: 'string' }, description: 'Target IDs' },
        type: {
          type: 'string',
          enum: ['causes', 'enables', 'prevents', 'correlates', 'precedes', 'triggers'],
          description: 'Relationship type'
        },
        strength: { type: 'number', minimum: 0, maximum: 1, description: 'Strength 0-1' },
        ttl: { type: 'number', minimum: 1, description: 'Time-to-live in ms (relation expires after this)' }
      },
      required: ['sourceIds', 'targetIds', 'type']
    }
  },
  {
    name: 'god_find_paths',
    description: `Find causal paths between two memory entries.

    Discovers chains of cause-effect relationships connecting entries.
    Useful for understanding how events relate.`,
    inputSchema: {
      type: 'object',
      properties: {
        sourceId: { type: 'string', description: 'Source entry ID' },
        targetId: { type: 'string', description: 'Target entry ID' },
        maxDepth: { type: 'number', minimum: 1, maximum: 20, description: 'Max path depth' }
      },
      required: ['sourceId', 'targetId']
    }
  },
  {
    name: 'god_stats',
    description: `Get Rubix memory statistics.

    Shows:
    - Total memory entries
    - Vector count
    - Causal relations
    - Average L-Score`,
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'god_edit',
    description: `Edit an existing memory entry.

    Can update:
    - content (will re-embed for semantic search)
    - tags (replaces all existing tags)
    - importance (0-1)
    - source type

    Use god_query first to find the entry ID you want to edit.`,
    inputSchema: {
      type: 'object',
      properties: {
        entryId: { type: 'string', description: 'Entry ID to edit' },
        content: { type: 'string', description: 'New content' },
        tags: { type: 'array', items: { type: 'string' }, description: 'New tags (replaces all)' },
        importance: { type: 'number', minimum: 0, maximum: 1, description: 'New importance' },
        source: {
          type: 'string',
          enum: ['user_input', 'agent_inference', 'tool_output', 'system', 'external'],
          description: 'New source type'
        }
      },
      required: ['entryId']
    }
  },
  {
    name: 'god_delete',
    description: `Delete a memory entry permanently.

    WARNING: This cannot be undone. The entry and its vector will be removed.
    Causal relations referencing this entry will become orphaned.

    Requires confirm: true to proceed.`,
    inputSchema: {
      type: 'object',
      properties: {
        entryId: { type: 'string', description: 'Entry ID to delete' },
        confirm: { type: 'boolean', description: 'Must be true to confirm deletion' }
      },
      required: ['entryId', 'confirm']
    }
  },
  {
    name: 'god_checkpoint',
    description: `Create a Git-trackable checkpoint of the memory database.

    Copies memory.db to dev-memory-{timestamp}.db for version control.
    The working memory.db stays untracked; checkpoints are committed on demand.

    Usage:
    - Default: Creates new timestamped checkpoint
    - overwrite: true → Overwrites the most recent checkpoint instead`,
    inputSchema: {
      type: 'object',
      properties: {
        overwrite: { type: 'boolean', description: 'Overwrite most recent checkpoint instead of creating new' }
      }
    }
  },
  {
    name: 'god_learn',
    description: `Provide feedback for a query trajectory to improve future retrieval.

    This is the main learning entry point. Call this after evaluating how useful
    query results were. The system updates BOTH:
    - MemRL Q-values (entry-level utility scores)
    - Sona pattern weights (pattern-level learning)

    How it works:
    1. Use god_query to search - results include a trajectoryId
    2. Evaluate how useful the results were
    3. Call god_learn with trajectoryId and quality score
    4. System updates Q-values (EMA) and pattern weights (EWC++)

    Quality scores:
    - 0.0: Completely useless results
    - 0.5: Neutral (no change)
    - 1.0: Perfect, exactly what was needed`,
    inputSchema: {
      type: 'object',
      properties: {
        trajectoryId: { type: 'string', description: 'Trajectory ID from previous query' },
        quality: { type: 'number', minimum: 0, maximum: 1, description: 'Quality score 0-1' },
        route: { type: 'string', description: 'Optional reasoning route' },
        memrlQueryId: { type: 'string', description: 'MemRL query ID (auto-uses last query if omitted)' }
      },
      required: ['trajectoryId', 'quality']
    }
  },
  {
    name: 'god_learning_stats',
    description: `Get combined learning statistics (MemRL + Sona).

    Shows:
    - MemRL: Q-value distribution, avg Q, entries with updates
    - Sona: Trajectories, feedback rate, pattern weights
    - Current drift score and health status
    - Pruning/boosting candidates`,
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'god_session_store',
    description: `Store a session summary with structured metadata.

    Use this to capture significant session outcomes:
    - Architecture decisions made
    - Patterns discovered or applied
    - Bug fixes and their root causes
    - Files changed and why

    Auto-tags with 'session' and today's date. Sets importance 0.8.`,
    inputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Session summary text' },
        decisions: { type: 'array', items: { type: 'string' }, description: 'Key decisions made' },
        patterns: { type: 'array', items: { type: 'string' }, description: 'Patterns discovered or applied' },
        filesChanged: { type: 'array', items: { type: 'string' }, description: 'Files modified' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Additional tags' },
        relatedIds: { type: 'array', items: { type: 'string' }, description: 'Related memory IDs for causal links' }
      },
      required: ['summary']
    }
  },
  {
    name: 'god_prune_patterns',
    description: `Prune patterns with low success rates.

    Removes patterns that have:
    - At least 100 uses (configurable via pruneMinUses)
    - Success rate below 40% (configurable via pruneThreshold)

    This implements evolutionary pressure on patterns:
    - Good patterns survive and strengthen
    - Bad patterns die off
    - System quality improves over time

    Returns information about pruned patterns including:
    - Pattern ID and name
    - Use count and success rate
    - Total number pruned`,
    inputSchema: {
      type: 'object',
      properties: {
        dryRun: {
          type: 'boolean',
          description: 'If true, only report what would be pruned without actually deleting'
        }
      }
    }
  },
  {
    name: 'god_shadow_search',
    description: `Find contradictory evidence using shadow vector search.

    Inverts the query embedding (v × -1) to find entries that semantically
    oppose your claim. Returns contradictions with credibility analysis.

    Use cases:
    - Risk Assessment: Find reasons a trade might fail
    - Bias Detection: Ensure not only seeing confirming evidence
    - Devil's Advocate: Generate counter-arguments to your thesis

    Returns:
    - contradictions: Entries that oppose the query
    - credibility: support / (support + contradiction) score
    - refutationStrength: How strongly each entry contradicts (0-1)
    - contradictionType: direct_negation, counterargument, alternative, etc.`,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The claim to find contradictions for' },
        threshold: { type: 'number', minimum: 0, maximum: 1, description: 'Min refutation strength (default: 0.5)' },
        topK: { type: 'number', minimum: 1, maximum: 50, description: 'Number of contradictions (default: 10)' },
        contradictionType: {
          type: 'string',
          enum: ['direct_negation', 'counterargument', 'falsification', 'alternative', 'exception'],
          description: 'Filter by contradiction type'
        },
        includeProvenance: { type: 'boolean', description: 'Include L-Score in credibility calc' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
        minImportance: { type: 'number', minimum: 0, maximum: 1, description: 'Min importance' }
      },
      required: ['query']
    }
  },
  {
    name: 'god_cleanup_expired',
    description: `Clean up expired causal relations.

    Removes relations that have passed their TTL expiration time.
    Temporal relations naturally expire as market correlations are regime-dependent.

    Use cases:
    - Regime Detection: Old correlations expiring = regime may be changing
    - Fresh Analysis: Only recent causal links influence decisions
    - Memory Hygiene: Prevents stale relationships from polluting reasoning

    Options:
    - dryRun: true = Preview what would be deleted without actually deleting

    Returns:
    - cleaned: Number of relations removed
    - relationIds: IDs of the removed relations`,
    inputSchema: {
      type: 'object',
      properties: {
        dryRun: { type: 'boolean', description: 'If true, only report what would be cleaned' }
      }
    }
  },
  {
    name: 'god_enhance',
    description: `Enhance a memory entry's embedding using Graph Neural Network.

    Uses the causal/provenance graph structure to enrich the embedding by:
    1. Extracting the ego graph (2-hop neighborhood) around the entry
    2. Aggregating neighbor embeddings via message passing
    3. Projecting from 768-dim to 1024-dim for richer representation

    The enhanced embedding captures both semantic content AND structural context,
    improving retrieval recall by 15-30%.

    Use cases:
    - Get richer representation for important entries
    - Understand what neighbors contribute to an entry's context
    - Debug why certain entries rank higher in search

    Returns:
    - originalDim: Input embedding dimension (768)
    - enhancedDim: Output embedding dimension (1024)
    - neighborsUsed: Number of graph neighbors aggregated
    - neighborWeights: Weight contribution from each neighbor (if includeWeights=true)
    - processingTimeMs: Time taken for enhancement`,
    inputSchema: {
      type: 'object',
      properties: {
        entryId: { type: 'string', description: 'ID of entry to enhance' },
        includeWeights: { type: 'boolean', description: 'Include neighbor weights in response' }
      },
      required: ['entryId']
    }
  },
  {
    name: 'god_enhance_batch',
    description: `Enhance multiple memory entries in batch.

    More efficient than calling god_enhance repeatedly. Processes entries
    in batch, sharing neighbor embeddings where applicable.

    Returns aggregate statistics plus individual results.`,
    inputSchema: {
      type: 'object',
      properties: {
        entryIds: { type: 'array', items: { type: 'string' }, description: 'Entry IDs to enhance' },
        maxBatchSize: { type: 'number', minimum: 1, maximum: 100, description: 'Max batch size (default: 50)' }
      },
      required: ['entryIds']
    }
  },
  {
    name: 'god_gnn_stats',
    description: `Get GNN enhancement layer statistics.

    Shows:
    - enhancementsPerformed: Total enhancement operations
    - avgNeighborsUsed: Average neighbors per enhancement
    - avgProcessingTimeMs: Average time per enhancement
    - cacheHitRate: Cache efficiency (0-1)
    - cacheSize: Current entries in cache

    Use to monitor GNN performance and caching effectiveness.`,
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'god_clear_gnn_cache',
    description: `Clear the GNN enhancement cache.

    Enhanced embeddings are cached to avoid recomputation.
    Clear the cache when:
    - Graph structure has changed significantly
    - Testing different enhancement configurations
    - Memory pressure requires freeing resources

    Returns the number of cached entries cleared.`,
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'god_route',
    description: `Route a query to the optimal reasoning strategy using Tiny Dancer.

    Analyzes the query and determines the best reasoning approach:
    - pattern_match: Find similar historical patterns
    - causal_forward: What effects does X cause?
    - causal_backward: What caused X?
    - temporal_causal: Time-based cause-effect chains
    - hybrid: Combine pattern + causal reasoning
    - direct_retrieval: Simple vector search
    - adversarial: Find contradictory evidence

    Features:
    - Rule-based routing with keyword matching (< 1ms)
    - Circuit breaker protection for failing routes
    - Confidence scores and alternative routes
    - Session continuity support

    Use this before executing queries to select the optimal approach.`,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Query to route' },
        preferredRoute: {
          type: 'string',
          enum: ['pattern_match', 'causal_forward', 'causal_backward', 'temporal_causal', 'hybrid', 'direct_retrieval', 'adversarial'],
          description: 'Preferred route'
        },
        previousRoute: {
          type: 'string',
          enum: ['pattern_match', 'causal_forward', 'causal_backward', 'temporal_causal', 'hybrid', 'direct_retrieval', 'adversarial'],
          description: 'Previous route used'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'god_route_result',
    description: `Record the result of executing a routed query.

    Call this after executing a query to update the circuit breaker:
    - success=true: Route is working, circuit stays closed
    - success=false: Route failure recorded, may trip circuit

    Circuit breaker thresholds:
    - 5 failures in 60 seconds → OPEN circuit (suspend route)
    - 5 minute cooldown → HALF-OPEN (test one request)
    - Success in half-open → CLOSED (resume normal)
    - Failure in half-open → OPEN again

    This feedback improves routing reliability over time.`,
    inputSchema: {
      type: 'object',
      properties: {
        route: {
          type: 'string',
          enum: ['pattern_match', 'causal_forward', 'causal_backward', 'temporal_causal', 'hybrid', 'direct_retrieval', 'adversarial'],
          description: 'Route that was executed'
        },
        success: { type: 'boolean', description: 'Whether execution succeeded' }
      },
      required: ['route', 'success']
    }
  },
  {
    name: 'god_routing_stats',
    description: `Get Tiny Dancer routing statistics.

    Shows:
    - totalRouted: Queries processed
    - routeCounts: Queries per route
    - avgConfidence: Confidence per route
    - avgRoutingTimeMs: Routing latency
    - fallbackCount: Low-confidence fallbacks
    - circuitTrips: Times circuits were opened

    Use to monitor routing performance and identify problem routes.`,
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'god_circuit_status',
    description: `Get circuit breaker status for all routes.

    Shows for each route:
    - state: CLOSED (normal), OPEN (blocked), HALF_OPEN (testing)
    - failureCount: Recent failures in window
    - successCount: Successes in half-open state
    - cooldownEndsAt: When OPEN circuit will try recovery
    - totalFailures/totalSuccesses: Lifetime counts

    Use to diagnose why certain routes might be blocked.`,
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'god_reset_circuit',
    description: `Reset circuit breaker for a route.

    Options:
    - Specify route: Reset just that route's circuit
    - Omit route: Reset ALL circuits

    Use when:
    - A route was blocked but the issue is fixed
    - Testing after making changes
    - Starting a new session

    Clears failure history and returns circuit to CLOSED state.`,
    inputSchema: {
      type: 'object',
      properties: {
        route: {
          type: 'string',
          enum: ['pattern_match', 'causal_forward', 'causal_backward', 'temporal_causal', 'hybrid', 'direct_retrieval', 'adversarial'],
          description: 'Route to reset (omit for all)'
        }
      }
    }
  },
  // ==========================================
  // Scheduler Tools (Phase 9)
  // ==========================================
  {
    name: 'god_schedule',
    description: `Schedule a task for future execution.

    Create scheduled tasks that execute automatically based on triggers:
    - datetime: Execute at a specific time
    - cron: Execute on a recurring schedule
    - event: Execute when an event is fired
    - file: Execute when a file changes
    - manual: Execute only when triggered manually

    Tasks receive context from god-agent memory (via contextIds or contextQuery).
    Use {context} placeholder in prompt to inject memory context.

    Example: Schedule daily analysis
    {
      name: "Morning analysis",
      prompt: "Analyze overnight developments. Context: {context}",
      trigger: { type: "cron", pattern: "0 8 * * 1-5" },
      contextQuery: "recent market events"
    }`,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Task name' },
        description: { type: 'string', description: 'Optional description' },
        prompt: { type: 'string', description: 'Task prompt (use {context} for memory)' },
        trigger: {
          type: 'object',
          description: 'Trigger configuration',
          properties: {
            type: { type: 'string', enum: ['datetime', 'cron', 'event', 'file', 'manual'] },
            at: { type: 'string', description: 'ISO datetime (for datetime trigger)' },
            pattern: { type: 'string', description: 'Cron expression (for cron trigger)' },
            event: { type: 'string', description: 'Event name (for event trigger)' },
            path: { type: 'string', description: 'File path (for file trigger)' }
          },
          required: ['type']
        },
        contextIds: { type: 'array', items: { type: 'string' }, description: 'Memory IDs for context' },
        contextQuery: { type: 'string', description: 'Query for fresh context' },
        priority: { type: 'number', minimum: 1, maximum: 10, description: 'Priority 1-10' },
        notification: {
          type: 'object',
          properties: {
            onComplete: { type: 'boolean' },
            onDecision: { type: 'boolean' },
            onFailure: { type: 'boolean' }
          }
        }
      },
      required: ['name', 'prompt', 'trigger']
    }
  },
  {
    name: 'god_trigger',
    description: `Manually trigger a scheduled task or fire an event.

    Options:
    - taskId: Trigger a specific task immediately (ignores trigger conditions)
    - event: Fire a named event (triggers all tasks listening for that event)

    Example: Fire trading completion event
    { event: "trading_complete" }

    Example: Trigger specific task now
    { taskId: "abc123..." }`,
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID to trigger directly' },
        event: { type: 'string', description: 'Event name to fire' }
      }
    }
  },
  {
    name: 'god_tasks',
    description: `List scheduled tasks.

    Filter by status:
    - pending: Tasks waiting for trigger
    - running: Currently executing tasks
    - completed: Successfully finished tasks
    - failed: Tasks that errored
    - paused: Temporarily suspended tasks
    - all: Show all tasks

    Returns task details including trigger config, last run, and next run times.`,
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['pending', 'running', 'completed', 'failed', 'paused', 'cancelled', 'all'],
          description: 'Filter by status'
        },
        limit: { type: 'number', minimum: 1, maximum: 100, description: 'Max results' }
      }
    }
  },
  {
    name: 'god_pause',
    description: `Pause a scheduled task.

    Paused tasks won't trigger until resumed.
    Use for temporarily disabling recurring tasks.`,
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID to pause' }
      },
      required: ['taskId']
    }
  },
  {
    name: 'god_resume',
    description: `Resume a paused task.

    Returns the task to pending status so it can trigger again.`,
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID to resume' }
      },
      required: ['taskId']
    }
  },
  {
    name: 'god_cancel',
    description: `Cancel a scheduled task.

    Permanently cancels the task. Use god_pause for temporary suspension.
    Cancelled tasks remain in history but won't execute.`,
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID to cancel' }
      },
      required: ['taskId']
    }
  },
  {
    name: 'god_scheduler_stats',
    description: `Get scheduler statistics.

    Shows:
    - Task counts by status
    - Run history summary
    - Average run duration
    - Events in queue`,
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  // ==========================================
  // Playwright Tools (RUBIX)
  // ==========================================
  {
    name: 'god_pw_launch',
    description: `Launch a browser session for verification and testing.

    Returns a sessionId to use with other playwright tools.
    Browser stays open until closed with god_pw_close.

    Options:
    - browser: chromium (default), firefox, or webkit
    - headless: true (default) for CI, false for debugging
    - viewport: screen dimensions`,
    inputSchema: {
      type: 'object',
      properties: {
        browser: {
          type: 'string',
          enum: ['chromium', 'firefox', 'webkit'],
          description: 'Browser to use'
        },
        headless: {
          type: 'boolean',
          description: 'Run headless (default: true)'
        },
        viewport: {
          type: 'object',
          properties: {
            width: { type: 'number', minimum: 320, maximum: 3840 },
            height: { type: 'number', minimum: 240, maximum: 2160 }
          },
          description: 'Viewport dimensions'
        }
      }
    }
  },
  {
    name: 'god_pw_close',
    description: `Close a browser session.

    Frees resources and cleans up the session.
    All console logs and screenshots remain in memory.`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID to close' }
      },
      required: ['sessionId']
    }
  },
  {
    name: 'god_pw_navigate',
    description: `Navigate to a URL in a browser session.

    Returns navigation result including success, URL, and title.
    Console messages are captured automatically.`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Browser session ID' },
        url: { type: 'string', description: 'URL to navigate to' },
        waitUntil: {
          type: 'string',
          enum: ['load', 'domcontentloaded', 'networkidle'],
          description: 'When to consider navigation complete'
        }
      },
      required: ['sessionId', 'url']
    }
  },
  {
    name: 'god_pw_screenshot',
    description: `Take a screenshot of the current page or element.

    Screenshots are saved to disk and tracked in the session.
    Use for visual verification and debugging.`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Browser session ID' },
        fullPage: { type: 'boolean', description: 'Capture full page' },
        selector: { type: 'string', description: 'Element to screenshot' },
        label: { type: 'string', description: 'Screenshot label' },
        returnBase64: { type: 'boolean', description: 'Return base64 data' }
      },
      required: ['sessionId']
    }
  },
  {
    name: 'god_pw_action',
    description: `Perform an action on a page element.

    Actions:
    - click, dblclick: Click element
    - type: Type text character by character
    - fill: Fill input field (replaces content)
    - clear: Clear input field
    - check/uncheck: Toggle checkbox
    - select: Select dropdown option
    - hover, focus: Mouse/keyboard focus
    - press: Press a key (Enter, Tab, etc.)`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Browser session ID' },
        selector: { type: 'string', description: 'CSS selector' },
        action: {
          type: 'string',
          enum: ['click', 'dblclick', 'type', 'fill', 'clear', 'check', 'uncheck', 'select', 'hover', 'focus', 'press'],
          description: 'Action to perform'
        },
        value: { type: 'string', description: 'Value for type/fill/select' },
        key: { type: 'string', description: 'Key for press action' },
        force: { type: 'boolean', description: 'Skip actionability checks' }
      },
      required: ['sessionId', 'selector', 'action']
    }
  },
  {
    name: 'god_pw_assert',
    description: `Assert element or page state.

    Assertion types:
    - visible/hidden: Element visibility
    - enabled/disabled: Input state
    - checked/unchecked: Checkbox state
    - text: Element text content
    - value: Input value
    - attribute: Element attribute
    - count: Number of matching elements
    - url/title: Page URL or title`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Browser session ID' },
        type: {
          type: 'string',
          enum: ['visible', 'hidden', 'enabled', 'disabled', 'checked', 'unchecked', 'text', 'value', 'attribute', 'count', 'url', 'title'],
          description: 'Assertion type'
        },
        selector: { type: 'string', description: 'CSS selector' },
        expected: { description: 'Expected value (string or number)' },
        attribute: { type: 'string', description: 'Attribute name' }
      },
      required: ['sessionId', 'type']
    }
  },
  {
    name: 'god_pw_console',
    description: `Get console logs and errors from a browser session.

    Returns all captured console messages and page errors.
    Includes error counts, message types, and stack traces.

    Use for debugging and verification.`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Browser session ID' },
        clear: { type: 'boolean', description: 'Clear logs after returning' }
      },
      required: ['sessionId']
    }
  },
  {
    name: 'god_pw_verify',
    description: `Quick verification workflow for a URL.

    Navigates to URL and performs:
    - Screenshot capture (optional)
    - Console error check (optional)
    - Element visibility assertions (optional)

    Returns a comprehensive result with all verification steps.`,
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to verify' },
        screenshot: { type: 'boolean', description: 'Take screenshot (default: true)' },
        checkConsole: { type: 'boolean', description: 'Check for errors (default: true)' },
        assertVisible: {
          type: 'array',
          items: { type: 'string' },
          description: 'Selectors that must be visible'
        }
      },
      required: ['url']
    }
  },
  // RUBIX Tools (Autonomous Developer)
  {
    name: 'god_codex_do',
    description: `Submit a task to RUBIX - the autonomous developer agent.

    RUBIX will:
    1. Decompose the task into subtasks
    2. Execute each subtask with verification
    3. Self-heal when things fail (up to 3 attempts)
    4. Only escalate when genuinely blocked

    Use for development tasks like:
    - Building new features
    - Fixing bugs
    - Refactoring code
    - Writing tests

    Returns task ID and status. Check progress with god_codex_status.`,
    inputSchema: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'What you want RUBIX to do' },
        specification: { type: 'string', description: 'Detailed requirements' },
        codebase: { type: 'string', description: 'Path to codebase' },
        constraints: {
          type: 'array',
          items: { type: 'string' },
          description: 'Constraints to follow'
        },
        verificationUrl: { type: 'string', description: 'URL for verification' },
        dryRun: { type: 'boolean', description: 'Preview without executing' }
      },
      required: ['description', 'codebase']
    }
  },
  {
    name: 'god_codex_status',
    description: `Get current RUBIX execution status.

    Shows:
    - Current task and progress
    - Subtasks completed/remaining
    - Current subtask being worked on
    - Any blockers or pending decisions
    - Recent work log entries

    Use to check on RUBIX without interrupting.`,
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'god_codex_answer',
    description: `Answer a pending RUBIX escalation.

    When RUBIX is blocked and needs help, use this to provide:
    - Clarification for ambiguous specs
    - Resolution for blockers
    - Approval for irreversible actions

    Get escalation ID from god_codex_status.`,
    inputSchema: {
      type: 'object',
      properties: {
        escalationId: { type: 'string', description: 'Escalation ID to answer' },
        answer: { type: 'string', description: 'Your answer/resolution' },
        optionIndex: { type: 'number', description: 'Selected option index' }
      },
      required: ['escalationId', 'answer']
    }
  },
  {
    name: 'god_codex_decision',
    description: `Answer a pending RUBIX decision.

    When RUBIX needs a business decision, use this to provide your choice.
    Get decision ID from god_codex_status.`,
    inputSchema: {
      type: 'object',
      properties: {
        decisionId: { type: 'string', description: 'Decision ID to answer' },
        answer: { type: 'string', description: 'Your decision' },
        optionIndex: { type: 'number', description: 'Selected option index' }
      },
      required: ['decisionId', 'answer']
    }
  },
  {
    name: 'god_codex_cancel',
    description: `Cancel the current RUBIX task.

    Stops execution immediately. Any completed subtasks remain complete.
    Use when you need to abort or change direction.`,
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'god_codex_log',
    description: `Get the full work log from RUBIX (in-memory, current session only).

    Shows chronological log of all actions taken:
    - Task start/complete
    - Subtask progress
    - Successes and failures
    - Decisions and escalations

    Useful for understanding what RUBIX did. For persistent logs, use god_codex_logs.`,
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'god_codex_logs',
    description: `List and read persistent CODEX execution logs from disk.

    Logs are stored in data/codex-logs/ with one file per task execution.
    These persist across sessions and can be reviewed later.

    Operations:
    - list: List recent log files (default)
    - read: Read a specific log file
    - latest: Read the most recent log file

    Examples:
    - god_codex_logs() - List recent logs
    - god_codex_logs({ action: "latest" }) - Read latest log
    - god_codex_logs({ action: "read", filename: "codex_2026-01-16_abc123.log" }) - Read specific log`,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'read', 'latest'],
          description: 'Action to perform (default: list)'
        },
        filename: {
          type: 'string',
          description: 'Log filename to read (for action: read)'
        },
        limit: {
          type: 'number',
          description: 'Max files to list (default: 20)'
        }
      },
      required: []
    }
  },
  {
    name: 'god_codex_wait',
    description: `Extend the timeout for pending RUBIX escalations.

    When RUBIX is waiting for your response to an escalation,
    use this to add more time before it times out.

    Default: Adds 10 minutes. Can be called multiple times to stack.

    Examples:
    - god_codex_wait() - Add 10 minutes
    - god_codex_wait({ minutes: 30 }) - Add 30 minutes

    Also available as /wait command in Telegram.`,
    inputSchema: {
      type: 'object',
      properties: {
        minutes: {
          type: 'number',
          description: 'Minutes to extend timeout (default: 10)'
        }
      },
      required: []
    }
  },
  {
    name: 'god_codex_estimate',
    description: `Estimate token usage and cost for a CODEX task.

    Analyzes the codebase and task to predict:
    - Token usage per phase (context scout, architect, engineer, validator)
    - Estimated Claude API cost
    - Complexity assessment

    Does NOT make any API calls - pure estimation based on:
    - Codebase file count and size
    - Task complexity heuristics
    - Phase-specific overhead

    Use before god_codex_do to preview costs.`,
    inputSchema: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'Task description' },
        specification: { type: 'string', description: 'Detailed specification' },
        codebase: { type: 'string', description: 'Path to codebase' }
      },
      required: ['description', 'codebase']
    }
  },

  // ==========================================
  // Collaborative Partner Tools
  // ==========================================

  {
    name: 'god_partner_config',
    description: `Configure the Collaborative Partner behavior.

    The Collaborative Partner provides:
    - Proactive Curiosity: Asks questions before executing
    - Challenge Decisions: Uses shadow search to find contradictions
    - Confidence Gates: L-Score thresholds for warn/block
    - Hard Gate: Requires override for risky decisions

    Thresholds determine challenge behavior:
    - credibilityHardGate (0.3): BLOCK if credibility below this
    - credibilityWarnGate (0.5): WARN if credibility below this
    - lScoreHardGate (0.2): BLOCK if L-Score below this
    - lScoreWarnGate (0.5): WARN if L-Score below this`,
    inputSchema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', description: 'Enable/disable collaborative partner' },
        thresholds: {
          type: 'object',
          properties: {
            credibilityHardGate: { type: 'number', description: 'Credibility BLOCK threshold (default: 0.3)' },
            credibilityWarnGate: { type: 'number', description: 'Credibility WARN threshold (default: 0.5)' },
            lScoreHardGate: { type: 'number', description: 'L-Score BLOCK threshold (default: 0.2)' },
            lScoreWarnGate: { type: 'number', description: 'L-Score WARN threshold (default: 0.5)' }
          }
        },
        behaviors: {
          type: 'object',
          properties: {
            proactiveCuriosity: { type: 'boolean', description: 'Ask questions before executing' },
            challengeDecisions: { type: 'boolean', description: 'Use shadow search for contradictions' },
            hardGateHighRisk: { type: 'boolean', description: 'Require override for risky decisions' }
          }
        }
      },
      required: []
    }
  },
  {
    name: 'god_partner_challenge',
    description: `Manually trigger a challenge assessment on an approach.

    The Collaborative Partner will:
    1. Run shadow search to find contradictions
    2. Check memory for approach L-Score
    3. Return assessment with credibility and concerns

    Useful for testing challenge behavior before execution.`,
    inputSchema: {
      type: 'object',
      properties: {
        approach: { type: 'string', description: 'The approach/plan to assess' },
        taskDescription: { type: 'string', description: 'Optional task description' },
        subtaskDescription: { type: 'string', description: 'Optional subtask description' }
      },
      required: ['approach']
    }
  },
  {
    name: 'god_partner_status',
    description: `Get current Collaborative Partner status and configuration.

    Shows:
    - Current configuration (thresholds, behaviors)
    - Whether partner is enabled
    - Containment status`,
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },

  // ==========================================
  // Containment Tools
  // ==========================================

  {
    name: 'god_containment_check',
    description: `Check if a path is allowed for an operation.

    The ContainmentManager enforces path-based permissions:
    - Project folder is always allowed (read-write)
    - Dangerous paths (secrets, keys) are always denied
    - Other paths follow configured rules

    Returns whether the operation is allowed and why.`,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to check' },
        operation: { type: 'string', enum: ['read', 'write'], description: 'Operation type' }
      },
      required: ['path', 'operation']
    }
  },
  {
    name: 'god_containment_config',
    description: `Configure containment settings.

    Containment controls which paths RUBIX can access:
    - projectRoot: Always allowed for read-write
    - defaultPermission: Permission for unmatched paths
    - enabled: Enable/disable containment entirely`,
    inputSchema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', description: 'Enable/disable containment' },
        projectRoot: { type: 'string', description: 'Project root (always allowed)' },
        defaultPermission: { type: 'string', enum: ['deny', 'read', 'write', 'read-write'], description: 'Default permission' }
      },
      required: []
    }
  },
  {
    name: 'god_containment_add_rule',
    description: `Add a path permission rule.

    Rules are glob patterns matched against paths:
    - "**/.env*" - Match any .env file
    - "/etc/**" - Match anything under /etc
    - "**/secrets*" - Match any file with "secrets" in name

    Higher priority rules are checked first.`,
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern to match' },
        permission: { type: 'string', enum: ['deny', 'read', 'write', 'read-write'], description: 'Permission level' },
        reason: { type: 'string', description: 'Human-readable reason' },
        priority: { type: 'number', description: 'Priority (higher = checked first)' }
      },
      required: ['pattern', 'permission']
    }
  },
  {
    name: 'god_containment_remove_rule',
    description: `Remove a path permission rule by pattern.

    Removes the rule matching the exact pattern.`,
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern to remove' }
      },
      required: ['pattern']
    }
  },
  {
    name: 'god_containment_status',
    description: `Get current containment status and rules.

    Shows:
    - Whether containment is enabled
    - Project root path
    - Default permission
    - All configured rules
    - Session permissions`,
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'god_containment_session',
    description: `Grant or revoke temporary session-scoped access to paths/drives.

    Session permissions are temporary (cleared on server restart) and still respect
    security rules - sensitive files (.env, credentials, keys) remain blocked.

    Use this when you need to search or access files outside the project root temporarily.

    Examples:
    - Grant read access to D drive: action:"add" pattern:"D:/**" permission:"read"
    - Grant read-write to user folder: action:"add" pattern:"C:/Users/**" permission:"read-write"
    - Revoke access: action:"remove" pattern:"D:/**"
    - Clear all session permissions: action:"clear"`,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['add', 'remove', 'clear', 'list'], description: 'Action to perform' },
        pattern: { type: 'string', description: 'Glob pattern (e.g., D:/**, C:/Users/**)' },
        permission: { type: 'string', enum: ['read', 'write', 'read-write'], description: 'Permission level (for add action)' },
        reason: { type: 'string', description: 'Reason for access (for logging)' }
      },
      required: ['action']
    }
  },

  // ==========================================
  // Capabilities Tools (Stage 4)
  // ==========================================

  // LSP Tools
  {
    name: 'god_lsp_start',
    description: `Start the Language Server Protocol integration.

    Supports 10 languages:
    - TypeScript (.ts, .tsx) - typescript-language-server
    - JavaScript (.js, .jsx, .mjs) - typescript-language-server
    - PHP (.php) - intelephense
    - CSS (.css, .scss, .less) - vscode-css-language-server
    - HTML (.html, .htm) - vscode-html-language-server
    - SQL (.sql) - sql-language-server
    - Java (.java) - jdtls
    - Python (.py) - pyright
    - Go (.go) - gopls
    - Rust (.rs) - rust-analyzer

    Features: go-to-definition, find-references, diagnostics, symbol search.
    Must be called before using other LSP tools.`,
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'god_lsp_stop',
    description: `Stop the Language Server Protocol integration.

    Shuts down language servers and cleans up resources.`,
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'god_lsp_available',
    description: `Check which language servers are installed and available.

    Returns availability status for all 10 supported languages:
    - typescript, javascript, php, css, html, sql, java, python, go, rust

    For each language shows:
    - Whether the server is installed
    - The command being used
    - Install instructions if not available

    Use this to diagnose LSP issues or see what's supported.`,
    inputSchema: {
      type: 'object',
      properties: {
        language: {
          type: 'string',
          description: 'Check specific language (optional, checks all if omitted)',
          enum: ['typescript', 'javascript', 'php', 'css', 'html', 'sql', 'java', 'python', 'go', 'rust']
        }
      },
      required: []
    }
  },
  {
    name: 'god_lsp_definition',
    description: `Go to definition of a symbol.

    Returns the location where a symbol is defined.
    Useful for understanding code structure and navigation.`,
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'File path' },
        line: { type: 'number', description: 'Line number (1-based)' },
        column: { type: 'number', description: 'Column number (1-based)' }
      },
      required: ['file', 'line', 'column']
    }
  },
  {
    name: 'god_lsp_references',
    description: `Find all references to a symbol.

    Returns all locations where a symbol is used.
    Essential for understanding impact of changes.`,
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'File path' },
        line: { type: 'number', description: 'Line number (1-based)' },
        column: { type: 'number', description: 'Column number (1-based)' },
        includeDeclaration: { type: 'boolean', description: 'Include declaration in results' }
      },
      required: ['file', 'line', 'column']
    }
  },
  {
    name: 'god_lsp_diagnostics',
    description: `Get diagnostics (errors, warnings) from the language server.

    Returns compilation errors and warnings for the codebase.`,
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'File path (optional, all files if not specified)' }
      },
      required: []
    }
  },
  {
    name: 'god_lsp_symbols',
    description: `Search for symbols across the codebase.

    Find functions, classes, interfaces by name.
    Useful for code navigation and discovery.`,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Symbol search query' }
      },
      required: ['query']
    }
  },

  // Git Tools
  {
    name: 'god_git_blame',
    description: `Get blame information for a file.

    Shows who wrote each line and when.
    Useful for understanding code history and ownership.`,
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'File path' },
        startLine: { type: 'number', description: 'Start line (1-based)' },
        endLine: { type: 'number', description: 'End line (1-based)' }
      },
      required: ['file']
    }
  },
  {
    name: 'god_git_bisect',
    description: `Binary search for a breaking commit.

    Automatically finds the first commit that introduced a bug.
    Runs test command at each step to determine good/bad.`,
    inputSchema: {
      type: 'object',
      properties: {
        good: { type: 'string', description: 'Known good commit/tag' },
        bad: { type: 'string', description: 'Known bad commit/tag (default: HEAD)' },
        testCommand: { type: 'string', description: 'Command to test if commit is good' }
      },
      required: ['good', 'testCommand']
    }
  },
  {
    name: 'god_git_history',
    description: `Get commit history for a file or repository.

    Shows recent commits with author, date, and message.
    Useful for understanding what changed and when.`,
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'File path (optional, all files if not specified)' },
        limit: { type: 'number', description: 'Number of commits to return' },
        author: { type: 'string', description: 'Filter by author' }
      },
      required: []
    }
  },
  {
    name: 'god_git_diff',
    description: `Show changes in the working directory or between commits.

    Displays what has been modified.`,
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'File path (optional, all files if not specified)' },
        commit: { type: 'string', description: 'Commit to diff against (default: HEAD)' },
        staged: { type: 'boolean', description: 'Show staged changes only' }
      },
      required: []
    }
  },
  {
    name: 'god_git_branches',
    description: `List and get information about git branches.

    Shows all branches with their tracking status.`,
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },

  // AST Tools
  {
    name: 'god_ast_parse',
    description: `Parse a file into an Abstract Syntax Tree.

    Returns the AST structure for code analysis.
    Useful for understanding code structure.`,
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'File path to parse' }
      },
      required: ['file']
    }
  },
  {
    name: 'god_ast_query',
    description: `Query the AST for specific node types.

    Find all occurrences of a node type (e.g., FunctionDeclaration).
    Useful for code analysis and refactoring preparation.`,
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'File path' },
        nodeType: { type: 'string', description: 'Node type to find (e.g., "FunctionDeclaration", "ImportDeclaration")' }
      },
      required: ['file', 'nodeType']
    }
  },
  {
    name: 'god_ast_refactor',
    description: `Perform safe refactoring operations.

    Supports: rename, extract, inline, move.
    Uses AST for safe, accurate transformations.`,
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['rename', 'extract', 'inline', 'move'], description: 'Refactoring type' },
        target: { type: 'string', description: 'Target (format: "file:symbolName" for rename)' },
        newValue: { type: 'string', description: 'New name/location for rename/move' },
        scope: { type: 'string', description: 'Scope for rename (file path or "all")' }
      },
      required: ['type', 'target']
    }
  },
  {
    name: 'god_ast_symbols',
    description: `Get all symbols defined in a file.

    Returns functions, classes, variables with locations.
    Useful for code understanding and navigation.`,
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'File path' }
      },
      required: ['file']
    }
  },

  // Analysis Tools
  {
    name: 'god_analyze_lint',
    description: `Run ESLint on source files.

    Returns linting errors and warnings.
    Can auto-fix some issues.`,
    inputSchema: {
      type: 'object',
      properties: {
        files: { type: 'array', items: { type: 'string' }, description: 'Files to lint (default: all source files)' }
      },
      required: []
    }
  },
  {
    name: 'god_analyze_types',
    description: `Run TypeScript type checking.

    Returns type errors and warnings from the TypeScript compiler.`,
    inputSchema: {
      type: 'object',
      properties: {
        files: { type: 'array', items: { type: 'string' }, description: 'Files to type-check (default: all)' }
      },
      required: []
    }
  },
  {
    name: 'god_analyze_deps',
    description: `Build dependency graph from an entry point.

    Shows what modules import what.
    Detects circular dependencies.`,
    inputSchema: {
      type: 'object',
      properties: {
        entryPoint: { type: 'string', description: 'Entry point file for dependency analysis' }
      },
      required: ['entryPoint']
    }
  },
  {
    name: 'god_analyze_impact',
    description: `Analyze the impact of changing a file.

    Shows what other files depend on it.
    Helps assess risk of changes.`,
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'File to analyze impact for' }
      },
      required: ['file']
    }
  },

  // Debug Tools
  {
    name: 'god_debug_start',
    description: `Start a debug session for a Node.js script.

    Connects to Node.js inspector for debugging.
    Allows breakpoints, stepping, inspection.`,
    inputSchema: {
      type: 'object',
      properties: {
        script: { type: 'string', description: 'Script to debug' },
        args: { type: 'array', items: { type: 'string' }, description: 'Script arguments' }
      },
      required: ['script']
    }
  },
  {
    name: 'god_debug_stop',
    description: `Stop all debug sessions.

    Cleans up all debugging resources.`,
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'god_debug_breakpoint',
    description: `Set or remove a breakpoint.

    Control where execution pauses.
    Supports conditional breakpoints.`,
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'File path' },
        line: { type: 'number', description: 'Line number' },
        condition: { type: 'string', description: 'Conditional breakpoint expression' },
        remove: { type: 'boolean', description: 'Remove breakpoint instead of adding' }
      },
      required: ['file', 'line']
    }
  },
  {
    name: 'god_debug_step',
    description: `Step through code execution.

    Actions: continue, stepOver, stepInto, stepOut.`,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['continue', 'stepOver', 'stepInto', 'stepOut'], description: 'Step action' }
      },
      required: ['action']
    }
  },
  {
    name: 'god_debug_eval',
    description: `Evaluate an expression in the current debug context.

    Inspect variables, call functions, etc.`,
    inputSchema: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'Expression to evaluate' }
      },
      required: ['expression']
    }
  },

  // Stack Trace Tools
  {
    name: 'god_stack_parse',
    description: `Parse an error stack trace.

    Extracts file, line, column from stack frames.
    Supports source map mapping.`,
    inputSchema: {
      type: 'object',
      properties: {
        error: { type: 'string', description: 'Error message or stack trace string' }
      },
      required: ['error']
    }
  },
  {
    name: 'god_stack_context',
    description: `Get code context around an error location.

    Shows surrounding lines of code at error location.`,
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'File path' },
        line: { type: 'number', description: 'Line number' },
        contextLines: { type: 'number', description: 'Number of surrounding lines (default: 5)' }
      },
      required: ['file', 'line']
    }
  },

  // Database Tools
  {
    name: 'god_db_schema',
    description: `Get database schema information.

    Returns tables, columns, relationships, indexes.
    Supports PostgreSQL, MySQL, SQLite.`,
    inputSchema: {
      type: 'object',
      properties: {
        connectionString: { type: 'string', description: 'Database connection string (uses config if not provided)' }
      },
      required: []
    }
  },
  {
    name: 'god_db_types',
    description: `Generate TypeScript types from database schema.

    Creates interfaces matching table structure.
    Useful for type-safe database access.`,
    inputSchema: {
      type: 'object',
      properties: {
        exportFormat: { type: 'string', enum: ['interface', 'type', 'class'], description: 'TypeScript export format' },
        addNullable: { type: 'boolean', description: 'Add null types for nullable columns' },
        addOptional: { type: 'boolean', description: 'Make nullable fields optional' }
      },
      required: []
    }
  },

  // Profiler Tools
  {
    name: 'god_profile_start',
    description: `Start CPU profiling a script.

    Records execution time per function.
    Use god_profile_stop to get results.`,
    inputSchema: {
      type: 'object',
      properties: {
        script: { type: 'string', description: 'Script to profile' },
        args: { type: 'array', items: { type: 'string' }, description: 'Script arguments' },
        duration: { type: 'number', description: 'Max duration in seconds (default: 30)' }
      },
      required: ['script']
    }
  },
  {
    name: 'god_profile_stop',
    description: `Stop profiling and get results.

    Returns profile data with execution times.`,
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'god_profile_hotspots',
    description: `Analyze profile for performance hotspots.

    Identifies slowest functions.
    Provides optimization suggestions.`,
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },

  // Documentation Tools
  {
    name: 'god_docs_fetch',
    description: `Fetch documentation from a URL.

    Downloads and parses documentation.
    Caches for future use.`,
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Documentation URL to fetch' }
      },
      required: ['url']
    }
  },
  {
    name: 'god_docs_search',
    description: `Search cached documentation.

    Find relevant docs by keyword.
    Can fetch package docs from npm.`,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        package: { type: 'string', description: 'Package name to search docs for' }
      },
      required: ['query']
    }
  },

  // Wolfram Alpha Tools
  {
    name: 'god_wolfram_query',
    description: `Query Wolfram Alpha computational knowledge engine.

    Use for:
    - Complex math (calculus, algebra, differential equations)
    - Unit conversions
    - Scientific calculations
    - Data lookups (weather, stocks, geography)

    Returns deterministic, verified results - not hallucinated.`,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language query (e.g., "integrate x^2 sin(x) dx")' }
      },
      required: ['query']
    }
  },
  {
    name: 'god_wolfram_calculate',
    description: `Quick calculation via Wolfram Alpha.

    Returns just the result string for simple calculations.`,
    inputSchema: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'Math expression to calculate' }
      },
      required: ['expression']
    }
  },
  {
    name: 'god_wolfram_solve',
    description: `Solve an equation via Wolfram Alpha.

    Finds all roots including complex numbers.`,
    inputSchema: {
      type: 'object',
      properties: {
        equation: { type: 'string', description: 'Equation to solve (e.g., "x^3 - 4x + 2 = 0")' }
      },
      required: ['equation']
    }
  },
  {
    name: 'god_wolfram_convert',
    description: `Unit conversion via Wolfram Alpha.

    Converts between any units with current rates.`,
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'number', description: 'Value to convert' },
        fromUnit: { type: 'string', description: 'Source unit (e.g., "USD", "miles", "kg")' },
        toUnit: { type: 'string', description: 'Target unit (e.g., "EUR", "km", "lbs")' }
      },
      required: ['value', 'fromUnit', 'toUnit']
    }
  },

  // Capabilities Status
  {
    name: 'god_capabilities_status',
    description: `Get status of all capabilities.

    Shows which capabilities are enabled and initialized.
    Useful for debugging capability issues.`,
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },

  // Ollama Status
  {
    name: 'god_ollama_status',
    description: `Check Ollama cloud API status and configuration.

    Shows:
    - Whether Ollama is configured as the engineer provider
    - Endpoint URL and model name
    - API key presence
    - Availability status (connectivity test)

    Use this to verify Ollama integration before running multi-component tasks.`,
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },

  // ==========================================================================
  // Code Review Tools
  // ==========================================================================
  {
    name: 'god_review',
    description: `Perform automated code review on files.

    Reviews code for:
    - Security vulnerabilities (OWASP Top 10)
    - Style/lint issues (ESLint integration)
    - Type errors (TypeScript)
    - Logic issues

    Returns detailed issues with severity, location, and suggested fixes.`,
    inputSchema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Files to review (relative paths)'
        },
        type: {
          type: 'string',
          enum: ['full', 'security', 'style', 'logic', 'quick', 'pre-commit'],
          description: 'Type of review to perform'
        },
        diff: { type: 'string', description: 'Git diff to review' },
        description: { type: 'string', description: 'Commit message or description' },
        baseBranch: { type: 'string', description: 'Base branch for comparison' },
        targetBranch: { type: 'string', description: 'Target branch' }
      },
      required: ['files']
    }
  },
  {
    name: 'god_quick_review',
    description: `Quick code review for pre-commit checks.

    Fast review that only checks for critical and high-severity issues.
    Returns pass/fail status suitable for git hooks.`,
    inputSchema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Files to review'
        }
      },
      required: ['files']
    }
  },
  {
    name: 'god_security_review',
    description: `Security-focused code review.

    Scans code for security vulnerabilities including:
    - SQL injection
    - XSS vulnerabilities
    - Hardcoded secrets
    - Cryptographic failures
    - Authentication issues
    - SSRF and CSRF

    Based on OWASP Top 10 2021.`,
    inputSchema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Files to scan for security issues'
        }
      },
      required: ['files']
    }
  },
  {
    name: 'god_review_config',
    description: `Configure code review settings.

    Customize which checks are enabled and their thresholds.`,
    inputSchema: {
      type: 'object',
      properties: {
        security: { type: 'boolean', description: 'Enable security scanning' },
        style: { type: 'boolean', description: 'Enable style checking' },
        logic: { type: 'boolean', description: 'Enable logic review' },
        tests: { type: 'boolean', description: 'Enable test coverage check' },
        blockingSeverity: {
          type: 'string',
          enum: ['critical', 'high', 'medium', 'low', 'info'],
          description: 'Minimum severity to block'
        },
        maxIssues: { type: 'number', description: 'Maximum issues before blocking' },
        sensitivePatterns: {
          type: 'array',
          items: { type: 'string' },
          description: 'File patterns to flag as sensitive'
        }
      },
      required: []
    }
  },

  // =========================================================================
  // Notification Tools
  // =========================================================================
  {
    name: 'god_notify',
    description: `Send a notification via console, Slack, Discord, or webhooks.

    Use this to notify users about:
    - Task completion
    - Blocked tasks requiring attention
    - Decisions needed
    - Code reviews ready
    - Errors and escalations`,
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['complete', 'blocked', 'decision', 'review_ready', 'progress', 'error', 'escalation', 'approval', 'info'],
          description: 'Notification type'
        },
        urgency: {
          type: 'string',
          enum: ['low', 'normal', 'high', 'critical'],
          description: 'Urgency level (default: normal)'
        },
        title: { type: 'string', description: 'Notification title' },
        message: { type: 'string', description: 'Notification message' },
        taskId: { type: 'string', description: 'Associated task ID' },
        task: { type: 'string', description: 'Task description' },
        summary: { type: 'string', description: 'Short summary' },
        context: { type: 'string', description: 'Additional context' },
        actions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              url: { type: 'string' },
              style: { type: 'string', enum: ['primary', 'secondary', 'danger'] }
            },
            required: ['label']
          },
          description: 'Available actions'
        }
      },
      required: ['type', 'title', 'message']
    }
  },
  {
    name: 'god_notify_slack',
    description: `Configure Slack webhook for notifications.

    Requires a Slack webhook URL from your workspace settings.`,
    inputSchema: {
      type: 'object',
      properties: {
        webhookUrl: { type: 'string', description: 'Slack webhook URL' },
        channel: { type: 'string', description: 'Default channel' },
        username: { type: 'string', description: 'Bot username' },
        iconEmoji: { type: 'string', description: 'Bot icon emoji' },
        enabled: { type: 'boolean', description: 'Enable Slack notifications' }
      },
      required: ['webhookUrl']
    }
  },
  {
    name: 'god_notify_discord',
    description: `Configure Discord webhook for notifications.

    Requires a Discord webhook URL from your server settings.`,
    inputSchema: {
      type: 'object',
      properties: {
        webhookUrl: { type: 'string', description: 'Discord webhook URL' },
        username: { type: 'string', description: 'Bot username' },
        avatarUrl: { type: 'string', description: 'Bot avatar URL' },
        enabled: { type: 'boolean', description: 'Enable Discord notifications' }
      },
      required: ['webhookUrl']
    }
  },
  {
    name: 'god_notify_preferences',
    description: `Configure notification preferences.

    Control which events trigger notifications and minimum urgency level.`,
    inputSchema: {
      type: 'object',
      properties: {
        onComplete: { type: 'boolean', description: 'Notify on task completion' },
        onBlocked: { type: 'boolean', description: 'Notify when blocked' },
        onDecision: { type: 'boolean', description: 'Notify when decision needed' },
        onReviewReady: { type: 'boolean', description: 'Notify when review ready' },
        onProgress: { type: 'boolean', description: 'Notify on progress' },
        onError: { type: 'boolean', description: 'Notify on errors' },
        minUrgency: {
          type: 'string',
          enum: ['low', 'normal', 'high', 'critical'],
          description: 'Minimum urgency to notify'
        }
      },
      required: []
    }
  },
  {
    name: 'god_notify_test',
    description: `Send a test notification to verify configuration.

    Sends a test message to all configured channels.`,
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'god_notify_history',
    description: `Get recent notification history.

    Returns recent notifications sent with their status.`,
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum notifications to return (default: 20)' }
      },
      required: []
    }
  },

  // =========================================================================
  // Deep Work Mode Tools (Stage 8)
  // =========================================================================
  {
    name: 'god_deepwork_start',
    description: `Start a deep work session for focused task execution.

    Deep work mode provides:
    - Smart notification batching based on focus level
    - Progress checkpointing for crash recovery
    - Detailed work logging for transparency

    Focus levels:
    - shallow: All notifications enabled
    - normal: Batch non-urgent, allow blockers/completions
    - deep: Only critical/urgent + completions

    Session starts automatically with god_codex_do, but you can also
    start manually to configure settings before task submission.`,
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID to associate (optional)' },
        focusLevel: {
          type: 'string',
          enum: ['shallow', 'normal', 'deep'],
          description: 'Focus level (default: normal)'
        },
        allowProgress: { type: 'boolean', description: 'Allow progress notifications' },
        allowBlocked: { type: 'boolean', description: 'Allow blocked notifications' },
        allowComplete: { type: 'boolean', description: 'Allow completion notifications' },
        allowUrgent: { type: 'boolean', description: 'Allow urgent notifications' },
        batchNonUrgent: { type: 'boolean', description: 'Batch non-urgent notifications' }
      },
      required: []
    }
  },
  {
    name: 'god_deepwork_pause',
    description: `Pause the current deep work session.

    Pausing preserves session state and stops active time tracking.
    Use god_deepwork_resume to continue.`,
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'god_deepwork_resume',
    description: `Resume a paused deep work session.

    Continues tracking from where you left off.`,
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'god_deepwork_status',
    description: `Get current deep work session status.

    Returns:
    - Session info (ID, status, focus level)
    - Progress (completed/remaining subtasks)
    - Recent activity log
    - Pending decisions and blockers
    - Active time and ETA`,
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'god_deepwork_log',
    description: `Get the work log from the current or historical session.

    Shows chronological log of all activities:
    - Task/subtask start/complete
    - Progress updates
    - Decisions made
    - Blockers encountered
    - Errors`,
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID (optional, defaults to current)' },
        limit: { type: 'number', description: 'Maximum entries to return' }
      },
      required: []
    }
  },
  {
    name: 'god_deepwork_checkpoint',
    description: `Create a manual checkpoint in the current session.

    Checkpoints save progress state for recovery and provide
    milestone markers in the work log.

    Checkpoints are also created automatically:
    - After task decomposition
    - Every 3 completed subtasks
    - On integration subtasks`,
    inputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Checkpoint summary/description' }
      },
      required: ['summary']
    }
  },

  // =========================================================================
  // Configuration Tools (Stage 9 - Polish & Configuration)
  // =========================================================================
  {
    name: 'god_config_get',
    description: `Get current RUBIX configuration.

    Returns all configuration settings or a specific section:
    - escalation: Escalation behavior settings
    - workMode: Notification and deep work settings
    - playwright: Browser automation settings
    - review: Code review settings
    - notifications: Notification channel settings
    - memory: Memory retention settings
    - all: Complete configuration (default)

    Configuration can be customized via codex.yaml file.`,
    inputSchema: {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          enum: ['escalation', 'workMode', 'playwright', 'review', 'notifications', 'memory', 'all'],
          description: 'Configuration section to retrieve (default: all)'
        }
      },
      required: []
    }
  },
  {
    name: 'god_config_set',
    description: `Update RUBIX configuration.

    Modify specific configuration values without affecting others.
    Changes take effect immediately.

    Example usage:
    - Set max attempts: { escalation: { maxAttemptsBeforeEscalate: 5 } }
    - Enable Slack: { notifications: { slack: { webhookUrl: "..." } } }
    - Increase timeout: { playwright: { timeout: 60000 } }

    Changes are NOT automatically saved to file. Use god_config_save to persist.`,
    inputSchema: {
      type: 'object',
      properties: {
        escalation: {
          type: 'object',
          properties: {
            maxAttemptsBeforeEscalate: { type: 'number', minimum: 1, maximum: 10 },
            autonomousDecisions: { type: 'array', items: { type: 'string' } },
            requireApproval: { type: 'array', items: { type: 'string' } }
          }
        },
        workMode: {
          type: 'object',
          properties: {
            notifyOnProgress: { type: 'boolean' },
            notifyOnComplete: { type: 'boolean' },
            notifyOnBlocked: { type: 'boolean' },
            batchDecisions: { type: 'boolean' },
            deepWorkDefault: { type: 'boolean' }
          }
        },
        playwright: {
          type: 'object',
          properties: {
            defaultMode: { type: 'string', enum: ['headless', 'visible'] },
            screenshotOnFailure: { type: 'boolean' },
            captureConsole: { type: 'boolean' },
            timeout: { type: 'number', minimum: 1000, maximum: 300000 }
          }
        },
        review: {
          type: 'object',
          properties: {
            autoReview: { type: 'boolean' },
            securityScan: { type: 'boolean' },
            requireHumanReview: { type: 'array', items: { type: 'string' } },
            autoApproveIf: { type: 'array', items: { type: 'string' } }
          }
        },
        notifications: {
          type: 'object',
          properties: {
            console: { type: 'boolean' },
            slack: {
              type: 'object',
              properties: {
                webhookUrl: { type: 'string' },
                channel: { type: 'string' },
                username: { type: 'string' },
                iconEmoji: { type: 'string' }
              },
              required: ['webhookUrl']
            },
            discord: {
              type: 'object',
              properties: {
                webhookUrl: { type: 'string' },
                username: { type: 'string' },
                avatarUrl: { type: 'string' }
              },
              required: ['webhookUrl']
            }
          }
        },
        memory: {
          type: 'object',
          properties: {
            storeFailures: { type: 'boolean' },
            storeSuccesses: { type: 'boolean' },
            pruneAfterDays: { type: 'number', minimum: 1 }
          }
        }
      },
      required: []
    }
  },
  {
    name: 'god_config_load',
    description: `Load configuration from a YAML file.

    Searches for codex.yaml in current directory and parent directories.
    Optionally specify a custom path.

    Supported file names (searched in order):
    - codex.yaml
    - codex.yml
    - .codex.yaml
    - .codex.yml

    See codex.yaml.example for configuration format.`,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to codex.yaml (searches if not provided)' }
      },
      required: []
    }
  },
  {
    name: 'god_config_save',
    description: `Save current configuration to a YAML file.

    Writes the complete current configuration to file.
    Uses the loaded file path by default, or specify a custom path.

    Includes comments explaining each setting for easy editing.`,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to save configuration to (default: original load path or codex.yaml)' }
      },
      required: []
    }
  },
  {
    name: 'god_config_reset',
    description: `Reset configuration to default values.

    Restores all settings to their default values:
    - escalation.maxAttemptsBeforeEscalate: 3
    - workMode.deepWorkDefault: true
    - playwright.defaultMode: headless
    - review.autoReview: true
    - notifications.console: true
    - memory.pruneAfterDays: 90

    Does NOT save to file automatically. Use god_config_save to persist.`,
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },

  // =========================================================================
  // Failure Learning Tools (Stage 7)
  // =========================================================================
  {
    name: 'god_failure_record',
    description: `Record a failure in RUBIX failure memory.

    Stores failure with semantic tags for later retrieval.
    Automatically provides low-quality feedback to Sona learning.

    Use this to record:
    - Subtask failures with approach and error details
    - Console errors and stack traces
    - Context about what was being attempted

    Tags are automatically added: failure, codex, error:{type}, subtask:{type}`,
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID' },
        subtaskId: { type: 'string', description: 'Subtask ID' },
        attemptNumber: { type: 'number', description: 'Attempt number' },
        approach: { type: 'string', description: 'Approach that was tried' },
        error: { type: 'string', description: 'Error message' },
        errorType: {
          type: 'string',
          enum: ['syntax', 'type', 'runtime', 'test', 'integration', 'timeout', 'unknown'],
          description: 'Error type classification'
        },
        consoleErrors: {
          type: 'array',
          items: { type: 'string' },
          description: 'Console errors'
        },
        screenshot: { type: 'string', description: 'Screenshot path' },
        stackTrace: { type: 'string', description: 'Stack trace' },
        context: { type: 'string', description: 'Failure context' },
        subtaskType: { type: 'string', description: 'Subtask type' }
      },
      required: ['taskId', 'subtaskId', 'attemptNumber', 'approach', 'error', 'errorType', 'context', 'subtaskType']
    }
  },
  {
    name: 'god_failure_query',
    description: `Query for similar past failures.

    Uses semantic search to find failures with similar errors.
    Returns:
    - Similar failures found
    - Approaches to avoid (failed before)
    - Recommended approaches (worked before)

    Use before attempting a fix to learn from past mistakes.`,
    inputSchema: {
      type: 'object',
      properties: {
        error: { type: 'string', description: 'Error message to find similar failures for' },
        context: { type: 'string', description: 'Context to improve matching' },
        topK: { type: 'number', description: 'Maximum results (default: 10)' },
        minScore: { type: 'number', description: 'Minimum similarity score (default: 0.5)' }
      },
      required: ['error']
    }
  },
  {
    name: 'god_failure_resolve',
    description: `Mark a failure as resolved with successful approach.

    Records the resolution in failure memory.
    Provides high-quality feedback to Sona learning.
    Updates pattern cache with successful fix.

    Call this when a previously failed subtask succeeds.`,
    inputSchema: {
      type: 'object',
      properties: {
        failureId: { type: 'string', description: 'Failure ID to resolve' },
        approach: { type: 'string', description: 'Approach that resolved the failure' }
      },
      required: ['failureId', 'approach']
    }
  },
  {
    name: 'god_failure_stats',
    description: `Get failure learning statistics.

    Shows:
    - Total failures recorded
    - Resolved vs unresolved failures
    - Unique error patterns
    - Error type breakdown
    - Failures by subtask type

    Use to monitor failure patterns and learning effectiveness.`,
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },

  // =========================================================================
  // Communication Tools (Stage 10 - Escalation Fallback)
  // =========================================================================
  {
    name: 'god_comms_setup',
    description: `Configure RUBIX escalation communication channels.

    Setup multi-channel escalation with fallback chain:
    Phone -> SMS -> Slack -> Discord -> Email

    Each channel has a 5-minute timeout before trying the next.
    RUBIX will try each channel until you respond.

    Modes:
    - "wizard": Show setup instructions (default)
    - "status": Show current configuration status
    - "test": Test all configured channels
    - "set": Configure a specific channel
    - "disable": Disable a specific channel
    - "order": Set fallback order

    Examples:
      god_comms_setup mode="status"
      god_comms_setup mode="set" channel="phone" config={ phoneNumber: "+15551234567", provider: "callme" }
      god_comms_setup mode="order" fallbackOrder=["slack", "sms", "email"]
      god_comms_setup mode="test"`,
    inputSchema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['wizard', 'status', 'test', 'set', 'disable', 'order', 'enable'],
          description: 'Setup mode'
        },
        channel: {
          type: 'string',
          enum: ['phone', 'sms', 'slack', 'discord', 'email'],
          description: 'Channel to configure (for set/disable modes)'
        },
        config: {
          type: 'object',
          description: 'Channel-specific configuration object'
        },
        fallbackOrder: {
          type: 'array',
          items: { type: 'string' },
          description: 'New fallback order (for order mode)'
        }
      },
      required: []
    }
  },
  {
    name: 'god_comms_escalate',
    description: `Manually trigger an escalation through the communication chain.

    Sends an escalation message through the configured fallback chain.
    Blocks until a response is received or all channels are exhausted.

    Use this to test the escalation flow or manually ask the user a question.`,
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Escalation title' },
        message: { type: 'string', description: 'Message to send' },
        type: {
          type: 'string',
          enum: ['clarification', 'decision', 'blocked', 'approval'],
          description: 'Escalation type'
        },
        options: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              description: { type: 'string' }
            }
          },
          description: 'Response options to present'
        }
      },
      required: ['title', 'message']
    }
  },

  {
    name: 'god_afk',
    description: `Read or toggle AFK (Away From Keyboard) mode.

    When AFK is ON, all interactions route through Telegram:
    - Tool permission requests (Allow/Deny buttons)
    - Questions and escalations
    - Notifications

    When AFK is OFF, everything stays in CLI (normal operation).

    Actions:
    - "status": Check current AFK state (default)
    - "toggle": Toggle AFK on/off
    - "on": Force AFK on
    - "off": Force AFK off`,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'toggle', 'on', 'off'],
          description: 'Action to perform (default: status)'
        }
      },
      required: []
    }
  },

  // ==========================================
  // Inter-Instance Communication Tools
  // ==========================================

  {
    name: 'god_comms_heartbeat',
    description: `Register this instance's identity and update presence.

    MUST be called before any other god_comms_* tool (except god_comms_peers).
    Sets the instance ID for the current MCP server process.

    Call periodically to maintain presence in the instance registry.`,
    inputSchema: {
      type: 'object',
      properties: {
        instanceId: { type: 'string', description: 'Instance identifier (e.g., "instance_1", "instance_2")' },
        name: { type: 'string', description: 'Display name for this instance (e.g., "Forge", "Axis", "Trace", "Loom")' },
        role: { type: 'string', description: 'Instance role (e.g., "orchestrator", "worker")' },
        metadata: { type: 'object', description: 'Arbitrary JSON metadata about this instance' }
      },
      required: ['instanceId']
    }
  },
  {
    name: 'god_comms_send',
    description: `Send a message to a specific instance.

    Requires god_comms_heartbeat to be called first.
    Use god_comms_broadcast for messages to all instances.

    Message types:
    - task: Assign work to another instance
    - status: Report progress or completion
    - question: Ask another instance something
    - response: Reply to a question
    - notification: Informational alert
    - handoff: Transfer responsibility`,
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient instance ID' },
        type: {
          type: 'string',
          enum: ['task', 'status', 'question', 'response', 'notification', 'handoff'],
          description: 'Message type'
        },
        priority: { type: 'number', enum: [0, 1, 2], description: '0=normal, 1=high, 2=urgent' },
        subject: { type: 'string', description: 'Short subject line' },
        payload: { description: 'Message content (any JSON-serializable value)' },
        threadId: { type: 'string', description: 'Thread ID for reply threading (use original message ID)' },
        expiresInMs: { type: 'number', description: 'Auto-expire after this many milliseconds' }
      },
      required: ['to', 'type', 'payload']
    }
  },
  {
    name: 'god_comms_broadcast',
    description: `Broadcast a message to all instances.

    Requires god_comms_heartbeat to be called first.
    Each recipient tracks read/ack state independently.`,
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['task', 'status', 'question', 'response', 'notification', 'handoff'],
          description: 'Message type'
        },
        priority: { type: 'number', enum: [0, 1, 2], description: '0=normal, 1=high, 2=urgent' },
        subject: { type: 'string', description: 'Short subject line' },
        payload: { description: 'Message content (any JSON-serializable value)' },
        expiresInMs: { type: 'number', description: 'Auto-expire after this many milliseconds' }
      },
      required: ['type', 'payload']
    }
  },
  {
    name: 'god_comms_inbox',
    description: `Check inbox for unread messages (direct + broadcasts).

    Requires god_comms_heartbeat to be called first.
    Returns messages sorted by priority (desc) then time (newest first).
    Does not include messages sent by this instance.`,
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['task', 'status', 'question', 'response', 'notification', 'handoff'],
          description: 'Filter by message type'
        },
        from: { type: 'string', description: 'Filter by sender instance ID' },
        priority: { type: 'number', enum: [0, 1, 2], description: 'Minimum priority filter' },
        threadId: { type: 'string', description: 'Filter by thread ID' },
        limit: { type: 'number', description: 'Max messages to return (default: 50)' },
        includeRead: { type: 'boolean', description: 'Include already-read messages (default: false)' }
      },
      required: []
    }
  },
  {
    name: 'god_comms_read',
    description: `Mark a message as read and return its contents.

    Requires god_comms_heartbeat to be called first.`,
    inputSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'Message ID to mark as read' }
      },
      required: ['messageId']
    }
  },
  {
    name: 'god_comms_ack',
    description: `Acknowledge a message (mark as processed).

    Requires god_comms_heartbeat to be called first.
    Acked messages are eligible for cleanup after 48 hours.`,
    inputSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'Message ID to acknowledge' }
      },
      required: ['messageId']
    }
  },
  {
    name: 'god_comms_thread',
    description: `Get a full conversation thread.

    Returns all messages in a thread, sorted chronologically.
    Includes the original message and all replies.`,
    inputSchema: {
      type: 'object',
      properties: {
        threadId: { type: 'string', description: 'Thread ID (usually the original message ID)' }
      },
      required: ['threadId']
    }
  },
  {
    name: 'god_comms_peers',
    description: `List known instances and their status.

    Shows all registered instances with their last heartbeat time,
    role, and status. Instances with no heartbeat for 10+ minutes
    are marked offline.`,
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },

  // ==========================================
  // Inter-Instance Trigger Tools
  // ==========================================

  {
    name: 'god_comms_trigger',
    description: `Spawn a new Claude Code session as another instance.

    Autonomously triggers a new Claude session with a composed prompt that includes:
    - User style preferences (from memory)
    - Instance identity directive
    - Chain depth tracking
    - The task to execute

    The spawned session gets full MCP tool access (same .claude/mcp.json).
    Results are sent back via comms when the session completes.

    Safety: chain depth limit (default 3), concurrent limit (3), self-trigger rejected.
    Set RUBIX_TRIGGER_ENABLED=false to disable entirely.

    Requires god_comms_heartbeat first.`,
    inputSchema: {
      type: 'object',
      properties: {
        targetInstance: { type: 'string', description: 'Target instance ID (e.g. "instance_2")' },
        targetName: { type: 'string', description: 'Target display name (e.g. "Axis")' },
        task: { type: 'string', description: 'Task description for the spawned session' },
        priority: { type: 'number', enum: [0, 1, 2], description: '0=normal, 1=high, 2=urgent' },
        context: { type: 'string', description: 'Optional extra context to inject into prompt' },
        chainDepth: { type: 'number', description: 'Current chain depth (0 = root trigger). Auto-incremented.' },
        maxChainDepth: { type: 'number', description: 'Override max chain depth (default: 3)' }
      },
      required: ['targetInstance', 'task']
    }
  },
  {
    name: 'god_comms_trigger_status',
    description: `Check status of trigger tasks.

    With triggerId: returns status of a specific trigger.
    Without triggerId: lists recent triggers with optional filters.

    Statuses: pending → running → completed/failed/cancelled`,
    inputSchema: {
      type: 'object',
      properties: {
        triggerId: { type: 'string', description: 'Specific trigger ID to check' },
        status: { type: 'string', enum: ['pending', 'running', 'completed', 'failed', 'cancelled'], description: 'Filter by status' },
        limit: { type: 'number', description: 'Max results (default: 20)' }
      }
    }
  },
  {
    name: 'god_comms_trigger_cancel',
    description: `Cancel a running or pending trigger session.

    Sends SIGTERM to the spawned Claude process and marks the trigger as cancelled.`,
    inputSchema: {
      type: 'object',
      properties: {
        triggerId: { type: 'string', description: 'Trigger ID to cancel' }
      },
      required: ['triggerId']
    }
  },

  // ==========================================
  // Curiosity Tools
  // ==========================================

  {
    name: 'god_curiosity_list',
    description: `List current curiosity probes.

    Shows pending, exploring, and resolved probes with priority scores.
    Probes are ranked by origin: failure(1.0) > low_confidence(0.7) > knowledge_gap(0.5) > success_confirmation(0.2)`,
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['pending', 'exploring', 'resolved', 'all'],
          description: 'Filter by status (default: pending)'
        },
        limit: {
          type: 'number',
          description: 'Max results (default: 10)'
        }
      }
    }
  },
  {
    name: 'god_curiosity_explore',
    description: `Manually trigger exploration of a curiosity probe.

    Executes the top-priority probe or a specific probe by ID.
    Uses up to 100K tokens from the exploration budget.

    NEW: Auto-detects when web browsing would help (docs, tutorials, best practices).
    When triggered, a VISIBLE browser will open so you can watch RUBIX explore.`,
    inputSchema: {
      type: 'object',
      properties: {
        probeId: {
          type: 'string',
          description: 'Specific probe ID to explore (optional, otherwise picks top priority)'
        }
      }
    }
  },
  {
    name: 'god_curiosity_web_explore',
    description: `Explore the web with a visible browser for curiosity-driven research.

    Opens a VISIBLE browser window so you can watch RUBIX:
    - Search Google and click through results
    - Visit specific URLs directly
    - Extract content from pages
    - Capture screenshots along the way

    Use this for direct control over web exploration, or let god_curiosity_explore
    auto-detect when web browsing would help.`,
    inputSchema: {
      type: 'object',
      properties: {
        searchQuery: {
          type: 'string',
          description: 'Google search query to explore'
        },
        urls: {
          type: 'array',
          items: { type: 'string' },
          description: 'Direct URLs to visit'
        },
        maxPages: {
          type: 'number',
          description: 'Maximum pages to visit (default: 3)'
        },
        selectors: {
          type: 'array',
          items: { type: 'string' },
          description: 'CSS selectors to extract content from'
        },
        storeAsProbe: {
          type: 'boolean',
          description: 'Store findings as a resolved curiosity probe (default: true)'
        }
      }
    }
  },
  {
    name: 'god_budget_status',
    description: `Check curiosity token budget status.

    Shows:
    - Probes remaining this week
    - Current cycle position (3:1 pattern)
    - Next probe type (high or moderate priority)
    - Weekly reset date`,
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'god_budget_history',
    description: `Get curiosity exploration history.

    Shows past explorations with tokens used, probe types, and outcomes.`,
    inputSchema: {
      type: 'object',
      properties: {
        weeks: {
          type: 'number',
          description: 'Number of weeks to look back (default: 4)'
        }
      }
    }
  },
  // ==========================================
  // Memory Compression Tools
  // ==========================================
  {
    name: 'god_store_compressed',
    description: `[DEPRECATED] Use god_store instead - ALL storage now compresses by default.

    This tool forwards to god_store for backwards compatibility.
    god_store now auto-compresses using positional tokens.`,
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'Human-readable content to compress and store'
        },
        type: {
          type: 'string',
          enum: ['component', 'department', 'mcp_tool', 'capability', 'workflow', 'config', 'error_pattern', 'success_pattern', 'system', 'bug_fix', 'dev_feature', 'arch_insight', 'generic'],
          description: 'Memory type for schema selection'
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for categorization'
        },
        importance: {
          type: 'number',
          description: 'Importance score 0-1'
        }
      },
      required: ['content', 'type']
    }
  },
  {
    name: 'god_query_expanded',
    description: `Query memory with automatic expansion.

    Searches for memories and expands compressed entries to human-readable format.
    Use when you want readable results from compressed storage.`,
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query'
        },
        expand: {
          type: 'boolean',
          description: 'Whether to expand compressed entries (default: true)'
        },
        topK: {
          type: 'number',
          description: 'Number of results (default: 10)'
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by tags'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'god_self_query',
    description: `Query RUBIX self-knowledge.

    Ask questions about RUBIX's own architecture and capabilities.
    Examples:
    - "What is TaskExecutor?"
    - "What departments does RUBIX have?"
    - "How does the memory system work?"
    - "What MCP tools are available?"

    Format options:
    - tokens: Raw token format (efficient storage)
    - readable: Human-readable summary (default)
    - full: Detailed formatted output with boxes`,
    inputSchema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'Question about RUBIX architecture or capabilities'
        },
        format: {
          type: 'string',
          enum: ['tokens', 'readable', 'full'],
          description: 'Output format (default: readable)'
        },
        topK: {
          type: 'number',
          description: 'Number of relevant entries to return (default: 5)'
        }
      },
      required: ['question']
    }
  },
  {
    name: 'god_compression_stats',
    description: `Get memory compression statistics.

    Shows:
    - Total compressed entries
    - Average compression ratio
    - Estimated tokens saved
    - Breakdown by memory type`,
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'god_bootstrap_status',
    description: `Check self-knowledge bootstrap status.

    Shows whether RUBIX has embedded its own architecture as memories.
    If not bootstrapped, can trigger bootstrap.`,
    inputSchema: {
      type: 'object',
      properties: {
        runBootstrap: {
          type: 'boolean',
          description: 'If true and not bootstrapped, run bootstrap now'
        }
      }
    }
  },
  {
    name: 'god_recompress_all',
    description: `Compress all uncompressed memory entries.

    Finds all entries WITHOUT the 'compressed' tag and runs them through
    the compression engine. Already-compressed entries are skipped.

    Options:
    - dryRun: true = Preview what would be compressed without actually doing it
    - batchSize: Number of entries to process per batch (default: 50)

    Returns:
    - totalEntries: Total entries in database
    - alreadyCompressed: Entries skipped (already have 'compressed' tag)
    - newlyCompressed: Entries compressed this run
    - failed: Entries that failed to compress
    - tokensSaved: Estimated tokens saved from new compressions`,
    inputSchema: {
      type: 'object',
      properties: {
        dryRun: {
          type: 'boolean',
          description: 'If true, only report what would be compressed without actually compressing'
        },
        batchSize: {
          type: 'number',
          description: 'Entries to process per batch (default: 50)',
          minimum: 1,
          maximum: 200
        }
      }
    }
  },
  // AutoRecall (Centralized Brain)
  {
    name: 'god_autorecall_config',
    description: `Configure the AutoRecall system (centralized brain).

    AutoRecall automatically queries memory before processing any tool call,
    injecting relevant context into task execution. This makes the system
    work as a true centralized brain that never forgets.

    Options:
    - enabled: Enable/disable AutoRecall
    - topK: Number of memories to recall (default: 5)
    - minScore: Minimum similarity score (default: 0.3)
    - debug: Enable debug logging

    With compressed memories, always-on recall is essentially free (~250 tokens per request).`,
    inputSchema: {
      type: 'object',
      properties: {
        enabled: {
          type: 'boolean',
          description: 'Enable/disable AutoRecall'
        },
        topK: {
          type: 'number',
          description: 'Number of memories to recall (default: 5)',
          minimum: 1,
          maximum: 20
        },
        minScore: {
          type: 'number',
          description: 'Minimum similarity score (default: 0.3)',
          minimum: 0,
          maximum: 1
        },
        debug: {
          type: 'boolean',
          description: 'Enable debug logging'
        }
      }
    }
  },
  {
    name: 'god_autorecall_status',
    description: `Get AutoRecall system status and configuration.

    Shows:
    - Whether AutoRecall is enabled
    - Current configuration (topK, minScore, debug)
    - Number of excluded tools
    - Last recall result (if any)`,
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'god_recall_feedback',
    description: `Provide feedback on AutoRecall results to improve MemRL Q-values.

    Score 1-10 indicates how useful the recalled memories were:
    - 1-3: Irrelevant noise, no value
    - 4-6: Somewhat helpful, partial value
    - 7-9: Directly relevant, high value
    - 10: Perfect recall, exactly what was needed

    Auto-rating: Claude can automatically rate recalls during task execution.
    Override: Users can provide manual ratings via Telegram to calibrate learning.

    Tracks disagreements (|auto - human| >= 3) for calibration learning.`,
    inputSchema: {
      type: 'object',
      properties: {
        score: {
          type: 'number',
          description: 'How useful were the recalled memories? 1=useless, 10=perfect',
          minimum: 1,
          maximum: 10
        },
        queryId: {
          type: 'string',
          description: 'Optional: specific queryId. If omitted, uses last AutoRecall query'
        },
        auto: {
          type: 'boolean',
          description: 'True if auto-rated by Claude, false if human override',
          default: false
        }
      },
      required: ['score']
    }
  },
  // Reflexion Tools (Verbal Reflexion System)
  {
    name: 'god_reflexion_query',
    description: `Search past reflections for lessons learned.

    Reflexions contain Claude-generated "why did this fail" analysis:
    - Root cause identification
    - Generalizable lessons
    - Recommended approaches for similar situations

    Use before attempting a fix to learn from past failures.`,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query for past reflections' },
        topK: { type: 'number', minimum: 1, maximum: 50, description: 'Number of results (default: 10)' },
        minSimilarity: { type: 'number', minimum: 0, maximum: 1, description: 'Minimum similarity score (default: 0.5)' }
      },
      required: ['query']
    }
  },
  {
    name: 'god_reflexion_generate',
    description: `Manually trigger reflection generation for a failure.

    Generates Claude-powered verbal analysis of WHY a failure occurred:
    - Root cause analysis
    - What should have been done differently
    - Lessons for future similar situations

    Normally called automatically by SelfHealer, but can be triggered manually.`,
    inputSchema: {
      type: 'object',
      properties: {
        failureId: { type: 'string', description: 'Failure memory ID to generate reflection for' },
        taskDescription: { type: 'string', description: 'Description of the task that failed' },
        subtaskDescription: { type: 'string', description: 'Description of the subtask that failed' },
        previousAttempts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              approach: { type: 'string' },
              error: { type: 'string' }
            }
          },
          description: 'Previous failed attempts'
        }
      },
      required: ['failureId']
    }
  },
  {
    name: 'god_reflexion_stats',
    description: `Get statistics about the reflexion system.

    Shows:
    - Total reflections generated
    - Root cause category breakdown
    - Average tokens used per reflection
    - Lessons applied count`,
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  // Agent Card Tool (A2A Discovery)
  {
    name: 'god_agent_card',
    description: `Get the RUBIX Agent Card for A2A capability discovery.

    Returns a structured description of all RUBIX capabilities including:
    - Tool definitions with input/output schemas
    - Estimated token costs per operation
    - Capability categories and tags

    Useful for agent-to-agent communication and capability negotiation.`,
    inputSchema: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          enum: ['full', 'summary', 'capabilities'],
          description: 'Output format (default: full)'
        },
        includeSchemas: {
          type: 'boolean',
          description: 'Include JSON schemas for inputs/outputs (default: false)'
        }
      }
    }
  },
  // Guardian Tool (Post-Execution Audit)
  {
    name: 'god_guardian_audit',
    description: `Manually trigger post-execution audit on files.

    Runs comprehensive audits on specified files:
    - Security scan (OWASP Top 10)
    - Type checking (TypeScript)
    - Lint checking (ESLint)
    - Quality analysis

    Returns issues with severity and rollback recommendations.`,
    inputSchema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Files to audit'
        },
        auditTypes: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['security', 'regression', 'quality', 'types', 'lint']
          },
          description: 'Types of audits to run (default: all)'
        },
        codebaseRoot: {
          type: 'string',
          description: 'Codebase root directory'
        }
      },
      required: ['files']
    }
  },

  // =========================================================================
  // Memory Distillation Tools (Proactive Lesson Extraction)
  // =========================================================================
  {
    name: 'god_distill',
    description: `Manually trigger memory distillation.

    Proactively extracts lessons from stored memories:
    - Success patterns: "When facing X, approach Y works because Z"
    - Failure→fix chains: "Error X is caused by Y, fix with Z"
    - Cross-domain insights: Transferable principles across contexts

    Options:
    - types: Which extraction types to run (default: success_pattern, failure_fix)
    - lookbackDays: How far back to look (default: 7)
    - maxTokens: Token budget for this run (default: 100000)
    - force: Run even if recent run exists
    - dryRun: Preview without storing insights

    Normally runs weekly on Sundays. Use this for manual triggering.`,
    inputSchema: {
      type: 'object',
      properties: {
        types: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['success_pattern', 'failure_fix', 'cross_domain', 'contradiction', 'consolidation']
          },
          description: 'Distillation types to run (default: success_pattern, failure_fix)'
        },
        lookbackDays: {
          type: 'number',
          description: 'Days to look back (default: 7)'
        },
        maxTokens: {
          type: 'number',
          description: 'Max tokens for this run (default: 100000)'
        },
        force: {
          type: 'boolean',
          description: 'Force run even if recent run exists'
        },
        dryRun: {
          type: 'boolean',
          description: 'Preview without storing insights'
        }
      },
      required: []
    }
  },
  {
    name: 'god_distillation_stats',
    description: `Get memory distillation statistics.

    Shows:
    - Total distillation runs and insights extracted
    - Insights breakdown by type (success_pattern, failure_fix, etc.)
    - Average confidence score
    - Total and average tokens used
    - Last run timestamp and result
    - Top insights (most referenced)
    - Pending memories since last run

    Use to monitor the distillation system effectiveness.`,
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'god_distillation_config',
    description: `Configure memory distillation settings.

    Options:
    - enabled: Enable/disable distillation (default: true)
    - schedule: Cron pattern (default: "0 3 * * 0" = Sunday 3am)
    - maxTokensPerRun: Token budget per run (default: 100000)
    - minConfidence: Threshold for storing insights (default: 0.7)
    - lookbackDays: How far back to look (default: 7)
    - types: Which distillation types to run
    - startScheduler: Start the scheduled distillation daemon
    - stopScheduler: Stop the scheduled distillation daemon

    Returns current configuration and scheduling status.`,
    inputSchema: {
      type: 'object',
      properties: {
        enabled: {
          type: 'boolean',
          description: 'Enable/disable distillation'
        },
        schedule: {
          type: 'string',
          description: 'Cron pattern for scheduled runs'
        },
        maxTokensPerRun: {
          type: 'number',
          description: 'Max tokens per run'
        },
        minConfidence: {
          type: 'number',
          description: 'Minimum confidence to store insights (0-1)'
        },
        lookbackDays: {
          type: 'number',
          description: 'Days to look back for memories'
        },
        types: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['success_pattern', 'failure_fix', 'cross_domain', 'contradiction', 'consolidation']
          },
          description: 'Distillation types to enable'
        },
        startScheduler: {
          type: 'boolean',
          description: 'Start the scheduled distillation daemon'
        },
        stopScheduler: {
          type: 'boolean',
          description: 'Stop the scheduled distillation daemon'
        }
      },
      required: []
    }
  },
  {
    name: 'god_distillation_query',
    description: `Query for distilled insights.

    Searches stored insights by semantic similarity.
    Returns:
    - Matching insights with similarity scores
    - Applicable lessons for your context
    - Relevant patterns
    - Caveats to be aware of

    Use when starting a new task to leverage past learnings.`,
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query for insights'
        },
        topK: {
          type: 'number',
          description: 'Number of results (default: 10)'
        },
        type: {
          type: 'string',
          enum: ['success_pattern', 'failure_fix', 'cross_domain', 'contradiction', 'consolidation'],
          description: 'Filter by insight type'
        },
        minConfidence: {
          type: 'number',
          description: 'Minimum confidence (default: 0.5)'
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by tags'
        }
      },
      required: ['query']
    }
  }
];

// ==========================================
// Source Type Mapping
// ==========================================

function parseSource(source?: string): MemorySource {
  switch (source) {
    case 'user_input': return MemorySource.USER_INPUT;
    case 'agent_inference': return MemorySource.AGENT_INFERENCE;
    case 'tool_output': return MemorySource.TOOL_OUTPUT;
    case 'system': return MemorySource.SYSTEM;
    case 'external': return MemorySource.EXTERNAL;
    default: return MemorySource.AGENT_INFERENCE;
  }
}

function parseCausalType(type: string): CausalRelationType {
  switch (type) {
    case 'causes': return CausalRelationType.CAUSES;
    case 'enables': return CausalRelationType.ENABLES;
    case 'prevents': return CausalRelationType.PREVENTS;
    case 'correlates': return CausalRelationType.CORRELATES;
    case 'precedes': return CausalRelationType.PRECEDES;
    case 'triggers': return CausalRelationType.TRIGGERS;
    default: return CausalRelationType.CAUSES;
  }
}

// ==========================================
// MCP Server
// ==========================================

class GodAgentMCPServer {
  private server: Server;
  private engine: MemoryEngine | null = null;
  private scheduler: SchedulerDaemon | null = null;
  private playwright: PlaywrightManager | null = null;
  private verificationService: VerificationService | null = null;
  private taskExecutor: TaskExecutor | null = null;
  private capabilities: CapabilitiesManager | null = null;
  private reviewer: CodeReviewer | null = null;
  private notifications: NotificationService | null = null;
  private failureService: FailureMemoryService | null = null;
  private configManager: ConfigurationManager;
  private communications: CommunicationManager | null = null;
  private wolfram: WolframManager | null = null;
  private dataDir: string;
  // Project context (multi-project support)
  private projectRoot: string;
  private projectName: string;
  private projectContextStored: boolean = false;
  // Curiosity system
  private curiosityTracker: CuriosityTracker | null = null;
  private tokenBudget: TokenBudgetManager | null = null;
  private discoveryEngine: AutonomousDiscoveryEngine | null = null;
  // LLM compression
  private llmCompressor: LLMCompressor | null = null;
  // Automated memory recall (centralized brain)
  private autoRecall: AutoRecall;
  private _currentRecallResult: RecallResult | null = null;
  // Reflexion system (verbal failure analysis)
  private reflexionService: ReflexionService | null = null;
  // Agent card (cached)
  private agentCard: AgentCard | null = null;
  // Post-execution guardian
  private postExecGuardian: PostExecGuardian | null = null;
  // Memory distillation service
  private distillationService: MemoryDistillationService | null = null;
  // Inter-instance communication
  private commsStore: CommsStore | null = null;
  private triggerService: TriggerService | null = null;
  private instanceId: string | null = null;
  private instanceName: string | null = null;
  // Learning feedback tracking (for implicit feedback from god_store)
  private lastQueryContext: { queryId: string | null; trajectoryId: string; query: string; timestamp: number } | null = null;

  constructor() {
    // Data directory: prefer RUBIX_DATA_DIR, fallback to GOD_AGENT_DATA_DIR for backwards compat
    this.dataDir = process.env.RUBIX_DATA_DIR || process.env.GOD_AGENT_DATA_DIR || './data';

    // Project context: enables multi-project support via MCP instance configuration
    this.projectRoot = process.env.RUBIX_PROJECT_ROOT || process.cwd();
    this.projectName = process.env.RUBIX_PROJECT_NAME || this.projectRoot.split(/[/\\]/).pop() || 'Unknown Project';

    // Log project configuration at startup
    console.log(`[MCP Server] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`[MCP Server] Project: ${this.projectName}`);
    console.log(`[MCP Server] Root: ${this.projectRoot}`);
    console.log(`[MCP Server] Data: ${this.dataDir}`);
    console.log(`[MCP Server] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    this.configManager = ConfigurationManager.getInstance();

    // Initialize AutoRecall (centralized brain)
    this.autoRecall = new AutoRecall({
      enabled: true,
      topK: 5,
      minScore: 0.3,
      debug: process.env.AUTORECALL_DEBUG === 'true'
    });

    // Try to load configuration from file
    try {
      this.configManager.loadConfig();
    } catch {
      // Use defaults if no config file found
    }

    this.server = new Server(
      {
        name: 'Stock_Agent_God',
        version: '0.1.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    );

    this.setupHandlers();
  }

  private async getEngine(): Promise<MemoryEngine> {
    if (!this.engine) {
      this.engine = new MemoryEngine({
        dataDir: this.dataDir
      });
      await this.engine.initialize();

      // Wire AutoRecall to the engine (enables centralized brain from any entry point)
      this.autoRecall.setEngine(this.engine);

      // Log core brain configuration status
      const coreBrainDataDir = process.env.RUBIX_CORE_BRAIN_DATA_DIR;
      if (coreBrainDataDir) {
        console.log(`[MCP Server] Core brain configured: ${coreBrainDataDir}`);
        try {
          const { CoreBrainConnector } = await import('./core/CoreBrainConnector.js');
          const connector = new CoreBrainConnector(coreBrainDataDir);
          if (await connector.isAvailable()) {
            console.log('[MCP Server] ✓ Core brain connection verified');
          } else {
            console.warn('[MCP Server] ⚠ Core brain configured but unavailable');
          }
        } catch (error) {
          console.warn('[MCP Server] ⚠ Core brain connection failed:', error);
        }
      } else {
        console.log('[MCP Server] Core brain not configured (set RUBIX_CORE_BRAIN_DATA_DIR to enable shared knowledge)');
      }

      // Store project context in high-priority memory (once per session)
      // This ensures project context is always surfaced in queries via AutoRecall
      if (!this.projectContextStored) {
        const projectContext = `ACTIVE PROJECT: ${this.projectName}

**Working Directory**: ${this.projectRoot}
**Data Directory**: ${this.dataDir}
**Instance**: ${process.env.RUBIX_PROJECT_NAME ? 'multi-project' : 'default'}

All file operations are scoped to this project directory unless explicitly overridden.
This is project-specific context that persists across sessions.`;

        await this.engine.store(projectContext, {
          tags: ['project_context', 'always_recall', 'system_config'],
          importance: 1.0,
          source: MemorySource.SYSTEM,
          sessionId: 'mcp-init',
          agentId: 'system'
        });

        this.projectContextStored = true;
        console.log(`[MCP Server] Project context stored in memory (high priority)`);
      }
    }
    return this.engine;
  }

  private getLLMCompressor(): LLMCompressor {
    if (!this.llmCompressor) {
      this.llmCompressor = new LLMCompressor({
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
        model: process.env.RUBIX_MODEL || 'claude-opus-4-5-20251101',
        ollamaConfig: process.env.OLLAMA_ENDPOINT ? {
          provider: 'ollama',
          model: process.env.OLLAMA_MODEL || 'qwen2.5-coder:32b',
          apiEndpoint: process.env.OLLAMA_ENDPOINT || 'http://localhost:11434'
        } : undefined
      });
    }
    return this.llmCompressor;
  }

  private async getScheduler(): Promise<SchedulerDaemon> {
    if (!this.scheduler) {
      const engine = await this.getEngine();
      this.scheduler = new SchedulerDaemon(engine);
    }
    return this.scheduler;
  }

  private getPlaywright(): PlaywrightManager {
    if (!this.playwright) {
      this.playwright = new PlaywrightManager({
        screenshotDir: join(this.dataDir, 'screenshots')
      });
    }
    return this.playwright;
  }

  private getVerificationService(): VerificationService {
    if (!this.verificationService) {
      this.verificationService = new VerificationService({
        screenshotDir: join(this.dataDir, 'screenshots')
      });
    }
    return this.verificationService;
  }

  private async getCapabilities(): Promise<CapabilitiesManager> {
    if (!this.capabilities) {
      this.capabilities = new CapabilitiesManager({
        projectRoot: this.projectRoot,
        // Enable all capabilities for full functionality
        lsp: { enabled: true, timeout: 30000 },
        git: { enabled: true },
        analysis: { enabled: true, eslint: true, typescript: true },
        ast: { enabled: true },
        deps: { enabled: true },
        repl: { enabled: true },      // Enable debug/REPL
        profiler: { enabled: true },  // Enable profiler
        stacktrace: { enabled: true },
        database: { enabled: false }, // Requires explicit connection
        docs: { enabled: true, cacheTTL: 3600 }
      });
      await this.capabilities.initialize();

      // Start background pre-warming of heavy capabilities
      // This is non-blocking - capabilities initialize in background
      this.capabilities.prewarm().catch(err => {
        console.error('[MCP] Capability prewarm error:', err.message);
      });
    }
    return this.capabilities;
  }

  private async getReviewer(): Promise<CodeReviewer> {
    if (!this.reviewer) {
      const engine = await this.getEngine();
      const caps = await this.getCapabilities();
      this.reviewer = new CodeReviewer(
        engine,
        process.cwd(),
        {},
        caps,
        this.playwright ?? undefined,
        this.verificationService ?? undefined
      );
    }
    return this.reviewer;
  }

  private async getNotifications(): Promise<NotificationService> {
    if (!this.notifications) {
      const engine = await this.getEngine();
      this.notifications = new NotificationService(engine);

      // Wire to task executor if available
      if (this.taskExecutor) {
        this.taskExecutor.setNotifications(this.notifications);
      }
    }
    return this.notifications;
  }

  private async getFailureService(): Promise<FailureMemoryService> {
    if (!this.failureService) {
      const engine = await this.getEngine();
      this.failureService = new FailureMemoryService(engine);
    }
    return this.failureService;
  }

  private async getCuriosityTracker(): Promise<CuriosityTracker> {
    if (!this.curiosityTracker) {
      const engine = await this.getEngine();
      this.curiosityTracker = new CuriosityTracker(engine);
    }
    return this.curiosityTracker;
  }

  private async getTokenBudget(): Promise<TokenBudgetManager> {
    if (!this.tokenBudget) {
      const engine = await this.getEngine();
      const config = getCuriosityConfig();
      this.tokenBudget = new TokenBudgetManager(
        engine,
        config.tokensPerProbe,
        config.probesPerWeek,
        config.highPriorityRatio
      );
    }
    return this.tokenBudget;
  }

  private async getDiscoveryEngine(): Promise<AutonomousDiscoveryEngine> {
    if (!this.discoveryEngine) {
      const curiosity = await this.getCuriosityTracker();
      const budget = await this.getTokenBudget();
      const llmConfig = getCodexLLMConfig();
      this.discoveryEngine = new AutonomousDiscoveryEngine({
        curiosity,
        budget,
        apiKey: llmConfig.apiKey || '',
        model: llmConfig.model,
      });
    }
    return this.discoveryEngine;
  }

  private async getReflexionService(): Promise<ReflexionService> {
    if (!this.reflexionService) {
      const engine = await this.getEngine();
      const llmConfig = getCodexLLMConfig();
      this.reflexionService = new ReflexionService(
        engine,
        llmConfig.apiKey || '',
        { model: llmConfig.model }
      );
    }
    return this.reflexionService;
  }

  private getAgentCard(_includeSchemas: boolean = false): AgentCard {
    // Regenerate if not cached or schemas option changed
    if (!this.agentCard) {
      this.agentCard = AgentCardGenerator.fromMCPTools(TOOLS as any);
    }
    return this.agentCard;
  }

  private async getPostExecGuardian(): Promise<PostExecGuardian> {
    if (!this.postExecGuardian) {
      const reviewer = await this.getReviewer();
      const caps = await this.getCapabilities();
      this.postExecGuardian = new PostExecGuardian(process.cwd(), {}, reviewer, caps);
    }
    return this.postExecGuardian;
  }

  private async getDistillationService(): Promise<MemoryDistillationService> {
    if (!this.distillationService) {
      const engine = await this.getEngine();
      const llmConfig = getCodexLLMConfig();
      this.distillationService = new MemoryDistillationService(
        engine,
        undefined, // sona (optional)
        llmConfig.apiKey || '',
        { model: llmConfig.model }
      );

      // Start scheduled distillation (weekly Sunday 3am by default)
      this.distillationService.startScheduled();
    }
    return this.distillationService;
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: TOOLS
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      // ==========================================
      // AUTORECALL: Centralized Brain Hook
      // Automatically recall relevant memories before processing any tool
      // ==========================================
      try {
        // Ensure engine is initialized for AutoRecall
        await this.getEngine();

        // Perform automated recall (skip for excluded tools like god_query, god_store)
        this._currentRecallResult = await this.autoRecall.recall(name, args);

        if (this._currentRecallResult.memories.length > 0 && process.env.AUTORECALL_DEBUG === 'true') {
          console.error(`[AutoRecall] ${name}: Recalled ${this._currentRecallResult.memories.length} memories in ${this._currentRecallResult.recallTimeMs}ms`);
        }
      } catch (recallError) {
        // AutoRecall failures should not block the request
        if (process.env.AUTORECALL_DEBUG === 'true') {
          console.error(`[AutoRecall] Error: ${recallError instanceof Error ? recallError.message : String(recallError)}`);
        }
        this._currentRecallResult = null;
      }

      try {
        switch (name) {
          case 'god_store':
            return await this.handleStore(args);
          case 'god_query':
            return await this.handleQuery(args);
          case 'god_trace':
            return await this.handleTrace(args);
          case 'god_causal':
            return await this.handleCausal(args);
          case 'god_find_paths':
            return await this.handleFindPaths(args);
          case 'god_stats':
            return await this.handleStats();
          case 'god_edit':
            return await this.handleEdit(args);
          case 'god_delete':
            return await this.handleDelete(args);
          case 'god_checkpoint':
            return await this.handleCheckpoint(args);
          case 'god_shadow_search':
            return await this.handleShadowSearch(args);
          case 'god_learn':
            return await this.handleLearn(args);
          case 'god_session_store':
            return await this.handleSessionStore(args);
          case 'god_learning_stats':
            return await this.handleLearningStats();
          case 'god_prune_patterns':
            return await this.handlePrunePatterns(args);
          case 'god_cleanup_expired':
            return await this.handleCleanupExpired(args);
          case 'god_enhance':
            return await this.handleEnhance(args);
          case 'god_enhance_batch':
            return await this.handleEnhanceBatch(args);
          case 'god_gnn_stats':
            return await this.handleGNNStats();
          case 'god_clear_gnn_cache':
            return await this.handleClearGNNCache();
          case 'god_route':
            return await this.handleRoute(args);
          case 'god_route_result':
            return await this.handleRouteResult(args);
          case 'god_routing_stats':
            return await this.handleRoutingStats();
          case 'god_circuit_status':
            return await this.handleCircuitStatus();
          case 'god_reset_circuit':
            return await this.handleResetCircuit(args);
          // Scheduler tools (Phase 9)
          case 'god_schedule':
            return await this.handleSchedule(args);
          case 'god_trigger':
            return await this.handleTrigger(args);
          case 'god_tasks':
            return await this.handleTasks(args);
          case 'god_pause':
            return await this.handlePause(args);
          case 'god_resume':
            return await this.handleResume(args);
          case 'god_cancel':
            return await this.handleCancel(args);
          case 'god_scheduler_stats':
            return await this.handleSchedulerStats();
          // Playwright tools (RUBIX)
          case 'god_pw_launch':
            return await this.handlePlaywrightLaunch(args);
          case 'god_pw_close':
            return await this.handlePlaywrightClose(args);
          case 'god_pw_navigate':
            return await this.handlePlaywrightNavigate(args);
          case 'god_pw_screenshot':
            return await this.handlePlaywrightScreenshot(args);
          case 'god_pw_action':
            return await this.handlePlaywrightAction(args);
          case 'god_pw_assert':
            return await this.handlePlaywrightAssert(args);
          case 'god_pw_console':
            return await this.handlePlaywrightConsole(args);
          case 'god_pw_verify':
            return await this.handlePlaywrightVerify(args);
          // RUBIX tools (Autonomous Developer)
          case 'god_codex_do':
            return await this.handleCodexDo(args);
          case 'god_codex_status':
            return await this.handleCodexStatus();
          case 'god_codex_answer':
            return await this.handleCodexAnswer(args);
          case 'god_codex_decision':
            return await this.handleCodexDecision(args);
          case 'god_codex_cancel':
            return await this.handleCodexCancel();
          case 'god_codex_log':
            return await this.handleCodexLog();
          case 'god_codex_logs':
            return await this.handleCodexLogs(args);
          case 'god_codex_wait':
            return await this.handleCodexWait(args);
          case 'god_codex_estimate':
            return await this.handleCodexEstimate(args);

          // Collaborative Partner Tools
          case 'god_partner_config':
            return await this.handlePartnerConfig(args);
          case 'god_partner_challenge':
            return await this.handlePartnerChallenge(args);
          case 'god_partner_status':
            return await this.handlePartnerStatus();

          // Containment Tools
          case 'god_containment_check':
            return await this.handleContainmentCheck(args);
          case 'god_containment_config':
            return await this.handleContainmentConfig(args);
          case 'god_containment_add_rule':
            return await this.handleContainmentAddRule(args);
          case 'god_containment_remove_rule':
            return await this.handleContainmentRemoveRule(args);
          case 'god_containment_status':
            return await this.handleContainmentStatus();
          case 'god_containment_session':
            return await this.handleContainmentSession(args || {});

          // Capability tools (Stage 4)
          // LSP Tools
          case 'god_lsp_start':
            return await this.handleLspStart(args);
          case 'god_lsp_stop':
            return await this.handleLspStop();
          case 'god_lsp_available':
            return await this.handleLspAvailable(args);
          case 'god_lsp_definition':
            return await this.handleLspDefinition(args);
          case 'god_lsp_references':
            return await this.handleLspReferences(args);
          case 'god_lsp_diagnostics':
            return await this.handleLspDiagnostics(args);
          case 'god_lsp_symbols':
            return await this.handleLspSymbols(args);
          // Git Tools
          case 'god_git_blame':
            return await this.handleGitBlame(args);
          case 'god_git_bisect':
            return await this.handleGitBisect(args);
          case 'god_git_history':
            return await this.handleGitHistory(args);
          case 'god_git_diff':
            return await this.handleGitDiff(args);
          case 'god_git_branches':
            return await this.handleGitBranches();
          // AST Tools
          case 'god_ast_parse':
            return await this.handleAstParse(args);
          case 'god_ast_query':
            return await this.handleAstQuery(args);
          case 'god_ast_refactor':
            return await this.handleAstRefactor(args);
          case 'god_ast_symbols':
            return await this.handleAstSymbols(args);
          // Analysis Tools
          case 'god_analyze_lint':
            return await this.handleAnalyzeLint(args);
          case 'god_analyze_types':
            return await this.handleAnalyzeTypes(args);
          case 'god_analyze_deps':
            return await this.handleAnalyzeDeps(args);
          case 'god_analyze_impact':
            return await this.handleAnalyzeImpact(args);
          // Debug Tools
          case 'god_debug_start':
            return await this.handleDebugStart(args);
          case 'god_debug_stop':
            return await this.handleDebugStop();
          case 'god_debug_breakpoint':
            return await this.handleDebugBreakpoint(args);
          case 'god_debug_step':
            return await this.handleDebugStep(args);
          case 'god_debug_eval':
            return await this.handleDebugEval(args);
          // Stack Tools
          case 'god_stack_parse':
            return await this.handleStackParse(args);
          case 'god_stack_context':
            return await this.handleStackContext(args);
          // Database Tools
          case 'god_db_schema':
            return await this.handleDbSchema(args);
          case 'god_db_types':
            return await this.handleDbTypes(args);
          // Profiler Tools
          case 'god_profile_start':
            return await this.handleProfileStart(args);
          case 'god_profile_stop':
            return await this.handleProfileStop();
          case 'god_profile_hotspots':
            return await this.handleProfileHotspots();
          // Documentation Tools
          case 'god_docs_fetch':
            return await this.handleDocsFetch(args);
          case 'god_docs_search':
            return await this.handleDocsSearch(args);
          // Wolfram Alpha Tools
          case 'god_wolfram_query':
            return await this.handleWolframQuery(args);
          case 'god_wolfram_calculate':
            return await this.handleWolframCalculate(args);
          case 'god_wolfram_solve':
            return await this.handleWolframSolve(args);
          case 'god_wolfram_convert':
            return await this.handleWolframConvert(args);
          // Capabilities Status
          case 'god_capabilities_status':
            return await this.handleCapabilitiesStatus();

          // Ollama Status
          case 'god_ollama_status':
            return await this.handleOllamaStatus();

          // Code Review
          case 'god_review':
            return await this.handleReview(args);
          case 'god_quick_review':
            return await this.handleQuickReview(args);
          case 'god_security_review':
            return await this.handleSecurityReview(args);
          case 'god_review_config':
            return await this.handleReviewConfig(args);

          // Notification Tools
          case 'god_notify':
            return await this.handleNotify(args);
          case 'god_notify_slack':
            return await this.handleNotifySlack(args);
          case 'god_notify_discord':
            return await this.handleNotifyDiscord(args);
          case 'god_notify_preferences':
            return await this.handleNotifyPreferences(args);
          case 'god_notify_test':
            return await this.handleNotifyTest();
          case 'god_notify_history':
            return await this.handleNotifyHistory(args);

          // Deep Work Mode Tools (Stage 8)
          case 'god_deepwork_start':
            return await this.handleDeepWorkStart(args);
          case 'god_deepwork_pause':
            return await this.handleDeepWorkPause();
          case 'god_deepwork_resume':
            return await this.handleDeepWorkResume();
          case 'god_deepwork_status':
            return await this.handleDeepWorkStatus();
          case 'god_deepwork_log':
            return await this.handleDeepWorkLog(args);
          case 'god_deepwork_checkpoint':
            return await this.handleDeepWorkCheckpoint(args);

          // Configuration Tools (Stage 9)
          case 'god_config_get':
            return await this.handleConfigGet(args);
          case 'god_config_set':
            return await this.handleConfigSet(args);
          case 'god_config_load':
            return await this.handleConfigLoad(args);
          case 'god_config_save':
            return await this.handleConfigSave(args);
          case 'god_config_reset':
            return await this.handleConfigReset();

          // Failure Learning Tools (Stage 7)
          case 'god_failure_record':
            return await this.handleFailureRecord(args);
          case 'god_failure_query':
            return await this.handleFailureQuery(args);
          case 'god_failure_resolve':
            return await this.handleFailureResolve(args);
          case 'god_failure_stats':
            return await this.handleFailureStats();

          // Communication Tools (Stage 10)
          case 'god_comms_setup':
            return await this.handleCommsSetup(args);
          case 'god_comms_escalate':
            return await this.handleCommsEscalate(args);
          case 'god_afk':
            return await this.handleAfk(args);

          // Inter-Instance Communication Tools
          case 'god_comms_heartbeat':
            return await this.handleCommsHeartbeat(args);
          case 'god_comms_send':
            return await this.handleCommsSend(args);
          case 'god_comms_broadcast':
            return await this.handleCommsBroadcast(args);
          case 'god_comms_inbox':
            return await this.handleCommsInbox(args);
          case 'god_comms_read':
            return await this.handleCommsRead(args);
          case 'god_comms_ack':
            return await this.handleCommsAck(args);
          case 'god_comms_thread':
            return await this.handleCommsThread(args);
          case 'god_comms_peers':
            return await this.handleCommsPeers();

          // Inter-Instance Trigger Tools
          case 'god_comms_trigger':
            return await this.handleCommsTrigger(args);
          case 'god_comms_trigger_status':
            return await this.handleCommsTriggerStatus(args);
          case 'god_comms_trigger_cancel':
            return await this.handleCommsTriggerCancel(args);

          // Curiosity Tools
          case 'god_curiosity_list':
            return await this.handleCuriosityList(args);
          case 'god_curiosity_explore':
            return await this.handleCuriosityExplore(args);
          case 'god_curiosity_web_explore':
            return await this.handleCuriosityWebExplore(args);
          case 'god_budget_status':
            return await this.handleBudgetStatus();
          case 'god_budget_history':
            return await this.handleBudgetHistory(args);

          // Memory Compression Tools
          case 'god_store_compressed':
            return await this.handleStoreCompressed(args);
          case 'god_query_expanded':
            return await this.handleQueryExpanded(args);
          case 'god_self_query':
            return await this.handleSelfQuery(args);
          case 'god_compression_stats':
            return await this.handleCompressionStats();
          case 'god_bootstrap_status':
            return await this.handleBootstrapStatus(args);
          case 'god_recompress_all':
            return await this.handleRecompressAll(args);

          // AutoRecall (Centralized Brain)
          case 'god_autorecall_config':
            return await this.handleAutoRecallConfig(args);
          case 'god_autorecall_status':
            return await this.handleAutoRecallStatus();
          case 'god_recall_feedback':
            return await this.handleRecallFeedback(args);

          // Reflexion Tools (Verbal Reflexion System)
          case 'god_reflexion_query':
            return await this.handleReflexionQuery(args);
          case 'god_reflexion_generate':
            return await this.handleReflexionGenerate(args);
          case 'god_reflexion_stats':
            return await this.handleReflexionStats();

          // Agent Card Tool (A2A Discovery)
          case 'god_agent_card':
            return await this.handleAgentCard(args);

          // Guardian Tool (Post-Execution Audit)
          case 'god_guardian_audit':
            return await this.handleGuardianAudit(args);

          // Memory Distillation Tools
          case 'god_distill':
            return await this.handleDistill(args);
          case 'god_distillation_stats':
            return await this.handleDistillationStats();
          case 'god_distillation_config':
            return await this.handleDistillationConfig(args);
          case 'god_distillation_query':
            return await this.handleDistillationQuery(args);

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: `Error: ${message}` }],
          isError: true
        };
      } finally {
        // Cleanup recall result after request completes
        this._currentRecallResult = null;
      }
    });
  }

  /**
   * Get recalled memories for current request (available to handlers)
   */
  get recalledMemories(): RecalledMemory[] {
    return this._currentRecallResult?.memories ?? [];
  }

  /**
   * Get full recall result for current request
   */
  get currentRecallResult(): RecallResult | null {
    return this._currentRecallResult;
  }

  // ===========================================================================
  // AUTORECALL HANDLERS (Centralized Brain)
  // ===========================================================================

  private async handleAutoRecallConfig(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = z.object({
      enabled: z.boolean().optional(),
      topK: z.number().min(1).max(20).optional(),
      minScore: z.number().min(0).max(1).optional(),
      debug: z.boolean().optional()
    }).parse(args);

    // Update config
    this.autoRecall.configure({
      enabled: input.enabled,
      topK: input.topK,
      minScore: input.minScore,
      debug: input.debug
    });

    const config = this.autoRecall.getConfig();

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: 'AutoRecall configuration updated',
          config: {
            enabled: config.enabled,
            topK: config.topK,
            minScore: config.minScore,
            debug: config.debug,
            excludedToolsCount: config.excludeTools.length
          }
        }, null, 2)
      }]
    };
  }

  private async handleAutoRecallStatus(): Promise<{ content: Array<{ type: string; text: string }> }> {
    const config = this.autoRecall.getConfig();
    const lastResult = this.autoRecall.getLastRecallResult();

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: config.enabled ? 'enabled' : 'disabled',
          config: {
            enabled: config.enabled,
            topK: config.topK,
            minScore: config.minScore,
            debug: config.debug,
            expandCompressed: config.expandCompressed,
            excludedToolsCount: config.excludeTools.length
          },
          lastRecall: lastResult ? {
            memoriesFound: lastResult.memories.length,
            context: lastResult.context.slice(0, 100) + (lastResult.context.length > 100 ? '...' : ''),
            recallTimeMs: lastResult.recallTimeMs,
            skipped: lastResult.skipped,
            skipReason: lastResult.skipReason
          } : null,
          description: 'AutoRecall automatically queries memory before processing any tool call, making the system work as a centralized brain that never forgets relevant context.'
        }, null, 2)
      }]
    };
  }

  private async handleRecallFeedback(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = z.object({
      score: z.number().min(1).max(10),
      queryId: z.string().optional(),
      auto: z.boolean().default(false)
    }).parse(args);

    const lastResult = this.autoRecall.getLastRecallResult();
    const queryId = input.queryId || lastResult?.memrlQueryId;

    if (!queryId) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: 'No recent AutoRecall query to provide feedback for. Either provide a queryId or perform an AutoRecall-enabled operation first.'
          }, null, 2)
        }]
      };
    }

    const engine = await this.getEngine();
    const storage = engine.getStorage();

    // Check for human override of previous auto-rating
    const previousRating = storage.getQueryFeedback(queryId);

    if (previousRating && previousRating.auto && !input.auto) {
      const diff = Math.abs(previousRating.score - input.score);
      if (diff >= 3) {
        // Significant disagreement — store for calibration learning
        storage.storeDisagreement({
          queryId,
          autoScore: previousRating.score,
          humanScore: input.score,
          context: lastResult?.context
        });
      }
    }

    // Normalize score from 1-10 to 0-1 for MemRL
    const normalized = (input.score - 1) / 9; // 1→0, 10→1

    // Provide feedback to MemRL
    const result = await engine.provideMemRLFeedback(queryId, normalized);

    // Store the rating in the database
    storage.markQueryFeedback(queryId, input.score, input.auto);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: result.success,
          queryId,
          score: input.score,
          normalizedReward: normalized.toFixed(3),
          entriesUpdated: result.entriesUpdated,
          avgQChange: result.avgQChange.toFixed(4),
          isOverride: previousRating?.auto && !input.auto,
          message: result.message
        }, null, 2)
      }]
    };
  }

  private async handleStore(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = StoreInputSchema.parse(args);
    const engine = await this.getEngine();

    const originalLength = input.content.length;
    let content = input.content;
    let compressionMethod = 'none';
    const tags = [...(input.tags || [])];

    // Use LLM compression if available
    const llmCompressor = this.getLLMCompressor();
    if (llmCompressor.isAvailable()) {
      content = await llmCompressor.compress(input.content);
      compressionMethod = 'llm';
      tags.push('llm-compressed');
    } else {
      // Fallback to legacy compression
      const detectedType = input.type || memoryCompressor.detectTypeFromContent(input.content);
      const compressionResult = memoryCompressor.encode(
        input.content,
        input.type as MemoryType | undefined
      );
      content = compressionResult.compressed;
      compressionMethod = 'legacy';
      tags.push('compressed', `type:${detectedType}`);
    }

    const compressedLength = content.length;
    const ratio = originalLength > 0 ? 1 - (compressedLength / originalLength) : 0;
    const tokensSaved = Math.round((originalLength - compressedLength) / 4); // ~4 chars per token

    // Store the compressed content
    const entry = await engine.store(content, {
      tags,
      source: parseSource(input.source),
      importance: input.importance,
      parentIds: input.parentIds,
      confidence: input.confidence,
      sessionId: input.sessionId,
      agentId: input.agentId,
      context: {
        compressed: true,
        compressionMethod,
        originalLength,
        compressedLength
      }
    });

    // Implicit feedback: if a recent query led to this store, the results were useful
    let implicitFeedback = false;
    if (this.lastQueryContext && (Date.now() - this.lastQueryContext.timestamp) < 300000) {
      // Within 5 minutes of last query — provide positive feedback
      try {
        await engine.provideCombinedFeedback(
          this.lastQueryContext.queryId,
          this.lastQueryContext.trajectoryId,
          0.7, // Positive signal: user stored something after querying
          'implicit_store'
        );
        implicitFeedback = true;
        this.lastQueryContext = null; // Only fire once per query
        console.log('[god_store] Implicit positive feedback sent to MemRL+Sona');
      } catch (e) {
        // Non-critical, don't fail the store
        console.error('[god_store] Implicit feedback error:', e);
      }
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          id: entry.id,
          lScore: entry.provenance.lScore,
          lineageDepth: entry.provenance.lineageDepth,
          compressed: content,
          compressionMethod,
          ratio: Math.round(ratio * 100) + '%',
          tokensSaved,
          implicitFeedback,
          message: `Stored with ${compressionMethod} compression (${Math.round(ratio * 100)}% saved, ${tokensSaved} tokens)`
        }, null, 2)
      }]
    };
  }

  private async handleQuery(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = QueryInputSchema.parse(args);
    const engine = await this.getEngine();

    // Use queryWithLearning to get trajectoryId for Sona feedback
    const { results, trajectoryId } = await engine.queryWithLearning(input.query, {
      topK: input.topK ?? 10,
      includeProvenance: input.includeProvenance ?? true,
      filters: {
        tags: input.tags,
        minImportance: input.minImportance,
        sources: input.sources?.map(parseSource)
      }
    });

    // Track last query for implicit feedback from god_store
    const memrlQueryId = engine.getLastMemRLQueryId();
    this.lastQueryContext = {
      queryId: memrlQueryId,
      trajectoryId,
      query: input.query,
      timestamp: Date.now()
    };

    const formatted = results.map(r => ({
      id: r.entry.id,
      content: r.entry.content.substring(0, 500) + (r.entry.content.length > 500 ? '...' : ''),
      score: r.score.toFixed(4),
      lScore: r.lScore?.toFixed(4),
      reliability: r.lScore ? (r.lScore >= 0.7 ? 'high' : r.lScore >= 0.5 ? 'medium' : 'low') : 'unknown',
      tags: r.entry.metadata.tags,
      source: r.entry.metadata.source,
      importance: r.entry.metadata.importance,
      createdAt: r.entry.createdAt.toISOString()
    }));

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          count: results.length,
          results: formatted,
          _learning: {
            trajectoryId,
            queryId: memrlQueryId,
            hint: 'Call god_learn with these IDs to improve future results'
          }
        }, null, 2)
      }]
    };
  }

  private async handleTrace(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = TraceInputSchema.parse(args);
    const engine = await this.getEngine();

    const entry = engine.getEntry(input.entryId);
    if (!entry) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ error: 'Entry not found' })
        }]
      };
    }

    const trace = engine.getLineageTrace(input.entryId, input.depth ?? 10);
    const category = engine.getReliabilityCategory(input.entryId);
    const isReliable = engine.isReliable(input.entryId);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          entryId: input.entryId,
          content: entry.content.substring(0, 200) + (entry.content.length > 200 ? '...' : ''),
          lScore: trace.lScore.toFixed(4),
          reliabilityCategory: category,
          isReliable,
          lineageDepth: entry.provenance.lineageDepth,
          parentCount: entry.provenance.parentIds.length,
          parentIds: entry.provenance.parentIds,
          confidence: entry.provenance.confidence,
          relevance: entry.provenance.relevance,
          parentChain: trace.parentChain.map(p => ({
            id: p.id,
            confidence: p.confidence.toFixed(4),
            relevance: p.relevance.toFixed(4)
          }))
        }, null, 2)
      }]
    };
  }

  private async handleCausal(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = CausalInputSchema.parse(args);
    const engine = await this.getEngine();

    const relation = engine.addCausalRelation(
      input.sourceIds,
      input.targetIds,
      parseCausalType(input.type),
      input.strength ?? 0.8,
      input.ttl ? { ttl: input.ttl } : undefined
    );

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          relationId: relation.id,
          type: relation.type,
          strength: relation.strength,
          ttl: relation.ttl,
          expiresAt: relation.expiresAt?.toISOString(),
          message: relation.ttl
            ? `Created ${relation.type} relation (expires: ${relation.expiresAt?.toISOString()})`
            : `Created ${relation.type} relation (permanent)`
        }, null, 2)
      }]
    };
  }

  private async handleFindPaths(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = FindCausalInputSchema.parse(args);
    const engine = await this.getEngine();

    const paths = engine.findCausalPaths(
      input.sourceId,
      input.targetId,
      input.maxDepth ?? 10
    );

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          pathCount: paths.length,
          paths: paths.map(p => ({
            nodes: p.nodes,
            totalStrength: p.totalStrength.toFixed(4),
            edgeCount: p.edges.length,
            relationTypes: p.relationTypes
          }))
        }, null, 2)
      }]
    };
  }

  private async handleStats(): Promise<{ content: Array<{ type: string; text: string }> }> {
    const engine = await this.getEngine();
    const stats = engine.getStats();
    const compressionStats = engine.getCompressionStats();

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          totalEntries: stats.totalEntries,
          vectorCount: stats.vectorCount,
          causalRelations: stats.causalRelations,
          patternTemplates: stats.patternTemplates,
          avgLScore: stats.avgLScore.toFixed(4),
          compression: {
            tierDistribution: compressionStats.tierDistribution,
            estimatedMemorySavedBytes: compressionStats.estimatedMemorySaved,
            estimatedMemorySavedMB: (compressionStats.estimatedMemorySaved / 1024 / 1024).toFixed(2)
          },
          status: 'healthy'
        }, null, 2)
      }]
    };
  }

  private async handleEdit(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = EditInputSchema.parse(args);
    const engine = await this.getEngine();

    // Check if entry exists first
    const existing = engine.getEntry(input.entryId);
    if (!existing) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ error: 'Entry not found', entryId: input.entryId })
        }]
      };
    }

    const updated = await engine.updateEntry(input.entryId, {
      content: input.content,
      tags: input.tags,
      importance: input.importance,
      source: input.source ? parseSource(input.source) : undefined
    });

    if (!updated) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ error: 'Failed to update entry', entryId: input.entryId })
        }]
      };
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          id: updated.id,
          message: 'Entry updated successfully',
          updatedFields: {
            content: input.content !== undefined,
            tags: input.tags !== undefined,
            importance: input.importance !== undefined,
            source: input.source !== undefined
          },
          updatedAt: updated.updatedAt.toISOString()
        }, null, 2)
      }]
    };
  }

  private async handleDelete(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = DeleteInputSchema.parse(args);

    if (!input.confirm) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: 'Deletion not confirmed',
            message: 'Must set confirm: true to delete an entry'
          })
        }]
      };
    }

    const engine = await this.getEngine();

    // Check if entry exists first
    const existing = engine.getEntry(input.entryId);
    if (!existing) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ error: 'Entry not found', entryId: input.entryId })
        }]
      };
    }

    const success = engine.deleteEntry(input.entryId);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success,
          message: success ? 'Entry deleted permanently' : 'Failed to delete entry',
          entryId: input.entryId
        }, null, 2)
      }]
    };
  }

  private async handleCheckpoint(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = CheckpointInputSchema.parse(args);

    // Checkpoints go to separate tracked folder (sibling of data/)
    const checkpointDir = join(dirname(this.dataDir), 'checkpoints');

    // Ensure checkpoints directory exists
    if (!existsSync(checkpointDir)) {
      mkdirSync(checkpointDir, { recursive: true });
    }

    // Find existing checkpoints
    let checkpoints: string[] = [];
    try {
      const files = readdirSync(checkpointDir);
      checkpoints = files
        .filter(f => f.startsWith('dev-memory-') && f.endsWith('.db'))
        .sort()
        .reverse(); // Most recent first
    } catch {
      // Directory might not exist yet, that's ok
    }

    // Determine target filename
    let targetFile: string;
    let isOverwrite = false;

    if (input.overwrite && checkpoints.length > 0) {
      targetFile = checkpoints[0]; // Overwrite most recent
      isOverwrite = true;
    } else {
      // Generate timestamp: YYYYMMDD-HHMMSS
      const now = new Date();
      const timestamp = now.toISOString()
        .replace(/[-:]/g, '')
        .replace('T', '-')
        .slice(0, 15);
      targetFile = `dev-memory-${timestamp}.db`;
    }

    const sourcePath = join(this.dataDir, 'memory.db');
    const targetPath = join(checkpointDir, targetFile);

    try {
      // Copy the database file
      copyFileSync(sourcePath, targetPath);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            file: targetFile,
            path: targetPath,
            overwritten: isOverwrite,
            existingCheckpoints: checkpoints.length,
            message: isOverwrite
              ? `Checkpoint overwritten: ${targetFile}`
              : `Checkpoint created: ${targetFile}`,
            gitCommand: `git add "${targetPath}"`
          }, null, 2)
        }]
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: `Failed to create checkpoint: ${message}`
          })
        }]
      };
    }
  }

  private async handleShadowSearch(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = ShadowSearchInputSchema.parse(args);
    const engine = await this.getEngine();

    const result = await engine.shadowQuery(input.query, {
      threshold: input.threshold,
      topK: input.topK,
      contradictionType: input.contradictionType as 'direct_negation' | 'counterargument' | 'falsification' | 'alternative' | 'exception' | undefined,
      includeProvenance: input.includeProvenance ?? true,
      tags: input.tags,
      minImportance: input.minImportance
    });

    // Format contradictions for output
    const formatted = result.contradictions.map(c => ({
      id: c.entry.id,
      content: c.entry.content.substring(0, 300) + (c.entry.content.length > 300 ? '...' : ''),
      refutationStrength: c.refutationStrength.toFixed(4),
      contradictionType: c.contradictionType,
      lScore: c.lScore?.toFixed(4),
      reliability: c.lScore ? (c.lScore >= 0.7 ? 'high' : c.lScore >= 0.5 ? 'medium' : 'low') : 'unknown',
      tags: c.entry.metadata.tags,
      importance: c.entry.metadata.importance
    }));

    // Determine credibility interpretation
    let credibilityInterpretation: string;
    if (result.credibility >= 0.8) {
      credibilityInterpretation = 'STRONG - Claim is well-supported with minimal contradictions';
    } else if (result.credibility >= 0.6) {
      credibilityInterpretation = 'MODERATE - Claim has some support but notable contradictions exist';
    } else if (result.credibility >= 0.4) {
      credibilityInterpretation = 'CONTESTED - Claim has significant contradictions, proceed with caution';
    } else {
      credibilityInterpretation = 'WEAK - Contradictions outweigh support, claim is disputed';
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          query: input.query,
          credibility: result.credibility.toFixed(4),
          credibilityInterpretation,
          supportWeight: result.supportWeight.toFixed(4),
          contradictionWeight: result.contradictionWeight.toFixed(4),
          contradictionCount: result.count,
          contradictions: formatted
        }, null, 2)
      }]
    };
  }

  private async handleLearn(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = LearnInputSchema.parse(args);
    const engine = await this.getEngine();

    // Get memrlQueryId - use provided, or fall back to last query ID
    const memrlQueryId = input.memrlQueryId ?? engine.getLastMemRLQueryId();

    // Use combined feedback to update both MemRL Q-values and Sona pattern weights
    const result = await engine.provideCombinedFeedback(
      memrlQueryId,
      input.trajectoryId,
      input.quality,
      input.route
    );

    // Determine drift interpretation
    let driftInterpretation = 'N/A';
    if (result.sona) {
      switch (result.sona.driftStatus) {
        case 'critical':
          driftInterpretation = 'CRITICAL - Weights rolled back to checkpoint';
          break;
        case 'alert':
          driftInterpretation = 'ALERT - Drift approaching threshold, checkpoint created';
          break;
        default:
          driftInterpretation = 'OK - Pattern weights updated successfully';
      }
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          trajectoryId: input.trajectoryId,
          quality: input.quality,
          // MemRL results (entry-level Q-value learning)
          memrl: result.memrl ? {
            entriesUpdated: result.memrl.entriesUpdated,
            avgQChange: result.memrl.avgQChange.toFixed(4),
            queryId: memrlQueryId
          } : null,
          // Sona results (pattern-level learning)
          sona: result.sona ? {
            weightsUpdated: result.sona.weightsUpdated,
            driftScore: result.sona.driftScore.toFixed(4),
            driftStatus: result.sona.driftStatus,
            driftInterpretation
          } : null,
          message: `Updated ${result.memrl?.entriesUpdated ?? 0} Q-values and ${result.sona?.weightsUpdated ?? 0} pattern weights`
        }, null, 2)
      }]
    };
  }

  private async handleSessionStore(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = z.object({
      summary: z.string(),
      decisions: z.array(z.string()).optional(),
      patterns: z.array(z.string()).optional(),
      filesChanged: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
      relatedIds: z.array(z.string()).optional()
    }).parse(args);

    const engine = await this.getEngine();
    const dateTag = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // Build structured content
    const parts = [input.summary];
    if (input.decisions?.length) parts.push('DECISIONS: ' + input.decisions.join(' | '));
    if (input.patterns?.length) parts.push('PATTERNS: ' + input.patterns.join(' | '));
    if (input.filesChanged?.length) parts.push('FILES: ' + input.filesChanged.join(', '));
    const content = parts.join('\n');

    const tags = ['session', dateTag, ...(input.tags || [])];

    const entry = await engine.store(content, {
      source: MemorySource.AGENT_INFERENCE,
      tags,
      importance: 0.8
    });

    // Create causal links if related IDs provided
    let manualLinks = 0;
    if (input.relatedIds?.length) {
      for (const relId of input.relatedIds) {
        try {
          await engine.addCausalRelation(
            [relId], [entry.id],
            CausalRelationType.ENABLES, 0.7
          );
          manualLinks++;
        } catch (e) {
          // Non-critical
        }
      }
    }

    // Auto-detect causal relations from structured session data
    let autoLinks = 0;
    let autoStrategies: string[] = [];
    try {
      const detected = await engine.detectSessionCausalLinks(entry.id, {
        decisions: input.decisions,
        patterns: input.patterns,
        filesChanged: input.filesChanged,
        tags,
        content
      });
      autoLinks = detected.relations.length;
      autoStrategies = detected.strategies;
      if (autoLinks > 0) {
        console.log(`[god_session_store] Auto-detected ${autoLinks} causal relation(s) via: ${autoStrategies.join(', ')}`);
      }
    } catch (e) {
      // Non-critical: don't fail the session store
      console.error('[god_session_store] Causal detection error:', e);
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          id: entry.id,
          tags,
          causalLinks: { manual: manualLinks, auto: autoLinks, strategies: autoStrategies },
          message: `Session summary stored with ${tags.length} tags, ${manualLinks + autoLinks} causal link(s)`
        }, null, 2)
      }]
    };
  }

  private async handleLearningStats(): Promise<{ content: Array<{ type: string; text: string }> }> {
    const engine = await this.getEngine();

    // Get both MemRL and Sona stats
    const memrlStats = engine.getMemRLStats();
    const sonaStats = engine.getLearningStats();
    const drift = engine.checkLearningDrift();

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          // MemRL stats (entry-level Q-value learning)
          memrl: {
            totalEntries: memrlStats.totalEntries,
            entriesWithQUpdates: memrlStats.entriesWithQUpdates,
            avgQValue: memrlStats.avgQValue.toFixed(4),
            qValueDistribution: memrlStats.qValueDistribution,
            totalQueries: memrlStats.totalQueries,
            queriesWithFeedback: memrlStats.queriesWithFeedback,
            feedbackRate: memrlStats.totalQueries > 0
              ? ((memrlStats.queriesWithFeedback / memrlStats.totalQueries) * 100).toFixed(1) + '%'
              : '0%',
            config: {
              delta: memrlStats.config.delta,
              lambda: memrlStats.config.lambda,
              alpha: memrlStats.config.alpha
            }
          },
          // Sona stats (pattern-level learning)
          sona: {
            totalTrajectories: sonaStats.totalTrajectories,
            trajectoriesWithFeedback: sonaStats.trajectoriesWithFeedback,
            feedbackRate: sonaStats.totalTrajectories > 0
              ? ((sonaStats.trajectoriesWithFeedback / sonaStats.totalTrajectories) * 100).toFixed(1) + '%'
              : '0%',
            trackedPatterns: sonaStats.trackedPatterns,
            avgWeight: sonaStats.avgWeight.toFixed(4),
            avgSuccessRate: (sonaStats.avgSuccessRate * 100).toFixed(1) + '%',
            pruneCandidates: sonaStats.prunedPatterns,
            boostCandidates: sonaStats.boostedPatterns
          },
          // Overall health
          currentDrift: drift.drift.toFixed(4),
          driftStatus: drift.status,
          learningHealth: drift.status === 'ok' ? 'HEALTHY' : drift.status === 'alert' ? 'WARNING' : 'CRITICAL'
        }, null, 2)
      }]
    };
  }

  private async handlePrunePatterns(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = PrunePatternsInputSchema.parse(args);
    const engine = await this.getEngine();

    // Get the pattern matcher from the engine
    const patternMatcher = engine.getPatternMatcher();

    if (input.dryRun) {
      // Dry run: only report what would be pruned
      const candidates = patternMatcher.getPruneCandidates();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            dryRun: true,
            candidateCount: candidates.length,
            candidates: candidates.map(c => ({
              id: c.pattern.id,
              name: c.pattern.name,
              useCount: c.stats.useCount,
              successCount: c.stats.successCount,
              successRate: (c.stats.successRate * 100).toFixed(1) + '%',
              lastUsedAt: c.stats.lastUsedAt?.toISOString()
            })),
            message: candidates.length > 0
              ? `Found ${candidates.length} patterns eligible for pruning`
              : 'No patterns meet pruning criteria (need 100+ uses and <40% success rate)'
          }, null, 2)
        }]
      };
    }

    // Actually prune patterns
    const result = patternMatcher.prunePatterns();

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          dryRun: false,
          pruned: result.pruned,
          patterns: result.patterns.map(p => ({
            id: p.id,
            name: p.name,
            useCount: p.useCount,
            successRate: (p.successRate * 100).toFixed(1) + '%'
          })),
          message: result.pruned > 0
            ? `Pruned ${result.pruned} low-performance patterns`
            : 'No patterns were pruned'
        }, null, 2)
      }]
    };
  }

  private async handleCleanupExpired(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = CleanupExpiredInputSchema.parse(args);
    const engine = await this.getEngine();

    if (input.dryRun) {
      // Dry run: report what would be cleaned
      const expiredRelations = engine.getExpiredRelations();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            dryRun: true,
            expiredCount: expiredRelations.length,
            expired: expiredRelations.map(r => ({
              id: r.id,
              type: r.type,
              strength: r.strength,
              createdAt: r.createdAt.toISOString(),
              expiresAt: r.expiresAt?.toISOString(),
              ttl: r.ttl
            })),
            message: expiredRelations.length > 0
              ? `Found ${expiredRelations.length} expired relations ready for cleanup`
              : 'No expired relations found'
          }, null, 2)
        }]
      };
    }

    // Actually clean up expired relations
    const result = engine.cleanupExpiredRelations();

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          dryRun: false,
          cleaned: result.cleaned,
          relationIds: result.relationIds,
          message: result.cleaned > 0
            ? `Cleaned ${result.cleaned} expired relations`
            : 'No expired relations to clean'
        }, null, 2)
      }]
    };
  }

  private async handleEnhance(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = EnhanceInputSchema.parse(args);
    const engine = await this.getEngine();

    // Check if entry exists
    const entry = engine.getEntry(input.entryId);
    if (!entry) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ error: 'Entry not found', entryId: input.entryId })
        }]
      };
    }

    const result = await engine.enhanceEntry(input.entryId);
    if (!result) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ error: 'Failed to enhance entry - no embedding found', entryId: input.entryId })
        }]
      };
    }

    // Format neighbor weights if requested
    const neighborWeightsObj: Record<string, number> = {};
    if (input.includeWeights) {
      for (const [id, weight] of result.neighborWeights) {
        neighborWeightsObj[id] = Number(weight.toFixed(4));
      }
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          entryId: input.entryId,
          originalDim: result.originalEmbedding.length,
          enhancedDim: result.enhancedEmbedding.length,
          neighborsUsed: result.neighborsUsed,
          neighborWeights: input.includeWeights ? neighborWeightsObj : undefined,
          processingTimeMs: result.processingTimeMs,
          message: `Enhanced embedding: ${result.originalEmbedding.length}→${result.enhancedEmbedding.length} dims using ${result.neighborsUsed} neighbors`
        }, null, 2)
      }]
    };
  }

  private async handleEnhanceBatch(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = EnhanceBatchInputSchema.parse(args);
    const engine = await this.getEngine();
    const maxBatch = input.maxBatchSize ?? 50;

    // Limit batch size
    const idsToProcess = input.entryIds.slice(0, maxBatch);
    const results: Array<{
      entryId: string;
      success: boolean;
      neighborsUsed?: number;
      error?: string;
    }> = [];

    let totalNeighbors = 0;
    let totalTime = 0;
    let successCount = 0;

    for (const entryId of idsToProcess) {
      const result = await engine.enhanceEntry(entryId);
      if (result) {
        results.push({
          entryId,
          success: true,
          neighborsUsed: result.neighborsUsed
        });
        totalNeighbors += result.neighborsUsed;
        totalTime += result.processingTimeMs;
        successCount++;
      } else {
        results.push({
          entryId,
          success: false,
          error: 'Entry not found or no embedding'
        });
      }
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          processed: idsToProcess.length,
          successful: successCount,
          failed: idsToProcess.length - successCount,
          skipped: input.entryIds.length - idsToProcess.length,
          avgNeighbors: successCount > 0 ? (totalNeighbors / successCount).toFixed(2) : 0,
          totalTimeMs: totalTime,
          avgTimeMs: successCount > 0 ? (totalTime / successCount).toFixed(2) : 0,
          results
        }, null, 2)
      }]
    };
  }

  private async handleGNNStats(): Promise<{ content: Array<{ type: string; text: string }> }> {
    const engine = await this.getEngine();
    const stats = engine.getGNNStats();
    const cacheSize = engine.getEnhancementLayer().getCacheSize();

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          enhancementsPerformed: stats.enhancementsPerformed,
          avgNeighborsUsed: stats.avgNeighborsUsed.toFixed(2),
          avgProcessingTimeMs: stats.avgProcessingTimeMs.toFixed(2),
          cacheHitRate: (stats.cacheHitRate * 100).toFixed(1) + '%',
          cacheSize,
          message: stats.enhancementsPerformed > 0
            ? `GNN layer has processed ${stats.enhancementsPerformed} enhancements with ${(stats.cacheHitRate * 100).toFixed(0)}% cache hit rate`
            : 'No GNN enhancements performed yet'
        }, null, 2)
      }]
    };
  }

  private async handleClearGNNCache(): Promise<{ content: Array<{ type: string; text: string }> }> {
    const engine = await this.getEngine();
    const cacheSize = engine.getEnhancementLayer().getCacheSize();
    engine.clearGNNCache();

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          clearedEntries: cacheSize,
          message: cacheSize > 0
            ? `Cleared ${cacheSize} cached enhanced embeddings`
            : 'Cache was already empty'
        }, null, 2)
      }]
    };
  }

  private async handleRoute(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = RouteQueryInputSchema.parse(args);
    const engine = await this.getEngine();

    const decision = engine.routeQuery(input.query, {
      preferredRoute: input.preferredRoute as ReasoningRoute | undefined,
      previousRoute: input.previousRoute as ReasoningRoute | undefined
    });

    // Format alternatives
    const alternatives = decision.alternatives?.map(alt => ({
      route: alt.route,
      confidence: alt.confidence.toFixed(4)
    }));

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          route: decision.route,
          confidence: decision.confidence.toFixed(4),
          reason: decision.reason,
          routingTimeMs: decision.routingTimeMs,
          alternatives: alternatives?.length ? alternatives : undefined,
          message: `Routed to ${decision.route} with ${(decision.confidence * 100).toFixed(1)}% confidence`
        }, null, 2)
      }]
    };
  }

  private async handleRouteResult(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = RecordRoutingResultInputSchema.parse(args);
    const engine = await this.getEngine();

    const route = input.route as ReasoningRoute;
    engine.recordRoutingResult(route, input.success);

    const circuitStatus = engine.getCircuitStatus().find(s => s.id === route);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          route: input.route,
          resultRecorded: input.success ? 'success' : 'failure',
          circuitState: circuitStatus?.state ?? 'closed',
          failureCount: circuitStatus?.failureCount ?? 0,
          message: input.success
            ? `Recorded success for ${input.route}`
            : `Recorded failure for ${input.route}${circuitStatus?.state === 'open' ? ' - CIRCUIT OPENED' : ''}`
        }, null, 2)
      }]
    };
  }

  private async handleRoutingStats(): Promise<{ content: Array<{ type: string; text: string }> }> {
    const engine = await this.getEngine();
    const stats = engine.getRoutingStats();

    // Format route counts and confidence
    const routeDetails = Object.entries(stats.routeCounts)
      .filter(([_, count]) => count > 0)
      .map(([route, count]) => ({
        route,
        count,
        avgConfidence: stats.avgConfidence[route as ReasoningRoute]?.toFixed(4) ?? '0'
      }))
      .sort((a, b) => b.count - a.count);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          totalRouted: stats.totalRouted,
          avgRoutingTimeMs: stats.avgRoutingTimeMs.toFixed(2),
          fallbackCount: stats.fallbackCount,
          circuitTrips: stats.circuitTrips,
          routeBreakdown: routeDetails,
          message: stats.totalRouted > 0
            ? `Routed ${stats.totalRouted} queries with ${stats.circuitTrips} circuit trips`
            : 'No queries routed yet'
        }, null, 2)
      }]
    };
  }

  private async handleCircuitStatus(): Promise<{ content: Array<{ type: string; text: string }> }> {
    const engine = await this.getEngine();
    const statuses = engine.getCircuitStatus();

    const formatted = statuses.map(s => ({
      route: s.id,
      state: s.state,
      failureCount: s.failureCount,
      successCount: s.successCount,
      totalFailures: s.totalFailures,
      totalSuccesses: s.totalSuccesses,
      lastOpenedAt: s.lastOpenedAt?.toISOString(),
      cooldownEndsAt: s.cooldownEndsAt?.toISOString()
    }));

    const openCircuits = formatted.filter(s => s.state === 'open');
    const halfOpenCircuits = formatted.filter(s => s.state === 'half_open');

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          totalCircuits: statuses.length,
          openCount: openCircuits.length,
          halfOpenCount: halfOpenCircuits.length,
          circuits: formatted,
          message: openCircuits.length > 0
            ? `WARNING: ${openCircuits.length} circuit(s) OPEN: ${openCircuits.map(c => c.route).join(', ')}`
            : 'All circuits healthy'
        }, null, 2)
      }]
    };
  }

  private async handleResetCircuit(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = ResetCircuitInputSchema.parse(args);
    const engine = await this.getEngine();

    if (input.route) {
      const route = input.route as ReasoningRoute;
      engine.resetCircuit(route);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            route: input.route,
            action: 'reset',
            message: `Reset circuit for ${input.route}`
          }, null, 2)
        }]
      };
    } else {
      engine.resetAllCircuits();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            action: 'reset_all',
            message: 'Reset all circuits'
          }, null, 2)
        }]
      };
    }
  }

  // ==========================================
  // Scheduler Handlers (Phase 9)
  // ==========================================

  private async handleSchedule(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = ScheduleInputSchema.parse(args);
    const scheduler = await this.getScheduler();
    const taskStore = scheduler.getTaskStore();

    // Convert trigger to internal format
    const trigger = this.parseTrigger(input.trigger);

    const task = taskStore.createTask({
      name: input.name,
      description: input.description,
      prompt: input.prompt,
      trigger,
      contextIds: input.contextIds,
      contextQuery: input.contextQuery,
      priority: input.priority,
      notification: input.notification as TaskNotification | undefined
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          taskId: task.id,
          name: task.name,
          triggerType: task.trigger.type,
          status: task.status,
          nextRun: task.nextRun?.toISOString(),
          message: `Scheduled task "${task.name}" (${task.trigger.type} trigger)`
        }, null, 2)
      }]
    };
  }

  private async handleTrigger(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = TriggerInputSchema.parse(args);
    const scheduler = await this.getScheduler();

    if (!input.taskId && !input.event) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ error: 'Must specify taskId or event' })
        }]
      };
    }

    if (input.taskId) {
      // Trigger specific task
      try {
        const run = await scheduler.triggerTask(input.taskId);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              taskId: input.taskId,
              runId: run?.id,
              status: run?.status,
              message: `Triggered task ${input.taskId}`
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: error instanceof Error ? error.message : 'Failed to trigger task'
            })
          }]
        };
      }
    }

    if (input.event) {
      // Fire event
      const event = scheduler.fireEvent(input.event);
      const taskStore = scheduler.getTaskStore();
      const listeningTasks = taskStore.getTasksForEvent(input.event);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            eventId: event.id,
            event: input.event,
            firedAt: event.firedAt.toISOString(),
            tasksListening: listeningTasks.length,
            message: `Fired event "${input.event}" (${listeningTasks.length} tasks listening)`
          }, null, 2)
        }]
      };
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ error: 'Invalid trigger request' })
      }]
    };
  }

  private async handleTasks(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = TasksInputSchema.parse(args);
    const scheduler = await this.getScheduler();
    const taskStore = scheduler.getTaskStore();

    let statuses: TaskStatus[] | undefined;
    if (input.status && input.status !== 'all') {
      statuses = [input.status as TaskStatus];
    }

    const tasks = taskStore.queryTasks({
      status: statuses,
      limit: input.limit ?? 20
    });

    const formatted = tasks.map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      status: t.status,
      triggerType: t.trigger.type,
      triggerConfig: t.trigger,
      priority: t.priority,
      runCount: t.runCount,
      lastRun: t.lastRun?.toISOString(),
      nextRun: t.nextRun?.toISOString(),
      createdAt: t.createdAt.toISOString()
    }));

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          count: tasks.length,
          tasks: formatted
        }, null, 2)
      }]
    };
  }

  private async handlePause(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = TaskIdInputSchema.parse(args);
    const scheduler = await this.getScheduler();
    const taskStore = scheduler.getTaskStore();

    const task = taskStore.getTask(input.taskId);
    if (!task) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ error: 'Task not found', taskId: input.taskId })
        }]
      };
    }

    taskStore.updateTaskStatus(input.taskId, TaskStatus.PAUSED);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          taskId: input.taskId,
          name: task.name,
          previousStatus: task.status,
          newStatus: 'paused',
          message: `Paused task "${task.name}"`
        }, null, 2)
      }]
    };
  }

  private async handleResume(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = TaskIdInputSchema.parse(args);
    const scheduler = await this.getScheduler();
    const taskStore = scheduler.getTaskStore();

    const task = taskStore.getTask(input.taskId);
    if (!task) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ error: 'Task not found', taskId: input.taskId })
        }]
      };
    }

    taskStore.updateTaskStatus(input.taskId, TaskStatus.PENDING);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          taskId: input.taskId,
          name: task.name,
          previousStatus: task.status,
          newStatus: 'pending',
          message: `Resumed task "${task.name}"`
        }, null, 2)
      }]
    };
  }

  private async handleCancel(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = TaskIdInputSchema.parse(args);
    const scheduler = await this.getScheduler();
    const taskStore = scheduler.getTaskStore();

    const task = taskStore.getTask(input.taskId);
    if (!task) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ error: 'Task not found', taskId: input.taskId })
        }]
      };
    }

    // Cancel running task if applicable
    scheduler.cancelRunningTask(input.taskId);
    taskStore.updateTaskStatus(input.taskId, TaskStatus.CANCELLED);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          taskId: input.taskId,
          name: task.name,
          previousStatus: task.status,
          newStatus: 'cancelled',
          message: `Cancelled task "${task.name}"`
        }, null, 2)
      }]
    };
  }

  private async handleSchedulerStats(): Promise<{ content: Array<{ type: string; text: string }> }> {
    const scheduler = await this.getScheduler();
    const taskStore = scheduler.getTaskStore();
    const stats = taskStore.getStats();
    const running = scheduler.getRunningTasks();

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          tasks: {
            total: stats.totalTasks,
            pending: stats.pendingTasks,
            running: stats.runningTasks,
            completed: stats.completedTasks,
            failed: stats.failedTasks
          },
          runs: {
            total: stats.totalRuns,
            successful: stats.successfulRuns,
            failed: stats.failedRuns,
            averageDurationMs: stats.averageRunDuration.toFixed(2)
          },
          eventsInQueue: stats.eventsInQueue,
          currentlyRunning: running.map(r => ({
            taskId: r.taskId,
            name: r.task.name,
            startedAt: r.run.startedAt.toISOString()
          })),
          schedulerRunning: scheduler.isRunning(),
          message: `${stats.totalTasks} tasks, ${stats.totalRuns} runs, ${stats.eventsInQueue} events queued`
        }, null, 2)
      }]
    };
  }

  private parseTrigger(input: z.infer<typeof ScheduleTriggerSchema>): ScheduleTrigger {
    switch (input.type) {
      case 'datetime':
        return { type: TriggerType.DATETIME, at: input.at };
      case 'cron':
        return { type: TriggerType.CRON, pattern: input.pattern };
      case 'event':
        return { type: TriggerType.EVENT, event: input.event };
      case 'file':
        return { type: TriggerType.FILE, path: input.path, event: input.event };
      case 'manual':
        return { type: TriggerType.MANUAL };
    }
  }

  // ==========================================
  // Playwright Handlers (RUBIX)
  // ==========================================

  private async handlePlaywrightLaunch(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = PlaywrightLaunchInputSchema.parse(args);
    const pw = this.getPlaywright();

    const result = await pw.launch({
      browser: input.browser as 'chromium' | 'firefox' | 'webkit' | undefined,
      headless: input.headless,
      viewport: input.viewport
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          sessionId: result.sessionId,
          browser: result.browser,
          headless: result.headless,
          viewport: result.viewport,
          message: `Browser launched (${result.browser}, ${result.headless ? 'headless' : 'visible'})`
        }, null, 2)
      }]
    };
  }

  private async handlePlaywrightClose(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = PlaywrightCloseInputSchema.parse(args);
    const pw = this.getPlaywright();

    const closed = await pw.close(input.sessionId);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: closed,
          sessionId: input.sessionId,
          message: closed ? 'Session closed' : 'Session not found'
        }, null, 2)
      }]
    };
  }

  private async handlePlaywrightNavigate(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = PlaywrightNavigateInputSchema.parse(args);
    const pw = this.getPlaywright();

    const result = await pw.navigate(input.sessionId, input.url, {
      waitUntil: input.waitUntil as 'load' | 'domcontentloaded' | 'networkidle' | undefined
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: result.success,
          url: result.url,
          title: result.title,
          duration: result.duration,
          error: result.error,
          message: result.success
            ? `Navigated to ${result.url}`
            : `Navigation failed: ${result.error}`
        }, null, 2)
      }]
    };
  }

  private async handlePlaywrightScreenshot(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = PlaywrightScreenshotInputSchema.parse(args);
    const pw = this.getPlaywright();

    const screenshot = await pw.screenshot(input.sessionId, {
      fullPage: input.fullPage,
      selector: input.selector,
      label: input.label,
      returnBase64: input.returnBase64
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          id: screenshot.id,
          path: screenshot.path,
          base64: screenshot.base64 ? `${screenshot.base64.substring(0, 50)}...` : undefined,
          url: screenshot.url,
          fullPage: screenshot.fullPage,
          viewport: screenshot.viewport,
          message: `Screenshot saved to ${screenshot.path}`
        }, null, 2)
      }]
    };
  }

  private async handlePlaywrightAction(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = PlaywrightActionInputSchema.parse(args);
    const pw = this.getPlaywright();

    const result = await pw.action(input.sessionId, {
      selector: input.selector,
      action: input.action as ActionType,
      value: input.value,
      key: input.key,
      force: input.force
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: result.success,
          action: result.action,
          selector: result.selector,
          duration: result.duration,
          error: result.error,
          screenshot: result.screenshot,
          message: result.success
            ? `${result.action} on ${result.selector} succeeded`
            : `${result.action} failed: ${result.error}`
        }, null, 2)
      }]
    };
  }

  private async handlePlaywrightAssert(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = PlaywrightAssertInputSchema.parse(args);
    const pw = this.getPlaywright();

    const result = await pw.assert(input.sessionId, {
      type: input.type as AssertionType,
      selector: input.selector,
      expected: input.expected,
      attribute: input.attribute
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: result.success,
          type: result.type,
          selector: result.selector,
          expected: result.expected,
          actual: result.actual,
          duration: result.duration,
          error: result.error,
          message: result.success
            ? `Assertion passed: ${result.type}`
            : `Assertion failed: ${result.error}`
        }, null, 2)
      }]
    };
  }

  private async handlePlaywrightConsole(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = PlaywrightConsoleInputSchema.parse(args);
    const pw = this.getPlaywright();

    const summary = pw.getConsoleLogs(input.sessionId);
    const report = ConsoleCapture.createReport(summary);

    if (input.clear) {
      pw.clearConsoleLogs(input.sessionId);
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          total: summary.total,
          errors: summary.errors,
          warnings: summary.warnings,
          pageErrors: summary.pageErrors.length,
          messages: summary.messages.slice(0, 20).map(m => ({
            type: m.type,
            text: m.text.substring(0, 200),
            timestamp: m.timestamp.toISOString()
          })),
          report: report,
          cleared: input.clear ?? false,
          message: summary.errors > 0
            ? `Found ${summary.errors} error(s) and ${summary.warnings} warning(s)`
            : `Console clean: ${summary.total} message(s)`
        }, null, 2)
      }]
    };
  }

  private async handlePlaywrightVerify(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = PlaywrightVerifyInputSchema.parse(args);
    const verifier = this.getVerificationService();

    const result = await verifier.quickVerify(input.url, {
      screenshot: input.screenshot,
      checkConsole: input.checkConsole,
      assertVisible: input.assertVisible
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: result.success,
          url: input.url,
          duration: result.duration,
          steps: result.steps.map(s => ({
            id: s.stepId,
            type: s.type,
            success: s.success,
            duration: s.duration,
            error: s.error
          })),
          screenshots: result.screenshots,
          failures: result.failures,
          consoleReport: result.consoleReport,
          summary: result.summary,
          message: result.success
            ? `Verification passed for ${input.url}`
            : `Verification failed: ${result.failures.join('; ')}`
        }, null, 2)
      }]
    };
  }

  // ==========================================
  // RUBIX Handlers
  // ==========================================

  private async getTaskExecutor(): Promise<TaskExecutor> {
    if (!this.taskExecutor) {
      // Lazy initialization
      const engine = this.engine;
      if (!engine) {
        throw new Error('MemoryEngine not initialized. Call getEngine() first.');
      }
      this.taskExecutor = new TaskExecutor(
        engine,
        {},
        this.playwright || undefined,
        this.verificationService || undefined
      );

      // Initialize RUBIX subsystems (Phased Execution is now the primary execution method)
      const llmConfig = getCodexLLMConfig();
      try {
        // Wire CommunicationManager for escalations
        const comms = this.getCommunicationManager();
        this.taskExecutor.setCommunications(comms);
        console.log('[MCP Server] CommunicationManager wired - escalations enabled');

        // Set extended thinking on TaskExecutor for budget calculation
        if (llmConfig.extendedThinking) {
          this.taskExecutor.setExtendedThinking(llmConfig.extendedThinking);
          console.log(`[MCP Server] Ultrathink enabled: base=${llmConfig.extendedThinking.baseBudget}, max=${llmConfig.extendedThinking.maxBudget}`);
        }

        // Initialize CollaborativePartner and ContainmentManager
        // Use this.projectRoot for proper multi-project scoping
        const containmentManager = new ContainmentManager({
          enabled: true,
          projectRoot: this.projectRoot
        });

        // Load persisted user rules from containment.json
        containmentManager.setRulesFilePath(this.dataDir);

        const collaborativePartner = new CollaborativePartner(engine, {
          enabled: true,
          containment: containmentManager.getConfig()
        });

        // Wire into TaskExecutor
        this.taskExecutor.setCollaborativePartner(collaborativePartner);

        console.log('[MCP Server] CollaborativePartner initialized - proactive curiosity and challenge decisions enabled');
        console.log('[MCP Server] ContainmentManager initialized - path-based permissions active');

        // Wire Wolfram Alpha for deterministic math
        const wolframAppId = process.env.WOLFRAM_APP_ID || '';
        if (wolframAppId) {
          const wolfram = this.getWolfram();
          this.taskExecutor.setWolfram(wolfram);
          console.log('[MCP Server] Wolfram Alpha integrated - RUBIX can verify math on-demand');
        }

        // Wire CodeReviewer for self-review after code generation
        if (!this.reviewer) {
          const caps = await this.getCapabilities();
          this.reviewer = new CodeReviewer(
            engine,
            process.cwd(),
            {},
            caps,
            this.playwright ?? undefined,
            this.verificationService ?? undefined
          );
        }
        this.taskExecutor.setCodeReviewer(this.reviewer);
        console.log('[MCP Server] CodeReviewer wired - RUBIX will self-review generated code');

        // Generate RuntimeContext - compressed capabilities context for this instance
        const configuredChannels = comms.getConfiguredChannels?.() || [];
        const runtimeCtx = createRuntimeContext({
          capabilities: {
            lsp: true, git: true, analysis: true, ast: true,
            deps: true, stacktrace: true, docs: true
          },
          channels: configuredChannels,
          toolCount: 50,
          wolfram: !!process.env.WOLFRAM_APP_ID,
          playwright: !!this.playwright,
          containment: true,
          codebaseRoot: process.cwd()
        });
        this.taskExecutor.setRuntimeContext(runtimeCtx.readable);
        console.log(`[MCP Server] RuntimeContext generated (${runtimeCtx.tokenEstimate} tokens):`);
        console.log(runtimeCtx.compressed);

        // Enable Phased Execution by default (6-phase tokenized flow)
        // This is now the primary execution method (legacy CodeGenerator removed)
        this.taskExecutor.enablePhasedExecution(process.cwd());
        console.log('[MCP Server] PhasedExecution enabled - using 6-phase tokenized flow (primary execution path)');

        // Wire ReflexionService for verbal failure analysis
        try {
          const reflexion = await this.getReflexionService();
          this.taskExecutor!.setReflexionService(reflexion);
          console.log('[MCP Server] ReflexionService wired - verbal failure analysis enabled');
        } catch (error) {
          console.warn('[MCP Server] Failed to wire ReflexionService:', error);
        }

        // Wire ShadowSearch for contradiction-based alternative finding during healing
        try {
          this.taskExecutor!.wireShadowSearch(engine);
          console.log('[MCP Server] ShadowSearch wired into AlternativesFinder');
        } catch (error) {
          console.warn('[MCP Server] Failed to wire ShadowSearch:', error);
        }

        console.log('[MCP Server] TaskExecutor initialized - RUBIX ready');
      } catch (error) {
        console.error('[MCP Server] Failed to initialize TaskExecutor subsystems:', error);
      }
    }
    return this.taskExecutor;
  }

  private async handleCodexDo(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = CodexDoInputSchema.parse(args);

    // Ensure engine is initialized
    await this.getEngine();
    const executor = await this.getTaskExecutor();

    // Check if already executing
    if (executor.isRunning()) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: 'A task is already in progress. Use god_codex_status to check progress or god_codex_cancel to stop it.'
          }, null, 2)
        }]
      };
    }

    // Inject recalled memories into context (centralized brain)
    let specification = input.specification || '';
    if (this.recalledMemories.length > 0) {
      const recalledContext = this.recalledMemories
        .map(m => `- ${m.content.slice(0, 300)}${m.content.length > 300 ? '...' : ''} (score: ${m.score.toFixed(2)})`)
        .join('\n');
      specification = `[Recalled Context from Memory]\n${recalledContext}\n\n${specification}`;
    }

    // Start execution (async, don't await completion for long tasks)
    const submission = {
      description: input.description,
      specification,
      codebase: input.codebase,
      constraints: input.constraints,
      verificationPlan: input.verificationUrl ? {
        url: input.verificationUrl,
        checkConsole: true
      } : undefined
    };

    if (input.dryRun) {
      // Dry run - execute synchronously for preview
      const result = await executor.execute(submission, { dryRun: true });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            dryRun: true,
            summary: result.summary,
            subtasksPlanned: result.subtasksCompleted + result.subtasksFailed,
            message: 'Dry run complete. Use without dryRun to execute.'
          }, null, 2)
        }]
      };
    }

    // Execute async - return immediately with task info
    // In production, this would run in background
    const task = executor.getCurrentTask();
    executor.execute(submission).catch(err => {
      console.error('RUBIX execution error:', err);
    });

    const status = executor.getStatus();

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: 'Task submitted to RUBIX. Check status with god_codex_status.',
          taskId: task?.id || 'pending',
          description: input.description,
          subtasksPlanned: status.subtasksComplete + status.subtasksRemaining,
          status: 'executing'
        }, null, 2)
      }]
    };
  }

  private async handleCodexStatus(): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      await this.getEngine();
      const executor = await this.getTaskExecutor();
      const status: StatusReport = executor.getStatus();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            running: executor.isRunning(),
            currentTask: status.currentTask ? {
              id: status.currentTask.id,
              description: status.currentTask.description,
              status: status.currentTask.status
            } : null,
            progress: {
              completed: status.subtasksComplete,
              remaining: status.subtasksRemaining,
              percentage: status.estimatedProgress
            },
            currentSubtask: status.currentSubtask ? {
              id: status.currentSubtask.id,
              type: status.currentSubtask.type,
              description: status.currentSubtask.description
            } : null,
            blockers: status.blockers,
            pendingDecisions: status.pendingDecisions.map(d => ({
              id: d.id,
              question: d.question,
              options: d.options
            })),
            pendingEscalations: status.pendingEscalations.map(e => ({
              id: e.id,
              type: e.type,
              title: e.title,
              context: e.context,
              blocking: e.blocking
            })),
            recentLog: status.recentLog.slice(-5).map(l => ({
              type: l.type,
              message: l.message,
              timestamp: l.timestamp.toISOString()
            }))
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            running: false,
            message: 'No task executor initialized yet.'
          }, null, 2)
        }]
      };
    }
  }

  private async handleCodexAnswer(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = CodexAnswerInputSchema.parse(args);
    await this.getEngine();
    const executor = await this.getTaskExecutor();

    const resolved = executor.resolveEscalation(input.escalationId, input.answer);

    if (!resolved) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: `Escalation ${input.escalationId} not found or already resolved.`
          }, null, 2)
        }]
      };
    }

    // Also inject response into CommunicationManager to resolve any waiting channel Promise
    const comms = this.getCommunicationManager();
    const injected = comms.injectResponse(input.escalationId, input.answer);
    if (injected) {
      console.log(`[MCP Server] Injected MCP response into communication channel`);
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: 'Escalation resolved. RUBIX will continue.',
          escalation: {
            id: resolved.id,
            type: resolved.type,
            resolution: resolved.resolution
          }
        }, null, 2)
      }]
    };
  }

  private async handleCodexDecision(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = CodexDecisionInputSchema.parse(args);
    await this.getEngine();
    const executor = await this.getTaskExecutor();

    const success = executor.answerDecision(input.decisionId, input.answer, input.optionIndex);

    if (!success) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: `Decision ${input.decisionId} not found.`
          }, null, 2)
        }]
      };
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: 'Decision recorded. RUBIX will continue.',
          decisionId: input.decisionId,
          answer: input.answer
        }, null, 2)
      }]
    };
  }

  private async handleCodexCancel(): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      await this.getEngine();
      const executor = await this.getTaskExecutor();

      // Check if there's a task (running OR stuck)
      const status = executor.getStatus();
      const hasTask = status.currentTask !== null;

      if (!hasTask) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              message: 'No task to cancel.'
            }, null, 2)
          }]
        };
      }

      // Force cancel even if not actively running (handles stuck/blocked tasks)
      const cancelled = executor.cancel();

      // If cancel returns false but we have a stuck task, force clear it
      if (!cancelled && hasTask) {
        // Force clear by calling cancel again - it will work on blocked tasks
        executor.forceReset?.();
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Task ${status.currentTask?.status === 'blocked' ? 'force-cleared' : 'cancelled'}.`,
            previousStatus: status.currentTask?.status
          }, null, 2)
        }]
      };
    } catch {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            message: 'No task executor initialized.'
          }, null, 2)
        }]
      };
    }
  }

  private async handleCodexLog(): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      await this.getEngine();
      const executor = await this.getTaskExecutor();
      const log: WorkLogEntry[] = executor.getWorkLog();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            entries: log.map(l => ({
              type: l.type,
              message: l.message,
              timestamp: l.timestamp.toISOString(),
              taskId: l.taskId,
              subtaskId: l.subtaskId,
              details: l.details
            })),
            count: log.length
          }, null, 2)
        }]
      };
    } catch {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            entries: [],
            count: 0,
            message: 'No work log available.'
          }, null, 2)
        }]
      };
    }
  }

  private async handleCodexLogs(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = z.object({
      action: z.enum(['list', 'read', 'latest']).optional().default('list'),
      filename: z.string().optional(),
      limit: z.number().optional().default(20)
    }).parse(args || {});

    try {
      await this.getEngine();
      const executor = await this.getTaskExecutor();
      const logger = executor.getLogger();

      switch (input.action) {
        case 'list': {
          const logs = logger.listLogs(input.limit);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                action: 'list',
                logDir: 'data/codex-logs/',
                currentLogPath: logger.getCurrentLogPath(),
                files: logs.map(f => ({
                  filename: f.filename,
                  taskId: f.taskId,
                  createdAt: f.createdAt.toISOString(),
                  entryCount: f.entryCount,
                  sizeKB: Math.round(f.sizeBytes / 1024 * 10) / 10
                })),
                totalFiles: logs.length
              }, null, 2)
            }]
          };
        }

        case 'read': {
          if (!input.filename) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  error: 'filename required for read action'
                }, null, 2)
              }]
            };
          }
          const content = logger.readLog(input.filename);
          if (!content) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  error: `Log file not found: ${input.filename}`
                }, null, 2)
              }]
            };
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                action: 'read',
                filename: input.filename,
                content: content
              }, null, 2)
            }]
          };
        }

        case 'latest': {
          const latest = logger.readLatestLog();
          if (!latest) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  error: 'No log files found'
                }, null, 2)
              }]
            };
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                action: 'latest',
                filename: latest.filename,
                content: latest.content
              }, null, 2)
            }]
          };
        }

        default:
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: `Unknown action: ${input.action}`
              }, null, 2)
            }]
          };
      }
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : 'Failed to access logs'
          }, null, 2)
        }]
      };
    }
  }

  private async handleCodexWait(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = z.object({
      minutes: z.number().optional().default(10)
    }).parse(args || {});

    try {
      await this.getEngine();
      const executor = await this.getTaskExecutor();

      // Check if there's a communication manager to extend timeout
      const communications = executor.getCommunications?.();

      if (!communications) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              message: 'No communication channels configured. Use /wait in Telegram instead.'
            }, null, 2)
          }]
        };
      }

      const result = communications.extendTimeout(input.minutes);

      if (result.extended) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `Extended timeout by ${input.minutes} minutes`,
              newTimeout: result.newTimeout?.toISOString(),
              channelsExtended: result.channelsExtended
            }, null, 2)
          }]
        };
      } else {
        // No pending escalations
        const status = executor.getStatus();
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              message: 'No pending escalation to extend.',
              taskStatus: status.currentTask?.status || 'no active task',
              hint: 'Use god_codex_status to check task state.'
            }, null, 2)
          }]
        };
      }
    } catch {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            message: 'Failed to extend timeout.'
          }, null, 2)
        }]
      };
    }
  }

  // ==========================================
  // CODEX Estimate Handlers
  // ==========================================

  /**
   * Scan codebase to gather statistics for estimation
   */
  private async scanCodebaseForEstimate(codebasePath: string): Promise<{
    fileCount: number;
    totalChars: number;
    avgFileSize: number;
    languages: string[];
  }> {
    const glob = await import('glob');
    const fs = await import('fs');
    const path = await import('path');

    // Source file patterns (same as ContextScout uses)
    const patterns = [
      '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx',
      '**/*.py', '**/*.java', '**/*.go', '**/*.rs',
      '**/*.php', '**/*.rb', '**/*.vue', '**/*.svelte',
      '**/*.css', '**/*.scss', '**/*.html'
    ];

    const ignorePatterns = [
      '**/node_modules/**', '**/dist/**', '**/build/**',
      '**/.git/**', '**/vendor/**', '**/__pycache__/**'
    ];

    let fileCount = 0;
    let totalChars = 0;
    const languageSet = new Set<string>();

    for (const pattern of patterns) {
      try {
        const files = await glob.glob(pattern, {
          cwd: codebasePath,
          ignore: ignorePatterns,
          nodir: true,
          absolute: true
        });

        for (const file of files) {
          try {
            const stats = fs.statSync(file);
            if (stats.size < 100000) { // Skip files > 100KB
              const content = fs.readFileSync(file, 'utf-8');
              fileCount++;
              totalChars += content.length;

              const ext = path.extname(file).toLowerCase();
              const langMap: Record<string, string> = {
                '.ts': 'typescript', '.tsx': 'typescript',
                '.js': 'javascript', '.jsx': 'javascript',
                '.py': 'python', '.java': 'java',
                '.go': 'go', '.rs': 'rust',
                '.php': 'php', '.rb': 'ruby',
                '.vue': 'vue', '.svelte': 'svelte',
                '.css': 'css', '.scss': 'scss',
                '.html': 'html'
              };
              if (langMap[ext]) languageSet.add(langMap[ext]);
            }
          } catch {
            // Skip unreadable files
          }
        }
      } catch {
        // Skip failed glob patterns
      }
    }

    return {
      fileCount,
      totalChars,
      avgFileSize: fileCount > 0 ? Math.round(totalChars / fileCount) : 0,
      languages: Array.from(languageSet)
    };
  }

  /**
   * Estimate task complexity from description and specification
   */
  private estimateTaskComplexity(description: string, specification?: string): 'low' | 'medium' | 'high' {
    const text = `${description} ${specification || ''}`.toLowerCase();

    // High complexity indicators
    const highIndicators = [
      'system', 'architecture', 'integration', 'multiple', 'complex',
      'refactor entire', 'redesign', 'migrate', 'rewrite', 'security',
      'authentication', 'authorization', 'database schema', 'api gateway'
    ];

    // Low complexity indicators
    const lowIndicators = [
      'simple', 'add button', 'fix typo', 'rename', 'update text',
      'change color', 'add comment', 'fix bug', 'small change'
    ];

    // Check high complexity first
    for (const indicator of highIndicators) {
      if (text.includes(indicator)) return 'high';
    }

    // Check low complexity
    for (const indicator of lowIndicators) {
      if (text.includes(indicator)) return 'low';
    }

    // Default to medium based on text length
    const wordCount = text.split(/\s+/).length;
    if (wordCount < 10) return 'low';
    if (wordCount > 50) return 'high';
    return 'medium';
  }

  /**
   * Calculate per-phase token estimates
   */
  private calculatePhaseEstimates(
    codebaseStats: { fileCount: number; totalChars: number; avgFileSize: number },
    complexity: 'low' | 'medium' | 'high'
  ): Array<{
    name: string;
    model: 'sonnet' | 'opus';
    inputTokens: number;
    outputTokens: number;
  }> {
    const phases: Array<{
      name: string;
      model: 'sonnet' | 'opus';
      inputTokens: number;
      outputTokens: number;
    }> = [];

    // Phase 1: Context Scout (Sonnet)
    // Reads up to 20 files × 2000 chars, converts to tokens (÷4)
    const scoutFileCount = Math.min(codebaseStats.fileCount, 20);
    const scoutChars = scoutFileCount * Math.min(codebaseStats.avgFileSize, 2000);
    const scoutTokens = Math.round(scoutChars / 4) + 2500; // + overhead
    phases.push({
      name: 'contextScout',
      model: 'sonnet',
      inputTokens: scoutTokens,
      outputTokens: complexity === 'low' ? 1000 : complexity === 'medium' ? 1500 : 2000
    });

    // Phase 2: Architect (Opus)
    // Complexity-based estimation
    const architectInput = {
      low: 1000,
      medium: 1800,
      high: 2800
    }[complexity];
    phases.push({
      name: 'architect',
      model: 'opus',
      inputTokens: architectInput,
      outputTokens: complexity === 'low' ? 500 : complexity === 'medium' ? 1000 : 1500
    });

    // Phase 3: Engineer (Sonnet for low/medium, may escalate to Opus for high)
    const engineerInput = {
      low: 2800,
      medium: 12000,
      high: 22000
    }[complexity];
    phases.push({
      name: 'engineer',
      model: complexity === 'high' ? 'opus' : 'sonnet',
      inputTokens: engineerInput,
      outputTokens: complexity === 'low' ? 2000 : complexity === 'medium' ? 4000 : 8000
    });

    // Phase 4: Validator (Sonnet)
    // Based on file count + overhead
    const validatorInput = Math.min(codebaseStats.fileCount * 250, 3000) + 1500;
    phases.push({
      name: 'validator',
      model: 'sonnet',
      inputTokens: validatorInput,
      outputTokens: complexity === 'low' ? 500 : complexity === 'medium' ? 800 : 1500
    });

    // Phase 5: Executor - Local, no tokens
    // Not added to phases as it's 0 cost

    // Phase 6: Fix Loop (estimate 1 iteration)
    // In practice could be 0-5 iterations
    phases.push({
      name: 'fixLoop',
      model: 'sonnet',
      inputTokens: complexity === 'low' ? 750 : complexity === 'medium' ? 2000 : 4000,
      outputTokens: complexity === 'low' ? 1000 : complexity === 'medium' ? 2000 : 4000
    });

    return phases;
  }

  /**
   * Calculate cost breakdown from phase estimates
   */
  private calculateCost(phases: Array<{
    name: string;
    model: 'sonnet' | 'opus';
    inputTokens: number;
    outputTokens: number;
  }>): {
    sonnetInput: string;
    sonnetOutput: string;
    opusInput: string;
    opusOutput: string;
    total: string;
  } {
    // 2025 pricing
    const SONNET_INPUT_PER_M = 3.00;
    const SONNET_OUTPUT_PER_M = 15.00;
    const OPUS_INPUT_PER_M = 15.00;
    const OPUS_OUTPUT_PER_M = 75.00;

    let sonnetInputTokens = 0;
    let sonnetOutputTokens = 0;
    let opusInputTokens = 0;
    let opusOutputTokens = 0;

    for (const phase of phases) {
      if (phase.model === 'sonnet') {
        sonnetInputTokens += phase.inputTokens;
        sonnetOutputTokens += phase.outputTokens;
      } else {
        opusInputTokens += phase.inputTokens;
        opusOutputTokens += phase.outputTokens;
      }
    }

    const sonnetInputCost = (sonnetInputTokens / 1_000_000) * SONNET_INPUT_PER_M;
    const sonnetOutputCost = (sonnetOutputTokens / 1_000_000) * SONNET_OUTPUT_PER_M;
    const opusInputCost = (opusInputTokens / 1_000_000) * OPUS_INPUT_PER_M;
    const opusOutputCost = (opusOutputTokens / 1_000_000) * OPUS_OUTPUT_PER_M;
    const totalCost = sonnetInputCost + sonnetOutputCost + opusInputCost + opusOutputCost;

    return {
      sonnetInput: `$${sonnetInputCost.toFixed(3)}`,
      sonnetOutput: `$${sonnetOutputCost.toFixed(3)}`,
      opusInput: `$${opusInputCost.toFixed(3)}`,
      opusOutput: `$${opusOutputCost.toFixed(3)}`,
      total: `$${totalCost.toFixed(2)}`
    };
  }

  /**
   * Handle god_codex_estimate - estimate token usage and cost for a task
   */
  private async handleCodexEstimate(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = CodexEstimateInputSchema.parse(args);

    try {
      // 1. Scan codebase for file count and sizes
      const codebaseStats = await this.scanCodebaseForEstimate(input.codebase);

      // 2. Estimate complexity from task description
      const complexity = this.estimateTaskComplexity(input.description, input.specification);

      // 3. Calculate per-phase token estimates
      const phases = this.calculatePhaseEstimates(codebaseStats, complexity);

      // 4. Calculate cost
      const estimatedCost = this.calculateCost(phases);

      // 5. Calculate totals
      const totals = {
        inputTokens: phases.reduce((sum, p) => sum + p.inputTokens, 0),
        outputTokens: phases.reduce((sum, p) => sum + p.outputTokens, 0)
      };

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            codebase: input.codebase,
            complexity,
            codebaseStats,
            phases,
            totals,
            estimatedCost,
            notes: [
              'Estimates assume single fix loop iteration',
              'High complexity tasks may use Opus ($15/M in) instead of Sonnet ($3/M in)',
              'Actual usage varies based on generated code size'
            ]
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            codebase: input.codebase
          }, null, 2)
        }]
      };
    }
  }

  // ==========================================
  // Collaborative Partner Handlers
  // ==========================================

  private async handlePartnerConfig(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = PartnerConfigInputSchema.parse(args);

    try {
      await this.getEngine();
      const executor = await this.getTaskExecutor();
      const partner = executor.getCollaborativePartner();

      if (!partner) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'CollaborativePartner not initialized. Ensure ANTHROPIC_API_KEY is set.'
            }, null, 2)
          }]
        };
      }

      // Update configuration - only include defined fields
      const configUpdate: Record<string, unknown> = {};
      if (input.enabled !== undefined) configUpdate.enabled = input.enabled;
      if (input.thresholds) configUpdate.thresholds = input.thresholds;
      if (input.behaviors) configUpdate.behaviors = input.behaviors;

      // Check result - security bounds may reject some updates
      const result = partner.updateConfig(configUpdate);
      if (!result.success) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: result.reason,
              message: 'Configuration update rejected for security reasons'
            }, null, 2)
          }]
        };
      }

      const config = partner.getConfig();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            config: {
              enabled: config.enabled,
              thresholds: config.thresholds,
              behaviors: config.behaviors
            },
            message: 'Collaborative Partner configuration updated'
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handlePartnerChallenge(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = PartnerChallengeInputSchema.parse(args);

    try {
      await this.getEngine();
      const executor = await this.getTaskExecutor();
      const partner = executor.getCollaborativePartner();

      if (!partner) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'CollaborativePartner not initialized.'
            }, null, 2)
          }]
        };
      }

      // Create mock context for assessment
      const mockTask = {
        id: 'manual-challenge',
        description: input.taskDescription || 'Manual challenge assessment',
        codebase: process.cwd(),
        status: CodexTaskStatus.EXECUTING,
        subtasks: [],
        decisions: [],
        assumptions: [],
        createdAt: new Date()
      };

      const assessment = await partner.assessApproach(input.approach, {
        task: mockTask,
        codebaseContext: input.subtaskDescription
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            assessment: {
              shouldChallenge: assessment.shouldChallenge,
              isHardGate: assessment.isHardGate,
              credibility: assessment.credibility,
              lScore: assessment.lScore,
              contradictions: assessment.contradictions.length,
              recommendation: assessment.recommendation,
              reasoning: assessment.reasoning
            },
            verdict: assessment.isHardGate
              ? 'BLOCKED - Requires user override to proceed'
              : assessment.shouldChallenge
                ? 'WARNING - Concerns noted but can proceed'
                : 'APPROVED - No significant concerns'
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handlePartnerStatus(): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      await this.getEngine();
      const executor = await this.getTaskExecutor();
      const partner = executor.getCollaborativePartner();

      if (!partner) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              status: 'not_initialized',
              message: 'CollaborativePartner not initialized. Ensure ANTHROPIC_API_KEY is set.'
            }, null, 2)
          }]
        };
      }

      const config = partner.getConfig();
      const containment = partner.getContainment();
      const containmentConfig = containment.getConfig();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            status: 'active',
            partner: {
              enabled: config.enabled,
              thresholds: config.thresholds,
              behaviors: config.behaviors
            },
            containment: {
              enabled: containmentConfig.enabled,
              projectRoot: containmentConfig.projectRoot,
              defaultPermission: containmentConfig.defaultPermission,
              rulesCount: containmentConfig.permissions.length
            }
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  // ==========================================
  // Containment Handlers
  // ==========================================

  private async handleContainmentCheck(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = ContainmentCheckInputSchema.parse(args);

    try {
      await this.getEngine();
      const executor = await this.getTaskExecutor();
      const partner = executor.getCollaborativePartner();

      if (!partner) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'ContainmentManager not initialized.'
            }, null, 2)
          }]
        };
      }

      const result = partner.checkPathPermission(input.path, input.operation);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            path: input.path,
            operation: input.operation,
            allowed: result.allowed,
            reason: result.reason,
            canOverride: result.canOverride,
            matchedRule: result.matchedRule ? {
              pattern: result.matchedRule.pattern,
              permission: result.matchedRule.permission,
              reason: result.matchedRule.reason
            } : undefined
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleContainmentConfig(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = ContainmentConfigInputSchema.parse(args);

    try {
      await this.getEngine();
      const executor = await this.getTaskExecutor();
      const partner = executor.getCollaborativePartner();

      if (!partner) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'ContainmentManager not initialized.'
            }, null, 2)
          }]
        };
      }

      const containment = partner.getContainment();

      // Check result - security bounds may reject some updates
      const result = containment.updateConfig({
        enabled: input.enabled,
        projectRoot: input.projectRoot,
        defaultPermission: input.defaultPermission
      });

      if (!result.success) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: result.reason,
              message: 'Configuration update rejected for security reasons'
            }, null, 2)
          }]
        };
      }

      const config = containment.getConfig();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            config: {
              enabled: config.enabled,
              projectRoot: config.projectRoot,
              defaultPermission: config.defaultPermission,
              rulesCount: config.permissions.length
            },
            message: 'Containment configuration updated'
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleContainmentAddRule(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = ContainmentAddRuleInputSchema.parse(args);

    try {
      await this.getEngine();
      const executor = await this.getTaskExecutor();
      const partner = executor.getCollaborativePartner();

      if (!partner) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'ContainmentManager not initialized.'
            }, null, 2)
          }]
        };
      }

      const containment = partner.getContainment();

      // Use addUserRule for persistence (saves to containment.json)
      const result = containment.addUserRule(
        input.pattern,
        input.permission,
        input.reason,
        input.priority  // Will be capped to 89 by ContainmentManager
      );

      if (!result.success) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: result.reason,
              pattern: input.pattern,
              message: 'Rule addition rejected for security reasons'
            }, null, 2)
          }]
        };
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            rule: {
              pattern: input.pattern,
              permission: input.permission,
              reason: input.reason,
              priority: Math.min(input.priority ?? 60, 89)  // Show capped priority
            },
            persisted: true,
            message: `Added permission rule for pattern: ${input.pattern} (saved to containment.json)`
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleContainmentRemoveRule(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = ContainmentRemoveRuleInputSchema.parse(args);

    try {
      await this.getEngine();
      const executor = await this.getTaskExecutor();
      const partner = executor.getCollaborativePartner();

      if (!partner) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'ContainmentManager not initialized.'
            }, null, 2)
          }]
        };
      }

      const containment = partner.getContainment();

      // Use removeUserRule for persistence (updates containment.json)
      const result = containment.removeUserRule(input.pattern);

      if (!result.success) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: result.reason,
              pattern: input.pattern,
              message: 'Rule removal failed - rule may not exist or be immutable'
            }, null, 2)
          }]
        };
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            pattern: input.pattern,
            persisted: true,
            message: `Removed permission rule for pattern: ${input.pattern} (saved to containment.json)`
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleContainmentStatus(): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      await this.getEngine();
      const executor = await this.getTaskExecutor();
      const partner = executor.getCollaborativePartner();

      if (!partner) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              status: 'not_initialized',
              message: 'ContainmentManager not initialized.'
            }, null, 2)
          }]
        };
      }

      const containment = partner.getContainment();
      const config = containment.getConfig();
      const sessionPerms = containment.getSessionPermissions();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            status: config.enabled ? 'active' : 'disabled',
            config: {
              enabled: config.enabled,
              projectRoot: config.projectRoot,
              defaultPermission: config.defaultPermission,
              allowTaskOverrides: config.allowTaskOverrides
            },
            sessionPermissions: sessionPerms.map(p => ({
              pattern: p.pattern,
              permission: p.permission,
              reason: p.reason
            })),
            rules: config.permissions.map(p => ({
              pattern: p.pattern,
              permission: p.permission,
              reason: p.reason,
              priority: p.priority ?? 0
            }))
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleContainmentSession(args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      await this.getEngine();
      const executor = await this.getTaskExecutor();
      const partner = executor.getCollaborativePartner();

      if (!partner) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'ContainmentManager not initialized.'
            }, null, 2)
          }]
        };
      }

      const containment = partner.getContainment();
      const { action, pattern, permission = 'read', reason } = args as {
        action: 'add' | 'remove' | 'clear' | 'list';
        pattern?: string;
        permission?: 'read' | 'write' | 'read-write';
        reason?: string;
      };

      switch (action) {
        case 'add': {
          if (!pattern) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  error: 'Pattern is required for add action'
                }, null, 2)
              }]
            };
          }
          const result = containment.addSessionPermission(pattern, permission, reason);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: result.success,
                message: result.success
                  ? `Session access granted: ${pattern} (${permission}). Note: Security rules still apply.`
                  : result.reason,
                sessionPermissions: containment.getSessionPermissions().map(p => ({
                  pattern: p.pattern,
                  permission: p.permission,
                  reason: p.reason
                }))
              }, null, 2)
            }]
          };
        }

        case 'remove': {
          if (!pattern) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  error: 'Pattern is required for remove action'
                }, null, 2)
              }]
            };
          }
          const result = containment.removeSessionPermission(pattern);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: result.success,
                message: result.success
                  ? `Session permission removed: ${pattern}`
                  : result.reason,
                sessionPermissions: containment.getSessionPermissions().map(p => ({
                  pattern: p.pattern,
                  permission: p.permission,
                  reason: p.reason
                }))
              }, null, 2)
            }]
          };
        }

        case 'clear': {
          containment.clearSessionPermissions();
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: 'All session permissions cleared.',
                sessionPermissions: []
              }, null, 2)
            }]
          };
        }

        case 'list': {
          const sessionPerms = containment.getSessionPermissions();
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                count: sessionPerms.length,
                sessionPermissions: sessionPerms.map(p => ({
                  pattern: p.pattern,
                  permission: p.permission,
                  reason: p.reason
                }))
              }, null, 2)
            }]
          };
        }

        default:
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: `Unknown action: ${action}. Use add, remove, clear, or list.`
              }, null, 2)
            }]
          };
      }
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  // ==========================================
  // Capability Handlers (Stage 4)
  // ==========================================

  // LSP Handlers
  private async handleLspStart(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = LSPStartInputSchema.parse(args);
    const caps = await this.getCapabilities();

    try {
      await caps.startLspServer(input.languageId);
      const status = caps.getLspStatus();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            servers: status,
            message: `LSP server started for ${input.languageId ?? 'typescript'}`
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleLspStop(): Promise<{ content: Array<{ type: string; text: string }> }> {
    const caps = await this.getCapabilities();

    try {
      await caps.stopLspServer();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: 'All LSP servers stopped'
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleLspAvailable(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const caps = await this.getCapabilities();
    const input = args as { language?: string } | undefined;

    try {
      let results;
      if (input?.language) {
        // Check specific language
        const result = await caps.checkLspAvailability(input.language);
        results = [result];
      } else {
        // Check all languages
        results = await caps.checkAllLspAvailability();
      }

      const available = results.filter(r => r.available);
      const unavailable = results.filter(r => !r.available);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            summary: {
              available: available.length,
              unavailable: unavailable.length,
              total: results.length
            },
            servers: results.map(r => ({
              language: r.languageId,
              name: r.name,
              available: r.available,
              command: r.command,
              ...(r.installInstructions && { installInstructions: r.installInstructions }),
              ...(r.error && { error: r.error })
            }))
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleLspDefinition(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = LSPDefinitionInputSchema.parse(args);
    const caps = await this.getCapabilities();

    try {
      const result = await caps.gotoDefinition(input.file, input.line, input.column);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            definition: result,
            message: result ? `Definition found at ${result.file}:${result.line}` : 'No definition found'
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleLspReferences(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = LSPReferencesInputSchema.parse(args);
    const caps = await this.getCapabilities();

    try {
      const result = await caps.findReferences(input.file, input.line, input.column);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            symbol: result.symbol,
            totalCount: result.totalCount,
            references: result.references.slice(0, 50),
            message: `Found ${result.totalCount} references to ${result.symbol}`
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleLspDiagnostics(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = LSPDiagnosticsInputSchema.parse(args);
    const caps = await this.getCapabilities();

    try {
      const result = await caps.getDiagnostics(input.file);
      const totalErrors = result.reduce((sum, r) => sum + r.errorCount, 0);
      const totalWarnings = result.reduce((sum, r) => sum + r.warningCount, 0);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            files: result.length,
            totalErrors,
            totalWarnings,
            diagnostics: result,
            message: `${totalErrors} errors, ${totalWarnings} warnings`
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleLspSymbols(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = LSPSymbolsInputSchema.parse(args);
    const caps = await this.getCapabilities();

    try {
      const result = await caps.searchSymbols(input.query);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            symbols: result.symbols.slice(0, 50),
            totalCount: result.totalCount,
            message: `Found ${result.totalCount} symbols matching "${input.query}"`
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  // Git Handlers
  private async handleGitBlame(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = GitBlameInputSchema.parse(args);
    const caps = await this.getCapabilities();

    try {
      const result = await caps.gitBlame(input.file, input.startLine, input.endLine);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            file: result.file,
            lines: result.lines.slice(0, 100), // Limit output
            message: `Blame for ${result.file}: ${result.lines.length} lines`
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleGitBisect(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = GitBisectInputSchema.parse(args);
    const caps = await this.getCapabilities();

    try {
      const result = await caps.gitBisect(input.good, input.bad, input.testCommand);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            status: result.status,
            firstBadCommit: result.firstBadCommit,
            message: result.message,
            author: result.author,
            result,
            statusMessage: result.status === 'found'
              ? `Found breaking commit: ${result.firstBadCommit}`
              : result.status === 'not_found' ? 'Bisect complete - no bad commit found' : 'Bisect error'
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleGitHistory(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = GitHistoryInputSchema.parse(args);
    const caps = await this.getCapabilities();

    try {
      const commits = await caps.gitHistory(input.file, input.limit);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            commits,
            totalCount: commits.length,
            message: `${commits.length} commits found`
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleGitDiff(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = GitDiffInputSchema.parse(args);
    const caps = await this.getCapabilities();

    try {
      const diffs = await caps.gitDiff(input.file, input.staged);
      const totalAdditions = diffs.reduce((sum, d) => sum + d.additions, 0);
      const totalDeletions = diffs.reduce((sum, d) => sum + d.deletions, 0);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            files: diffs.map(d => d.file),
            diffs: diffs.slice(0, 20), // Limit output
            additions: totalAdditions,
            deletions: totalDeletions,
            message: `${diffs.length} files changed (+${totalAdditions} -${totalDeletions})`
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleGitBranches(): Promise<{ content: Array<{ type: string; text: string }> }> {
    const caps = await this.getCapabilities();

    try {
      const branches = await caps.gitBranches();
      const current = branches.find(b => b.current)?.name ?? 'unknown';

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            current,
            branches: branches.map(b => b.name),
            branchDetails: branches,
            message: `Current branch: ${current}, ${branches.length} total`
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  // AST Handlers
  private async handleAstParse(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = ASTParseInputSchema.parse(args);
    const caps = await this.getCapabilities();

    try {
      const result = await caps.parseAST(input.file);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            file: result.file,
            ast: result.ast,
            errors: result.errors,
            message: result.errors.length > 0
              ? `Parsed with ${result.errors.length} errors`
              : 'Parsed successfully'
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleAstQuery(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = ASTQueryInputSchema.parse(args);
    const caps = await this.getCapabilities();

    try {
      const result = await caps.queryAST(input.file, input.nodeType);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            file: result.file,
            nodeType: result.nodeType,
            matches: result.matches.slice(0, 50), // Limit output
            totalMatches: result.matches.length,
            message: `Found ${result.matches.length} ${result.nodeType} nodes`
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleAstRefactor(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = ASTRefactorInputSchema.parse(args);
    const caps = await this.getCapabilities();

    try {
      const operation: RefactorOperation = {
        type: input.type as 'rename' | 'extract' | 'inline' | 'move',
        target: input.target,
        newValue: input.newValue,
        scope: input.scope
      };

      const result = await caps.refactor(operation);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: result.success,
            operation: result.operation,
            affectedFiles: result.affectedFiles,
            changes: result.changes.map(c => ({
              file: c.file,
              preview: c.diffPreview
            })),
            error: result.error,
            message: result.success
              ? `Refactored ${result.affectedFiles} files`
              : `Refactor failed: ${result.error}`
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleAstSymbols(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = ASTSymbolsInputSchema.parse(args);
    const caps = await this.getCapabilities();

    try {
      const result = await caps.getSymbols(input.file);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            file: input.file,
            symbols: result,
            count: result.length,
            message: `Found ${result.length} symbols`
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  // Analysis Handlers
  private async handleAnalyzeLint(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = AnalyzeLintInputSchema.parse(args);
    const caps = await this.getCapabilities();

    try {
      const results = await caps.runLint(input.files);
      const errorCount = results.reduce((sum, r) => sum + r.errorCount, 0);
      const warningCount = results.reduce((sum, r) => sum + r.warningCount, 0);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            errorCount,
            warningCount,
            files: results.slice(0, 20), // Limit output
            message: `${errorCount} errors, ${warningCount} warnings`
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleAnalyzeTypes(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = AnalyzeTypesInputSchema.parse(args);
    const caps = await this.getCapabilities();

    try {
      const results = await caps.runTypeCheck(input.files);
      const errorCount = results.reduce((sum, r) => sum + r.errors.length, 0);
      const warningCount = results.reduce((sum, r) => sum + r.warnings.length, 0);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            errorCount,
            warningCount,
            diagnostics: results.slice(0, 50), // Limit output
            message: `${errorCount} type errors, ${warningCount} warnings`
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleAnalyzeDeps(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = AnalyzeDepsInputSchema.parse(args);
    const caps = await this.getCapabilities();

    try {
      const result = await caps.buildDependencyGraph(input.entryPoint);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            entryPoint: result.entryPoint,
            totalModules: result.nodes.length,
            circularDependencies: result.circularDependencies,
            nodes: result.nodes.slice(0, 50), // Limit output
            edges: result.edges.slice(0, 100),
            message: `${result.nodes.length} modules, ${result.circularDependencies.length} circular deps`
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleAnalyzeImpact(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = AnalyzeImpactInputSchema.parse(args);
    const caps = await this.getCapabilities();

    try {
      const result = await caps.analyzeImpact(input.file);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            changedFile: result.changedFile,
            directDependents: result.directDependents,
            transitiveDependents: result.transitiveDependents.slice(0, 50), // Limit
            totalImpact: result.totalImpact,
            riskLevel: result.riskLevel,
            suggestions: result.suggestions,
            message: `Impact: ${result.riskLevel} (${result.transitiveDependents.length} dependents)`
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  // Debug Handlers
  private async handleDebugStart(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = DebugStartInputSchema.parse(args);
    const caps = await this.getCapabilities();

    try {
      const result = await caps.startDebugSession(input.script);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            sessionId: result.id,
            status: result.status,
            message: `Debug session started (ID: ${result.id})`
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleDebugStop(): Promise<{ content: Array<{ type: string; text: string }> }> {
    const caps = await this.getCapabilities();

    try {
      await caps.stopAllDebugSessions();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: 'All debug sessions stopped'
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleDebugBreakpoint(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = DebugBreakpointInputSchema.parse(args);
    const caps = await this.getCapabilities();

    try {
      if (input.remove && input.breakpointId) {
        await caps.removeBreakpoint(input.breakpointId);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              breakpointId: input.breakpointId,
              message: 'Breakpoint removed'
            }, null, 2)
          }]
        };
      } else {
        const result = await caps.setBreakpoint(input.file, input.line, input.condition);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              breakpointId: result.id,
              file: result.file,
              line: result.line,
              condition: result.condition,
              message: `Breakpoint set at ${input.file}:${input.line}`
            }, null, 2)
          }]
        };
      }
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleDebugStep(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = DebugStepInputSchema.parse(args);
    const caps = await this.getCapabilities();

    try {
      await caps.step(input.action as 'into' | 'over' | 'out' | 'continue');

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            action: input.action,
            message: `Step ${input.action} executed`
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleDebugEval(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = DebugEvalInputSchema.parse(args);
    const caps = await this.getCapabilities();

    try {
      const result = await caps.evalExpression(input.expression);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: !result.error,
            expression: result.expression,
            result: result.result,
            type: result.type,
            error: result.error,
            message: result.error ? `Error: ${result.error}` : 'Evaluated successfully'
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  // Stack Trace Handlers
  private async handleStackParse(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = StackParseInputSchema.parse(args);
    const caps = await this.getCapabilities();

    try {
      const result = await caps.parseStackTrace(input.error);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            name: result.name,
            message: result.message,
            frames: result.frames.slice(0, 20), // Limit frames
            totalFrames: result.frames.length
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleStackContext(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = StackContextInputSchema.parse(args);
    const caps = await this.getCapabilities();

    try {
      const result = await caps.getStackContext(input.file, input.line);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            frame: result.frame,
            surroundingCode: result.surroundingCode,
            message: `Context for ${input.file}:${input.line}`
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  // Database Handlers
  private async handleDbSchema(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    DBSchemaInputSchema.parse(args);
    const caps = await this.getCapabilities();

    try {
      const result = await caps.getSchema();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            tables: result.tables.length,
            views: result.views.length,
            relationships: result.relationships.length,
            schema: {
              tables: result.tables.map(t => ({
                name: t.name,
                columns: t.columns.length,
                primaryKey: t.primaryKey
              })),
              views: result.views.map(v => v.name),
              relationships: result.relationships
            },
            message: `${result.tables.length} tables, ${result.views.length} views`
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleDbTypes(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = DBTypesInputSchema.parse(args);
    const caps = await this.getCapabilities();

    try {
      const result = await caps.generateTypes({
        exportFormat: input.exportFormat as 'interface' | 'type' | 'class' | undefined,
        addNullable: input.addNullable,
        addOptional: input.addOptional
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            tableCount: result.tableCount,
            typescript: result.typescript,
            warnings: result.warnings,
            message: `Generated types for ${result.tableCount} tables`
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  // Profiler Handlers
  private async handleProfileStart(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    ProfileStartInputSchema.parse(args);
    const caps = await this.getCapabilities();

    try {
      await caps.startProfiling();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: 'Profiling started'
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleProfileStop(): Promise<{ content: Array<{ type: string; text: string }> }> {
    const caps = await this.getCapabilities();

    try {
      const result = await caps.stopProfiling();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            profile: {
              duration: result.duration,
              samples: result.samples,
              topFunctions: result.topFunctions.slice(0, 10)
            },
            message: `Profile complete: ${result.samples} samples over ${result.duration}ms`
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleProfileHotspots(): Promise<{ content: Array<{ type: string; text: string }> }> {
    const caps = await this.getCapabilities();

    try {
      const result = await caps.findHotspots();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            hotspots: result.hotspots.slice(0, 20),
            summary: result.summary,
            totalHotspots: result.hotspots.length,
            message: `Found ${result.hotspots.length} hotspots`
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  // Documentation Handlers
  private async handleDocsFetch(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = DocsFetchInputSchema.parse(args);
    const caps = await this.getCapabilities();

    try {
      const result = await caps.fetchDocs(input.url);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            url: result.url,
            title: result.title,
            contentLength: result.content.length,
            content: result.content.substring(0, 5000), // Limit output
            cached: result.cached,
            message: `Fetched: ${result.title}`
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleDocsSearch(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = DocsSearchInputSchema.parse(args);
    const caps = await this.getCapabilities();

    try {
      const result = await caps.searchDocs(input.query);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            query: result.query,
            results: result.results.slice(0, 20), // Limit
            totalResults: result.results.length,
            message: `Found ${result.results.length} results`
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  // ===========================================================================
  // Wolfram Alpha Handlers
  // ===========================================================================

  private getWolfram(): WolframManager {
    if (!this.wolfram) {
      const appId = process.env.WOLFRAM_APP_ID || '';
      this.wolfram = new WolframManager({
        appId,
        timeout: 30000,
        cacheEnabled: true
      });
    }
    return this.wolfram;
  }

  private async handleWolframQuery(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = z.object({
      query: z.string()
    }).parse(args);

    const wolfram = this.getWolfram();

    if (!wolfram.isConfigured()) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: 'Wolfram Alpha not configured. Set WOLFRAM_APP_ID environment variable.',
            hint: 'Get a free App ID at https://developer.wolframalpha.com'
          }, null, 2)
        }]
      };
    }

    try {
      const result = await wolfram.query(input.query);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: result.success,
            query: result.query,
            result: result.result,
            pods: result.pods?.map(p => ({
              title: p.title,
              content: p.plaintext
            })),
            cached: result.cached,
            timing: result.timing,
            error: result.error
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleWolframCalculate(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = z.object({
      expression: z.string()
    }).parse(args);

    const wolfram = this.getWolfram();

    if (!wolfram.isConfigured()) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: 'Wolfram Alpha not configured. Set WOLFRAM_APP_ID environment variable.'
          }, null, 2)
        }]
      };
    }

    try {
      const result = await wolfram.calculate(input.expression);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            expression: input.expression,
            result: result
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            expression: input.expression,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleWolframSolve(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = z.object({
      equation: z.string()
    }).parse(args);

    const wolfram = this.getWolfram();

    if (!wolfram.isConfigured()) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: 'Wolfram Alpha not configured. Set WOLFRAM_APP_ID environment variable.'
          }, null, 2)
        }]
      };
    }

    try {
      const result = await wolfram.solve(input.equation);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: result.success,
            equation: input.equation,
            solutions: result.result,
            pods: result.pods?.map(p => ({
              title: p.title,
              content: p.plaintext
            })),
            error: result.error
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleWolframConvert(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = z.object({
      value: z.number(),
      fromUnit: z.string(),
      toUnit: z.string()
    }).parse(args);

    const wolfram = this.getWolfram();

    if (!wolfram.isConfigured()) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: 'Wolfram Alpha not configured. Set WOLFRAM_APP_ID environment variable.'
          }, null, 2)
        }]
      };
    }

    try {
      const result = await wolfram.convert(input.value, input.fromUnit, input.toUnit);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: result.success,
            conversion: `${input.value} ${input.fromUnit} → ${input.toUnit}`,
            result: result.result,
            error: result.error
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  // Capabilities Status Handler
  private async handleCapabilitiesStatus(): Promise<{ content: Array<{ type: string; text: string }> }> {
    const caps = await this.getCapabilities();
    const status = caps.getStatus();

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          capabilities: status,
          projectRoot: this.projectRoot,
          projectName: this.projectName,
          message: 'Capabilities status retrieved'
        }, null, 2)
      }]
    };
  }

  // Ollama Status Handler
  private async handleOllamaStatus(): Promise<{ content: Array<{ type: string; text: string }> }> {
    const endpoint = process.env.OLLAMA_ENDPOINT;
    const model = process.env.OLLAMA_MODEL || 'qwen3-coder:480b-cloud';
    const apiKey = process.env.OLLAMA_API_KEY;
    const engineerProvider = process.env.RUBIX_ENGINEER_PROVIDER;
    const timeout = parseInt(process.env.OLLAMA_TIMEOUT || '120000', 10);

    // Check if Ollama is configured as the engineer provider
    const isConfigured = engineerProvider === 'ollama';

    // Check availability if configured
    let available = false;
    let availabilityError: string | undefined;

    if (endpoint) {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json'
        };
        if (apiKey) {
          headers['Authorization'] = `Bearer ${apiKey}`;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);  // 10s health check

        try {
          const res = await fetch(`${endpoint}/api/tags`, {
            headers,
            signal: controller.signal
          });
          available = res.ok;
          if (!res.ok) {
            availabilityError = `HTTP ${res.status}: ${res.statusText}`;
          }
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (error) {
        available = false;
        availabilityError = error instanceof Error ? error.message : String(error);
      }
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          configured: isConfigured,
          available,
          endpoint: endpoint || 'not set',
          model,
          hasApiKey: !!apiKey,
          timeout,
          availabilityError,
          message: isConfigured
            ? (available ? 'Ollama is configured and available' : `Ollama is configured but not available: ${availabilityError}`)
            : 'Ollama is not configured as the engineer provider. Set RUBIX_ENGINEER_PROVIDER=ollama to enable.'
        }, null, 2)
      }]
    };
  }

  // ===========================================================================
  // Code Review Handlers
  // ===========================================================================

  private async handleReview(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = ReviewInputSchema.parse(args);
    const reviewer = await this.getReviewer();

    try {
      const result = await reviewer.review({
        id: `review-${Date.now()}`,
        files: input.files,
        type: (input.type ?? 'full') as ReviewType,
        diff: input.diff,
        description: input.description,
        baseBranch: input.baseBranch,
        targetBranch: input.targetBranch
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            status: result.status,
            summary: result.summary,
            issueCount: result.issues.length,
            securityFindings: result.security.length,
            styleIssues: result.style.length,
            approval: result.approval,
            issues: result.issues.slice(0, 20), // Limit for readability
            duration: result.duration,
            notes: result.notes,
            message: result.summary.text
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleQuickReview(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = QuickReviewInputSchema.parse(args);
    const reviewer = await this.getReviewer();

    try {
      const result = await reviewer.quickReview(input.files);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            pass: result.pass,
            criticalIssueCount: result.criticalIssues.length,
            criticalIssues: result.criticalIssues,
            summary: result.summary,
            message: result.pass ? 'Review passed' : 'Review failed - critical issues found'
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleSecurityReview(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = SecurityReviewInputSchema.parse(args);
    const reviewer = await this.getReviewer();

    try {
      const result = await reviewer.securityReview(input.files);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            riskLevel: result.riskLevel,
            findingCount: result.findings.length,
            findings: result.findings,
            summary: result.summary,
            message: `Security review complete. Risk level: ${result.riskLevel.toUpperCase()}`
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleReviewConfig(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = ReviewConfigInputSchema.parse(args);
    const reviewer = await this.getReviewer();

    try {
      const newConfig: Partial<ReviewConfig> = {};

      if (input.security !== undefined) newConfig.security = input.security;
      if (input.style !== undefined) newConfig.style = input.style;
      if (input.logic !== undefined) newConfig.logic = input.logic;
      if (input.tests !== undefined) newConfig.tests = input.tests;
      if (input.blockingSeverity !== undefined) {
        newConfig.blockingSeverity = input.blockingSeverity as ReviewConfig['blockingSeverity'];
      }
      if (input.maxIssues !== undefined) newConfig.maxIssues = input.maxIssues;
      if (input.sensitivePatterns !== undefined) {
        newConfig.sensitivePatterns = input.sensitivePatterns;
      }

      reviewer.setConfig(newConfig);
      const currentConfig = reviewer.getConfig();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            config: currentConfig,
            message: 'Review configuration updated'
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  // ===========================================================================
  // Notification Handlers
  // ===========================================================================

  private async handleNotify(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = NotifyInputSchema.parse(args);
    const notifications = await this.getNotifications();

    try {
      const result = await notifications.notify({
        type: input.type as NotificationType,
        urgency: (input.urgency || 'normal') as NotificationUrgency,
        title: input.title,
        message: input.message,
        taskId: input.taskId,
        task: input.task,
        summary: input.summary,
        context: input.context,
        actions: input.actions
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: result.status === 'sent',
            notificationId: result.notificationId,
            status: result.status,
            channelResults: result.channelResults.map(r => ({
              channel: r.channel,
              status: r.status,
              error: r.error
            }))
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleNotifySlack(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = NotifySlackConfigSchema.parse(args);
    const notifications = await this.getNotifications();

    try {
      notifications.configureSlack({
        webhookUrl: input.webhookUrl,
        channel: input.channel,
        username: input.username,
        iconEmoji: input.iconEmoji,
        enabled: input.enabled
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: 'Slack configuration updated',
            enabled: input.enabled
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleNotifyDiscord(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = NotifyDiscordConfigSchema.parse(args);
    const notifications = await this.getNotifications();

    try {
      notifications.configureDiscord({
        webhookUrl: input.webhookUrl,
        username: input.username,
        avatarUrl: input.avatarUrl,
        enabled: input.enabled
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: 'Discord configuration updated',
            enabled: input.enabled
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleNotifyPreferences(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = NotifyPreferencesSchema.parse(args);
    const notifications = await this.getNotifications();

    try {
      const currentConfig = notifications.getConfig();
      const newPreferences = { ...currentConfig.preferences };

      if (input.onComplete !== undefined) newPreferences.onComplete = input.onComplete;
      if (input.onBlocked !== undefined) newPreferences.onBlocked = input.onBlocked;
      if (input.onDecision !== undefined) newPreferences.onDecision = input.onDecision;
      if (input.onReviewReady !== undefined) newPreferences.onReviewReady = input.onReviewReady;
      if (input.onProgress !== undefined) newPreferences.onProgress = input.onProgress;
      if (input.onError !== undefined) newPreferences.onError = input.onError;
      if (input.minUrgency !== undefined) {
        newPreferences.minUrgency = input.minUrgency as NotificationUrgency;
      }

      notifications.setConfig({ preferences: newPreferences });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: 'Notification preferences updated',
            preferences: newPreferences
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleNotifyTest(): Promise<{ content: Array<{ type: string; text: string }> }> {
    const notifications = await this.getNotifications();

    try {
      const result = await notifications.test();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: result.status === 'sent',
            notificationId: result.notificationId,
            status: result.status,
            channelResults: result.channelResults.map(r => ({
              channel: r.channel,
              status: r.status,
              error: r.error
            })),
            message: result.status === 'sent'
              ? 'Test notification sent successfully'
              : 'Test notification failed or was skipped'
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleNotifyHistory(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = z.object({
      limit: z.number().optional().default(20)
    }).parse(args);

    const notifications = await this.getNotifications();

    try {
      const history = notifications.getHistory(input.limit);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            count: history.length,
            notifications: history.map(n => ({
              id: n.notificationId,
              status: n.status,
              timestamp: n.timestamp,
              channels: n.channelResults.map(r => ({
                channel: r.channel,
                status: r.status
              }))
            }))
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  // ===========================================================================
  // Configuration Handlers (Stage 9)
  // ===========================================================================

  private async handleConfigGet(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = ConfigGetInputSchema.parse(args);

    try {
      const config = this.configManager.getConfig();
      const section = input.section || 'all';

      let result: unknown;
      if (section === 'all') {
        result = config;
      } else {
        result = config[section as keyof CodexConfiguration];
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            section,
            config: result,
            configPath: this.configManager.getConfigPath() || 'using defaults'
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleConfigSet(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = ConfigSetInputSchema.parse(args);

    try {
      // Build partial config from input
      const partial: PartialCodexConfiguration = {};

      if (input.escalation) {
        partial.escalation = input.escalation;
      }
      if (input.workMode) {
        partial.workMode = input.workMode;
      }
      if (input.playwright) {
        partial.playwright = input.playwright;
      }
      if (input.review) {
        partial.review = input.review;
      }
      if (input.notifications) {
        partial.notifications = input.notifications;
      }
      if (input.memory) {
        partial.memory = input.memory;
      }

      // Apply changes
      this.configManager.setConfig(partial);

      // Validate after changes
      const validation = this.configManager.validateConfig(this.configManager.getConfig());

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: 'Configuration updated',
            warnings: validation.warnings.map(w => `${w.path}: ${w.message}`),
            hint: 'Use god_config_save to persist changes to file'
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleConfigLoad(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = ConfigLoadInputSchema.parse(args);

    try {
      const config = this.configManager.loadConfig(input.path);
      const validation = this.configManager.validateConfig(config);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: 'Configuration loaded',
            path: this.configManager.getConfigPath(),
            version: config.version,
            warnings: validation.warnings.map(w => `${w.path}: ${w.message}`)
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
            hint: 'Use god_config_save to create a config file, or copy codex.yaml.example'
          }, null, 2)
        }]
      };
    }
  }

  private async handleConfigSave(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = ConfigSaveInputSchema.parse(args);

    try {
      this.configManager.saveConfig(input.path);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: 'Configuration saved',
            path: this.configManager.getConfigPath()
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleConfigReset(): Promise<{ content: Array<{ type: string; text: string }> }> {
    try {
      this.configManager.resetToDefaults();
      const config = this.configManager.getConfig();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: 'Configuration reset to defaults',
            config,
            hint: 'Use god_config_save to persist changes to file'
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  // ==========================================
  // Failure Learning Handlers (Stage 7)
  // ==========================================

  private async handleFailureRecord(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = FailureRecordInputSchema.parse(args);
    const failureService = await this.getFailureService();

    try {
      const failure = await failureService.recordFailure({
        taskId: input.taskId,
        subtaskId: input.subtaskId,
        attemptNumber: input.attemptNumber,
        approach: input.approach,
        error: input.error,
        errorType: input.errorType,
        consoleErrors: input.consoleErrors,
        screenshot: input.screenshot,
        stackTrace: input.stackTrace,
        context: input.context,
        subtaskType: input.subtaskType
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            failureId: failure.id,
            errorType: failure.errorType,
            message: `Recorded failure: ${failure.error.substring(0, 100)}...`,
            tags: ['failure', 'codex', `error:${failure.errorType}`, `subtask:${input.subtaskType}`]
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleFailureQuery(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = FailureQueryInputSchema.parse(args);
    const failureService = await this.getFailureService();

    try {
      const result = await failureService.queryFailures({
        error: input.error,
        context: input.context,
        topK: input.topK,
        minScore: input.minScore
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            similarFailuresCount: result.similarFailures.length,
            similarFailures: result.similarFailures.map(f => ({
              id: f.id,
              error: f.error.substring(0, 200),
              approach: f.approach,
              errorType: f.errorType,
              resolved: f.resolved,
              resolutionApproach: f.resolutionApproach
            })),
            suggestedAvoidances: result.suggestedAvoidances,
            recommendedApproaches: result.recommendedApproaches,
            guidance: result.recommendedApproaches.length > 0
              ? `Try: ${result.recommendedApproaches[0]}`
              : result.suggestedAvoidances.length > 0
                ? `Avoid: ${result.suggestedAvoidances.join(', ')}`
                : 'No similar failures found'
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleFailureResolve(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = FailureResolveInputSchema.parse(args);
    const failureService = await this.getFailureService();

    try {
      const success = await failureService.recordResolution({
        failureId: input.failureId,
        approach: input.approach
      });

      if (!success) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'Failure not found or could not be resolved',
              failureId: input.failureId
            }, null, 2)
          }]
        };
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: 'Failure marked as resolved',
            failureId: input.failureId,
            resolutionApproach: input.approach,
            learningFeedback: 'High-quality feedback provided to Sona'
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleFailureStats(): Promise<{ content: Array<{ type: string; text: string }> }> {
    const failureService = await this.getFailureService();

    try {
      const stats: FailureStats = await failureService.getStats();

      const resolutionRate = stats.totalFailures > 0
        ? (stats.resolvedFailures / stats.totalFailures * 100).toFixed(1)
        : '0';

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            stats: {
              totalFailures: stats.totalFailures,
              resolvedFailures: stats.resolvedFailures,
              unresolvedFailures: stats.unresolvedFailures,
              resolutionRate: `${resolutionRate}%`,
              uniquePatterns: stats.uniquePatterns,
              errorTypeBreakdown: stats.errorTypeBreakdown,
              failuresBySubtaskType: stats.failuresBySubtaskType
            },
            insights: [
              stats.unresolvedFailures > 5 ? 'Many unresolved failures - review recurring patterns' : null,
              Object.keys(stats.errorTypeBreakdown).length > 0
                ? `Most common error type: ${Object.entries(stats.errorTypeBreakdown).sort((a, b) => b[1] - a[1])[0]?.[0] || 'none'}`
                : null
            ].filter(Boolean)
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  // ==========================================
  // Communication Handlers (Stage 10)
  // ==========================================

  private getCommunicationManager(): CommunicationManager {
    if (!this.communications) {
      const codexConfig = this.configManager.getConfig();

      // Check for Telegram env vars (auto-configure if available)
      const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
      const telegramChatId = process.env.TELEGRAM_CHAT_ID;
      const hasTelegram = !!(telegramBotToken && telegramChatId);

      // Enable communications if configured or Telegram env vars present
      // Actual availability is determined at runtime by daemon detection
      const shouldEnableComms = codexConfig.communications?.enabled || hasTelegram;

      // Map CodexConfiguration communications to CommunicationConfig format
      const commsConfig: Partial<CommunicationConfig> = codexConfig.communications ? {
        enabled: shouldEnableComms,
        fallbackOrder: codexConfig.communications.fallbackOrder || ['telegram', 'phone', 'sms', 'slack', 'discord', 'email'],
        timeoutMs: codexConfig.communications.timeoutMs || 300000,
        retryAttempts: codexConfig.communications.retryAttempts || 1,
        webhookServer: codexConfig.communications.webhookServer || { port: 3456 },
        // Auto-configure Telegram from env vars
        telegram: hasTelegram ? {
          enabled: true,
          botToken: telegramBotToken!,
          chatId: telegramChatId!
        } : undefined
      } : {
        // Default config - auto-enable if Telegram env vars present
        enabled: shouldEnableComms,
        fallbackOrder: ['telegram', 'phone', 'sms', 'slack', 'discord', 'email'],
        timeoutMs: 300000,
        retryAttempts: 1,
        webhookServer: { port: 3456 },
        telegram: hasTelegram ? {
          enabled: true,
          botToken: telegramBotToken!,
          chatId: telegramChatId!
        } : undefined
      };

      this.communications = new CommunicationManager(commsConfig);

      // Initialize channels if enabled
      if (commsConfig.enabled) {
        this.communications.initialize();
        // Enable TelegramChannel polling since there's no TelegramBot in MCP mode
        this.communications.setTelegramBotActive(false);
        console.log(`[MCP Server] CommunicationManager initialized - channels: ${this.communications.getConfiguredChannels().join(', ') || 'none'}`);
        console.log('[MCP Server] TelegramChannel polling enabled for CLI routing');
      } else {
        console.log('[MCP Server] CommunicationManager disabled - no channels configured');
      }
    }
    return this.communications;
  }

  private async handleCommsSetup(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = args as {
      mode?: string;
      channel?: ChannelType;
      config?: Record<string, unknown>;
      fallbackOrder?: ChannelType[];
    };

    const mode = input.mode || 'wizard';
    const comms = this.getCommunicationManager();

    try {
      switch (mode) {
        case 'wizard':
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: 'RUBIX Communication Setup Wizard',
                instructions: `
## Multi-Channel Escalation Setup

RUBIX uses a fallback chain to reach you when it needs input:
Telegram → Phone → SMS → Slack → Discord → Email

Each channel has a 5-minute timeout before trying the next.

### Configure Channels

**1. Telegram (Recommended - Free & Bidirectional)**
god_comms_setup mode="set" channel="telegram" config={
  "enabled": true,
  "botToken": "YOUR_BOT_TOKEN",
  "chatId": "YOUR_CHAT_ID"
}

**2. Phone (via CallMe)**
god_comms_setup mode="set" channel="phone" config={
  "enabled": true,
  "provider": "callme",
  "phoneNumber": "+15551234567"
}

**3. SMS (via Twilio)**
god_comms_setup mode="set" channel="sms" config={
  "enabled": true,
  "provider": "twilio",
  "phoneNumber": "+15551234567",
  "accountSid": "AC...",
  "authToken": "...",
  "fromNumber": "+15559876543"
}

**4. Slack**
god_comms_setup mode="set" channel="slack" config={
  "enabled": true,
  "webhookUrl": "https://hooks.slack.com/services/..."
}

**5. Discord**
god_comms_setup mode="set" channel="discord" config={
  "enabled": true,
  "webhookUrl": "https://discord.com/api/webhooks/..."
}

**6. Email**
god_comms_setup mode="set" channel="email" config={
  "enabled": true,
  "smtp": { "host": "smtp.gmail.com", "port": 587 },
  "fromAddress": "codex@example.com",
  "toAddress": "you@example.com"
}

### Other Commands
- god_comms_setup mode="status" - Show current configuration
- god_comms_setup mode="test" - Test all channels
- god_comms_setup mode="order" fallbackOrder=["slack", "sms"] - Set order
- god_comms_setup mode="enable" - Enable communications
`,
                currentStatus: comms.getStatus()
              }, null, 2)
            }]
          };

        case 'status':
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                enabled: comms.isEnabled(),
                config: comms.getConfig(),
                channelStatus: comms.getStatus()
              }, null, 2)
            }]
          };

        case 'test':
          comms.initialize();
          const testResults = await comms.testAllChannels();
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                testResults,
                summary: Object.entries(testResults)
                  .map(([ch, ok]) => `${ch}: ${ok ? '✓ PASS' : '✗ FAIL'}`)
                  .join('\n')
              }, null, 2)
            }]
          };

        case 'set':
          if (!input.channel || !input.config) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  error: 'Channel and config required. Use mode="wizard" for help.'
                }, null, 2)
              }]
            };
          }
          // Update the specific channel config
          const channelConfig: Record<string, unknown> = {
            ...input.config,
            enabled: input.config.enabled !== false
          };
          const updateConfig: Partial<CommunicationConfig> = {
            [input.channel]: channelConfig
          };
          comms.updateConfig(updateConfig);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `${input.channel} channel configured`,
                channel: input.channel,
                enabled: channelConfig.enabled
              }, null, 2)
            }]
          };

        case 'disable':
          if (!input.channel) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  error: 'Channel required for disable mode'
                }, null, 2)
              }]
            };
          }
          comms.updateConfig({ [input.channel]: { enabled: false } } as Partial<CommunicationConfig>);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `${input.channel} channel disabled`
              }, null, 2)
            }]
          };

        case 'enable':
          comms.updateConfig({ enabled: true });
          comms.initialize();
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: 'Communications enabled',
                status: comms.getStatus()
              }, null, 2)
            }]
          };

        case 'order':
          if (!input.fallbackOrder || !Array.isArray(input.fallbackOrder)) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  error: 'fallbackOrder array required'
                }, null, 2)
              }]
            };
          }
          comms.updateConfig({ fallbackOrder: input.fallbackOrder });
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `Fallback order set to: ${input.fallbackOrder.join(' → ')}`
              }, null, 2)
            }]
          };

        default:
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: `Unknown mode: ${mode}`
              }, null, 2)
            }]
          };
      }
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleCommsEscalate(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = args as {
      title: string;
      message: string;
      type?: 'clarification' | 'decision' | 'blocked' | 'approval';
      options?: Array<{ label: string; description: string }>;
    };

    // Detect if daemon is running
    const daemonStatus = await DaemonDetector.detect();

    if (!daemonStatus.running) {
      // Daemon not running - return fallback response for CLI mode
      const fallbackResponse: EscalationFallbackResponse = {
        success: false,
        daemonRequired: true,
        fallbackAction: 'ask_user_question',
        question: {
          title: input.title,
          message: input.message,
          type: input.type,
          options: input.options
        },
        instructions: 'Daemon not detected. Use AskUserQuestion tool with the above question data.',
        detectionDetails: {
          method: daemonStatus.method,
          details: daemonStatus.details || 'No daemon detected'
        }
      };

      console.log(`[MCP] Daemon not detected (${daemonStatus.method}), returning CLI fallback`);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(fallbackResponse, null, 2)
        }]
      };
    }

    // Daemon is running — check AFK state to decide routing
    const afkState = this.readAfkState();

    if (!afkState.afk) {
      // Daemon running but user is at keyboard — route to CLI
      const atKeyboardResponse: EscalationFallbackResponse = {
        success: false,
        daemonRequired: true,
        fallbackAction: 'ask_user_question',
        question: {
          title: input.title,
          message: input.message,
          type: input.type,
          options: input.options
        },
        instructions: 'User is at keyboard (AFK mode OFF). Use AskUserQuestion tool with the above question data.',
        detectionDetails: {
          method: daemonStatus.method,
          details: 'Daemon running but AFK mode is OFF — routing to CLI'
        }
      };

      console.log(`[MCP] Daemon detected but AFK OFF — routing to CLI (at_keyboard)`);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ ...atKeyboardResponse, routingReason: 'at_keyboard' }, null, 2)
        }]
      };
    }

    // AFK mode is ON — proceed with Telegram escalation
    console.log(`[MCP] Daemon detected + AFK ON (${daemonStatus.method}), proceeding with Telegram escalation`);

    const comms = this.getCommunicationManager();

    if (!comms.isEnabled()) {
      // This shouldn't happen if daemon is detected, but handle it gracefully
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: 'Communications not enabled despite daemon being detected. Run god_comms_setup mode="enable" first.',
            daemonStatus
          }, null, 2)
        }]
      };
    }

    try {
      const escalation = {
        id: `manual-${Date.now()}`,
        taskId: 'manual-escalation',
        type: input.type || 'clarification' as const,
        title: input.title,
        context: input.message,
        options: input.options,
        blocking: true
      };

      console.log(`[MCP] Starting manual escalation: ${input.title}`);
      const response: EscalationResponse | null = await comms.escalate(escalation);

      if (response) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              response: response.response,
              channel: response.channel,
              selectedOption: response.selectedOption,
              receivedAt: response.receivedAt
            }, null, 2)
          }]
        };
      } else {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'No response received from any channel',
              message: 'All channels were exhausted without receiving a response'
            }, null, 2)
          }]
        };
      }
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  // ==========================================
  // AFK Mode Handler
  // ==========================================

  private getAfkStatePath(): string {
    return join(process.cwd(), 'data', 'afk-state.json');
  }

  private readAfkState(): { afk: boolean; since: string | null } {
    try {
      const p = this.getAfkStatePath();
      if (existsSync(p)) {
        return JSON.parse(readFileSync(p, 'utf8'));
      }
    } catch {
      // ignore
    }
    return { afk: false, since: null };
  }

  private writeAfkState(state: { afk: boolean; since: string | null }): void {
    const p = this.getAfkStatePath();
    const dir = dirname(p);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(p, JSON.stringify(state, null, 2));
  }

  private async handleAfk(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = args as { action?: 'status' | 'toggle' | 'on' | 'off' };
    const action = input.action || 'status';
    const current = this.readAfkState();

    if (action === 'status') {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(current, null, 2)
        }]
      };
    }

    let newAfk: boolean;
    if (action === 'on') {
      newAfk = true;
    } else if (action === 'off') {
      newAfk = false;
    } else {
      // toggle
      newAfk = !current.afk;
    }

    const newState = {
      afk: newAfk,
      since: newAfk ? new Date().toISOString() : null
    };

    this.writeAfkState(newState);

    const statusMsg = newAfk
      ? 'AFK mode ON — all interactions will route through Telegram'
      : 'AFK mode OFF — interactions return to CLI';

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ ...newState, message: statusMsg }, null, 2)
      }]
    };
  }

  // ==========================================
  // Inter-Instance Communication Handlers
  // ==========================================

  private getCommsStore(): CommsStore {
    if (!this.commsStore) {
      this.commsStore = new CommsStore(this.dataDir);
      // Run cleanup on first init
      const cleaned = this.commsStore.cleanup(48);
      if (cleaned > 0) {
        console.log(`[CommsStore] Cleaned ${cleaned} old messages on init`);
      }
    }
    return this.commsStore;
  }

  private requireInstanceId(): string {
    if (!this.instanceId) {
      throw new Error('Call god_comms_heartbeat first to register your instance identity');
    }
    return this.instanceId;
  }

  private async handleCommsHeartbeat(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = args as { instanceId: string; name?: string; role?: string; metadata?: unknown };
    const store = this.getCommsStore();

    this.instanceId = input.instanceId;
    this.instanceName = input.name ?? this.instanceName;
    store.heartbeat(input.instanceId, input.role, input.metadata, input.name);

    // Persist identity for hooks (recall, stop, plan) that need to filter self-sent messages
    try {
      const { writeFileSync, mkdirSync, existsSync } = await import('fs');
      const { join, isAbsolute } = await import('path');
      const resolvedDataDir = isAbsolute(this.dataDir) ? this.dataDir : join(process.cwd(), this.dataDir);
      if (!existsSync(resolvedDataDir)) mkdirSync(resolvedDataDir, { recursive: true });
      writeFileSync(
        join(resolvedDataDir, 'hook-identity.json'),
        JSON.stringify({ instanceId: input.instanceId, name: input.name ?? null, role: input.role ?? null, timestamp: new Date().toISOString() })
      );
    } catch {
      // Non-critical — hooks will fall back to counting all messages
    }

    const displayName = input.name ? `${input.name} (${input.instanceId})` : input.instanceId;
    console.log(`[CommsStore] Instance registered: ${displayName} (role: ${input.role ?? 'unset'})`);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          instanceId: input.instanceId,
          name: input.name ?? null,
          role: input.role ?? null,
          message: `Registered as ${displayName}. Inter-instance comms ready.`
        }, null, 2)
      }]
    };
  }

  private async handleCommsSend(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const fromInstance = this.requireInstanceId();
    const input = args as {
      to: string;
      type: MessageType;
      priority?: MessagePriority;
      subject?: string;
      payload: unknown;
      threadId?: string;
      expiresInMs?: number;
    };
    const store = this.getCommsStore();

    const id = store.send(fromInstance, {
      to: input.to,
      type: input.type,
      priority: input.priority,
      subject: input.subject,
      payload: input.payload,
      threadId: input.threadId,
      expiresInMs: input.expiresInMs
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          messageId: id,
          to: input.to,
          type: input.type,
          subject: input.subject ?? null,
          message: `Message sent to ${input.to}`
        }, null, 2)
      }]
    };
  }

  private async handleCommsBroadcast(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const fromInstance = this.requireInstanceId();
    const input = args as {
      type: MessageType;
      priority?: MessagePriority;
      subject?: string;
      payload: unknown;
      expiresInMs?: number;
    };
    const store = this.getCommsStore();

    const id = store.send(fromInstance, {
      type: input.type,
      priority: input.priority,
      subject: input.subject,
      payload: input.payload,
      expiresInMs: input.expiresInMs
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          messageId: id,
          broadcast: true,
          type: input.type,
          subject: input.subject ?? null,
          message: `Broadcast sent to all instances`
        }, null, 2)
      }]
    };
  }

  private async handleCommsInbox(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const instanceId = this.requireInstanceId();
    const input = args as InboxFilters;
    const store = this.getCommsStore();

    const messages = store.inbox(instanceId, input);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          instanceId,
          count: messages.length,
          messages: messages.map(m => ({
            id: m.id,
            from: m.from_instance,
            to: m.to_instance,
            type: m.type,
            priority: m.priority,
            subject: m.subject,
            payload: (() => { try { return JSON.parse(m.payload); } catch { return m.payload; } })(),
            threadId: m.thread_id,
            status: m.status,
            createdAt: m.created_at,
            expiresAt: m.expires_at
          }))
        }, null, 2)
      }]
    };
  }

  private async handleCommsRead(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const instanceId = this.requireInstanceId();
    const input = args as { messageId: string };
    const store = this.getCommsStore();

    const msg = store.read(instanceId, input.messageId);
    if (!msg) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ success: false, error: `Message not found: ${input.messageId}` }, null, 2)
        }]
      };
    }

    let parsedPayload: unknown;
    try { parsedPayload = JSON.parse(msg.payload); } catch { parsedPayload = msg.payload; }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: {
            id: msg.id,
            from: msg.from_instance,
            to: msg.to_instance,
            type: msg.type,
            priority: msg.priority,
            subject: msg.subject,
            payload: parsedPayload,
            threadId: msg.thread_id,
            status: msg.status,
            createdAt: msg.created_at,
            readAt: msg.read_at,
            expiresAt: msg.expires_at
          }
        }, null, 2)
      }]
    };
  }

  private async handleCommsAck(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const instanceId = this.requireInstanceId();
    const input = args as { messageId: string };
    const store = this.getCommsStore();

    const success = store.ack(instanceId, input.messageId);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success,
          messageId: input.messageId,
          message: success ? 'Message acknowledged' : `Message not found: ${input.messageId}`
        }, null, 2)
      }]
    };
  }

  private async handleCommsThread(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = args as { threadId: string };
    const store = this.getCommsStore();

    const messages = store.thread(input.threadId);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          threadId: input.threadId,
          count: messages.length,
          messages: messages.map(m => ({
            id: m.id,
            from: m.from_instance,
            to: m.to_instance,
            type: m.type,
            priority: m.priority,
            subject: m.subject,
            payload: (() => { try { return JSON.parse(m.payload); } catch { return m.payload; } })(),
            threadId: m.thread_id,
            status: m.status,
            createdAt: m.created_at
          }))
        }, null, 2)
      }]
    };
  }

  private async handleCommsPeers(): Promise<{ content: Array<{ type: string; text: string }> }> {
    const store = this.getCommsStore();
    const instances = store.listInstances();
    const stats = store.stats();

    const currentDisplay = this.instanceName
      ? `${this.instanceName} (${this.instanceId})`
      : this.instanceId ?? '(not registered — call god_comms_heartbeat)';

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          currentInstance: currentDisplay,
          peers: instances.map(i => ({
            instanceId: i.instance_id,
            name: i.name,
            role: i.role,
            status: i.status,
            lastHeartbeat: i.last_heartbeat,
            metadata: i.metadata ? (() => { try { return JSON.parse(i.metadata!); } catch { return i.metadata; } })() : null
          })),
          stats: {
            totalMessages: stats.totalMessages,
            unread: stats.unread,
            activeInstances: stats.activeInstances
          }
        }, null, 2)
      }]
    };
  }

  // ==========================================
  // Inter-Instance Trigger Handlers
  // ==========================================

  private getTriggerService(): TriggerService {
    if (!this.triggerService) {
      const store = this.getCommsStore();
      this.triggerService = new TriggerService(store, this.dataDir, this.projectRoot);
    }
    return this.triggerService;
  }

  private async handleCommsTrigger(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const fromInstance = this.requireInstanceId();
    const input = args as {
      targetInstance: string;
      targetName?: string;
      task: string;
      priority?: 0 | 1 | 2;
      context?: string;
      chainDepth?: number;
      maxChainDepth?: number;
    };

    const service = this.getTriggerService();
    const result = await service.trigger(fromInstance, this.instanceName, {
      targetInstance: input.targetInstance,
      targetName: input.targetName,
      task: input.task,
      priority: input.priority,
      context: input.context,
      chainDepth: input.chainDepth,
      maxChainDepth: input.maxChainDepth
    });

    const isError = result.status === 'failed';
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: !isError,
          ...result,
          message: isError
            ? result.error
            : `Trigger spawned. Session running as ${input.targetName ?? input.targetInstance}. Check status with god_comms_trigger_status or wait for comms response.`
        }, null, 2)
      }],
      ...(isError ? { isError: true } : {})
    };
  }

  private async handleCommsTriggerStatus(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = args as { triggerId?: string; status?: string; limit?: number };
    const service = this.getTriggerService();

    if (input.triggerId) {
      const result = service.getStatus(input.triggerId) as TriggerResult;
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }]
      };
    }

    const tasks = service.getStatus(undefined, {
      status: input.status,
      limit: input.limit
    }) as TriggerTaskRow[];

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          triggers: tasks.map(t => ({
            id: t.id,
            from: t.from_instance,
            target: t.target_instance,
            status: t.status,
            task: t.raw_task.substring(0, 200) + (t.raw_task.length > 200 ? '...' : ''),
            chainDepth: `${t.chain_depth}/${t.max_chain_depth}`,
            createdAt: t.created_at,
            startedAt: t.started_at,
            completedAt: t.completed_at,
            hasResult: !!t.result,
            error: t.error
          })),
          count: tasks.length
        }, null, 2)
      }]
    };
  }

  private async handleCommsTriggerCancel(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = args as { triggerId: string };
    const service = this.getTriggerService();
    const result = service.cancel(input.triggerId);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: result.status === 'cancelled',
          ...result
        }, null, 2)
      }]
    };
  }

  // Deep Work Mode Handlers (Stage 8)
  private async handleDeepWorkStart(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = DeepWorkStartInputSchema.parse(args);
    await this.getEngine();
    const executor = await this.getTaskExecutor();
    const deepWork = executor.getDeepWorkManager();
    const notificationPolicy: Record<string, boolean> = {};
    if (input.allowProgress !== undefined) notificationPolicy.allowProgress = input.allowProgress;
    if (input.allowBlocked !== undefined) notificationPolicy.allowBlocked = input.allowBlocked;
    if (input.allowComplete !== undefined) notificationPolicy.allowComplete = input.allowComplete;
    if (input.allowUrgent !== undefined) notificationPolicy.allowUrgent = input.allowUrgent;
    if (input.batchNonUrgent !== undefined) notificationPolicy.batchNonUrgent = input.batchNonUrgent;
    const session = deepWork.startSession(input.taskId ?? 'manual', { focusLevel: input.focusLevel as 'shallow' | 'normal' | 'deep' | undefined, notificationPolicy: Object.keys(notificationPolicy).length > 0 ? notificationPolicy : undefined });
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, sessionId: session.id, taskId: session.taskId, status: session.status, focusLevel: session.focusLevel, notificationPolicy: session.notificationPolicy, message: `Deep work session started with ${session.focusLevel} focus` }, null, 2) }] };
  }
  private async handleDeepWorkPause(): Promise<{ content: Array<{ type: string; text: string }> }> {
    await this.getEngine();
    const executor = await this.getTaskExecutor();
    const session = executor.pauseDeepWork();
    if (!session) return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'No active deep work session to pause' }) }] };
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, sessionId: session.id, status: session.status, activeTimeMs: session.activeTimeMs, message: 'Deep work session paused' }, null, 2) }] };
  }
  private async handleDeepWorkResume(): Promise<{ content: Array<{ type: string; text: string }> }> {
    await this.getEngine();
    const executor = await this.getTaskExecutor();
    const session = executor.resumeDeepWork();
    if (!session) return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'No paused deep work session to resume' }) }] };
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, sessionId: session.id, status: session.status, message: 'Deep work session resumed' }, null, 2) }] };
  }
  private async handleDeepWorkStatus(): Promise<{ content: Array<{ type: string; text: string }> }> {
    await this.getEngine();
    const executor = await this.getTaskExecutor();
    const status = executor.getDeepWorkStatus();
    if (!status) return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'No deep work session active', hasActiveSession: false }) }] };
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, hasActiveSession: true, session: { id: status.session.id, taskId: status.session.taskId, status: status.session.status, focusLevel: status.session.focusLevel, startedAt: status.session.startedAt.toISOString() }, currentTask: status.currentTask, progress: status.progress, eta: status.eta, activeTime: status.activeTimeFormatted, pendingDecisions: status.pendingDecisions, blockers: status.blockers, batchedNotifications: status.batchedNotifications, recentActivity: status.recentActivity.slice(-5).map(a => ({ type: a.type, message: a.message, timestamp: a.timestamp.toISOString() })), checkpointCount: status.session.checkpoints.length, logEntryCount: status.session.workLog.length }, null, 2) }] };
  }
  private async handleDeepWorkLog(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = DeepWorkLogInputSchema.parse(args);
    await this.getEngine();
    const deepWork = (await this.getTaskExecutor()).getDeepWorkManager();
    const log = deepWork.getWorkLog(input.sessionId, input.limit);
    if (log.length === 0) return { content: [{ type: 'text', text: JSON.stringify({ success: true, count: 0, entries: [], message: input.sessionId ? 'No log entries for this session' : 'No active session or empty log' }) }] };
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, count: log.length, entries: log.map(e => ({ id: e.id, type: e.type, message: e.message, timestamp: e.timestamp.toISOString(), subtaskId: e.subtaskId, details: e.details })) }, null, 2) }] };
  }
  private async handleDeepWorkCheckpoint(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = DeepWorkCheckpointInputSchema.parse(args);
    await this.getEngine();
    const checkpoint = (await this.getTaskExecutor()).createDeepWorkCheckpoint(input.summary);
    if (!checkpoint) return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'No active deep work session or task' }) }] };
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, checkpointId: checkpoint.id, timestamp: checkpoint.timestamp.toISOString(), subtasksComplete: checkpoint.subtasksComplete, subtasksRemaining: checkpoint.subtasksRemaining, summary: checkpoint.summary, message: `Checkpoint created: ${checkpoint.summary}` }, null, 2) }] };
  }

  // ==========================================
  // Curiosity Handlers
  // ==========================================

  private async handleCuriosityList(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = z.object({
      status: z.enum(['pending', 'exploring', 'resolved', 'all']).optional(),
      limit: z.number().optional()
    }).parse(args);

    const tracker = await this.getCuriosityTracker();
    const status = input.status || 'pending';
    const limit = input.limit || 10;

    let probes;
    if (status === 'all') {
      probes = await tracker.getExplorationOpportunities(limit);
    } else {
      probes = await tracker.getProbesByStatus(status as ProbeStatus, limit);
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          probes: probes.map(p => ({
            id: p.id,
            domain: p.domain,
            question: p.question,
            origin: p.origin,
            priority: p.priority,
            status: p.status,
            estimatedTokens: p.estimatedTokens
          })),
          count: probes.length
        }, null, 2)
      }]
    };
  }

  private async handleCuriosityExplore(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = z.object({
      probeId: z.string().optional()
    }).parse(args);

    const discovery = await this.getDiscoveryEngine();
    const budget = await this.getTokenBudget();

    // Check if we can explore
    if (!budget.canExplore()) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            reason: 'weekly_limit_reached',
            remainingProbes: budget.getRemainingProbes()
          }, null, 2)
        }]
      };
    }

    // Run exploration - specific probe or discovery cycle
    let result;
    if (input.probeId) {
      result = await discovery.exploreProbe(input.probeId);
      if (!result) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              reason: 'probe_not_found_or_not_pending',
              probeId: input.probeId
            }, null, 2)
          }]
        };
      }
    } else {
      result = await discovery.discoveryCycle();
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };
  }

  private async handleCuriosityWebExplore(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = z.object({
      searchQuery: z.string().optional(),
      urls: z.array(z.string()).optional(),
      maxPages: z.number().optional(),
      selectors: z.array(z.string()).optional(),
      storeAsProbe: z.boolean().optional()
    }).parse(args);

    // Need at least a search query or URLs
    if (!input.searchQuery && (!input.urls || input.urls.length === 0)) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: 'Either searchQuery or urls must be provided'
          }, null, 2)
        }]
      };
    }

    const discovery = await this.getDiscoveryEngine();
    const webStrategy = discovery.getWebStrategy();

    // Run web exploration
    const result = await webStrategy.exploreWithConfig({
      searchQuery: input.searchQuery,
      urls: input.urls,
      maxPages: input.maxPages ?? 3,
      selectors: input.selectors,
      captureScreenshots: true
    }, input.searchQuery || input.urls?.join(', '));

    // Optionally store findings as a resolved probe
    if (input.storeAsProbe !== false && result.success) {
      const curiosity = await this.getCuriosityTracker();
      const probeId = await curiosity.recordCuriosity({
        domain: 'web-research',
        question: input.searchQuery || `Explore: ${input.urls?.slice(0, 2).join(', ')}`,
        origin: 'knowledge_gap',
        confidence: 0.7,
        noveltyScore: 0.5,
        estimatedTokens: 1000,
        context: {
          webConfig: {
            searchQuery: input.searchQuery,
            urls: input.urls,
            maxPages: input.maxPages,
            selectors: input.selectors
          },
          explorationMethod: 'web'
        }
      });

      // Immediately resolve it with findings
      await curiosity.startExploring(probeId);
      await curiosity.recordDiscovery(probeId, {
        success: true,
        tokensUsed: 0,
        findings: `Web exploration visited ${result.visitedUrls.length} pages. Content extracted from: ${result.visitedUrls.join(', ')}`,
        storedFacts: result.visitedUrls,
        confidence: 0.7,
        durationMs: result.durationMs
      });
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: result.success,
          searchQuery: result.searchQuery,
          visitedUrls: result.visitedUrls,
          screenshots: result.screenshots,
          pageCount: result.pageContents.length,
          pages: result.pageContents.map(p => ({
            url: p.url,
            title: p.title,
            textLength: p.text.length,
            textPreview: p.text.slice(0, 200) + (p.text.length > 200 ? '...' : '')
          })),
          durationMs: result.durationMs,
          error: result.error
        }, null, 2)
      }]
    };
  }

  private async handleBudgetStatus(): Promise<{ content: Array<{ type: string; text: string }> }> {
    const budget = await this.getTokenBudget();
    const config = getCuriosityConfig();

    const status = {
      canExplore: budget.canExplore(),
      remainingProbes: budget.getRemainingProbes(),
      cyclePosition: budget.getCyclePosition(),
      nextProbeType: budget.getNextProbeType(),
      config: {
        tokensPerProbe: config.tokensPerProbe,
        probesPerWeek: config.probesPerWeek,
        highPriorityRatio: config.highPriorityRatio,
        pattern: `${config.highPriorityRatio} high-priority, then 1 moderate`
      }
    };

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(status, null, 2)
      }]
    };
  }

  private async handleBudgetHistory(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = z.object({
      weeks: z.number().optional()
    }).parse(args);

    const tracker = await this.getCuriosityTracker();
    const weeks = input.weeks || 4;
    const since = new Date();
    since.setDate(since.getDate() - (weeks * 7));

    const history = await tracker.getExplorationHistory(since);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          explorations: history.map(h => ({
            probeId: h.probeId,
            domain: h.domain,
            tokensUsed: h.tokensUsed,
            success: h.success,
            exploredAt: h.exploredAt
          })),
          count: history.length,
          periodWeeks: weeks
        }, null, 2)
      }]
    };
  }

  // ==========================================
  // Memory Compression Handlers
  // ==========================================

  private async handleStoreCompressed(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    // DEPRECATED: Forward to handleStore which now compresses by default
    const input = z.object({
      content: z.string(),
      type: z.enum(['component', 'department', 'mcp_tool', 'capability', 'workflow', 'config', 'error_pattern', 'success_pattern', 'system', 'bug_fix', 'dev_feature', 'arch_insight', 'generic']),
      tags: z.array(z.string()).optional(),
      importance: z.number().min(0).max(1).optional()
    }).parse(args);

    // Forward to unified handleStore
    const result = await this.handleStore({
      content: input.content,
      type: input.type,
      tags: input.tags,
      importance: input.importance,
      source: 'agent_inference'
    });

    // Add deprecation notice to response
    const parsed = JSON.parse(result.content[0].text);
    parsed.deprecated = true;
    parsed.notice = 'god_store_compressed is deprecated. Use god_store instead - all storage now compresses by default.';

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(parsed, null, 2)
      }]
    };
  }

  private async handleQueryExpanded(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = z.object({
      query: z.string(),
      expand: z.boolean().optional(),
      topK: z.number().optional(),
      tags: z.array(z.string()).optional()
    }).parse(args);

    const engine = await this.getEngine();
    const shouldExpand = input.expand !== false;
    const llmCompressor = this.getLLMCompressor();

    const results = await engine.query(input.query, {
      topK: input.topK || 10,
      filters: { tags: input.tags }
    });

    // Use Promise.all since LLM decompression is async
    const expandedResults = await Promise.all(results.map(async r => {
      const tags = r.entry.metadata.tags || [];
      const isLLMCompressed = tags.includes('llm-compressed');
      const isLegacyCompressed = tags.includes('compressed');
      let content = r.entry.content;
      let compressionMethod = 'none';

      if (shouldExpand) {
        // LLM compressed entries - use LLM decompression
        if (isLLMCompressed && llmCompressor.isAvailable()) {
          content = await llmCompressor.decompress(r.entry.content);
          compressionMethod = 'llm';
        }
        // Legacy compressed entries - use regex decoder
        else if (isLegacyCompressed) {
          const typeTag = tags.find((t: string) => t.startsWith('type:'));
          const memType = typeTag ? typeTag.replace('type:', '') : undefined;
          content = memoryCompressor.decode(r.entry.content, memType as import('./memory/types.js').MemoryType);
          compressionMethod = 'legacy';
        }
      }

      return {
        id: r.entry.id,
        content,
        score: r.score,
        tags,
        compressed: isLLMCompressed || isLegacyCompressed,
        compressionMethod,
        type: tags.find((t: string) => t.startsWith('type:'))?.replace('type:', '')
      };
    }));

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          results: expandedResults,
          count: expandedResults.length,
          expanded: shouldExpand
        }, null, 2)
      }]
    };
  }

  private async handleSelfQuery(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = z.object({
      question: z.string(),
      format: z.enum(['tokens', 'readable', 'full']).optional(),
      topK: z.number().optional()
    }).parse(args);

    const engine = await this.getEngine();
    const bootstrap = new SelfKnowledgeBootstrap(engine);

    // Ensure bootstrapped
    const status = await bootstrap.getStatus();
    if (!status.bootstrapped) {
      await bootstrap.bootstrap();
    }

    // Query self-knowledge
    const rawAnswers = await bootstrap.querySelf(input.question, input.topK || 5);

    // Format based on requested format
    const format = input.format || 'readable';
    const answers = rawAnswers.map(answer => {
      // Check if it's token format (starts with SYS: or similar)
      if (answer.match(/^[A-Z]+:/m)) {
        switch (format) {
          case 'tokens':
            return answer;
          case 'full':
            return SelfKnowledgeCompressor.decompressFull(answer);
          case 'readable':
          default:
            return SelfKnowledgeCompressor.decompress(answer);
        }
      }
      // Already readable, return as-is
      return answer;
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          question: input.question,
          format,
          answers,
          count: answers.length
        }, null, 2)
      }]
    };
  }

  private async handleCompressionStats(): Promise<{ content: Array<{ type: string; text: string }> }> {
    const engine = await this.getEngine();

    // Query all compressed entries
    const results = await engine.query('compressed memory', {
      filters: { tags: ['compressed'] },
      topK: 1000
    });

    // Calculate stats
    const typeBreakdown: Record<string, number> = {};
    let totalTokensSaved = 0;
    let totalRatio = 0;

    for (const r of results) {
      const context = r.entry.metadata.context as Record<string, unknown> | undefined;
      const type = (context?.originalType as string) || 'generic';
      typeBreakdown[type] = (typeBreakdown[type] || 0) + 1;
      totalTokensSaved += (context?.tokensSaved as number) || 0;
      totalRatio += (context?.compressionRatio as number) || 0;
    }

    const avgRatio = results.length > 0 ? totalRatio / results.length : 0;

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          totalCompressedEntries: results.length,
          averageCompressionRatio: Math.round(avgRatio * 100) + '%',
          estimatedTokensSaved: totalTokensSaved,
          byType: typeBreakdown,
          registeredSchemas: memoryCompressor.getSchemaStats()
        }, null, 2)
      }]
    };
  }

  private async handleBootstrapStatus(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = z.object({
      runBootstrap: z.boolean().optional()
    }).parse(args);

    const engine = await this.getEngine();
    const bootstrap = new SelfKnowledgeBootstrap(engine);

    let status = await bootstrap.getStatus();
    let bootstrapResult = null;

    // Run bootstrap if requested and not already done
    if (input.runBootstrap && !status.bootstrapped) {
      bootstrapResult = await bootstrap.bootstrap();
      status = await bootstrap.getStatus();
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          bootstrapped: status.bootstrapped,
          entriesCount: status.entriesCount,
          categories: status.categories,
          bootstrapRan: bootstrapResult !== null,
          bootstrapStats: bootstrapResult
        }, null, 2)
      }]
    };
  }

  private async handleRecompressAll(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = z.object({
      dryRun: z.boolean().optional().default(false),
      batchSize: z.number().min(1).max(200).optional().default(50)
    }).parse(args);

    const engine = await this.getEngine();
    const storage = engine.getStorage();
    const db = storage.getDb();

    // Get ALL entries from database (better-sqlite3 is synchronous)
    const allEntries = db.prepare(`
      SELECT e.id, e.content, GROUP_CONCAT(t.tag) as tags
      FROM memory_entries e
      LEFT JOIN memory_tags t ON e.id = t.entry_id
      GROUP BY e.id
    `).all() as Array<{ id: string; content: string; tags: string | null }>;

    const stats = {
      totalEntries: allEntries.length,
      alreadyCompressed: 0,
      newlyCompressed: 0,
      failed: 0,
      tokensSaved: 0,
      samples: [] as Array<{ id: string; before: string; after: string; type: string }>
    };

    // Prepare statements for updates
    const updateContent = db.prepare('UPDATE memory_entries SET content = ? WHERE id = ?');
    const insertTag = db.prepare('INSERT OR IGNORE INTO memory_tags (entry_id, tag) VALUES (?, ?)');

    // Process entries
    for (const entry of allEntries) {
      const tags = entry.tags ? entry.tags.split(',') : [];

      // Skip if already has 'compressed' tag
      if (tags.includes('compressed')) {
        stats.alreadyCompressed++;
        continue;
      }

      // Skip if content looks already compressed (pipe-delimited short segments)
      if (memoryCompressor.isCompressed(entry.content)) {
        stats.alreadyCompressed++;
        continue;
      }

      try {
        // Detect type and compress
        const detectedType = memoryCompressor.detectTypeFromContent(entry.content);
        const result = memoryCompressor.encode(entry.content, detectedType);

        // Only update if we actually achieved compression
        if (result.ratio > 0.1) {
          if (!input.dryRun) {
            // Update content in database
            updateContent.run(result.compressed, entry.id);

            // Add compressed tag
            insertTag.run(entry.id, 'compressed');

            // Add type tag
            insertTag.run(entry.id, `type:${detectedType}`);
          }

          stats.newlyCompressed++;
          stats.tokensSaved += result.tokensSaved;

          // Keep samples for first 5
          if (stats.samples.length < 5) {
            stats.samples.push({
              id: entry.id.substring(0, 8),
              before: entry.content.substring(0, 50) + '...',
              after: result.compressed.substring(0, 50) + '...',
              type: detectedType
            });
          }
        } else {
          // Low compression ratio - still mark as processed
          if (!input.dryRun) {
            insertTag.run(entry.id, 'compressed');
          }
          stats.alreadyCompressed++;
        }
      } catch (error) {
        stats.failed++;
      }
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          dryRun: input.dryRun,
          totalEntries: stats.totalEntries,
          alreadyCompressed: stats.alreadyCompressed,
          newlyCompressed: stats.newlyCompressed,
          failed: stats.failed,
          tokensSaved: stats.tokensSaved,
          samples: stats.samples,
          message: input.dryRun
            ? `Would compress ${stats.newlyCompressed} entries (${stats.tokensSaved} tokens saved)`
            : `Compressed ${stats.newlyCompressed} entries (${stats.tokensSaved} tokens saved)`
        }, null, 2)
      }]
    };
  }

  // ===========================================================================
  // REFLEXION HANDLERS (Verbal Reflexion System)
  // ===========================================================================

  private async handleReflexionQuery(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = ReflexionQueryInputSchema.parse(args);
    const reflexion = await this.getReflexionService();

    try {
      const result = await reflexion.queryReflections({
        query: input.query,
        topK: input.topK,
        minSimilarity: input.minSimilarity
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            reflectionsFound: result.reflections.length,
            reflections: result.reflections.map(r => ({
              id: r.reflection.id,
              failureId: r.reflection.failureId,
              whyItFailed: r.reflection.whyItFailed.substring(0, 300) + (r.reflection.whyItFailed.length > 300 ? '...' : ''),
              rootCause: r.reflection.rootCause,
              lesson: r.reflection.lesson,
              nextTimeApproach: r.reflection.nextTimeApproach,
              generatedAt: r.reflection.generatedAt,
              similarity: r.similarity
            })),
            lessons: result.reflections.slice(0, 3).map(r => r.reflection.lesson),
            applicableLessons: result.applicableLessons,
            suggestedApproaches: result.suggestedApproaches
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleReflexionGenerate(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = ReflexionGenerateInputSchema.parse(args);
    const reflexion = await this.getReflexionService();
    const failureService = await this.getFailureService();

    try {
      // First, try to find the failure in memory
      const failures = await failureService.queryFailures({
        error: input.failureId, // Use as search query
        topK: 1
      });

      if (failures.similarFailures.length === 0) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'Failure not found. Provide a valid failure ID or error message.'
            }, null, 2)
          }]
        };
      }

      const failure = failures.similarFailures[0];

      // Build reflection context
      const context: ReflectionContext = {
        failure: {
          id: failure.id,
          taskId: failure.taskId,
          subtaskId: failure.subtaskId,
          attemptNumber: failure.attemptNumber,
          approach: failure.approach,
          error: failure.error,
          errorType: failure.errorType,
          context: failure.context
        },
        taskDescription: input.taskDescription || `Task ${failure.taskId}`,
        subtaskDescription: input.subtaskDescription || `Subtask ${failure.subtaskId}`,
        previousAttempts: input.previousAttempts?.map((a, idx) => ({
          attemptNumber: idx + 1,
          approach: a.approach,
          error: a.error,
          outcome: 'failed' as const
        }))
      };

      // Generate reflection
      const reflection = await reflexion.generateReflection(context);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            reflection: {
              id: reflection.id,
              failureId: reflection.failureId,
              whyItFailed: reflection.whyItFailed,
              rootCause: reflection.rootCause,
              lesson: reflection.lesson,
              nextTimeApproach: reflection.nextTimeApproach,
              tokensUsed: reflection.tokensUsed
            },
            message: 'Reflection generated and stored in memory'
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  private async handleReflexionStats(): Promise<{ content: Array<{ type: string; text: string }> }> {
    const reflexion = await this.getReflexionService();

    try {
      const stats: ReflexionStats = await reflexion.getStats();

      // Find most common root cause
      const rootCauseEntries = Object.entries(stats.byRootCause);
      const mostCommonRootCause = rootCauseEntries.length > 0
        ? rootCauseEntries.sort((a, b) => b[1] - a[1])[0]?.[0]
        : 'none';

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            stats: {
              totalReflections: stats.totalReflections,
              byRootCause: stats.byRootCause,
              avgConfidence: stats.avgConfidence,
              totalTokensUsed: stats.totalTokensUsed,
              topLessons: stats.topLessons,
              resolutionRate: `${(stats.resolutionRate * 100).toFixed(1)}%`
            },
            insights: [
              stats.totalReflections > 0 ?
                `Most common root cause: ${mostCommonRootCause}` :
                null,
              stats.topLessons.length > 0 ?
                `Top lesson: "${stats.topLessons[0]?.lesson}" (${stats.topLessons[0]?.count} occurrences)` :
                null,
              stats.resolutionRate > 0 ?
                `${(stats.resolutionRate * 100).toFixed(0)}% of reflections led to successful resolution` :
                null
            ].filter(Boolean)
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  // ===========================================================================
  // AGENT CARD HANDLER (A2A Discovery)
  // ===========================================================================

  private async handleAgentCard(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = AgentCardInputSchema.parse(args);

    try {
      const card = this.getAgentCard(input.includeSchemas);

      // Format based on requested format
      let output: any;

      switch (input.format) {
        case 'summary':
          output = {
            id: card.id,
            name: card.name,
            version: card.version,
            description: card.description,
            capabilityCount: card.capabilities.length,
            categories: [...new Set(card.capabilities.map(c => c.category))],
            provider: card.provider
          };
          break;

        case 'capabilities':
          output = {
            capabilities: card.capabilities.map(c => ({
              name: c.name,
              description: c.description.substring(0, 100) + (c.description.length > 100 ? '...' : ''),
              category: c.category,
              complexity: c.complexity,
              estimatedTokens: c.estimatedTokens
            }))
          };
          break;

        case 'full':
        default:
          output = input.includeSchemas ? card : {
            ...card,
            capabilities: card.capabilities.map(c => ({
              name: c.name,
              description: c.description,
              category: c.category,
              complexity: c.complexity,
              estimatedTokens: c.estimatedTokens,
              tags: c.tags
            }))
          };
          break;
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            agentCard: output
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  // ===========================================================================
  // GUARDIAN HANDLER (Post-Execution Audit)
  // ===========================================================================

  private async handleGuardianAudit(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = GuardianAuditInputSchema.parse(args);
    const guardian = await this.getPostExecGuardian();

    try {
      // Build audit context
      const auditContext: AuditContext = {
        taskId: 'manual-audit',
        subtaskId: 'manual',
        filesWritten: [],
        filesModified: input.files,
        filesDeleted: [],
        workingDir: input.codebaseRoot || process.cwd()
      };

      // Run audit
      const result: AuditResult = await guardian.audit(auditContext);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            audit: {
              passed: result.passed,
              rollbackRequired: result.rollbackRequired,
              rollbackReason: result.rollbackReason,
              filesAudited: result.filesAudited,
              filesModified: result.filesModified,
              auditDurationMs: result.auditDurationMs,
              phasesCompleted: result.phasesCompleted,
              issueCount: result.issues.length,
              issues: result.issues.map(i => ({
                severity: i.severity,
                category: i.category,
                file: i.file,
                line: i.line,
                message: i.message.substring(0, 200),
                suggestion: i.suggestion
              })),
              summary: result.summary
            },
            recommendation: result.rollbackRequired
              ? `ROLLBACK RECOMMENDED: ${result.rollbackReason}`
              : result.passed
                ? 'All audits passed'
                : `${result.issues.filter(i => i.severity === 'critical' || i.severity === 'high').length} critical/high issues found`
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }

  // ===========================================================================
  // DISTILLATION HANDLERS (Memory Lesson Extraction)
  // ===========================================================================

  private async handleDistill(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = z.object({
      types: z.array(z.enum(['success_pattern', 'failure_fix', 'cross_domain', 'contradiction', 'consolidation'])).optional(),
      lookbackDays: z.number().min(1).max(90).optional(),
      maxTokens: z.number().min(1000).max(500000).optional(),
      force: z.boolean().optional(),
      dryRun: z.boolean().optional()
    }).parse(args || {});

    const service = await this.getDistillationService();

    // Check if already running
    if (service.isDistillationRunning()) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: 'Distillation already running',
            message: 'Wait for the current run to complete or try again later'
          }, null, 2)
        }]
      };
    }

    const options: ManualDistillationOptions = {
      types: input.types as DistillationType[] | undefined,
      lookbackDays: input.lookbackDays,
      maxTokens: input.maxTokens,
      force: input.force,
      dryRun: input.dryRun
    };

    const result = await service.runDistillation(options);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: result.success,
          dryRun: input.dryRun ?? false,
          startedAt: result.startedAt.toISOString(),
          completedAt: result.completedAt.toISOString(),
          durationMs: result.durationMs,
          tokensUsed: result.tokensUsed,
          memoriesProcessed: result.memoriesProcessed,
          insightsExtracted: result.insights.length,
          byType: result.byType,
          budgetExhausted: result.budgetExhausted,
          errors: result.errors.length > 0 ? result.errors : undefined,
          insights: result.insights.map(i => ({
            type: i.type,
            insight: i.insight.substring(0, 200) + (i.insight.length > 200 ? '...' : ''),
            confidence: i.confidence,
            applicableContexts: i.applicableContexts.slice(0, 3)
          }))
        }, null, 2)
      }]
    };
  }

  private async handleDistillationStats(): Promise<{ content: Array<{ type: string; text: string }> }> {
    const service = await this.getDistillationService();
    const stats: DistillationStats = await service.getStats();

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          totalRuns: stats.totalRuns,
          totalInsights: stats.totalInsights,
          byType: stats.byType,
          avgConfidence: stats.avgConfidence.toFixed(3),
          totalTokensUsed: stats.totalTokensUsed,
          avgTokensPerRun: stats.avgTokensPerRun,
          lastRunAt: stats.lastRunAt?.toISOString(),
          lastRunResult: stats.lastRunResult,
          pendingMemories: stats.pendingMemories,
          topInsights: stats.topInsights.slice(0, 5),
          isRunning: service.isDistillationRunning(),
          scheduling: {
            isSchedulerRunning: service.isScheduledRunning(),
            nextScheduledRun: service.getNextScheduledRun()?.toISOString()
          }
        }, null, 2)
      }]
    };
  }

  private async handleDistillationConfig(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = z.object({
      enabled: z.boolean().optional(),
      schedule: z.string().optional(),
      maxTokensPerRun: z.number().min(1000).max(500000).optional(),
      minConfidence: z.number().min(0).max(1).optional(),
      lookbackDays: z.number().min(1).max(90).optional(),
      types: z.array(z.enum(['success_pattern', 'failure_fix', 'cross_domain', 'contradiction', 'consolidation'])).optional(),
      startScheduler: z.boolean().optional(),
      stopScheduler: z.boolean().optional()
    }).parse(args || {});

    const service = await this.getDistillationService();

    // Update config if any values provided
    const configUpdates: Partial<DistillationConfig> = {};
    if (input.enabled !== undefined) configUpdates.enabled = input.enabled;
    if (input.schedule !== undefined) configUpdates.schedule = input.schedule;
    if (input.maxTokensPerRun !== undefined) configUpdates.maxTokensPerRun = input.maxTokensPerRun;
    if (input.minConfidence !== undefined) configUpdates.minConfidence = input.minConfidence;
    if (input.lookbackDays !== undefined) configUpdates.lookbackDays = input.lookbackDays;
    if (input.types !== undefined) configUpdates.distillationTypes = input.types as DistillationType[];

    if (Object.keys(configUpdates).length > 0) {
      service.updateConfig(configUpdates);
    }

    // Handle scheduler start/stop
    if (input.startScheduler) {
      service.startScheduled();
    }
    if (input.stopScheduler) {
      service.stopScheduled();
    }

    const config = service.getConfig();

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          config: {
            enabled: config.enabled,
            schedule: config.schedule,
            maxTokensPerRun: config.maxTokensPerRun,
            minConfidence: config.minConfidence,
            lookbackDays: config.lookbackDays,
            distillationTypes: config.distillationTypes,
            model: config.model,
            enableExtendedThinking: config.enableExtendedThinking,
            thinkingBudget: config.thinkingBudget
          },
          scheduling: {
            isSchedulerRunning: service.isScheduledRunning(),
            nextScheduledRun: service.getNextScheduledRun()?.toISOString()
          },
          message: Object.keys(configUpdates).length > 0 ? 'Configuration updated' : 'Current configuration'
        }, null, 2)
      }]
    };
  }

  private async handleDistillationQuery(args: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
    const input = z.object({
      query: z.string(),
      topK: z.number().min(1).max(50).optional(),
      type: z.enum(['success_pattern', 'failure_fix', 'cross_domain', 'contradiction', 'consolidation']).optional(),
      minConfidence: z.number().min(0).max(1).optional(),
      tags: z.array(z.string()).optional()
    }).parse(args);

    const service = await this.getDistillationService();

    const result = await service.queryInsights({
      query: input.query,
      topK: input.topK,
      type: input.type as DistillationType | undefined,
      minConfidence: input.minConfidence,
      tags: input.tags
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          count: result.insights.length,
          insights: result.insights.map(i => ({
            id: i.insight.id,
            type: i.insight.type,
            insight: i.insight.insight,
            pattern: i.insight.pattern,
            applicableContexts: i.insight.applicableContexts,
            caveats: i.insight.caveats,
            confidence: i.insight.confidence,
            similarity: i.similarity.toFixed(4),
            sourceCount: i.insight.sourceMemoryIds.length
          })),
          applicableLessons: result.applicableLessons,
          relevantPatterns: result.relevantPatterns,
          relevantCaveats: result.relevantCaveats
        }, null, 2)
      }]
    };
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Rubix MCP Server running on stdio');
  }

  async shutdown(): Promise<void> {
    // Close Playwright sessions
    if (this.playwright) {
      await this.playwright.closeAll();
    }
    if (this.verificationService) {
      await this.verificationService.cleanup();
    }
    // Stop scheduler
    if (this.scheduler) {
      this.scheduler.stop('Server shutdown');
    }
    // Close inter-instance comms
    if (this.commsStore) {
      this.commsStore.close();
    }
    // Close memory engine
    if (this.engine) {
      await this.engine.close();
    }
    await this.server.close();
  }
}

// ==========================================
// Main Entry
// ==========================================

// Initialize output sanitizer to prevent secret exposure in console output
getSanitizer().wrapConsole();

const server = new GodAgentMCPServer();

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.error('Shutting down Rubix MCP Server...');
  await server.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.error('Shutting down Rubix MCP Server...');
  await server.shutdown();
  process.exit(0);
});

server.run().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
