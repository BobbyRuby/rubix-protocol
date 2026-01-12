/**
 * CompressionSchemas - Schema definitions for each memory type.
 *
 * Each schema defines bidirectional encode/decode transformations.
 */

import { MemoryType, CompressionSchema, ParsedKeyValue } from './types.js';

/**
 * Parse key:value format into object.
 */
function parseKV(compressed: string): ParsedKeyValue {
  const result: ParsedKeyValue = {};
  const lines = compressed.split('\n');

  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      result[key] = value;
    }
  }

  return result;
}

/**
 * Expand arrow-chain to readable text.
 */
function expandArrows(chain: string): string {
  if (!chain) return '';
  return chain.split('→').map(v => v.trim()).join(', then ');
}

/**
 * Expand comma list to readable text.
 */
function expandCommas(list: string): string {
  if (!list) return '';
  const items = list.split(',').map(i => i.trim());
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  const last = items.pop();
  return `${items.join(', ')}, and ${last}`;
}

/**
 * Component schema (TaskExecutor, MemoryEngine, etc.)
 */
const COMPONENT_SCHEMA: CompressionSchema = {
  encode: (text: string) => {
    // Extract component name (first capitalized word or phrase)
    const nameMatch = text.match(/\b([A-Z][a-zA-Z]+(?:[A-Z][a-zA-Z]+)*)\b/);
    const name = nameMatch ? nameMatch[1] : 'Unknown';

    // Extract type indicators
    const type = text.match(/\b(orchestrator|facade|service|manager|engine|handler|store|tracker)\b/i)?.[1] || 'component';

    // Extract verbs (action words)
    const verbs: string[] = [];
    const verbPatterns = [
      /\b(executes?|runs?|handles?|manages?|orchestrates?|coordinates?)\b/gi,
      /\b(stores?|saves?|persists?|caches?)\b/gi,
      /\b(queries?|searches?|finds?|retrieves?)\b/gi,
      /\b(analyzes?|processes?|transforms?|converts?)\b/gi,
      /\b(validates?|verifies?|checks?|tests?)\b/gi,
      /\b(generates?|creates?|builds?|produces?)\b/gi,
      /\b(escalates?|notifies?|alerts?|reports?)\b/gi,
      /\b(decomposes?|breaks?|splits?)\b/gi,
      /\b(heals?|recovers?|retries?)\b/gi,
      /\b(learns?|adapts?|improves?)\b/gi,
    ];
    for (const pattern of verbPatterns) {
      const match = text.match(pattern);
      if (match) {
        verbs.push(match[0].toLowerCase().replace(/s$/, ''));
      }
    }

    // Extract dependencies (capitalized class names)
    const deps: string[] = [];
    const depMatches = text.matchAll(/\b([A-Z][a-zA-Z]+(?:[A-Z][a-zA-Z]+)+)\b/g);
    for (const match of depMatches) {
      if (match[1] !== name && !deps.includes(match[1])) {
        deps.push(match[1]);
      }
    }

    // Extract file path
    const pathMatch = text.match(/\b(src\/[\w/]+\.ts)\b/);
    const path = pathMatch ? pathMatch[1] : '';

    // Extract line count
    const linesMatch = text.match(/~?(\d+)\s*lines?/i);
    const lines = linesMatch ? `~${linesMatch[1]}` : '';

    let result = `COMP:${name}
TYPE:${type.toLowerCase()}
DOES:${verbs.slice(0, 5).join('→') || 'process'}`;

    if (deps.length > 0) {
      result += `\nDEPS:${deps.slice(0, 6).join(',')}`;
    }
    if (path) {
      result += `\nLOC:${path}`;
    }
    if (lines) {
      result += `\nLINES:${lines}`;
    }

    return result;
  },

  decode: (compressed: string) => {
    const kv = parseKV(compressed);
    const name = kv['COMP'] || 'Unknown';
    const type = kv['TYPE'] || 'component';
    const does = kv['DOES'] || '';
    const deps = kv['DEPS'] || '';
    const loc = kv['LOC'] || '';
    const lines = kv['LINES'] || '';

    let result = `${name} is a ${type} component.`;

    if (does) {
      result += `\n\nFunction: ${expandArrows(does)}`;
    }
    if (deps) {
      result += `\n\nDependencies: ${expandCommas(deps)}`;
    }
    if (loc) {
      result += `\nLocation: ${loc}`;
      if (lines) {
        result += ` (${lines} lines)`;
      }
    }

    return result;
  },
};

