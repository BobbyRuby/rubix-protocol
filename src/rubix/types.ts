/**
 * RUBIX Department Head System - Type Definitions
 *
 * Hierarchy:
 * Claude (Head of Operations)
 * └── 5 Department Heads (RESEARCHER, ARCHITECT, ENGINEER, VALIDATOR, GUARDIAN)
 *     └── Sub-agents (parallel workers managed by each head)
 */

export type DepartmentType = 'researcher' | 'architect' | 'engineer' | 'validator' | 'guardian';

export interface DepartmentConfig {
  type: DepartmentType;
  maxSubAgents: number;
  apiKey: string;
  model?: string;
  maxTokens?: number;
}

export interface SubAgentTask {
  id: string;
  type: string;
  description: string;
  context: string;
  dependencies?: string[];  // IDs of tasks that must complete first
}

export interface SubAgentResult {
  taskId: string;
  success: boolean;
  output: string;
  artifacts?: Artifact[];
  errors?: string[];
  durationMs: number;
}

export interface Artifact {
  type: 'file' | 'report' | 'design' | 'test' | 'review';
  path?: string;
  content: string;
  metadata?: Record<string, any>;
}

export interface DepartmentReport {
  department: DepartmentType;
  success: boolean;
  summary: string;
  subAgentResults: SubAgentResult[];
  artifacts: Artifact[];
  recommendations?: string[];
  issues?: string[];
  durationMs: number;
}

export interface RubixTask {
  id: string;
  description: string;
  specification?: string;
  codebase: string;
  context?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
}

export interface RubixPlan {
  taskId: string;
  phases: RubixPhase[];
  estimatedComplexity: 'small' | 'medium' | 'large' | 'massive';
}

export interface RubixPhase {
  order: number;
  departments: DepartmentType[];  // Can run in parallel
  description: string;
  dependencies?: number[];  // Phase orders that must complete first
}

export interface RubixResult {
  taskId: string;
  success: boolean;
  summary: string;
  departmentReports: DepartmentReport[];
  artifacts: Artifact[];
  totalDurationMs: number;
}

// Department-specific task types
export interface ResearchTask extends SubAgentTask {
  type: 'file_analysis' | 'pattern_detection' | 'dependency_mapping' | 'doc_mining' | 'precedent_finding';
}

export interface ArchitectTask extends SubAgentTask {
  type: 'structure_design' | 'interface_design' | 'data_modeling' | 'module_planning' | 'tech_evaluation';
}

export interface EngineerTask extends SubAgentTask {
  type: 'logic_implementation' | 'component_building' | 'algorithm_writing' | 'integration' | 'refactoring';
  targetFile?: string;
}

export interface ValidatorTask extends SubAgentTask {
  type: 'unit_test' | 'integration_test' | 'edge_case' | 'type_validation' | 'behavior_check';
  targetFile?: string;
}

export interface GuardianTask extends SubAgentTask {
  type: 'security_scan' | 'performance_analysis' | 'code_review' | 'resilience_check' | 'standards_enforcement';
}
