/**
 * PlanDeviationDetector - Detects deviations between approved plan specifications
 * and architect designs.
 *
 * Used by the PLAN DEVIATION GATE in PhasedExecutor to ensure user control
 * over architectural decisions.
 */

import type { DesignOutput } from './ClaudeReasoner.js';

/**
 * Types of deviations that can be detected.
 */
export type DeviationType =
  | 'component_added'
  | 'component_removed'
  | 'component_changed'
  | 'scope_expanded'
  | 'scope_reduced'
  | 'approach_changed'
  | 'task_type_changed';

/**
 * Severity of a deviation.
 */
export type DeviationSeverity = 'major' | 'minor';

/**
 * A single detected deviation between plan and design.
 */
export interface PlanDeviation {
  type: DeviationType;
  severity: DeviationSeverity;
  description: string;
  planElement: string;      // What was in the plan
  designElement: string;    // What architect proposed
}

/**
 * Report of all deviations found.
 */
export interface DeviationReport {
  hasDeviations: boolean;
  deviations: PlanDeviation[];
  summary: string;          // Human-readable summary for escalation
  /** Severity breakdown */
  majorCount: number;
  minorCount: number;
}

/**
 * Extract components/files mentioned in specification text.
 * Uses heuristics to identify component names, file paths, and key terms.
 */
