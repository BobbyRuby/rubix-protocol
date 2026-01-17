/**
 * InputCompressor - Pure token prompt compression.
 *
 * Converts natural language prompts to structured tokens.
 * No NLP strings. Pure function. Maximum efficiency.
 *
 * Input:  "I would like you to please help me create a new feature
 *          that allows users to upload profile pictures and validates
 *          the file type"
 *
 * Output: "TASK:create
 *          DO:upload,validate
 *          TARGET:profile_pictures,file_type
 *          TYPE:feature"
 */

export interface CompressedPrompt {
  original: string;
  compressed: string;
  ratio: number;
  tokensSaved: number;
}

interface ExtractedTokens {
  task: string;
  actions: string[];
  targets: string[];
  type: string;
  tech: string[];
  constraints: string[];
  location: string[];
}

export class InputCompressor {
  // Task verbs → normalized form
  private static TASK_VERBS: Record<string, string> = {
    'create': 'create', 'make': 'create', 'build': 'create', 'add': 'create',
    'implement': 'implement', 'develop': 'implement',
    'fix': 'fix', 'repair': 'fix', 'solve': 'fix', 'debug': 'fix',
    'update': 'update', 'modify': 'update', 'change': 'update', 'edit': 'update',
    'remove': 'remove', 'delete': 'remove', 'drop': 'remove',
    'refactor': 'refactor', 'restructure': 'refactor', 'reorganize': 'refactor',
    'test': 'test', 'verify': 'test', 'check': 'test',
    'optimize': 'optimize', 'improve': 'optimize', 'speed': 'optimize',
    'document': 'document', 'explain': 'document',
    'migrate': 'migrate', 'move': 'migrate', 'transfer': 'migrate',
    'integrate': 'integrate', 'connect': 'integrate', 'link': 'integrate',
    'configure': 'configure', 'setup': 'configure', 'set': 'configure',
  };

  // Action verbs to extract
  private static ACTION_VERBS = new Set([
    'upload', 'download', 'fetch', 'send', 'receive', 'store', 'save', 'load',
    'validate', 'verify', 'check', 'ensure', 'confirm',
    'resize', 'compress', 'transform', 'convert', 'format', 'parse',
    'filter', 'sort', 'search', 'find', 'query', 'select',
    'authenticate', 'authorize', 'login', 'logout', 'register',
    'encrypt', 'decrypt', 'hash', 'sign',
    'cache', 'batch', 'queue', 'schedule', 'trigger',
    'log', 'track', 'monitor', 'alert', 'notify',
    'render', 'display', 'show', 'hide', 'toggle',
    'submit', 'cancel', 'retry', 'rollback',
    'import', 'export', 'sync', 'backup', 'restore',
  ]);

  // Type indicators
  private static TYPE_WORDS: Record<string, string> = {
    'feature': 'feature', 'functionality': 'feature',
    'component': 'component', 'widget': 'component',
    'function': 'function', 'method': 'function', 'helper': 'function',
    'api': 'api', 'endpoint': 'api', 'route': 'api',
    'page': 'page', 'view': 'page', 'screen': 'page',
    'button': 'ui', 'form': 'ui', 'modal': 'ui', 'dialog': 'ui',
    'test': 'test', 'spec': 'test',
    'config': 'config', 'setting': 'config',
    'model': 'model', 'schema': 'model', 'type': 'model',
    'service': 'service', 'provider': 'service',
    'hook': 'hook', 'middleware': 'middleware',
    'bug': 'bugfix', 'issue': 'bugfix', 'error': 'bugfix',
  };

  // Tech/framework keywords
  private static TECH_WORDS = new Set([
    'react', 'vue', 'angular', 'svelte', 'nextjs', 'nuxt',
    'node', 'express', 'fastify', 'nestjs', 'django', 'flask', 'laravel',
    'typescript', 'javascript', 'python', 'rust', 'go', 'java',
    'sql', 'postgres', 'mysql', 'mongodb', 'redis', 'sqlite',
    'graphql', 'rest', 'grpc', 'websocket',
    'docker', 'kubernetes', 'aws', 'gcp', 'azure',
    'jwt', 'oauth', 'api', 'cli', 'sdk',
    'css', 'tailwind', 'scss', 'styled',
    'git', 'npm', 'yarn', 'pnpm',
  ]);

