/**
 * Skills Migration
 *
 * Migrates skill files into God Agent memory as semantic knowledge.
 */

import { existsSync, readFileSync } from 'fs';
import { join, basename } from 'path';
import type { MemoryEngine } from '../core/MemoryEngine.js';
import { MemorySource, CausalRelationType } from '../core/types.js';
import type {
  MigrationConfig,
  MigrationResult,
  ProgressCallback,
} from './types.js';
import { SKILL_FILES } from './types.js';

/**
 * Maximum content length before splitting into sections
 */
const MAX_SECTION_LENGTH = 4000;

/**
 * Split markdown content into sections by ## headers
 */
function splitIntoSections(content: string, skillName: string): { title: string; content: string }[] {
  const sections: { title: string; content: string }[] = [];

  // If content is small enough, return as single section
  if (content.length <= MAX_SECTION_LENGTH) {
    return [{ title: skillName, content }];
  }

  // Split by ## headers
  const headerRegex = /^## (.+)$/gm;
  const matches = [...content.matchAll(headerRegex)];

  if (matches.length === 0) {
    // No headers, split by chunks
    const chunks = splitByLength(content, MAX_SECTION_LENGTH);
    return chunks.map((chunk, i) => ({
      title: `${skillName} (Part ${i + 1})`,
      content: chunk,
    }));
  }

  // Get content before first header
  const firstMatch = matches[0];
  if (firstMatch.index && firstMatch.index > 100) {
    const intro = content.substring(0, firstMatch.index).trim();
    if (intro.length > 50) {
      sections.push({ title: `${skillName} - Introduction`, content: intro });
    }
  }

  // Extract each section
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const sectionTitle = match[1];
    const startIndex = match.index! + match[0].length;
    const endIndex = i < matches.length - 1 ? matches[i + 1].index : content.length;
    const sectionContent = content.substring(startIndex, endIndex).trim();

    if (sectionContent.length > 50) {
      // If section is too long, split it further
      if (sectionContent.length > MAX_SECTION_LENGTH) {
        const chunks = splitByLength(sectionContent, MAX_SECTION_LENGTH);
        chunks.forEach((chunk, j) => {
          sections.push({
            title: `${skillName} - ${sectionTitle}${chunks.length > 1 ? ` (Part ${j + 1})` : ''}`,
            content: chunk,
          });
        });
      } else {
        sections.push({
          title: `${skillName} - ${sectionTitle}`,
          content: sectionContent,
        });
      }
    }
  }

  return sections;
}

/**
 * Split content by length, trying to break at paragraph boundaries
 */
function splitByLength(content: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = content;

  while (remaining.length > maxLength) {
    // Try to find a paragraph break near the max length
    let splitIndex = remaining.lastIndexOf('\n\n', maxLength);

    // If no paragraph break, try single newline
    if (splitIndex < maxLength / 2) {
      splitIndex = remaining.lastIndexOf('\n', maxLength);
    }

    // If still no good break, just split at max
    if (splitIndex < maxLength / 2) {
      splitIndex = maxLength;
    }

    chunks.push(remaining.substring(0, splitIndex).trim());
    remaining = remaining.substring(splitIndex).trim();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

/**
 * Create relations between related skills
 */
function getSkillRelations(): { source: string; target: string; type: CausalRelationType }[] {
  return [
    // NESC tables enable joint-use calculations
    { source: 'nesc-clearance-tables-SKILL', target: 'nesc-joint-use-SKILL', type: CausalRelationType.ENABLES },
    // NESC rules enable make-ready logic
    { source: 'nesc-joint-use-SKILL', target: 'make-ready-logic-SKILL', type: CausalRelationType.ENABLES },
    // Laravel backend enables TALL stack frontend
    { source: 'laravel-backend', target: 'tall-stack', type: CausalRelationType.ENABLES },
  ];
}

/**
 * Migrate skill files to God Agent memory
 */
export async function migrateSkills(
  engine: MemoryEngine,
  config: MigrationConfig,
  onProgress?: ProgressCallback
): Promise<MigrationResult> {
  const startTime = Date.now();
  const result: MigrationResult = {
    phase: 'skills',
    entriesStored: 0,
    relationsCreated: 0,
    errors: [],
    duration: 0,
    dryRun: config.dryRun,
  };

  // Map to track skill name -> entry IDs for relations
  const skillEntryIds = new Map<string, string[]>();

  onProgress?.('skills', 0, SKILL_FILES.length, 'Processing skill files...');

  for (let i = 0; i < SKILL_FILES.length; i++) {
    const skill = SKILL_FILES[i];
    const filePath = join(config.projectRoot, skill.path);

    // Check if file exists
    if (!existsSync(filePath)) {
      result.errors.push(`Skill file not found: ${skill.path}`);
      onProgress?.('skills', i + 1, SKILL_FILES.length, `Skipped: ${skill.path} (not found)`);
      continue;
    }

    try {
      // Read file content
      const content = readFileSync(filePath, 'utf-8');
      const skillName = basename(skill.path, '.md').replace('-SKILL', '');

      // Split into sections
      const sections = splitIntoSections(content, skillName);

      const entryIds: string[] = [];

      for (const section of sections) {
        if (!config.dryRun) {
          const entry = await engine.store(section.content, {
            tags: skill.tags,
            source: MemorySource.EXTERNAL,
            importance: 0.9,
            context: {
              skillFile: skill.path,
              section: section.title,
              description: skill.description,
            },
          });
          entryIds.push(entry.id);
        }
        result.entriesStored++;
      }

      skillEntryIds.set(skillName, entryIds);

      onProgress?.('skills', i + 1, SKILL_FILES.length, `Processed: ${skill.description}`);
    } catch (error) {
      const errorMsg = `Failed to process skill ${skill.path}: ${error instanceof Error ? error.message : error}`;
      result.errors.push(errorMsg);
    }
  }

  // Create relations between related skills
  if (!config.dryRun) {
    const relations = getSkillRelations();
    for (const relation of relations) {
      const sourceIds = skillEntryIds.get(relation.source);
      const targetIds = skillEntryIds.get(relation.target);

      if (sourceIds?.length && targetIds?.length) {
        // Link first entries of each skill
        engine.addCausalRelation(
          [sourceIds[0]],
          [targetIds[0]],
          relation.type,
          0.8,
          { metadata: { relationship: 'skill-dependency' } }
        );
        result.relationsCreated++;
      }
    }
  } else {
    // Dry run - count expected relations
    result.relationsCreated = getSkillRelations().length;
  }

  result.duration = Date.now() - startTime;
  return result;
}