/**
 * Department schema (RUBIX departments)
 */
const DEPARTMENT_SCHEMA: CompressionSchema = {
  encode: (text: string) => {
    const nameMatch = text.match(/\b(Researcher|Architect|Engineer|Validator|Guardian)\b/i);
    const name = nameMatch ? nameMatch[1] : 'Unknown';

    // Map department to role
    const roles: Record<string, string> = {
      researcher: 'VP_Discovery',
      architect: 'VP_Design',
      engineer: 'VP_Implementation',
      validator: 'VP_Quality',
      guardian: 'VP_Reliability',
    };
    const role = roles[name.toLowerCase()] || 'VP_Operations';

    // Extract responsibilities
    const responsibilities: string[] = [];
    const respPatterns = [
      /\b(analyze|map|scan|explore|research)\b/gi,
      /\b(design|plan|structure|architect)\b/gi,
      /\b(build|implement|code|write)\b/gi,
      /\b(test|validate|verify|check)\b/gi,
      /\b(secure|guard|review|protect)\b/gi,
    ];
    for (const pattern of respPatterns) {
      const matches = text.match(pattern);
      if (matches) {
        responsibilities.push(...matches.map(m => m.toLowerCase()));
      }
    }

    // Extract sub-agents
    const agents: string[] = [];
    const agentPatterns = text.matchAll(/\b(\w+_\w+)\b/g);
    for (const match of agentPatterns) {
      if (!agents.includes(match[1])) {
        agents.push(match[1]);
      }
    }

    // Extract phase number
    const phaseMatch = text.match(/phase\s*(\d)/i);
    const phase = phaseMatch ? phaseMatch[1] : '';

    // Extract location
    const pathMatch = text.match(/\b(src\/[\w/]+\.ts)\b/);
    const path = pathMatch ? pathMatch[1] : '';

    let result = `DEPT:${name}
ROLE:${role}
DOES:${[...new Set(responsibilities)].slice(0, 5).join(',') || 'operate'}`;

    if (agents.length > 0) {
      result += `\nAGENTS:${agents.slice(0, 4).join(',')}`;
    }
    if (phase) {
      result += `\nPHASE:${phase}`;
    }
    if (path) {
      result += `\nLOC:${path}`;
    }

    return result;
  },

  decode: (compressed: string) => {
    const kv = parseKV(compressed);
    const name = kv['DEPT'] || 'Unknown';
    const role = kv['ROLE'] || '';
    const does = kv['DOES'] || '';
    const agents = kv['AGENTS'] || '';
    const phase = kv['PHASE'] || '';
    const loc = kv['LOC'] || '';

    let result = `RUBIX Department: ${name}`;

    if (role) {
      result += `\nRole: ${role.replace('_', ' of ')}`;
    }
    if (does) {
      result += `\nResponsibilities: ${expandCommas(does)}`;
    }
    if (agents) {
      result += `\nSub-Agents: ${agents}`;
    }
    if (phase) {
      result += `\nExecution Phase: ${phase}`;
    }
    if (loc) {
      result += `\nLocation: ${loc}`;
    }

    return result;
  },
};

/**
 * MCP Tool schema
 */
