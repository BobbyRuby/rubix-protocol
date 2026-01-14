/**
 * CompressionSchemas - Pure positional token compression.
 *
 * Format: position0|position1|position2|...
 * Machine knows schema -> position = meaning -> no keys needed.
 *
 * Principles:
 * - Strip the bullshit, pure function, compress into pure tokens
 * - No NLP strings, pure efficiency
 * - Machine understands tokens, humans get decoded output
 */

import { MemoryType, CompressionSchema } from './types.js';

// Type code mappings
const TYPE_CODES: Record<string, string> = {
  orchestrator: 'O', facade: 'F', service: 'S', manager: 'M', engine: 'E', handler: 'H',
  O: 'orchestrator', F: 'facade', S: 'service', M: 'manager', E: 'engine', H: 'handler',
};

const ROLE_CODES: Record<string, string> = {
  discovery: 'D', design: 'G', implementation: 'I', quality: 'Q', reliability: 'R',
  D: 'discovery', G: 'design', I: 'implementation', Q: 'quality', R: 'reliability',
};

const STATUS_CODES: Record<string, string> = {
  fixed: 'F', open: 'O', wip: 'W', resolved: 'F', closed: 'F',
  F: 'fixed', O: 'open', W: 'wip',
};

const INSIGHT_TYPE_CODES: Record<string, string> = {
  lesson: 'L', pattern: 'P', rule: 'R', lesson_learned: 'L',
  L: 'lesson', P: 'pattern', R: 'rule',
};

const FEATURE_TYPE_CODES: Record<string, string> = {
  module: 'M', new_module: 'M', enhancement: 'E', refactor: 'R', feature: 'M',
  M: 'module', E: 'enhancement', R: 'refactor',
};

const PARAM_TYPE_CODES: Record<string, string> = {
  string: 's', number: 'n', boolean: 'b', array: 'a', object: 'o',
  s: 'string', n: 'number', b: 'boolean', a: 'array', o: 'object',
};

/**
 * Extract initials from PascalCase name.
 * TaskExecutor -> TE, MemoryEngine -> ME
 */
function toInitials(name: string): string {
  return name.replace(/[a-z]/g, '');
}

/**
 * Convert action words to short form.
 * "execute, decompose, heal" -> "exe.dec.heal"
 */
function compressActions(actions: string[]): string {
  return actions.map(a => a.slice(0, 3).toLowerCase()).join('.');
}

/**
 * Expand short action form to words.
 * "exe.dec.heal" -> "execute, decompose, heal"
 */
function expandActions(compressed: string): string {
  if (!compressed) return '';
  const actionMap: Record<string, string> = {
    exe: 'execute', dec: 'decompose', hea: 'heal', ret: 'retry', ana: 'analyze',
    map: 'map', sca: 'scan', exp: 'explore', res: 'research', des: 'design',
    pla: 'plan', str: 'structure', arc: 'architect', bui: 'build', imp: 'implement',
    cod: 'code', wri: 'write', tes: 'test', val: 'validate', ver: 'verify',
    che: 'check', sec: 'secure', gua: 'guard', rev: 'review', prt: 'protect',
    sto: 'store', sav: 'save', per: 'persist', cac: 'cache', que: 'query',
    sea: 'search', fin: 'find', rtv: 'retrieve', tra: 'transform', con: 'convert',
    gen: 'generate', cre: 'create', esc: 'escalate', not: 'notify', ale: 'alert',
    bre: 'break', spl: 'split', rec: 'recover', lea: 'learn', ada: 'adapt',
    got: 'goto', get: 'get', par: 'parse', trc: 'trace', int: 'introspect',
    run: 'run', ope: 'operate', pro: 'process',
  };
  return compressed.split('.').map(c => actionMap[c] || c).join(', ');
}

/**
 * Compress deps to initials.
 * "CodeGenerator, SelfHealer" -> "CG.SH"
 */
function compressDeps(deps: string[]): string {
  return deps.map(toInitials).join('.');
}

/**
 * Sanitize text: remove extra spaces, convert to snake_case tokens.
 */
function sanitize(text: string, maxLen = 40): string {
  return text
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, '_')
    .toLowerCase()
    .slice(0, maxLen);
}

/**
 * 1. COMPONENT: name|type|actions|deps|path|lines
 * Example: TaskExecutor|O|exe.dec.heal|CG.SH|codex/TaskExecutor.ts|1800
 */
const COMPONENT_SCHEMA: CompressionSchema = {
  encode: (text: string) => {
    const nameMatch = text.match(/\b([A-Z][a-zA-Z]+(?:[A-Z][a-zA-Z]+)*)\b/);
    const name = nameMatch?.[1] || 'Unknown';

    const typeMatch = text.match(/\b(orchestrator|facade|service|manager|engine|handler)\b/i);
    const type = TYPE_CODES[typeMatch?.[1]?.toLowerCase() || ''] || 'S';

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
    for (const p of verbPatterns) {
      const m = text.match(p);
      if (m) verbs.push(m[0].toLowerCase().replace(/e?s$/, ''));
    }
    const actions = compressActions([...new Set(verbs)].slice(0, 5));

    const deps: string[] = [];
    for (const m of text.matchAll(/\b([A-Z][a-zA-Z]*[A-Z][a-zA-Z]*)\b/g)) {
      if (m[1] !== name && !deps.includes(m[1])) deps.push(m[1]);
    }
    const depsStr = compressDeps(deps.slice(0, 4));

    const pathMatch = text.match(/\b(\w+\/[\w/]+\.ts)\b/);
    const path = pathMatch?.[1] || '';

    const linesMatch = text.match(/~?(\d+)\s*lines?/i);
    const lines = linesMatch?.[1] || '';

    return [name, type, actions || 'pro', depsStr, path, lines].join('|');
  },

  decode: (compressed: string) => {
    const [name, type, actions, deps, path, lines] = compressed.split('|');
    const typeStr = TYPE_CODES[type] || 'service';
    let result = `${name} is a ${typeStr} component.`;
    if (actions) result += `\nActions: ${expandActions(actions)}`;
    if (deps) result += `\nDependencies: ${deps.split('.').join(', ')}`;
    if (path) result += `\nLocation: ${path}`;
    if (lines) result += ` (~${lines} lines)`;
    return result;
  },
};

