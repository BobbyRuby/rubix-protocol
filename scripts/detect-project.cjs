#!/usr/bin/env node
/**
 * Project Detection Hook for Claude Code
 *
 * Runs on user-prompt-submit to detect which project is active
 * based on the current working directory and inject context.
 *
 * SHORTCUTS (for "switch <shortcut>" commands):
 *   oneshot-droid  → C:/Users/rruby/AndroidStudioProjects/OneShotProAi
 *   oneshot-web    → C:/Users/rruby/PhpstormProjects/OneShotProAi
 *   rubix          → D:/rubix-protocol
 */

const path = require('path');
const fs = require('fs');

// Shortcut mappings for quick switching
const SHORTCUTS = {
  'oneshot-droid': 'C:/Users/rruby/AndroidStudioProjects/OneShotProAi',
  'oneshot-web': 'C:/Users/rruby/PhpstormProjects/OneShotProAi',
  'rubix': 'D:/rubix-protocol'
};

// Known project mappings (path patterns -> MCP instance)
const PROJECT_MAPPINGS = [
  {
    patterns: [
      /androidstudioprojects[/\\]oneshotproai/i,
      /oneshotpro.*android/i
    ],
    instance: 'oneshotpro-android',
    name: 'OneShotPro AI (Android)',
    tools: 'mcp__oneshotpro-android__*'
  },
  {
    patterns: [
      /phpstormprojects[/\\]oneshotproai/i,
      /oneshotpro.*web/i
    ],
    instance: 'oneshotpro-web',
    name: 'OneShotPro AI (Web)',
    tools: 'mcp__oneshotpro-web__*'
  },
  {
    patterns: [
      /rubix-protocol[/\\]god-agent/i,
      /god-agent/i
    ],
    instance: 'rubix',
    name: 'God-Agent',
    tools: 'mcp__rubix__*'
  }
];

// Get current working directory
const cwd = process.cwd();

// Find matching project
let matchedProject = null;
for (const project of PROJECT_MAPPINGS) {
  for (const pattern of project.patterns) {
    if (pattern.test(cwd)) {
      matchedProject = project;
      break;
    }
  }
  if (matchedProject) break;
}

// Output context for Claude
if (matchedProject) {
  console.log(`[PROJECT CONTEXT] Active: ${matchedProject.name}`);
  console.log(`[PROJECT CONTEXT] Use ${matchedProject.tools} for memory operations`);
  console.log(`[PROJECT CONTEXT] Instance: ${matchedProject.instance}`);
} else {
  // Default to rubix if no match
  console.log(`[PROJECT CONTEXT] No project match for: ${cwd}`);
  console.log(`[PROJECT CONTEXT] Defaulting to mcp__rubix__* tools`);
}