const MCP_TOOL_SCHEMA: CompressionSchema = {
  encode: (text: string) => {
    // Extract tool name (god_* pattern)
    const nameMatch = text.match(/\b(god_\w+)\b/);
    const name = nameMatch ? nameMatch[1] : 'unknown_tool';

    // Extract purpose (first sentence or verb phrase)
    const purposeMatch = text.match(/(?:^|\.\s*)([^.]+?)(?:\.|$)/);
    const purpose = purposeMatch
      ? purposeMatch[1]
          .replace(/\b(the|a|an|this|that)\b/gi, '')
          .replace(/\s+/g, '_')
          .toLowerCase()
          .slice(0, 50)
      : 'execute';

    // Extract parameters (word:type patterns)
    const params: string[] = [];
    const paramMatches = text.matchAll(/\b(\w+):\s*(string|number|boolean|object|array|\[\]|\{\})/gi);
    for (const match of paramMatches) {
      params.push(`${match[1]}:${match[2].toLowerCase()}`);
    }

    // Extract return type
    const returnMatch = text.match(/returns?\s*[:\-]?\s*(\{[^}]+\}|\w+)/i);
    const returns = returnMatch ? returnMatch[1] : 'result';

    // Extract use cases
    const useCases: string[] = [];
    const usePatterns = text.matchAll(/\b(for|when|use for|useful for)\s+([^,.]+)/gi);
    for (const match of usePatterns) {
      useCases.push(match[2].trim().replace(/\s+/g, '_').toLowerCase().slice(0, 20));
    }

    let result = `TOOL:${name}
DOES:${purpose}`;

    if (params.length > 0) {
      result += `\nIN:{${params.join(',')}}`;
    }
    if (returns) {
      result += `\nOUT:{${returns}}`;
    }
    if (useCases.length > 0) {
      result += `\nUSE:${useCases.slice(0, 3).join(',')}`;
    }

    return result;
  },

  decode: (compressed: string) => {
    const kv = parseKV(compressed);
    const name = kv['TOOL'] || 'unknown';
    const does = kv['DOES'] || '';
    const input = kv['IN'] || '';
    const output = kv['OUT'] || '';
    const use = kv['USE'] || '';

    let result = `MCP Tool: ${name}`;

    if (does) {
      result += `\nPurpose: ${does.replace(/_/g, ' ')}`;
    }
    if (input) {
      result += `\nParameters: ${input}`;
    }
    if (output) {
      result += `\nReturns: ${output}`;
    }
    if (use) {
      result += `\nUse Cases: ${use.replace(/_/g, ' ')}`;
    }

    return result;
  },
};

/**
 * Capability schema (IDE powers)
 */
const CAPABILITY_SCHEMA: CompressionSchema = {
  encode: (text: string) => {
    // Extract capability name
    const nameMatch = text.match(/\b(LSP|Git|AST|Profiler|Debug|REPL|Deps?|Docs?|Database|Stack(?:trace)?)\b/i);
    const name = nameMatch ? nameMatch[1].toUpperCase() : 'Unknown';

    // Extract functions
    const functions: string[] = [];
    const funcPatterns = text.matchAll(/\b(go[- ]?to|find|get|analyze|parse|traverse|trace|introspect|run|execute)\b/gi);
    for (const match of funcPatterns) {
      functions.push(match[1].toLowerCase().replace(/[- ]/g, '_'));
    }

    // Extract languages
    const langs: string[] = [];
    const langPatterns = text.matchAll(/\b(typescript|javascript|python|rust|go|java|ts|js|py)\b/gi);
    for (const match of langPatterns) {
      const lang = match[1].toLowerCase();
      if (!langs.includes(lang)) {
        langs.push(lang);
      }
    }

    // Extract API methods
    const apis: string[] = [];
    const apiPatterns = text.matchAll(/\b(\w+)\(\)/g);
    for (const match of apiPatterns) {
      if (!apis.includes(match[1])) {
        apis.push(match[1]);
      }
    }

    // Extract location
    const pathMatch = text.match(/\b(src\/[\w/]+)\b/);
    const path = pathMatch ? pathMatch[1] : '';

    let result = `CAP:${name}
DOES:${[...new Set(functions)].slice(0, 5).join(',') || 'analyze'}`;

    if (langs.length > 0) {
      result += `\nLANG:${langs.join(',')}`;
    }
    if (apis.length > 0) {
      result += `\nAPI:${apis.slice(0, 5).map(a => `${a}()`).join(',')}`;
    }
    if (path) {
      result += `\nLOC:${path}`;
    }

    return result;
  },

  decode: (compressed: string) => {
    const kv = parseKV(compressed);
    const name = kv['CAP'] || 'Unknown';
    const does = kv['DOES'] || '';
    const lang = kv['LANG'] || '';
    const api = kv['API'] || '';
    const loc = kv['LOC'] || '';

    let result = `IDE Capability: ${name}`;

    if (does) {
      result += `\nFunctions: ${expandCommas(does)}`;
    }
    if (lang) {
      result += `\nSupported Languages: ${lang}`;
    }
    if (api) {
      result += `\nAPI Methods: ${api}`;
    }
    if (loc) {
      result += `\nLocation: ${loc}`;
    }

    return result;
  },
};