/**
 * 2. DEPARTMENT: name|role|actions|agents|phase|path
 * Example: Researcher|D|ana.map.sca|dep_analyzer.pattern_finder|1|codex/departments/
 */
const DEPARTMENT_SCHEMA: CompressionSchema = {
  encode: (text: string) => {
    const nameMatch = text.match(/\b(Researcher|Architect|Engineer|Validator|Guardian)\b/i);
    const name = nameMatch?.[1] || 'Department';

    const roleMap: Record<string, string> = {
      researcher: 'D', architect: 'G', engineer: 'I', validator: 'Q', guardian: 'R',
    };
    const role = roleMap[name.toLowerCase()] || 'I';

    const verbs: string[] = [];
    const patterns = [
      /\b(analyze|map|scan|explore|research)\b/gi,
      /\b(design|plan|structure|architect)\b/gi,
      /\b(build|implement|code|write)\b/gi,
      /\b(test|validate|verify|check)\b/gi,
      /\b(secure|guard|review|protect)\b/gi,
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m) verbs.push(...m.map(v => v.toLowerCase()));
    }
    const actions = compressActions([...new Set(verbs)].slice(0, 4));

    const agents: string[] = [];
    for (const m of text.matchAll(/\b(\w+_\w+)\b/g)) {
      if (!agents.includes(m[1])) agents.push(m[1]);
    }
    const agentsStr = agents.slice(0, 3).join('.');

    const phaseMatch = text.match(/phase\s*(\d)/i);
    const phase = phaseMatch?.[1] || '';

    const pathMatch = text.match(/\b(\w+\/[\w/]+)\b/);
    const path = pathMatch?.[1] || '';

    return [name, role, actions || 'ope', agentsStr, phase, path].join('|');
  },

  decode: (compressed: string) => {
    const [name, role, actions, agents, phase, path] = compressed.split('|');
    const roleStr = ROLE_CODES[role] || 'implementation';
    let result = `RUBIX Department: ${name}`;
    result += `\nRole: VP of ${roleStr}`;
    if (actions) result += `\nResponsibilities: ${expandActions(actions)}`;
    if (agents) result += `\nSub-Agents: ${agents.split('.').join(', ')}`;
    if (phase) result += `\nExecution Phase: ${phase}`;
    if (path) result += `\nLocation: ${path}`;
    return result;
  },
};

/**
 * 3. MCP_TOOL: name|action|params|returns|uses
 * Example: god_store|store_mem|content:s.tags:a.importance:n|id.lscore|persist.track
 */
const MCP_TOOL_SCHEMA: CompressionSchema = {
  encode: (text: string) => {
    const nameMatch = text.match(/\b(god_\w+)\b/);
    const name = nameMatch?.[1] || 'god_tool';

    const purposeMatch = text.match(/(?:^|\.\s*)([^.]+?)(?:\.|$)/);
    const action = purposeMatch?.[1]
      ? sanitize(purposeMatch[1], 30)
      : 'execute';

    const params: string[] = [];
    for (const m of text.matchAll(/\b(\w+):\s*(string|number|boolean|object|array)/gi)) {
      const typeCode = PARAM_TYPE_CODES[m[2].toLowerCase()] || 's';
      params.push(`${m[1]}:${typeCode}`);
    }
    const paramsStr = params.slice(0, 4).join('.');

    const returnMatch = text.match(/returns?\s*[:\-]?\s*(\w+)/i);
    const returns = returnMatch?.[1] || 'result';

    const uses: string[] = [];
    for (const m of text.matchAll(/\b(?:for|when|use for)\s+(\w+)/gi)) {
      uses.push(m[1].toLowerCase());
    }
    const usesStr = uses.slice(0, 3).join('.');

    return [name, action, paramsStr, returns, usesStr].join('|');
  },

  decode: (compressed: string) => {
    const [name, action, params, returns, uses] = compressed.split('|');
    let result = `MCP Tool: ${name}`;
    if (action) result += `\nPurpose: ${action.replace(/_/g, ' ')}`;
    if (params) {
      const expanded = params.split('.').map(p => {
        const [n, t] = p.split(':');
        return `${n}: ${PARAM_TYPE_CODES[t] || t}`;
      }).join(', ');
      result += `\nParameters: ${expanded}`;
    }
    if (returns) result += `\nReturns: ${returns}`;
    if (uses) result += `\nUse Cases: ${uses.split('.').join(', ')}`;
    return result;
  },
};

/**
 * 4. CAPABILITY: name|actions|langs|apis|path
 * Example: LSP|goto.refs.diag|ts.js|definition().references()|capabilities/
 */
const CAPABILITY_SCHEMA: CompressionSchema = {
  encode: (text: string) => {
    const nameMatch = text.match(/\b(LSP|Git|AST|Profiler|Debug|REPL|Deps?|Docs?|Database|Stack(?:trace)?)\b/i);
    const name = nameMatch?.[1]?.toUpperCase() || 'CAP';

    const funcs: string[] = [];
    for (const m of text.matchAll(/\b(go[- ]?to|find|get|analyze|parse|traverse|trace|introspect|run)\b/gi)) {
      funcs.push(m[1].toLowerCase().replace(/[- ]/g, ''));
    }
    const actions = funcs.slice(0, 4).map(f => f.slice(0, 4)).join('.');

    const langs: string[] = [];
    for (const m of text.matchAll(/\b(typescript|javascript|python|rust|go|java|ts|js|py)\b/gi)) {
      const l = m[1].toLowerCase();
      if (!langs.includes(l)) langs.push(l.length > 2 ? l.slice(0, 2) : l);
    }
    const langsStr = langs.join('.');

    const apis: string[] = [];
    for (const m of text.matchAll(/\b(\w+)\(\)/g)) {
      if (!apis.includes(m[1])) apis.push(m[1]);
    }
    const apisStr = apis.slice(0, 4).map(a => `${a}()`).join('.');

    const pathMatch = text.match(/\b(\w+\/[\w/]*)\b/);
    const path = pathMatch?.[1] || '';

    return [name, actions || 'ana', langsStr, apisStr, path].join('|');
  },

  decode: (compressed: string) => {
    const [name, actions, langs, apis, path] = compressed.split('|');
    let result = `IDE Capability: ${name}`;
    if (actions) result += `\nFunctions: ${actions.split('.').join(', ')}`;
    if (langs) result += `\nLanguages: ${langs.split('.').join(', ')}`;
    if (apis) result += `\nAPI Methods: ${apis.split('.').join(', ')}`;
    if (path) result += `\nLocation: ${path}`;
    return result;
  },
};

