#!/usr/bin/env node
/**
 * God-Agent Multi-Project Configuration Helper
 *
 * Interactive CLI tool to generate .claude/mcp.json with multi-project configuration.
 * This enables working on multiple projects simultaneously with complete isolation.
 *
 * Usage:
 *   node scripts/configure-projects.js
 *
 * Features:
 *   - Prompts for project details
 *   - Validates project paths
 *   - Generates MCP config with isolated instances
 *   - Creates data directories for each project
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const godAgentRoot = path.join(__dirname, '..');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise(resolve => rl.question(prompt, resolve));
}

function validatePath(projectPath) {
  if (!path.isAbsolute(projectPath)) {
    return { valid: false, error: 'Path must be absolute' };
  }

  if (!fs.existsSync(projectPath)) {
    return { valid: false, error: 'Path does not exist' };
  }

  const stats = fs.statSync(projectPath);
  if (!stats.isDirectory()) {
    return { valid: false, error: 'Path is not a directory' };
  }

  return { valid: true };
}

function sanitizeId(input) {
  // Convert to lowercase, replace spaces/special chars with hyphens
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║  God-Agent Multi-Project Configuration Helper     ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  console.log('This tool will help you set up multiple project instances.');
  console.log('Each instance will have:');
  console.log('  ✓ Isolated memory and context');
  console.log('  ✓ Project-specific containment rules');
  console.log('  ✓ Independent task execution');
  console.log('  ✓ Separate data storage\n');

  const projects = [];
  const numProjects = parseInt(await question('How many projects do you want to configure? (1-10): ') || '1');

  if (isNaN(numProjects) || numProjects < 1 || numProjects > 10) {
    console.error('\n❌ Invalid number. Must be between 1 and 10.');
    rl.close();
    process.exit(1);
  }

  for (let i = 0; i < numProjects; i++) {
    console.log(`\n─────────────────────────────────────────────────────`);
    console.log(`Project ${i + 1} of ${numProjects}:`);
    console.log(`─────────────────────────────────────────────────────`);

    let projectPath;
    let validation;
    do {
      projectPath = await question(`  Project Path (absolute path, e.g., D:\\my-projects\\backend): `);
      projectPath = projectPath.trim().replace(/^["']|["']$/g, ''); // Remove quotes

      validation = validatePath(projectPath);
      if (!validation.valid) {
        console.log(`  ❌ ${validation.error}. Please try again.`);
      }
    } while (!validation.valid);

    const defaultName = path.basename(projectPath);
    const name = (await question(`  Project Name [${defaultName}]: `)).trim() || defaultName;

    const defaultId = sanitizeId(name);
    const id = (await question(`  Project ID (used in tool names) [${defaultId}]: `)).trim() || defaultId;

    const description = (await question(`  Description (optional): `)).trim();

    projects.push({ id, name, path: projectPath, description });

    console.log(`  ✅ Project "${name}" (${id}) configured`);
  }

  console.log('\n─────────────────────────────────────────────────────');
  console.log('Summary:');
  console.log('─────────────────────────────────────────────────────');
  projects.forEach((proj, idx) => {
    console.log(`${idx + 1}. ${proj.name} (${proj.id})`);
    console.log(`   Path: ${proj.path}`);
    if (proj.description) {
      console.log(`   Description: ${proj.description}`);
    }
  });

  const confirm = await question('\nGenerate configuration? (yes/no) [yes]: ');
  if (confirm.trim().toLowerCase() === 'no') {
    console.log('\n❌ Configuration cancelled.');
    rl.close();
    process.exit(0);
  }

  // Generate MCP config
  console.log('\n📝 Generating configuration...');

  const mcpConfig = {
    mcpServers: {}
  };

  for (const proj of projects) {
    mcpConfig.mcpServers[`rubix-${proj.id}`] = {
      command: 'node',
      args: ['dist/mcp-server.js'],
      cwd: godAgentRoot,
      env: {
        OPENAI_API_KEY: process.env.OPENAI_API_KEY || '${OPENAI_API_KEY}',
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '${ANTHROPIC_API_KEY}',
        RUBIX_DATA_DIR: `./data/projects/${proj.id}`,
        RUBIX_PROJECT_ROOT: proj.path,
        RUBIX_PROJECT_NAME: proj.name
      }
    };
  }

  // Write to .claude/mcp.json
  const mcpPath = path.join(godAgentRoot, '.claude', 'mcp.json');
  fs.mkdirSync(path.dirname(mcpPath), { recursive: true });

  // Backup existing config if it exists
  if (fs.existsSync(mcpPath)) {
    const backupPath = path.join(godAgentRoot, '.claude', `mcp.json.backup.${Date.now()}`);
    fs.copyFileSync(mcpPath, backupPath);
    console.log(`  ℹ️  Backed up existing config to: ${path.basename(backupPath)}`);
  }

  fs.writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2));
  console.log(`  ✅ Configuration written to: ${mcpPath}`);

  // Create data directories
  console.log('\n📁 Creating data directories...');
  for (const proj of projects) {
    const dataDir = path.join(godAgentRoot, 'data', 'projects', proj.id);
    fs.mkdirSync(dataDir, { recursive: true });
    console.log(`  ✅ Created: data/projects/${proj.id}`);
  }

  // Generate usage instructions
  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║  Configuration Complete!                           ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  console.log('Next steps:\n');

  if (mcpConfig.mcpServers[Object.keys(mcpConfig.mcpServers)[0]].env.OPENAI_API_KEY.includes('$')) {
    console.log('1. ⚠️  Update API keys in .claude/mcp.json:');
    console.log('   - Replace ${OPENAI_API_KEY} with your actual key');
    console.log('   - Replace ${ANTHROPIC_API_KEY} with your actual key\n');
  }

  console.log('2. 🔄 Restart Claude Code to load the new configuration\n');

  console.log('3. 🎯 Your projects will be available as:\n');
  projects.forEach(proj => {
    const toolPrefix = `mcp__rubix_${proj.id.replace(/-/g, '_')}__`;
    console.log(`   ${proj.name}:`);
    console.log(`     ${toolPrefix}god_codex_do`);
    console.log(`     ${toolPrefix}god_query`);
    console.log(`     ${toolPrefix}* (all tools)\n`);
  });

  console.log('4. 📖 See CLAUDE.md for usage examples\n');

  console.log('Example usage:\n');
  console.log('```typescript');
  const firstProj = projects[0];
  const firstPrefix = `mcp__rubix_${firstProj.id.replace(/-/g, '_')}__`;
  console.log(`// Work on ${firstProj.name}`);
  console.log(`${firstPrefix}god_codex_do({`);
  console.log(`  task: "Add a new feature"`);
  console.log('});');
  console.log('```\n');

  rl.close();
}

main().catch(err => {
  console.error('\n❌ Error:', err.message);
  rl.close();
  process.exit(1);
});