/**
 * Workflow schema
 */
const WORKFLOW_SCHEMA: CompressionSchema = {
  encode: (text: string) => {
    // Extract workflow name
    const nameMatch = text.match(/\b(\w+(?:_\w+)*)\s*(?:flow|workflow|cycle|process)/i);
    const name = nameMatch ? nameMatch[1].toLowerCase() : 'process';

    // Extract steps (arrow patterns or numbered lists)
    const steps: string[] = [];
    const arrowMatch = text.match(/(?:→|->|then|next)\s*(\w+)/gi);
    if (arrowMatch) {
      for (const match of arrowMatch) {
        const step = match.replace(/(?:→|->|then|next)\s*/i, '');
        steps.push(step.toLowerCase());
      }
    }

    // Extract actors/components
    const actors: string[] = [];
    const actorPatterns = text.matchAll(/\b([A-Z][a-zA-Z]+(?:[A-Z][a-zA-Z]+)+)\b/g);
    for (const match of actorPatterns) {
      if (!actors.includes(match[1])) {
        actors.push(match[1]);
      }
    }

    // Extract budget/limit info
    const budgetMatch = text.match(/(\d+K?)\s*(?:tokens?|budget)/i);
    const budget = budgetMatch ? budgetMatch[1] : '';

    let result = `FLOW:${name}
STEPS:${steps.length > 0 ? steps.join('→') : 'start→process→complete'}`;

    if (actors.length > 0) {
      result += `\nACTORS:${actors.slice(0, 5).join(',')}`;
    }
    if (budget) {
      result += `\nBUDGET:${budget}`;
    }

    return result;
  },

  decode: (compressed: string) => {
    const kv = parseKV(compressed);
    const name = kv['FLOW'] || 'process';
    const steps = kv['STEPS'] || '';
    const actors = kv['ACTORS'] || '';
    const budget = kv['BUDGET'] || '';

    let result = `Workflow: ${name.replace(/_/g, ' ')}`;

    if (steps) {
      result += `\n\nSteps:\n${expandArrows(steps).split(', then ').map((s, i) => `  ${i + 1}. ${s}`).join('\n')}`;
    }
    if (actors) {
      result += `\n\nComponents Involved: ${expandCommas(actors)}`;
    }
    if (budget) {
      result += `\nToken Budget: ${budget}`;
    }

    return result;
  },
};

/**
 * Config schema
 */
const CONFIG_SCHEMA: CompressionSchema = {
  encode: (text: string) => {
    // Extract config name
    const nameMatch = text.match(/\b(\w+(?:_\w+)*)\s*(?:config|configuration|setting)/i);
    const name = nameMatch ? nameMatch[1].toUpperCase() : 'CONFIG';

    // Extract env vars
    const envVars: string[] = [];
    const envPatterns = text.matchAll(/\b([A-Z][A-Z_]+)\s*=/g);
    for (const match of envPatterns) {
      envVars.push(match[1]);
    }

    // Extract default values
    const defaults: string[] = [];
    const defaultPatterns = text.matchAll(/default[:\s]+(\w+)/gi);
    for (const match of defaultPatterns) {
      defaults.push(match[1]);
    }

    let result = `CFG:${name}`;

    if (envVars.length > 0) {
      result += `\nVARS:${envVars.slice(0, 10).join(',')}`;
    }
    if (defaults.length > 0) {
      result += `\nDEFAULTS:${defaults.join(',')}`;
    }

    return result;
  },

  decode: (compressed: string) => {
    const kv = parseKV(compressed);
    const name = kv['CFG'] || 'Configuration';
    const vars = kv['VARS'] || '';
    const defaults = kv['DEFAULTS'] || '';

    let result = `Configuration: ${name}`;

    if (vars) {
      result += `\n\nEnvironment Variables:\n${vars.split(',').map(v => `  - ${v}`).join('\n')}`;
    }
    if (defaults) {
      result += `\n\nDefault Values: ${defaults}`;
    }

    return result;
  },
};

