/**
 * SelfKnowledgeCompressor - Bidirectional compression for RUBIX self-knowledge.
 *
 * Token Schema:
 *   SYS:<system_name>
 *   TYPE:<type>
 *   CAP:<capability1>,<capability2>
 *   FLOW:<step1>→<step2>→<step3>
 *   TECH:<tech1>,<tech2>
 *   CFG:<key>=<value>,<key>=<value>
 *   DEPT:<dept1>,<dept2>
 *   TOOL:<tool1>,<tool2>
 *   SUB:<subsystem1>,<subsystem2>
 *
 * Example:
 *   Input (structured):
 *     { system: 'self-heal', flow: ['fail','analyze','retry'], subsystems: ['SelfHealer'] }
 *
 *   Compressed:
 *     SYS:self-heal
 *     FLOW:fail→analyze→retry
 *     SUB:SelfHealer
 *
 *   Decompressed (readable):
 *     **SELF-HEAL**
 *     Flow: fail → analyze → retry
 *     Subsystems: SelfHealer
 */

export interface RubixKnowledge {
  system: string;
  type?: string;
  capabilities?: string[];
  flow?: string[];
  tech?: string[];
  config?: Record<string, string>;
  departments?: string[];
  tools?: string[];
  subsystems?: string[];
  entry?: string[];
  routes?: string[];
  channels?: string[];
  triggers?: string[];
  list?: string[];
  count?: string;
  algo?: string[];
  tiers?: string[];
  output?: string[];
  memory?: string[];
  causal?: string[];
  learn?: string[];
  route?: string[];
  codex?: string[];
}

export class SelfKnowledgeCompressor {
  /**
   * Compress structured knowledge to tokens.
   */
  static compress(k: RubixKnowledge): string {
    const lines: string[] = [`SYS:${k.system}`];

    if (k.type) lines.push(`TYPE:${k.type}`);
    if (k.count) lines.push(`COUNT:${k.count}`);
    if (k.capabilities?.length) lines.push(`CAP:${k.capabilities.join(',')}`);
    if (k.flow?.length) lines.push(`FLOW:${k.flow.join('→')}`);
    if (k.tech?.length) lines.push(`TECH:${k.tech.join(',')}`);
    if (k.departments?.length) lines.push(`DEPT:${k.departments.join(',')}`);
    if (k.tools?.length) lines.push(`TOOL:${k.tools.join(',')}`);
    if (k.subsystems?.length) lines.push(`SUB:${k.subsystems.join(',')}`);
    if (k.entry?.length) lines.push(`ENTRY:${k.entry.join(',')}`);
    if (k.routes?.length) lines.push(`ROUTES:${k.routes.join(',')}`);
    if (k.channels?.length) lines.push(`CHANNELS:${k.channels.join(',')}`);
    if (k.triggers?.length) lines.push(`TRIGGERS:${k.triggers.join(',')}`);
    if (k.list?.length) lines.push(`LIST:${k.list.join(',')}`);
    if (k.algo?.length) lines.push(`ALGO:${k.algo.join(',')}`);
    if (k.tiers?.length) lines.push(`TIERS:${k.tiers.join(',')}`);
    if (k.output?.length) lines.push(`OUTPUT:${k.output.join(',')}`);
    if (k.memory?.length) lines.push(`MEMORY:${k.memory.join(',')}`);
    if (k.causal?.length) lines.push(`CAUSAL:${k.causal.join(',')}`);
    if (k.learn?.length) lines.push(`LEARN:${k.learn.join(',')}`);
    if (k.route?.length) lines.push(`ROUTE:${k.route.join(',')}`);
    if (k.codex?.length) lines.push(`CODEX:${k.codex.join(',')}`);

    if (k.config) {
      const cfg = Object.entries(k.config).map(([key, val]) => `${key}=${val}`).join(',');
      lines.push(`CFG:${cfg}`);
    }

    return lines.join('\n');
  }