/**
 * 5. WORKFLOW: name|steps|actors|budget
 * Example: self_heal|fail.analyze.alt.retry|SH.AF.CG|16K
 */
const WORKFLOW_SCHEMA: CompressionSchema = {
  encode: (text: string) => {
    const nameMatch = text.match(/\b(\w+(?:_\w+)*)\s*(?:flow|workflow|cycle|process)/i);
    const name = nameMatch?.[1]?.toLowerCase() || 'process';

    const steps: string[] = [];
    for (const m of text.matchAll(/(?:→|->|then|next)\s*(\w+)/gi)) {
      steps.push(m[1].toLowerCase().slice(0, 4));
    }
    const stepsStr = steps.length > 0 ? steps.join('.') : 'start.proc.done';

    const actors: string[] = [];
    for (const m of text.matchAll(/\b([A-Z][a-zA-Z]*[A-Z][a-zA-Z]*)\b/g)) {
      if (!actors.includes(m[1])) actors.push(toInitials(m[1]));
    }
    const actorsStr = actors.slice(0, 4).join('.');

    const budgetMatch = text.match(/(\d+K?)\s*(?:tokens?|budget)/i);
    const budget = budgetMatch?.[1] || '';

    return [name, stepsStr, actorsStr, budget].join('|');
  },

  decode: (compressed: string) => {
    const [name, steps, actors, budget] = compressed.split('|');
    let result = `Workflow: ${name.replace(/_/g, ' ')}`;
    if (steps) result += `\nSteps: ${steps.split('.').join(' -> ')}`;
    if (actors) result += `\nActors: ${actors.split('.').join(', ')}`;
    if (budget) result += `\nToken Budget: ${budget}`;
    return result;
  },
};

/**
 * 6. CONFIG: name|vars|defaults
 * Example: RUBIX|OPENAI_KEY.ANTHROPIC_KEY.MODEL|opus.5000.16000
 */
const CONFIG_SCHEMA: CompressionSchema = {
  encode: (text: string) => {
    const nameMatch = text.match(/\b(\w+(?:_\w+)*)\s*(?:config|configuration|setting)/i);
    const name = nameMatch?.[1]?.toUpperCase() || 'CONFIG';

    const vars: string[] = [];
    for (const m of text.matchAll(/\b([A-Z][A-Z_]+)\s*=/g)) {
      vars.push(m[1]);
    }
    const varsStr = vars.slice(0, 6).join('.');

    const defaults: string[] = [];
    for (const m of text.matchAll(/default[:\s]+(\w+)/gi)) {
      defaults.push(m[1]);
    }
    const defaultsStr = defaults.join('.');

    return [name, varsStr, defaultsStr].join('|');
  },

  decode: (compressed: string) => {
    const [name, vars, defaults] = compressed.split('|');
    let result = `Configuration: ${name}`;
    if (vars) result += `\nEnvironment Variables: ${vars.split('.').join(', ')}`;
    if (defaults) result += `\nDefaults: ${defaults.split('.').join(', ')}`;
    return result;
  },
};

/**
 * 7. ERROR_PATTERN: id|symptom|root|fix|file
 * Example: I001|cap_no_init|getcap_skip_init|add_await|mcp-server.ts
 */
const ERROR_PATTERN_SCHEMA: CompressionSchema = {
  encode: (text: string) => {
    const idMatch = text.match(/\b(ISSUE-\d+|I\d+|\w+Error|\w+Exception)\b/i);
    const id = idMatch?.[1] || text.match(/^(\w+)/)?.[1] || 'ERR';

    const symptomMatch = text.match(/symptom[s]?[:\s]+([^.\n]+)/i);
    const symptom = symptomMatch ? sanitize(symptomMatch[1], 30) : '';

    const rootMatch = text.match(/(?:root\s*cause|cause|root)[:\s]+([^.\n]+)/i);
    const root = rootMatch ? sanitize(rootMatch[1], 30) : '';

    const fixMatch = text.match(/fix[:\s]+([^.\n]+)/i);
    const fix = fixMatch ? sanitize(fixMatch[1], 30) : '';

    const fileMatch = text.match(/\b(\w+\.ts)\b/);
    const file = fileMatch?.[1] || '';

    return [id, symptom, root, fix, file].join('|');
  },

  decode: (compressed: string) => {
    const [id, symptom, root, fix, file] = compressed.split('|');
    let result = `Error Pattern: ${id}`;
    if (symptom) result += `\nSymptom: ${symptom.replace(/_/g, ' ')}`;
    if (root) result += `\nRoot Cause: ${root.replace(/_/g, ' ')}`;
    if (fix) result += `\nFix: ${fix.replace(/_/g, ' ')}`;
    if (file) result += `\nFile: ${file}`;
    return result;
  },
};

/**
 * 8. SUCCESS_PATTERN: name|factors|rate|context
 * Example: retry_think|ext_budget.alt_approach|85|complex_code
 */