  // Words to completely ignore
  private static IGNORE = new Set([
    // Articles/pronouns
    'a', 'an', 'the', 'i', 'you', 'we', 'they', 'it', 'me', 'my', 'your', 'our',
    'their', 'its', 'his', 'her', 'them', 'us',
    // Greetings/politeness
    'please', 'thanks', 'thank', 'kindly', 'hi', 'hello', 'hey',
    // Hedging
    'maybe', 'might', 'could', 'would', 'should', 'possibly', 'perhaps',
    // Filler
    'basically', 'actually', 'really', 'just', 'very', 'quite', 'simply',
    'literally', 'definitely', 'certainly', 'obviously',
    // Fluff verbs
    'want', 'need', 'like', 'going', 'able', 'think', 'believe', 'wondering',
    'help', 'sure', 'use', 'using', 'used',
    // Vague
    'that', 'which', 'also', 'something', 'stuff', 'things', 'thing',
    'new', 'good', 'great', 'nice', 'some', 'any', 'all', 'this', 'these',
    'other', 'another', 'such', 'same', 'different',
    // Connectors
    'can', 'will', 'would', 'if', 'when', 'then', 'so', 'and', 'or', 'but',
    'for', 'to', 'of', 'in', 'on', 'at', 'by', 'with', 'from', 'as', 'is', 'are',
    'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'done',
    'get', 'got', 'make', 'made', 'let', 'allows', 'allow', 'users', 'user',
    // Noise
    'was', 'were', 'out', 'up', 'down', 'into', 'onto', 'about', 'after',
    'before', 'during', 'through', 'over', 'under', 'between', 'where',
    'ahead', 'doesn', 'don', 'won', 'isn', 'aren', 'wasn', 'weren',
    'properly', 'correctly', 'successfully', 'currently', 'already',
    // More noise
    'much', 'many', 'few', 'little', 'lot', 'lots',
    'handles', 'handling', 'handle',
    'adds', 'adding', 'added',
    'gets', 'getting',
    'puts', 'putting',
    'takes', 'taking', 'took',
    'comes', 'coming', 'came',
    'goes', 'going', 'went', 'gone',
    'needed', 'needs',
    'wanted', 'wants',
    'together', 'apart',
    'every', 'each', 'both', 'either', 'neither',
  ]);

  /**
   * Compress natural language to pure tokens.
   */
  static compress(input: string): CompressedPrompt {
    if (!input || input.trim().length === 0) {
      return { original: input, compressed: input, ratio: 0, tokensSaved: 0 };
    }

    const original = input;

    // For short, clean inputs - don't tokenize, just strip fluff
    if (original.length < 60 && !this.hasFluff(original)) {
      return { original, compressed: original.trim(), ratio: 0, tokensSaved: 0 };
    }

    const tokens = this.extractTokens(input);
    const compressed = this.formatTokens(tokens);

    // If tokenized form is longer, return cleaned original
    if (compressed.length >= original.length * 0.9) {
      const cleaned = this.stripFluff(original);
      return {
        original,
        compressed: cleaned,
        ratio: 1 - (cleaned.length / original.length),
        tokensSaved: Math.floor((original.length - cleaned.length) / 4),
      };
    }

    return {
      original,
      compressed,
      ratio: 1 - (compressed.length / original.length),
      tokensSaved: Math.floor((original.length - compressed.length) / 4),
    };
  }

  /**
   * Check if input has significant fluff worth compressing.
   */
  private static hasFluff(input: string): boolean {
    const fluffPatterns = [
      /please/i, /could you/i, /would you/i, /can you/i,
      /i want/i, /i need/i, /i would like/i, /help me/i,
      /basically/i, /actually/i, /just/i,
    ];
    return fluffPatterns.some(p => p.test(input));
  }

