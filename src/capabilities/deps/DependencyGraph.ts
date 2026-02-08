/**
 * DependencyGraphManager
 *
 * Dependency graph analysis for understanding code relationships.
 * Provides impact analysis and circular dependency detection.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import madge from 'madge';

import type { DepsConfig } from '../types.js';
import type {
  DependencyGraph,
  DependencyNode,
  DependencyEdge,
  ImpactAnalysis
} from '../types.js';
import type { ModuleInfo, CircularDependency } from './types.js';

/**
 * DependencyGraphManager - Dependency analysis operations
 */
export class DependencyGraphManager {
  private projectRoot: string;
  private graphCache: Map<string, { graph: DependencyGraph; time: number }> = new Map();
  private cacheTimeout = 60000; // 1 minute

  constructor(projectRoot: string, _config: DepsConfig) {
    this.projectRoot = projectRoot;
  }

  /**
   * Build dependency graph from entry point
   */
  async build(entryPoint: string): Promise<DependencyGraph> {
    const absoluteEntry = path.isAbsolute(entryPoint)
      ? entryPoint
      : path.join(this.projectRoot, entryPoint);

    // Check cache
    const cached = this.graphCache.get(absoluteEntry);
    if (cached && Date.now() - cached.time < this.cacheTimeout) {
      return cached.graph;
    }

    try {
      // Use madge to analyze dependencies
      const result = await madge(absoluteEntry, {
        baseDir: this.projectRoot,
        includeNpm: false,
        fileExtensions: ['ts', 'tsx', 'js', 'jsx'],
        detectiveOptions: {
          ts: {
            skipTypeImports: true
          }
        }
      });

      const tree = result.obj();
      const circular = result.circular();

      // Build nodes
      const nodes: DependencyNode[] = [];
      const edges: DependencyEdge[] = [];
      const nodeMap = new Map<string, DependencyNode>();

      for (const [filePath, dependencies] of Object.entries(tree)) {
        const node: DependencyNode = {
          id: filePath,
          path: filePath,
          imports: dependencies as string[],
          exports: [], // Would need AST analysis for exports
          isExternal: filePath.includes('node_modules')
        };
        nodes.push(node);
        nodeMap.set(filePath, node);

        // Create edges
        for (const dep of dependencies as string[]) {
          edges.push({
            source: filePath,
            target: dep,
            type: 'import'
          });
        }
      }

      // Format circular dependencies
      const circularDependencies = circular.map((chain: string[]) => chain);

      const graph: DependencyGraph = {
        nodes,
        edges,
        entryPoint: path.relative(this.projectRoot, absoluteEntry),
        circularDependencies
      };

      // Cache the result
      this.graphCache.set(absoluteEntry, { graph, time: Date.now() });

      return graph;
    } catch (error) {
      // Return empty graph on error
      return {
        nodes: [],
        edges: [],
        entryPoint: path.relative(this.projectRoot, absoluteEntry),
        circularDependencies: []
      };
    }
  }