const SUCCESS_PATTERN_SCHEMA: CompressionSchema = {
  encode: (text: string) => {
    const nameMatch = text.match(/\b(\w+(?:_\w+)*)\s*pattern/i);
    const name = nameMatch?.[1] || 'success';

    const factors: string[] = [];
    for (const m of text.matchAll(/\b(?:because|due to|works? when|succeeds? when)\s+([^,.]+)/gi)) {
      factors.push(sanitize(m[1], 20));
    }
    const factorsStr = factors.slice(0, 3).join('.');

    const rateMatch = text.match(/(\d+(?:\.\d+)?)\s*%?\s*(?:success|confidence|rate)/i);
    const rate = rateMatch?.[1] || '';

    const contextMatch = text.match(/context[:\s]+([^.\n]+)/i);
    const context = contextMatch ? sanitize(contextMatch[1], 20) : '';

    return [name, factorsStr, rate, context].join('|');
  },

  decode: (compressed: string) => {
    const [name, factors, rate, context] = compressed.split('|');
    let result = `Success Pattern: ${name.replace(/_/g, ' ')}`;
    if (factors) result += `\nKey Factors: ${factors.split('.').map(f => f.replace(/_/g, ' ')).join(', ')}`;
    if (rate) result += `\nSuccess Rate: ${rate}%`;
    if (context) result += `\nContext: ${context.replace(/_/g, ' ')}`;
    return result;
  },
};

/**
 * 9. SYSTEM: name|modes|core|storage|embed
 * Example: god-agent|mcp.cli.daemon|TE.ME.CG|sqlite.hnsw|768
 */
const SYSTEM_SCHEMA: CompressionSchema = {
  encode: (text: string) => {
    const nameMatch = text.match(/\b(\w+(?:-\w+)*)\b/);
    const name = nameMatch?.[1] || 'system';

    const modes: string[] = [];
    for (const m of text.matchAll(/\b(mcp|cli|daemon|server|standalone|bot)\b/gi)) {
      modes.push(m[1].toLowerCase());
    }
    const modesStr = modes.join('.');

    const cores: string[] = [];
    for (const m of text.matchAll(/\b([A-Z][a-zA-Z]*[A-Z][a-zA-Z]*)\b/g)) {
      if (!cores.includes(m[1])) cores.push(toInitials(m[1]));
    }
    const coresStr = cores.slice(0, 5).join('.');

    const storeMatch = text.match(/\b(sqlite|postgres|redis|hnsw|vector)\b/gi);
    const storage = storeMatch ? [...new Set(storeMatch.map(s => s.toLowerCase()))].join('.') : '';

    const embedMatch = text.match(/(\d+)\s*(?:dim|dimensional)/i);
    const embed = embedMatch?.[1] || '';

    return [name, modesStr, coresStr, storage, embed].join('|');
  },

  decode: (compressed: string) => {
    const [name, modes, cores, storage, embed] = compressed.split('|');
    let result = `System: ${name}`;
    if (modes) result += `\nModes: ${modes.split('.').join(', ')}`;
    if (cores) result += `\nCore Components: ${cores.split('.').join(', ')}`;
    if (storage) result += `\nStorage: ${storage.split('.').join(' + ')}`;
    if (embed) result += `\nEmbedding: ${embed}-dim`;
    return result;
  },
};

/**
 * 10. BUG_FIX: id|status|symptom|root|fix|file|lesson
 * Example: I001|F|cap_err|no_init|await_init|mcp-server.ts|always_init_mgrs
 * Status: F=fixed O=open W=wip
 */
const BUG_FIX_SCHEMA: CompressionSchema = {
  encode: (text: string) => {
    const idMatch = text.match(/\b(?:bug|issue|problem)[:\s]*(\w+[-\d]*)/i) ||
                    text.match(/\b(ISSUE-\d+|I\d+)\b/i);
    const id = idMatch?.[1] || 'BUG';

    const statusMatch = text.match(/\b(?:status[:\s]*)?(fixed|resolved|closed|open|wip)\b/i);
    const status = STATUS_CODES[statusMatch?.[1]?.toLowerCase() || 'fixed'] || 'F';

    const symptomMatch = text.match(/symptom[s]?[:\s]+([^.\n]+)/i);
    const symptom = symptomMatch ? sanitize(symptomMatch[1], 30) : '';

    const rootMatch = text.match(/(?:root\s*cause|cause|root)[:\s]+([^.\n]+)/i);
    const root = rootMatch ? sanitize(rootMatch[1], 30) : '';

    const fixMatch = text.match(/fix[:\s]+([^.\n]+)/i);
    const fix = fixMatch ? sanitize(fixMatch[1], 30) : '';

    const fileMatch = text.match(/(?:file[:\s]*)?(\w+\.ts)\b/i);
    const file = fileMatch?.[1] || '';

    const lessonMatch = text.match(/lesson[:\s]+([^.\n]+)/i);
    const lesson = lessonMatch ? sanitize(lessonMatch[1], 30) : '';

    return [id, status, symptom, root, fix, file, lesson].join('|');
  },

  decode: (compressed: string) => {
    const [id, status, symptom, root, fix, file, lesson] = compressed.split('|');
    const statusStr = STATUS_CODES[status] || 'unknown';
    let result = `Bug: ${id} [${statusStr.toUpperCase()}]`;
    if (symptom) result += `\nSymptom: ${symptom.replace(/_/g, ' ')}`;
    if (root) result += `\nRoot Cause: ${root.replace(/_/g, ' ')}`;
    if (fix) result += `\nFix: ${fix.replace(/_/g, ' ')}`;
    if (file) result += `\nFile: ${file}`;
    if (lesson) result += `\nLesson: ${lesson.replace(/_/g, ' ')}`;
    return result;
  },
};

/**
 * 11. DEV_FEATURE: name|type|purpose|path|exports|wiring
 * Example: Compression|M|token_efficiency|memory/|encode.decode|MemoryEngine
 * Type: M=module E=enhancement R=refactor
 */