  /**
   * Simple fluff stripping for short inputs.
   */
  private static stripFluff(input: string): string {
    return input
      .replace(/please\s*/gi, '')
      .replace(/could you\s*/gi, '')
      .replace(/can you\s*/gi, '')
      .replace(/would you\s*/gi, '')
      .replace(/i want (you )?to\s*/gi, '')
      .replace(/i need (you )?to\s*/gi, '')
      .replace(/help me\s*/gi, '')
      .replace(/basically\s*/gi, '')
      .replace(/actually\s*/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Extract structured tokens from natural language.
   */
  private static extractTokens(input: string): ExtractedTokens {
    // Normalize input
    const text = input
      .toLowerCase()
      .replace(/[.,!?;:'"()[\]{}]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const words = text.split(' ');
    const result: ExtractedTokens = {
      task: '',
      actions: [],
      targets: [],
      type: '',
      tech: [],
      constraints: [],
      location: [],
    };

    const seenActions = new Set<string>();
    const seenTargets = new Set<string>();

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const nextWord = words[i + 1] || '';

      // Skip ignored words
      if (this.IGNORE.has(word)) continue;

      // Extract task verb (first one found)
      if (!result.task && this.TASK_VERBS[word]) {
        result.task = this.TASK_VERBS[word];
        continue;
      }

      // Extract action verbs
      if (this.ACTION_VERBS.has(word) && !seenActions.has(word)) {
        seenActions.add(word);
        result.actions.push(word);
        continue;
      }

      // Extract type
      if (!result.type && this.TYPE_WORDS[word]) {
        result.type = this.TYPE_WORDS[word];
        continue;
      }

      // Extract tech
      if (this.TECH_WORDS.has(word)) {
        result.tech.push(word);
        continue;
      }

      // Extract file paths (must look like a real file path)
      if (word.includes('/') && word.length > 3) {
        // Stricter validation: only treat as path if it looks like a real file path
        const startsLikePath = /^[.~\/]|^[A-Za-z]:[\\/]/.test(word);  // /, ./, ../, ~/, C:/, D:\
        const hasExtension = /\.[a-z]{1,5}$/i.test(word);             // Has file extension
        const hasCommonDir = /\/(src|lib|dist|node_modules|components|pages|api|test|spec|utils|hooks|services|models|views|controllers|routes|middleware|config|public|assets|images|styles|types)\//.test(word);

        if (startsLikePath || hasExtension || hasCommonDir) {
          result.location.push(word);
          continue;
        }
        // Skip words like "strategic/randomized", "input/output", "80%" that contain /
      }
      // File extensions without path
      if (/\.(ts|tsx|js|jsx|py|go|rs|java|cpp|c|h|rb|php|vue|svelte)x?$/i.test(word)) {
        result.location.push(word);
        continue;
      }

      // Remaining meaningful words become targets (nouns)
      if (word.length > 2 && !seenTargets.has(word)) {
        // Compound with next word if it's also a noun-like word
        if (nextWord && nextWord.length > 2 && !this.IGNORE.has(nextWord) &&
            !this.TASK_VERBS[nextWord] && !this.ACTION_VERBS.has(nextWord) &&
            !this.TYPE_WORDS[nextWord] && !this.TECH_WORDS.has(nextWord)) {
          const compound = `${word}_${nextWord}`;
          seenTargets.add(word);
          seenTargets.add(nextWord);
          result.targets.push(compound);
          i++; // Skip next word
        } else {
          seenTargets.add(word);
          result.targets.push(word);
        }
      }
    }

    // Defaults
    if (!result.task) result.task = 'do';
    if (!result.type) result.type = 'task';

    return result;
  }

  /**
   * Format tokens into compressed string.
   */
  private static formatTokens(tokens: ExtractedTokens): string {
    const lines: string[] = [];

    // TASK:verb
    lines.push(`TASK:${tokens.task}`);

    // DO:action1,action2
    if (tokens.actions.length > 0) {
      lines.push(`DO:${tokens.actions.join(',')}`);
    }

    // TARGET:noun1,noun2
    if (tokens.targets.length > 0) {
      // Limit to most relevant targets
      const topTargets = tokens.targets.slice(0, 5);
      lines.push(`TARGET:${topTargets.join(',')}`);
    }

    // TYPE:feature|api|function|etc
    lines.push(`TYPE:${tokens.type}`);

    // TECH:react,typescript (if any)
    if (tokens.tech.length > 0) {
      lines.push(`TECH:${tokens.tech.join(',')}`);
    }

    // LOC:path/to/file (if any)
    if (tokens.location.length > 0) {
      lines.push(`LOC:${tokens.location.join(',')}`);
    }

    return lines.join('\n');
  }

  /**
   * Decompress tokens back to human-readable form.
   *
   * Input:  "TASK:create\nDO:upload,validate\nTARGET:profile_pictures\nTYPE:feature"
   * Output: "Create feature: profile_pictures - upload, validate"
   */
  static decompress(tokens: string): string {
    // Check if this looks like token format
    if (!tokens.includes(':') || !tokens.match(/^[A-Z]+:/m)) {
      return tokens; // Not token format, return as-is
    }

    const lines = tokens.split('\n');
    const parsed: Record<string, string[]> = {};

    for (const line of lines) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).toUpperCase();
        const value = line.slice(colonIdx + 1);
        parsed[key] = value.split(',').map(v => v.trim());
      }
    }

    const parts: string[] = [];

    // Build readable sentence
    if (parsed.TASK) parts.push(this.capitalize(parsed.TASK[0]));
    if (parsed.TYPE) parts.push(parsed.TYPE[0] + ':');
    if (parsed.TARGET) parts.push(parsed.TARGET.join(', '));
    if (parsed.DO) parts.push('- ' + parsed.DO.join(', '));
    if (parsed.TECH) parts.push(`(${parsed.TECH.join(', ')})`);
    if (parsed.LOC) parts.push(`@ ${parsed.LOC.join(', ')}`);

    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  /**
   * Capitalize first letter.
   */
  private static capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /**
   * Compress with logging.
   */
  static compressWithLog(input: string, label?: string): CompressedPrompt {
    const result = this.compress(input);
    const pct = Math.round(result.ratio * 100);
    console.log(`[InputCompressor${label ? `:${label}` : ''}] ${pct}% reduction, ~${result.tokensSaved} tokens saved`);
    console.log(`  IN:  "${result.original.slice(0, 80)}..."`);
    console.log(`  OUT: ${result.compressed.replace(/\n/g, ' | ')}`);
    return result;
  }
}

// Shorthand
export const IC = InputCompressor;