  /**
   * Analyze impact of changing a file
   */
  async analyzeImpact(file: string): Promise<ImpactAnalysis> {
    const relativePath = path.isAbsolute(file)
      ? path.relative(this.projectRoot, file)
      : file;

    // Find entry point (typically src/index.ts)
    const entryPoints = [
      path.join(this.projectRoot, 'src/index.ts'),
      path.join(this.projectRoot, 'src/index.js'),
      path.join(this.projectRoot, 'index.ts'),
      path.join(this.projectRoot, 'index.js')
    ];

    let entryPoint: string | null = null;
    for (const ep of entryPoints) {
      try {
        await fs.access(ep);
        entryPoint = ep;
        break;
      } catch {
        continue;
      }
    }

    if (!entryPoint) {
      return {
        changedFile: relativePath,
        directDependents: [],
        transitiveDependents: [],
        totalImpact: 0,
        riskLevel: 'low',
        suggestions: ['Could not find entry point for analysis']
      };
    }

    // Build the dependency graph
    const graph = await this.build(entryPoint);

    // Find direct dependents (files that import this file)
    const directDependents = this.findDirectDependents(graph, relativePath);

    // Find transitive dependents
    const transitiveDependents = this.findTransitiveDependents(graph, relativePath, directDependents);

    // Calculate total impact
    const totalImpact = directDependents.length + transitiveDependents.length;

    // Determine risk level
    let riskLevel: 'low' | 'medium' | 'high';
    if (totalImpact <= 3) {
      riskLevel = 'low';
    } else if (totalImpact <= 10) {
      riskLevel = 'medium';
    } else {
      riskLevel = 'high';
    }

    // Generate suggestions
    const suggestions: string[] = [];

    if (totalImpact > 10) {
      suggestions.push('Consider breaking this change into smaller, incremental updates');
    }

    if (directDependents.length > 5) {
      suggestions.push(`This file is imported by ${directDependents.length} files directly - ensure all are tested`);
    }

    if (graph.circularDependencies.some(chain => chain.includes(relativePath))) {
      suggestions.push('This file is part of a circular dependency - changes may have unexpected effects');
    }

    // Check if it's a "hub" file
    const isHub = graph.nodes.find(n => n.path === relativePath)?.imports.length ?? 0 > 10;
    if (isHub) {
      suggestions.push('This file imports many modules - consider if refactoring would reduce coupling');
    }

    return {
      changedFile: relativePath,
      directDependents,
      transitiveDependents,
      totalImpact,
      riskLevel,
      suggestions
    };
  }

  /**
   * Get module information
   */
  async getModuleInfo(file: string): Promise<ModuleInfo> {
    const relativePath = path.isAbsolute(file)
      ? path.relative(this.projectRoot, file)
      : file;

    // Build graph from this file
    const graph = await this.build(file);

    const node = graph.nodes.find(n => n.path === relativePath);

    // Find dependents
    const dependents = graph.edges
      .filter(e => e.target === relativePath)
      .map(e => e.source);

    return {
      path: relativePath,
      exports: node?.exports ?? [],
      imports: (node?.imports ?? []).map(imp => ({
        source: imp,
        specifiers: [], // Would need AST for specifics
        isDefault: false
      })),
      dependencies: node?.imports ?? [],
      dependents
    };
  }

  /**
   * Find circular dependencies
   */
  async findCircularDependencies(entryPoint?: string): Promise<CircularDependency[]> {
    const entry = entryPoint ?? 'src/index.ts';
    const graph = await this.build(entry);

    return graph.circularDependencies.map(chain => ({
      chain,
      description: chain.join(' → ') + ' → ' + chain[0]
    }));
  }

  /**
   * Get dependency tree as text
   */
  async getTreeText(entryPoint?: string, maxDepth: number = 3): Promise<string> {
    const entry = entryPoint ?? 'src/index.ts';
    const graph = await this.build(entry);

    const lines: string[] = [];
    const visited = new Set<string>();

    const printTree = (node: string, depth: number, prefix: string) => {
      if (depth > maxDepth || visited.has(node)) {
        if (visited.has(node)) {
          lines.push(`${prefix}${node} (circular)`);
        }
        return;
      }

      visited.add(node);
      lines.push(`${prefix}${node}`);

      const imports = graph.nodes.find(n => n.path === node)?.imports ?? [];
      imports.forEach((imp, i) => {
        const isLast = i === imports.length - 1;
        const newPrefix = prefix.replace('├── ', '│   ').replace('└── ', '    ');
        printTree(imp, depth + 1, newPrefix + (isLast ? '└── ' : '├── '));
      });
    };

    printTree(path.relative(this.projectRoot, entry), 0, '');
    return lines.join('\n');
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  private findDirectDependents(graph: DependencyGraph, file: string): string[] {
    return graph.edges
      .filter(e => e.target === file || e.target.endsWith('/' + file))
      .map(e => e.source);
  }

  private findTransitiveDependents(
    graph: DependencyGraph,
    file: string,
    directDependents: string[]
  ): string[] {
    const transitive = new Set<string>();
    const visited = new Set<string>(directDependents);
    visited.add(file);

    const queue = [...directDependents];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const dependents = this.findDirectDependents(graph, current);

      for (const dep of dependents) {
        if (!visited.has(dep)) {
          visited.add(dep);
          transitive.add(dep);
          queue.push(dep);
        }
      }
    }

    return Array.from(transitive);
  }
}

export default DependencyGraphManager;