const DEV_FEATURE_SCHEMA: CompressionSchema = {
  encode: (text: string) => {
    const nameMatch = text.match(/\b(?:feature|dev)[:\s]*(\w+)/i) ||
                      text.match(/\b([A-Z][a-zA-Z]+(?:[A-Z][a-zA-Z]+)*)\b/);
    const name = nameMatch?.[1] || 'Feature';

    const typeMatch = text.match(/\btype[:\s]*(\w+)/i) ||
                      text.match(/\b(new_module|module|enhancement|refactor)\b/i);
    const type = FEATURE_TYPE_CODES[typeMatch?.[1]?.toLowerCase() || ''] || 'M';

    const purposeMatch = text.match(/purpose[:\s]+([^.\n]+)/i);
    const purpose = purposeMatch ? sanitize(purposeMatch[1], 30) : '';

    const pathMatch = text.match(/\b(\w+\/[\w/]*)\b/);
    const path = pathMatch?.[1] || '';

    const exports: string[] = [];
    for (const m of text.matchAll(/\b(?:export\s+)?(?:interface|class|function|const)\s+(\w+)/g)) {
      exports.push(m[1]);
    }
    const exportsStr = exports.slice(0, 4).join('.');

    const wiringMatch = text.match(/wir(?:ing|ed?)[:\s]+([^.\n]+)/i);
    const wiring = wiringMatch ? sanitize(wiringMatch[1], 20) : '';

    return [name, type, purpose, path, exportsStr, wiring].join('|');
  },

  decode: (compressed: string) => {
    const [name, type, purpose, path, exports, wiring] = compressed.split('|');
    const typeStr = FEATURE_TYPE_CODES[type] || 'module';
    let result = `Feature: ${name}`;
    result += `\nType: ${typeStr}`;
    if (purpose) result += `\nPurpose: ${purpose.replace(/_/g, ' ')}`;
    if (path) result += `\nPath: ${path}`;
    if (exports) result += `\nExports: ${exports.split('.').join(', ')}`;
    if (wiring) result += `\nIntegration: ${wiring.replace(/_/g, ' ')}`;
    return result;
  },
};

/**
 * 12. ARCH_INSIGHT: name|type|insight|pattern|rule|comps
 * Example: async_init|L|mgrs_need_init|lazy_init|always_await|CapsMgr.TaskExec
 * Type: L=lesson P=pattern R=rule
 */
const ARCH_INSIGHT_SCHEMA: CompressionSchema = {
  encode: (text: string) => {
    const nameMatch = text.match(/\b(?:arch|architecture)[:\s]*(\w+)/i) ||
                      text.match(/\b([a-z_]+)\b/);
    const name = nameMatch?.[1] || 'insight';

    const typeMatch = text.match(/\btype[:\s]*(\w+)/i);
    const type = INSIGHT_TYPE_CODES[typeMatch?.[1]?.toLowerCase() || ''] || 'L';

    const insightMatch = text.match(/(?:insight|lesson)[:\s]+([^.\n]+)/i);
    const insight = insightMatch ? sanitize(insightMatch[1], 30) : '';

    const patternMatch = text.match(/pattern[:\s]+([^.\n]+)/i);
    const pattern = patternMatch ? sanitize(patternMatch[1], 20) : '';

    const ruleMatch = text.match(/rule[:\s]+([^.\n]+)/i);
    const rule = ruleMatch ? sanitize(ruleMatch[1], 20) : '';

    const comps: string[] = [];
    for (const m of text.matchAll(/\b([A-Z][a-zA-Z]*[A-Z][a-zA-Z]*)\b/g)) {
      if (!comps.includes(m[1])) comps.push(toInitials(m[1]));
    }
    const compsStr = comps.slice(0, 4).join('.');

    return [name, type, insight, pattern, rule, compsStr].join('|');
  },

  decode: (compressed: string) => {
    const [name, type, insight, pattern, rule, comps] = compressed.split('|');
    const typeStr = INSIGHT_TYPE_CODES[type] || 'lesson';
    let result = `Architecture: ${name.replace(/_/g, ' ')}`;
    result += `\nType: ${typeStr}`;
    if (insight) result += `\nKey Insight: ${insight.replace(/_/g, ' ')}`;
    if (pattern) result += `\nPattern: ${pattern.replace(/_/g, ' ')}`;
    if (rule) result += `\nRule: ${rule.replace(/_/g, ' ')}`;
    if (comps) result += `\nComponents: ${comps.split('.').join(', ')}`;
    return result;
  },
};

/**
 * 13. GENERIC: passthrough with filler removal
 * Strips articles, pronouns, hedging, filler -> compact text
 */