/**
 * Error pattern schema
 */
const ERROR_PATTERN_SCHEMA: CompressionSchema = {
  encode: (text: string) => {
    // Extract error type
    const typeMatch = text.match(/\b(\w+Error|\w+Exception)\b/);
    const type = typeMatch ? typeMatch[1] : 'Error';

    // Extract message pattern
    const msgMatch = text.match(/message[:\s]+["']?([^"'\n]+)["']?/i);
    const msg = msgMatch ? msgMatch[1].slice(0, 50) : '';

    // Extract cause
    const causeMatch = text.match(/cause[d]?\s+by[:\s]+([^.\n]+)/i);
    const cause = causeMatch ? causeMatch[1].slice(0, 50) : '';

    // Extract fix
    const fixMatch = text.match(/fix[:\s]+([^.\n]+)/i);
    const fix = fixMatch ? fixMatch[1].slice(0, 50) : '';

    let result = `ERR:${type}`;

    if (msg) {
      result += `\nMSG:${msg}`;
    }
    if (cause) {
      result += `\nCAUSE:${cause}`;
    }
    if (fix) {
      result += `\nFIX:${fix}`;
    }

    return result;
  },

  decode: (compressed: string) => {
    const kv = parseKV(compressed);
    const type = kv['ERR'] || 'Error';
    const msg = kv['MSG'] || '';
    const cause = kv['CAUSE'] || '';
    const fix = kv['FIX'] || '';

    let result = `Error Pattern: ${type}`;

    if (msg) {
      result += `\nMessage: ${msg}`;
    }
    if (cause) {
      result += `\nRoot Cause: ${cause}`;
    }
    if (fix) {
      result += `\nResolution: ${fix}`;
    }

    return result;
  },
};

/**
 * Success pattern schema
 */
const SUCCESS_PATTERN_SCHEMA: CompressionSchema = {
  encode: (text: string) => {
    // Extract pattern name
    const nameMatch = text.match(/\b(\w+(?:_\w+)*)\s*pattern/i);
    const name = nameMatch ? nameMatch[1] : 'success';

    // Extract success factors
    const factors: string[] = [];
    const factorPatterns = text.matchAll(/\b(because|due to|works? when|succeeds? when)\s+([^,.]+)/gi);
    for (const match of factorPatterns) {
      factors.push(match[2].trim().slice(0, 30));
    }

    // Extract confidence/success rate
    const rateMatch = text.match(/(\d+(?:\.\d+)?)\s*%?\s*(?:success|confidence)/i);
    const rate = rateMatch ? rateMatch[1] : '';

    let result = `PAT:${name}`;

    if (factors.length > 0) {
      result += `\nFACTORS:${factors.slice(0, 3).join(',')}`;
    }
    if (rate) {
      result += `\nRATE:${rate}%`;
    }

    return result;
  },

  decode: (compressed: string) => {
    const kv = parseKV(compressed);
    const name = kv['PAT'] || 'Pattern';
    const factors = kv['FACTORS'] || '';
    const rate = kv['RATE'] || '';

    let result = `Success Pattern: ${name}`;

    if (factors) {
      result += `\nKey Factors: ${expandCommas(factors)}`;
    }
    if (rate) {
      result += `\nSuccess Rate: ${rate}`;
    }

    return result;
  },
};

/**
 * System overview schema
 */
