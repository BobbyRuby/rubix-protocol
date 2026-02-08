/**
 * ParallelEngineer - Spawns multiple engineers in dependency order.
 *
 * For high-complexity tasks with multiple components, this orchestrator:
 * 1. Topologically sorts components by dependencies
 * 2. Groups independent components into batches
 * 3. Executes each batch in parallel
 * 4. Passes completed outputs to dependent components
 *
 * Now supports provider-agnostic execution via EngineerProvider interface,
 * allowing use of Claude, Ollama, or other LLM backends.
 */

import type { ContextBundle } from './ContextScout.js';
import type { DesignOutput, PlanOutput, FileContent, ComponentDependency } from './ClaudeReasoner.js';
import type { EngineerProvider, EngineerFn } from './EngineerProvider.js';

/**
 * Re-export ComponentDependency as ComponentTask for backwards compatibility.
 */
export type ComponentTask = ComponentDependency;

/**
 * Result from a single component's engineer.
 */
interface EngineerResult {
  component: string;
  files: FileContent[];
  success: boolean;
  error?: string;
}

/**
 * ParallelEngineer orchestrates multiple engineers for complex tasks.
 */
export class ParallelEngineer {
  private engineerFn: EngineerFn;
  private readonly providerName: string;

  constructor(provider: EngineerProvider) {
    this.engineerFn = provider.createEngineer();
    this.providerName = provider.name;
    console.log(`[ParallelEngineer] Using ${this.providerName} engineers`);
  }

  /**
   * Execute engineers in topological order based on dependencies.
   */
  async executeInOrder(
    context: ContextBundle,
    design: DesignOutput
  ): Promise<PlanOutput> {
    const components = design.componentDependencies || [];

    if (components.length === 0) {
      console.log('[ParallelEngineer] No component dependencies defined, using single engineer');
      // Return empty plan - caller should fall back to single engineer
      return {
        department: 'eng',
        operations: [],
        commands: [],
        confidence: 0.5,
        notes: 'No component dependencies defined',
        files: [],
        compressedToken: 'PLAN|parallel|0files'
      };
    }

    const executionOrder = this.topologicalSort(components);
    console.log(`[ParallelEngineer] Execution order: ${executionOrder.join(' → ')}`);

    const completedOutputs = new Map<string, FileContent[]>();
    const allFiles: FileContent[] = [];
    let totalSuccess = 0;
    let totalFailed = 0;

    // Execute in dependency order
    // Components with no pending deps can run in parallel
    const batches = this.getBatches(executionOrder, components);
    console.log(`[ParallelEngineer] ${batches.length} batches to execute`);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`[ParallelEngineer] Executing batch ${i + 1}/${batches.length}: ${batch.join(', ')}`);

      const promises = batch.map(componentName => {
        const component = components.find(c => c.name === componentName);
        if (!component) {
          console.error(`[ParallelEngineer] Component ${componentName} not found`);
          return Promise.resolve({
            component: componentName,
            files: [],
            success: false,
            error: 'Component not found in design'
          });
        }

        // Gather outputs from dependencies
        const depOutputs = component.dependencies
          .map(dep => completedOutputs.get(dep) || [])
          .flat();

        return this.executeComponent(context, design, component, depOutputs);
      });

      const results = await Promise.all(promises);

      for (const result of results) {
        if (result.success) {
          completedOutputs.set(result.component, result.files);
          allFiles.push(...result.files);
          totalSuccess++;
          console.log(`[ParallelEngineer] ✓ ${result.component}: ${result.files.length} files`);
        } else {
          totalFailed++;
          console.error(`[ParallelEngineer] ✗ ${result.component}: ${result.error}`);
        }
      }
    }

    console.log(`[ParallelEngineer] Complete: ${totalSuccess} succeeded, ${totalFailed} failed, ${allFiles.length} total files`);

    return {
      department: 'eng',
      operations: allFiles.map(f => ({
        action: f.action === 'create' ? 'C' as const : f.action === 'modify' ? 'M' as const : 'D' as const,
        path: f.path
      })),
      commands: [],
      confidence: totalFailed === 0 ? 0.9 : 0.6,
      notes: `Parallel execution: ${totalSuccess}/${components.length} components, ${allFiles.length} files`,
      files: allFiles,
      compressedToken: `PLAN|parallel|${allFiles.length}files|${totalSuccess}ok|${totalFailed}fail`
    };
  }

  /**
   * Execute a single component with dependency context.
   */
  private async executeComponent(
    context: ContextBundle,
    design: DesignOutput,
    component: ComponentTask,
    dependencyOutputs: FileContent[]
  ): Promise<EngineerResult> {
    // Build dependency context section
    const depContext = dependencyOutputs.length > 0
      ? `\n## Completed Dependencies\nThese files have already been created and you can import from them:\n\n${dependencyOutputs.map(f =>
          `### ${f.path}\n\`\`\`typescript\n${f.content}\n\`\`\``
        ).join('\n\n')}`
      : '';

    const prompt = `# ENGINEER - Component: ${component.name}