const GENERIC_SCHEMA: CompressionSchema = {
  encode: (text: string) => {
    return text
      .replace(/\b(a|an|the)\b/gi, '')
      .replace(/\b(you|I|we|they|he|she|it|your|my|our|their)\b/gi, '')
      .replace(/\b(please|thanks|thank you|kindly)\b/gi, '')
      .replace(/\b(maybe|might|could|would|should|perhaps|possibly)\b/gi, '')
      .replace(/\b(basically|actually|really|very|just|simply|quite)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  },

  decode: (compressed: string) => compressed,
};

/**
 * Helper: Encode tool usage counts
 * R3.E2.B1 = Read(3), Edit(2), Bash(1)
 */
function encodeToolsUsed(tools: { name: string; count: number }[]): string {
  const abbrevs: Record<string, string> = {
    'Read': 'R', 'Edit': 'E', 'Write': 'W', 'Bash': 'B',
    'Glob': 'G', 'Grep': 'P', 'Task': 'T', 'WebFetch': 'F'
  };

  return tools
    .filter(t => t.count > 0)
    .map(t => `${abbrevs[t.name] || t.name[0]}${t.count}`)
    .join('.');
}

/**
 * Helper: Decode tool usage counts
 * R3.E2.B1 -> "Read(3), Edit(2), Bash(1)"
 */
function decodeToolsUsed(encoded: string): string {
  if (!encoded) return 'None';

  const abbrevs: Record<string, string> = {
    'R': 'Read', 'E': 'Edit', 'W': 'Write', 'B': 'Bash',
    'G': 'Glob', 'P': 'Grep', 'T': 'Task', 'F': 'WebFetch'
  };

  return encoded.split('.').map(part => {
    const letter = part[0];
    const count = part.slice(1);
    const tool = abbrevs[letter] || letter;
    return `${tool}(${count})`;
  }).join(', ');
}

/**
 * 14. CONVERSATION: Sub-agent conversation logs
 * Format: task_id|department|attempt|model|tools|files|outcome|duration|error|summary
 * Example: TSK001|engineer|2|S|R3.E2.B1|src/foo.ts.src/bar.ts|S|45000||refactored_auth_logic
 */
const CONVERSATION_SCHEMA: CompressionSchema = {
  encode: (text: string) => {
    // Extract task ID
    const taskIdMatch = text.match(/\btask[:\s]*(\w+)/i);
    const taskId = taskIdMatch?.[1] || '';

    // Extract department
    const deptMatch = text.match(/\b(researcher|architect|engineer|validator|guardian)\b/i);
    const dept = deptMatch?.[1]?.toLowerCase() || '';

    // Extract attempt number
    const attemptMatch = text.match(/attempt[:\s]*(\d+)/i);
    const attempt = attemptMatch?.[1] || '1';

    // Extract model (Sonnet or Opus)
    const modelMatch = text.match(/\b(sonnet|opus)\b/i);
    const model = modelMatch?.[1]?.toLowerCase() === 'opus' ? 'O' : 'S';

    // Extract tools used
    const toolsMatch = text.match(/tools?[:\s]*([^\n]+)/i);
    let toolsStr = '';
    if (toolsMatch) {
      // Parse tool counts from text like "Read(3), Edit(2), Bash(1)"
      const tools: { name: string; count: number }[] = [];
      for (const m of toolsMatch[1].matchAll(/(\w+)\((\d+)\)/g)) {
        tools.push({ name: m[1], count: parseInt(m[2]) });
      }
      toolsStr = encodeToolsUsed(tools);
    }

    // Extract files modified (use comma separator to avoid conflict with file extensions)
    const filesMatch = text.match(/files?[:\s]*([^\n]+)/i);
    const files = filesMatch ? filesMatch[1].split(/[,\s]+/).filter(f => f.trim() && f.includes('.')).join(',') : '';

    // Extract outcome
    const outcomeMatch = text.match(/\b(success|succeeded|completed|failed?|error)\b/i);
    const outcome = outcomeMatch && /fail|error/i.test(outcomeMatch[1]) ? 'F' : 'S';

    // Extract duration
    const durationMatch = text.match(/(\d+)\s*(?:ms|milliseconds?)/i) ||
                         text.match(/(\d+(?:\.\d+)?)\s*(?:s|seconds?)/i);
    const duration = durationMatch
      ? (durationMatch[0].includes('s') && !durationMatch[0].includes('ms')
          ? Math.round(parseFloat(durationMatch[1]) * 1000)
          : parseInt(durationMatch[1]))
      : 0;

    // Extract error type
    const errorMatch = text.match(/error[:\s]*(\w+)/i);
    const errorType = outcome === 'F' && errorMatch ? sanitize(errorMatch[1], 20) : '';

    // Extract summary
    const summaryMatch = text.match(/summary[:\s]+([^\n]+)/i);
    const summary = summaryMatch ? sanitize(summaryMatch[1], 40) : '';

    return [taskId, dept, attempt, model, toolsStr, files, outcome, duration, errorType, summary].join('|');
  },

  decode: (compressed: string) => {
    const parts = compressed.split('|');
    if (parts.length < 10) return compressed;

    const [taskId, dept, attempt, model, tools, files, outcome, duration, errorType, summary] = parts;

    const modelName = model === 'S' ? 'Sonnet' : 'Opus';
    const outcomeStr = outcome === 'S' ? 'SUCCESS' : 'FAILED';
    const durationSec = Math.round(parseInt(duration || '0') / 1000);
    const toolsList = decodeToolsUsed(tools);
    const filesList = files ? files.split(',').join(', ') : 'None';

    let result = `Task: ${taskId}`;
    result += `\nDepartment: ${dept} (Attempt ${attempt})`;
    result += `\nModel: ${modelName}`;
    result += `\nTools: ${toolsList}`;
    result += `\nFiles: ${filesList}`;
    result += `\nOutcome: ${outcomeStr}`;
    result += `\nDuration: ${durationSec}s`;
    if (errorType) result += `\nError: ${errorType.replace(/_/g, ' ')}`;
    result += `\nSummary: ${summary.replace(/_/g, ' ')}`;

    return result;
  },
};

/**
 * 15. CONTEXT_BUNDLE: Inter-phase Phase 1 output
 * Format: CTX|task_id|desc|files:path1,path2|mem:id1.id2|deps:d1.d2|patterns:p1.p2|style
 * Example: CTX|TSK001|build_auth_system|files:src/auth/,src/types/|mem:abc123.def456|deps:express.jwt|patterns:snake.vitest|style:ts.strict
 */
const CONTEXT_BUNDLE_SCHEMA: CompressionSchema = {
  encode: (text: string) => {
    const taskMatch = text.match(/task[:\s]*(\w+)/i);
    const taskId = taskMatch?.[1] || `TSK${Date.now().toString(36)}`;

    const descMatch = text.match(/(?:description|desc|task)[:\s]+([^.\n]+)/i);
    const desc = descMatch ? sanitize(descMatch[1], 50) : '';

    const files: string[] = [];
    for (const m of text.matchAll(/\b([\w/]+\.ts)\b/g)) {
      if (!files.includes(m[1])) files.push(m[1]);
    }
    const filesStr = files.length > 0 ? `files:${files.slice(0, 10).join(',')}` : 'files:';

    const memIds: string[] = [];
    for (const m of text.matchAll(/\b([a-f0-9]{8})\b/gi)) {
      if (!memIds.includes(m[1])) memIds.push(m[1]);
    }
    const memStr = memIds.length > 0 ? `mem:${memIds.slice(0, 5).join('.')}` : 'mem:';

    const deps: string[] = [];
    for (const m of text.matchAll(/\b(express|react|next|vue|angular|pg|prisma|jwt|bcrypt|axios|lodash)\b/gi)) {
      const d = m[1].toLowerCase();
      if (!deps.includes(d)) deps.push(d);
    }
    const depsStr = deps.length > 0 ? `deps:${deps.slice(0, 5).join('.')}` : 'deps:';

    const patterns: string[] = [];
    for (const m of text.matchAll(/\b(snake_case|camelCase|vitest|jest|mocha|flat|nested)\b/gi)) {
      const p = m[1].toLowerCase();
      if (!patterns.includes(p)) patterns.push(p);
    }
    const patternsStr = patterns.length > 0 ? `patterns:${patterns.slice(0, 3).join('.')}` : 'patterns:';

    const styleMatch = text.match(/\b(ts\.strict|ts\.loose|js)\b/i);
    const style = styleMatch?.[1]?.toLowerCase() || 'ts.strict';

    return ['CTX', taskId, desc, filesStr, memStr, depsStr, patternsStr, `style:${style}`].join('|');
  },

  decode: (compressed: string) => {
    const parts = compressed.split('|');
    if (parts[0] !== 'CTX') return compressed;

    const [, taskId, desc, files, mem, deps, patterns, style] = parts;
    let result = `Context Bundle for Task: ${taskId}`;
    if (desc) result += `\nDescription: ${desc.replace(/_/g, ' ')}`;
    if (files?.startsWith('files:')) {
      const fileList = files.replace('files:', '');
      if (fileList) result += `\nRelevant Files: ${fileList.split(',').join(', ')}`;
    }
    if (mem?.startsWith('mem:')) {
      const memList = mem.replace('mem:', '');
      if (memList) result += `\nMemory IDs: ${memList.split('.').join(', ')}`;
    }
    if (deps?.startsWith('deps:')) {
      const depList = deps.replace('deps:', '');
      if (depList) result += `\nDependencies: ${depList.split('.').join(', ')}`;
    }
    if (patterns?.startsWith('patterns:')) {
      const patList = patterns.replace('patterns:', '');
      if (patList) result += `\nPatterns: ${patList.split('.').join(', ')}`;
    }
    if (style?.startsWith('style:')) {
      result += `\nStyle: ${style.replace('style:', '')}`;
    }
    return result;
  },
};

/**
 * 16. DESIGN: Inter-phase Phase 2 output (Architecture)
 * Format: DES|comps:c1.c2|models:m1.m2|files:dir1/,dir2/|apis:a1.a2|notes
 * Example: DES|comps:AuthCtrl.JWTSvc|models:User.Session|files:auth/,types/|apis:login.logout|notes:stateless_jwt
 */
const DESIGN_SCHEMA: CompressionSchema = {
  encode: (text: string) => {
    const comps: string[] = [];
    for (const m of text.matchAll(/\b([A-Z][a-zA-Z]*(?:Controller|Service|Handler|Manager|Repository|Factory))\b/g)) {
      if (!comps.includes(m[1])) comps.push(toInitials(m[1]));
    }
    const compsStr = comps.length > 0 ? `comps:${comps.slice(0, 5).join('.')}` : 'comps:';

    const models: string[] = [];
    for (const m of text.matchAll(/\b(?:model|entity|type)[:\s]*(\w+)/gi)) {
      if (!models.includes(m[1])) models.push(m[1]);
    }
    const modelsStr = models.length > 0 ? `models:${models.slice(0, 5).join('.')}` : 'models:';

    const dirs: string[] = [];
    for (const m of text.matchAll(/\b([\w]+\/)\b/g)) {
      if (!dirs.includes(m[1])) dirs.push(m[1]);
    }
    const filesStr = dirs.length > 0 ? `files:${dirs.slice(0, 5).join(',')}` : 'files:';

    const apis: string[] = [];
    for (const m of text.matchAll(/\b(?:api|endpoint|route)[:\s]*(\w+)/gi)) {
      if (!apis.includes(m[1])) apis.push(m[1].toLowerCase());
    }
    const apisStr = apis.length > 0 ? `apis:${apis.slice(0, 5).join('.')}` : 'apis:';

    const notesMatch = text.match(/(?:notes?|design)[:\s]+([^.\n]+)/i);
    const notes = notesMatch ? sanitize(notesMatch[1], 30) : '';

    return ['DES', compsStr, modelsStr, filesStr, apisStr, notes].join('|');
  },

  decode: (compressed: string) => {
    const parts = compressed.split('|');
    if (parts[0] !== 'DES') return compressed;

    const [, comps, models, files, apis, notes] = parts;
    let result = 'Design Specification';
    if (comps?.startsWith('comps:')) {
      const compList = comps.replace('comps:', '');
      if (compList) result += `\nComponents: ${compList.split('.').join(', ')}`;
    }
    if (models?.startsWith('models:')) {
      const modelList = models.replace('models:', '');
      if (modelList) result += `\nData Models: ${modelList.split('.').join(', ')}`;
    }
    if (files?.startsWith('files:')) {
      const fileList = files.replace('files:', '');
      if (fileList) result += `\nDirectories: ${fileList.split(',').join(', ')}`;
    }
    if (apis?.startsWith('apis:')) {
      const apiList = apis.replace('apis:', '');
      if (apiList) result += `\nAPI Endpoints: ${apiList.split('.').join(', ')}`;
    }
    if (notes) result += `\nNotes: ${notes.replace(/_/g, ' ')}`;
    return result;
  },
};

/**
 * 17. EXEC_PLAN: Inter-phase Phase 3 output (Engineer plan)
 * Format: PLAN|dept|ops:C:path1,M:path2,D:path3|cmd:c1.c2|conf:0.85|notes
 * Example: PLAN|eng|C:src/auth/login.ts,M:src/types/user.ts|cmd:npm.test|conf:0.9|notes:add_bcrypt
 */
const EXEC_PLAN_SCHEMA: CompressionSchema = {
  encode: (text: string) => {
    const deptMatch = text.match(/\b(eng|engineer|val|validator|gua|guardian)\b/i);
    const dept = deptMatch?.[1]?.toLowerCase().slice(0, 3) || 'eng';

    const ops: string[] = [];
    for (const m of text.matchAll(/\b(create|modify|delete)[:\s]*([\w/]+\.ts)\b/gi)) {
      const op = m[1][0].toUpperCase();
      ops.push(`${op}:${m[2]}`);
    }
    const opsStr = ops.length > 0 ? ops.slice(0, 10).join(',') : '';

    const cmds: string[] = [];
    for (const m of text.matchAll(/\b(npm\s+\w+|yarn\s+\w+|pnpm\s+\w+)\b/gi)) {
      cmds.push(m[1].replace(/\s+/g, '.'));
    }
    const cmdStr = cmds.length > 0 ? `cmd:${cmds.slice(0, 3).join(',')}` : 'cmd:';

    const confMatch = text.match(/confidence[:\s]*([\d.]+)/i);
    const conf = confMatch?.[1] || '0.8';

    const notesMatch = text.match(/notes?[:\s]+([^.\n]+)/i);
    const notes = notesMatch ? sanitize(notesMatch[1], 30) : '';

    return ['PLAN', dept, opsStr, cmdStr, `conf:${conf}`, notes].join('|');
  },

  decode: (compressed: string) => {
    const parts = compressed.split('|');
    if (parts[0] !== 'PLAN') return compressed;

    const [, dept, ops, cmd, conf, notes] = parts;
    const deptNames: Record<string, string> = { eng: 'Engineer', val: 'Validator', gua: 'Guardian' };
    let result = `Execution Plan (${deptNames[dept] || dept})`;

    if (ops) {
      const opsList = ops.split(',').map(op => {
        const [action, path] = op.split(':');
        const actionNames: Record<string, string> = { C: 'Create', M: 'Modify', D: 'Delete' };
        return `${actionNames[action] || action}: ${path}`;
      });
      result += `\nOperations:\n  ${opsList.join('\n  ')}`;
    }
    if (cmd?.startsWith('cmd:')) {
      const cmdList = cmd.replace('cmd:', '');
      if (cmdList) result += `\nCommands: ${cmdList.split(',').map(c => c.replace(/\./g, ' ')).join(', ')}`;
    }
    if (conf?.startsWith('conf:')) {
      result += `\nConfidence: ${parseFloat(conf.replace('conf:', '')) * 100}%`;
    }
    if (notes) result += `\nNotes: ${notes.replace(/_/g, ' ')}`;
    return result;
  },
};

/**
 * 18. VALIDATION: Inter-phase Phase 4 output (Validator + Guardian)
 * Format: VAL|approve:1|tests:t1.t2|sec:s1.s2|perf:p1|mods:M:path.change|block:reason
 * Example: VAL|approve:1|tests:unit.integ|sec:|perf:|mods:|block:
 */
const VALIDATION_SCHEMA: CompressionSchema = {
  encode: (text: string) => {
    const approveMatch = text.match(/\b(?:approve|approved|pass|passed|ok)\b/i);
    const rejectMatch = text.match(/\b(?:reject|rejected|fail|failed|block)\b/i);
    const approve = approveMatch && !rejectMatch ? '1' : '0';

    const tests: string[] = [];
    for (const m of text.matchAll(/\b(unit|integration|integ|e2e|smoke|regression)\b/gi)) {
      const t = m[1].toLowerCase().slice(0, 5);
      if (!tests.includes(t)) tests.push(t);
    }
    const testsStr = tests.length > 0 ? `tests:${tests.join('.')}` : 'tests:';

    const secIssues: string[] = [];
    for (const m of text.matchAll(/\b(xss|sqli|csrf|ssrf|injection|auth|secret|hardcoded)\b/gi)) {
      const s = m[1].toLowerCase();
      if (!secIssues.includes(s)) secIssues.push(s);
    }
    const secStr = secIssues.length > 0 ? `sec:${secIssues.slice(0, 3).join('.')}` : 'sec:';

    const perfIssues: string[] = [];
    for (const m of text.matchAll(/\b(n\+1|slow|memory|leak|bottleneck|blocking)\b/gi)) {
      const p = m[1].toLowerCase();
      if (!perfIssues.includes(p)) perfIssues.push(p);
    }
    const perfStr = perfIssues.length > 0 ? `perf:${perfIssues.slice(0, 3).join('.')}` : 'perf:';

    const mods: string[] = [];
    for (const m of text.matchAll(/\bmodify[:\s]*([\w/]+\.ts)[:\s]*(\w+)/gi)) {
      mods.push(`M:${m[1]}.${sanitize(m[2], 15)}`);
    }
    const modsStr = mods.length > 0 ? `mods:${mods.slice(0, 3).join(',')}` : 'mods:';

    const blockMatch = text.match(/\bblock(?:er|ing)?[:\s]+([^.\n]+)/i);
    const block = blockMatch ? `block:${sanitize(blockMatch[1], 30)}` : 'block:';

    return ['VAL', `approve:${approve}`, testsStr, secStr, perfStr, modsStr, block].join('|');
  },

  decode: (compressed: string) => {
    const parts = compressed.split('|');
    if (parts[0] !== 'VAL') return compressed;

    const [, approve, tests, sec, perf, mods, block] = parts;
    const approved = approve?.includes(':1');
    let result = `Validation Result: ${approved ? '✓ APPROVED' : '✗ REJECTED'}`;

    if (tests?.startsWith('tests:')) {
      const testList = tests.replace('tests:', '');
      if (testList) result += `\nTests: ${testList.split('.').join(', ')}`;
    }
    if (sec?.startsWith('sec:')) {
      const secList = sec.replace('sec:', '');
      if (secList) result += `\nSecurity Issues: ${secList.split('.').join(', ')}`;
    }
    if (perf?.startsWith('perf:')) {
      const perfList = perf.replace('perf:', '');
      if (perfList) result += `\nPerformance Issues: ${perfList.split('.').join(', ')}`;
    }
    if (mods?.startsWith('mods:')) {
      const modList = mods.replace('mods:', '');
      if (modList) result += `\nRequired Modifications: ${modList.split(',').join(', ')}`;
    }
    if (block?.startsWith('block:')) {
      const blockReason = block.replace('block:', '');
      if (blockReason) result += `\nBlocker: ${blockReason.replace(/_/g, ' ')}`;
    }
    return result;
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
  bug_fix: BUG_FIX_SCHEMA,
  dev_feature: DEV_FEATURE_SCHEMA,
  arch_insight: ARCH_INSIGHT_SCHEMA,
  conversation: CONVERSATION_SCHEMA,
  context_bundle: CONTEXT_BUNDLE_SCHEMA,
  design: DESIGN_SCHEMA,
  exec_plan: EXEC_PLAN_SCHEMA,
  validation: VALIDATION_SCHEMA,
  generic: GENERIC_SCHEMA,
};