const SYSTEM_SCHEMA: CompressionSchema = {
  encode: (text: string) => {
    // Extract system name
    const nameMatch = text.match(/\b(\w+(?:-\w+)*)\b/);
    const name = nameMatch ? nameMatch[1] : 'system';

    // Extract modes
    const modes: string[] = [];
    const modePatterns = text.matchAll(/\b(mcp|cli|daemon|server|standalone|bot)\b/gi);
    for (const match of modePatterns) {
      modes.push(match[1].toLowerCase());
    }

    // Extract core components
    const cores: string[] = [];
    const corePatterns = text.matchAll(/\b([A-Z][a-zA-Z]+(?:[A-Z][a-zA-Z]+)+)\b/g);
    for (const match of corePatterns) {
      if (!cores.includes(match[1])) {
        cores.push(match[1]);
      }
    }

    // Extract storage info
    const storeMatch = text.match(/\b(sqlite|postgres|redis|hnsw|vector)\b/gi);
    const storage = storeMatch ? [...new Set(storeMatch.map(s => s.toLowerCase()))].join('+') : '';

    // Extract embedding info
    const embedMatch = text.match(/(\d+)\s*(?:dim|dimensional)/i);
    const embed = embedMatch ? `${embedMatch[1]}dim` : '';

    let result = `SYS:${name}`;

    if (modes.length > 0) {
      result += `\nMODE:${modes.join('|')}`;
    }
    if (cores.length > 0) {
      result += `\nCORE:${cores.slice(0, 5).join(',')}`;
    }
    if (storage) {
      result += `\nSTORE:${storage}`;
    }
    if (embed) {
      result += `\nEMBED:${embed}`;
    }

    return result;
  },

  decode: (compressed: string) => {
    const kv = parseKV(compressed);
    const name = kv['SYS'] || 'System';
    const mode = kv['MODE'] || '';
    const core = kv['CORE'] || '';
    const store = kv['STORE'] || '';
    const embed = kv['EMBED'] || '';
    const learn = kv['LEARN'] || '';
    const comms = kv['COMMS'] || '';

    let result = `System: ${name}`;

    if (mode) {
      result += `\nDeployment Modes: ${mode.replace(/\|/g, ', ')}`;
    }
    if (core) {
      result += `\nCore Components: ${expandCommas(core)}`;
    }
    if (store) {
      result += `\nStorage: ${store}`;
    }
    if (embed) {
      result += `\nEmbedding: ${embed}`;
    }
    if (learn) {
      result += `\nLearning: ${learn}`;
    }
    if (comms) {
      result += `\nCommunication Channels: ${comms}`;
    }

    return result;
  },
};

/**
 * Generic schema (fallback)
 */
const GENERIC_SCHEMA: CompressionSchema = {
  encode: (text: string) => {
    // Remove articles
    let compressed = text.replace(/\b(a|an|the)\b/gi, '');

    // Remove pronouns
    compressed = compressed.replace(/\b(you|I|we|they|he|she|it|your|my|our)\b/gi, '');

    // Remove politeness
    compressed = compressed.replace(/\b(please|thanks|thank you|kindly)\b/gi, '');

    // Remove hedging
    compressed = compressed.replace(/\b(maybe|might|could|would|should|perhaps|possibly)\b/gi, '');

    // Remove filler
    compressed = compressed.replace(/\b(basically|actually|really|very|just|simply|quite)\b/gi, '');

    // Collapse whitespace
    compressed = compressed.replace(/\s+/g, ' ').trim();

    return compressed;
  },

  decode: (compressed: string) => {
    // For generic content, just return as-is (already readable)
    return compressed;
  },
};

/**
 * All compression schemas registry.
 */
export const COMPRESSION_SCHEMAS: Record<MemoryType, CompressionSchema> = {
  component: COMPONENT_SCHEMA,
  department: DEPARTMENT_SCHEMA,
  mcp_tool: MCP_TOOL_SCHEMA,
  capability: CAPABILITY_SCHEMA,
  workflow: WORKFLOW_SCHEMA,
  config: CONFIG_SCHEMA,
  error_pattern: ERROR_PATTERN_SCHEMA,
  success_pattern: SUCCESS_PATTERN_SCHEMA,
  system: SYSTEM_SCHEMA,
  generic: GENERIC_SCHEMA,
};