function extractSpecificationElements(specification: string): {
  components: Set<string>;
  files: Set<string>;
  keywords: Set<string>;
  taskType: 'document' | 'build' | 'modify' | 'unknown';
} {
  const components = new Set<string>();
  const files = new Set<string>();
  const keywords = new Set<string>();

  // Extract file paths (e.g., src/foo/Bar.ts, ./components/Widget.tsx)
  const filePathRegex = /(?:^|\s|["'`])([a-zA-Z0-9_\-./]+\.(ts|tsx|js|jsx|py|java|go|rs|md|json|yaml|yml|sql|css|scss|html))/gi;
  const fileMatches = specification.matchAll(filePathRegex);
  for (const match of fileMatches) {
    files.add(match[1].replace(/^["'`]/, ''));
  }

  // Extract component-like names (PascalCase words)
  const componentRegex = /\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g;
  const componentMatches = specification.matchAll(componentRegex);
  for (const match of componentMatches) {
    components.add(match[1]);
  }

  // Extract explicit mentions of components, modules, classes, services
  const explicitComponentRegex = /(?:component|class|service|module|controller|model|handler|manager|provider|factory|repository)\s*[:\s`'"]*([A-Za-z][A-Za-z0-9_]+)/gi;
  const explicitMatches = specification.matchAll(explicitComponentRegex);
  for (const match of explicitMatches) {
    components.add(match[1]);
  }

  // Extract keywords that indicate scope
  const scopeKeywords = [
    'api', 'endpoint', 'route', 'database', 'schema', 'migration',
    'authentication', 'authorization', 'middleware', 'validation',
    'test', 'testing', 'unit', 'integration', 'e2e',
    'frontend', 'backend', 'ui', 'component', 'page', 'view'
  ];
  for (const kw of scopeKeywords) {
    if (specification.toLowerCase().includes(kw)) {
      keywords.add(kw);
    }
  }

  // Determine task type from specification content
  let taskType: 'document' | 'build' | 'modify' | 'unknown' = 'unknown';
  const specLower = specification.toLowerCase();

  if (
    specLower.includes('document') ||
    specLower.includes('analyze') ||
    specLower.includes('research') ||
    specLower.includes('explain') ||
    specLower.includes('summarize') ||
    specLower.includes('write a report') ||
    specLower.includes('create documentation')
  ) {
    taskType = 'document';
  } else if (
    specLower.includes('modify') ||
    specLower.includes('update') ||
    specLower.includes('fix') ||
    specLower.includes('refactor') ||
    specLower.includes('change') ||
    specLower.includes('edit')
  ) {
    taskType = 'modify';
  } else if (
    specLower.includes('create') ||
    specLower.includes('implement') ||
    specLower.includes('build') ||
    specLower.includes('add') ||
    specLower.includes('develop')
  ) {
    taskType = 'build';
  }

  return { components, files, keywords, taskType };
}

/**
 * Normalize a component/file name for comparison.
 */
function normalizeForComparison(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.(ts|tsx|js|jsx|py|java|go|rs)$/, '')  // Remove extensions
    .replace(/[/_-]/g, '')  // Remove separators
    .replace(/\s+/g, '');   // Remove whitespace
}

/**
 * Check if two component names are similar (fuzzy match).
 */
function isSimilarComponent(a: string, b: string): boolean {
  const normA = normalizeForComparison(a);
  const normB = normalizeForComparison(b);
  return normA === normB || normA.includes(normB) || normB.includes(normA);
}

/**
 * Detect deviations between an approved plan specification and an architect's design.
 *
 * @param specification - The original plan specification approved by user
 * @param design - The DesignOutput from the ARCHITECT phase
 * @returns DeviationReport with all detected deviations
 */
export function detectPlanDeviations(
  specification: string,
  design: DesignOutput
): DeviationReport {
  const deviations: PlanDeviation[] = [];

  // Parse specification to extract expected elements
  const specElements = extractSpecificationElements(specification);

  // Track which design elements were matched to spec elements
  const matchedDesignComponents = new Set<string>();
  const matchedSpecComponents = new Set<string>();

  // === 1. Check for components in design not mentioned in spec (component_added) ===
  for (const designComponent of design.components) {
    const designName = designComponent.split('/').pop() || designComponent;
    let foundMatch = false;

    // Check against spec components
    for (const specComponent of specElements.components) {
      if (isSimilarComponent(designName, specComponent)) {
        foundMatch = true;
        matchedDesignComponents.add(designComponent);
        matchedSpecComponents.add(specComponent);
        break;
      }
    }

    // Check against spec files
    if (!foundMatch) {
      for (const specFile of specElements.files) {
        if (isSimilarComponent(designName, specFile)) {
          foundMatch = true;
          matchedDesignComponents.add(designComponent);
          break;
        }
      }
    }

    // If no match found and spec has components, this is an addition
    if (!foundMatch && (specElements.components.size > 0 || specElements.files.size > 0)) {
      deviations.push({
        type: 'component_added',
        severity: 'major',
        description: `Architect added component "${designName}" which was not specified in the plan`,
        planElement: 'Not specified',
        designElement: designComponent
      });
    }
  }

  // === 2. Check for components in spec missing from design (component_removed) ===
  for (const specComponent of specElements.components) {
    if (!matchedSpecComponents.has(specComponent)) {
      // Check if it's in design somewhere
      const foundInDesign = design.components.some(dc =>
        isSimilarComponent(dc.split('/').pop() || dc, specComponent)
      );

      if (!foundInDesign) {
        deviations.push({
          type: 'component_removed',
          severity: 'major',
          description: `Component "${specComponent}" was specified in plan but not included in design`,
          planElement: specComponent,
          designElement: 'Not in design'
        });
      }
    }
  }

  // === 3. Check task type mismatch ===
  if (specElements.taskType !== 'unknown' && design.taskType !== specElements.taskType) {
    deviations.push({
      type: 'task_type_changed',
      severity: 'major',
      description: `Task type changed from "${specElements.taskType}" to "${design.taskType}"`,
      planElement: specElements.taskType,
      designElement: design.taskType
    });
  }

  // === 4. Check for significant scope differences ===
  const specComponentCount = specElements.components.size + specElements.files.size;
  const designComponentCount = design.components.length;

  if (specComponentCount > 0 && designComponentCount > 0) {
    // Scope expanded significantly (50% more components)
    if (designComponentCount > specComponentCount * 1.5) {
      deviations.push({
        type: 'scope_expanded',
        severity: 'major',
        description: `Scope expanded significantly: plan specified ~${specComponentCount} components, design has ${designComponentCount}`,
        planElement: `${specComponentCount} components`,
        designElement: `${designComponentCount} components`
      });
    }

    // Scope reduced significantly (50% fewer components)
    if (designComponentCount < specComponentCount * 0.5) {
      deviations.push({
        type: 'scope_reduced',
        severity: 'minor',
        description: `Scope reduced: plan specified ~${specComponentCount} components, design has ${designComponentCount}`,
        planElement: `${specComponentCount} components`,
        designElement: `${designComponentCount} components`
      });
    }
  }

  // === 5. Check for approach differences based on notes ===
  const designNotesLower = (design.notes || '').toLowerCase();

  // Check if design mentions different approaches than spec
  const approachKeywords = [
    'instead of', 'rather than', 'alternative', 'different approach',
    'modified the approach', 'changed to', 'opted for', 'decided to use'
  ];

  for (const keyword of approachKeywords) {
    if (designNotesLower.includes(keyword)) {
      deviations.push({
        type: 'approach_changed',
        severity: 'minor',
        description: `Architect notes indicate a different approach: "${design.notes?.substring(0, 150)}..."`,
        planElement: 'Original approach',
        designElement: design.notes || 'See architect notes'
      });
      break;  // Only add one approach_changed deviation
    }
  }

  // Build summary
  const majorCount = deviations.filter(d => d.severity === 'major').length;
  const minorCount = deviations.filter(d => d.severity === 'minor').length;

  let summary: string;
  if (deviations.length === 0) {
    summary = 'No deviations detected. Design aligns with plan specification.';
  } else {
    const parts: string[] = [];
    if (majorCount > 0) parts.push(`${majorCount} major`);
    if (minorCount > 0) parts.push(`${minorCount} minor`);
    summary = `Found ${deviations.length} deviation(s): ${parts.join(', ')}. ` +
      `Types: ${[...new Set(deviations.map(d => d.type))].join(', ')}`;
  }

  return {
    hasDeviations: deviations.length > 0,
    deviations,
    summary,
    majorCount,
    minorCount
  };
}

/**
 * Format a deviation report as a human-readable markdown string.
 */
export function formatDeviationReport(report: DeviationReport): string {
  if (!report.hasDeviations) {
    return 'No deviations detected between plan and design.';
  }

  const lines: string[] = [
    '### Deviations Found:',
    ''
  ];

  report.deviations.forEach((deviation, index) => {
    const severityIcon = deviation.severity === 'major' ? '**[MAJOR]**' : '[minor]';
    lines.push(`**${index + 1}. ${deviation.type.replace(/_/g, ' ').toUpperCase()}** ${severityIcon}`);
    lines.push(`- Plan: ${deviation.planElement}`);
    lines.push(`- Design: ${deviation.designElement}`);
    lines.push(`- ${deviation.description}`);
    lines.push('');
  });

  return lines.join('\n');
}
