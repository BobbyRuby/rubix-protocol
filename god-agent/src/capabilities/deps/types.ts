/**
 * Dependency Graph Types
 *
 * Type definitions specific to dependency analysis.
 */

export interface ModuleInfo {
  path: string;
  exports: string[];
  imports: Array<{
    source: string;
    specifiers: string[];
    isDefault: boolean;
  }>;
  dependencies: string[];
  dependents: string[];
}

export interface CircularDependency {
  chain: string[];
  description: string;
}

export interface DependencyAnalysisOptions {
  /** Entry point for analysis */
  entryPoint: string;
  /** Include dev dependencies */
  includeDevDeps?: boolean;
  /** Maximum depth to traverse */
  maxDepth?: number;
  /** File patterns to include */
  include?: string[];
  /** File patterns to exclude */
  exclude?: string[];
}

export interface ImpactAnalysisOptions {
  /** Include transitive dependents */
  includeTransitive?: boolean;
  /** Maximum transitive depth */
  maxDepth?: number;
}