## Your Role
You are the ENGINEER for this specific component.
Generate ONLY the file for this component. Write complete, working code.

## Task
${context.description}

${context.specification ? `## Specification\n${context.specification}\n` : ''}

## Design Context
Components: ${design.components.join(', ')}
Models: ${design.models.join(', ')}
Notes: ${design.notes}

## Your Component
- **Name:** ${component.name}
- **File:** ${component.file}
- **Dependencies:** ${component.dependencies.length > 0 ? component.dependencies.join(', ') : 'none'}
${depContext}

## Required Output
Generate ONLY the file for this component using this exact format:

<file path="${component.file}" action="create">
// Complete implementation here
// Include all imports, types, and exports
</file>

IMPORTANT:
- Provide COMPLETE file contents
- No placeholders or TODOs
- Include proper imports from dependencies
- Export what other components might need`;

    try {
      // Provider-agnostic call
      const responseText = await this.engineerFn(prompt);

      if (!responseText) {
        throw new Error('No response from engineer provider');
      }

      const files = this.parseFiles(responseText);

      if (files.length === 0) {
        // Log parsing failure with response preview for debugging
        const preview = responseText.slice(0, 500).replace(/\n/g, '\\n');
        console.warn(`[ParallelEngineer] ${component.name}: No <file> blocks parsed from response`);
        console.warn(`[ParallelEngineer] Response preview (${responseText.length} chars): ${preview}...`);

        // Log to file for detailed analysis
        try {
          const { getCodexLogger } = await import('./Logger.js');
          const logger = getCodexLogger();
          logger.logParsingFailure(
            responseText,
            `Component: ${component.name}, Expected file: ${component.file}`
          );
        } catch (logErr) {
          // Don't fail the operation if logging fails
          console.warn(`[ParallelEngineer] Could not log parsing failure: ${logErr}`);
        }

        // Try to extract any code block as fallback
        const codeMatch = responseText.match(/```(?:typescript|ts)?\n([\s\S]*?)```/);
        if (codeMatch) {
          console.log(`[ParallelEngineer] ${component.name}: Extracted code from markdown block as fallback`);
          files.push({
            path: component.file,
            action: 'create',
            content: codeMatch[1].trim()
          });
        }
      }

      return {
        component: component.name,
        files,
        success: files.length > 0,
        error: files.length === 0
          ? `No valid <file> blocks parsed. Response length: ${responseText.length} chars. Check PARSING_FAILURE logs.`
          : undefined
      };
    } catch (error) {
      return {
        component: component.name,
        files: [],
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Parse file blocks from response.
   */
  private parseFiles(output: string): FileContent[] {
    const files: FileContent[] = [];
    const matches = output.matchAll(/<file\s+([^>]+)>([\s\S]*?)<\/file>/g);

    for (const match of matches) {
      const pathMatch = match[1].match(/path="([^"]+)"/);
      const actionMatch = match[1].match(/action="([^"]+)"/);

      if (pathMatch) {
        files.push({
          path: pathMatch[1],
          action: (actionMatch?.[1] || 'create') as 'create' | 'modify' | 'delete',
          content: match[2].trim()
        });
      }
    }

    return files;
  }

  /**
   * Topological sort of components by dependencies.
   */
  private topologicalSort(components: ComponentTask[]): string[] {
    const visited = new Set<string>();
    const result: string[] = [];
    const componentMap = new Map(components.map(c => [c.name, c]));

    const visit = (name: string) => {
      if (visited.has(name)) return;
      visited.add(name);

      const comp = componentMap.get(name);
      if (comp) {
        for (const dep of comp.dependencies) {
          visit(dep);
        }
      }
      result.push(name);
    };

    for (const comp of components) {
      visit(comp.name);
    }

    return result;
  }

  /**
   * Group components into batches that can run in parallel.
   * Components in the same batch have no dependencies on each other.
   */
  private getBatches(order: string[], components: ComponentTask[]): string[][] {
    const batches: string[][] = [];
    const completed = new Set<string>();
    const remaining = new Set(order);

    while (remaining.size > 0) {
      const batch: string[] = [];

      for (const name of remaining) {
        const comp = components.find(c => c.name === name);
        if (!comp) continue;

        // Check if all dependencies are completed
        const depsComplete = comp.dependencies.every(d => completed.has(d));
        if (depsComplete) {
          batch.push(name);
        }
      }

      // Circular dependency protection
      if (batch.length === 0) {
        console.warn('[ParallelEngineer] Circular dependency detected, breaking');
        // Add remaining items as single batch
        batches.push([...remaining]);
        break;
      }

      // Move batch items from remaining to completed
      for (const name of batch) {
        remaining.delete(name);
        completed.add(name);
      }

      batches.push(batch);
    }

    return batches;
  }
}

/**
 * Factory function for ParallelEngineer.
 */
export function createParallelEngineer(provider: EngineerProvider): ParallelEngineer {
  return new ParallelEngineer(provider);
}