  /**
   * Parse tokens into structured object.
   */
  static parse(tokens: string): Record<string, string[]> {
    const result: Record<string, string[]> = {};

    for (const line of tokens.split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).toUpperCase();
        const value = line.slice(colonIdx + 1);

        // Handle → separator for FLOW, comma for others
        if (key === 'FLOW') {
          result[key] = value.split('→').map(v => v.trim());
        } else {
          result[key] = value.split(',').map(v => v.trim());
        }
      }
    }

    return result;
  }

  /**
   * Decompress tokens to human-readable description.
   */
  static decompress(tokens: string): string {
    const parsed = this.parse(tokens);
    const parts: string[] = [];

    // Header
    const sysName = parsed.SYS?.[0]?.toUpperCase().replace(/-/g, ' ') || 'SYSTEM';
    parts.push(`**${sysName}**`);
    if (parsed.TYPE) parts.push(` (${parsed.TYPE[0]})`);
    parts.push('\n');

    // Core fields
    if (parsed.CAP) parts.push(`Capabilities: ${parsed.CAP.join(', ')}\n`);
    if (parsed.FLOW) parts.push(`Flow: ${parsed.FLOW.join(' → ')}\n`);
    if (parsed.TECH) parts.push(`Tech: ${parsed.TECH.join(', ')}\n`);
    if (parsed.DEPT) parts.push(`Departments: ${parsed.DEPT.join(', ')}\n`);
    if (parsed.TOOL) parts.push(`Tools: ${parsed.TOOL.join(', ')}\n`);
    if (parsed.SUB) parts.push(`Subsystems: ${parsed.SUB.join(', ')}\n`);
    if (parsed.ENTRY) parts.push(`Entry Points: ${parsed.ENTRY.join(', ')}\n`);
    if (parsed.ROUTES) parts.push(`Routes: ${parsed.ROUTES.join(', ')}\n`);
    if (parsed.CHANNELS) parts.push(`Channels: ${parsed.CHANNELS.join(', ')}\n`);
    if (parsed.TRIGGERS) parts.push(`Triggers: ${parsed.TRIGGERS.join(', ')}\n`);
    if (parsed.LIST) parts.push(`Items: ${parsed.LIST.join(', ')}\n`);
    if (parsed.COUNT) parts.push(`Count: ${parsed.COUNT[0]}\n`);
    if (parsed.ALGO) parts.push(`Algorithms: ${parsed.ALGO.join(', ')}\n`);
    if (parsed.TIERS) parts.push(`Tiers: ${parsed.TIERS.join(', ')}\n`);
    if (parsed.OUTPUT) parts.push(`Output: ${parsed.OUTPUT.join(', ')}\n`);

    // Tool categories
    if (parsed.MEMORY) parts.push(`Memory Tools: ${parsed.MEMORY.join(', ')}\n`);
    if (parsed.CAUSAL) parts.push(`Causal Tools: ${parsed.CAUSAL.join(', ')}\n`);
    if (parsed.LEARN) parts.push(`Learning Tools: ${parsed.LEARN.join(', ')}\n`);
    if (parsed.ROUTE) parts.push(`Routing Tools: ${parsed.ROUTE.join(', ')}\n`);
    if (parsed.CODEX) parts.push(`CODEX Tools: ${parsed.CODEX.join(', ')}\n`);

    // Config last
    if (parsed.CFG) parts.push(`Config: ${parsed.CFG.join(', ')}\n`);

    return parts.join('');
  }

  /**
   * Decompress with full formatting (multi-section).
   */
  static decompressFull(tokens: string): string {
    const parsed = this.parse(tokens);
    const sections: string[] = [];

    // Header
    const sysName = parsed.SYS?.[0]?.toUpperCase().replace(/-/g, ' ') || 'SYSTEM';
    sections.push(`╔══════════════════════════════════════╗`);
    sections.push(`║  ${sysName.padEnd(36)}║`);
    if (parsed.TYPE) {
      sections.push(`║  Type: ${parsed.TYPE[0].padEnd(30)}║`);
    }
    sections.push(`╚══════════════════════════════════════╝\n`);

    // Capabilities
    if (parsed.CAP) {
      sections.push(`┌─ Capabilities ─────────────────────┐`);
      for (const cap of parsed.CAP) {
        sections.push(`│  • ${cap.padEnd(34)}│`);
      }
      sections.push(`└────────────────────────────────────┘\n`);
    }

    // Flow
    if (parsed.FLOW) {
      sections.push(`┌─ Flow ─────────────────────────────┐`);
      sections.push(`│  ${parsed.FLOW.join(' → ').padEnd(36)}│`);
      sections.push(`└────────────────────────────────────┘\n`);
    }

    // Subsystems
    if (parsed.SUB) {
      sections.push(`┌─ Subsystems ───────────────────────┐`);
      for (const sub of parsed.SUB) {
        sections.push(`│  • ${sub.padEnd(34)}│`);
      }
      sections.push(`└────────────────────────────────────┘\n`);
    }

    // Tech
    if (parsed.TECH) {
      sections.push(`Tech Stack: ${parsed.TECH.join(', ')}`);
    }

    // Config
    if (parsed.CFG) {
      sections.push(`\nConfiguration:`);
      for (const cfg of parsed.CFG) {
        sections.push(`  ${cfg}`);
      }
    }

    return sections.join('\n');
  }
}

// Shorthand
export const SKC = SelfKnowledgeCompressor;
