#!/usr/bin/env node
/**
 * Quick test script for CodeGenerator
 * Run with: node test-codegen.mjs
 */

import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from god-agent directory
config({ path: join(__dirname, '.env') });

// Import from compiled JS
import { CodeGenerator } from './dist/codex/CodeGenerator.js';

async function main() {
  console.log('=== CodeGenerator Test ===\n');

  // Check API key
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ERROR: ANTHROPIC_API_KEY not set!');
    process.exit(1);
  }
  console.log(`API Key: ${apiKey.substring(0, 10)}...${apiKey.substring(apiKey.length - 4)}`);

  // Create test output directory
  const testOutputDir = join(__dirname, 'test-output');
  console.log(`Test output dir: ${testOutputDir}`);

  // Create CodeGenerator
  const codeGen = new CodeGenerator({
    apiKey,
    model: 'claude-sonnet-4-20250514', // Use Sonnet for quick test
    maxTokens: 4096,
    codebaseRoot: testOutputDir
  });

  console.log('\nCodeGenerator created successfully.\n');

  // Create a simple test task
  const task = {
    id: 'test-task-1',
    description: 'Create a simple hello world TypeScript file',
    codebase: testOutputDir,
    status: 'executing',
    subtasks: [],
    decisions: [],
    assumptions: [],
    createdAt: new Date()
  };

  const subtask = {
    id: 'test-subtask-1',
    taskId: task.id,
    type: 'code',
    description: 'Create a hello.ts file that exports a greet function',
    order: 1,
    dependencies: [],
    status: 'in_progress',
    maxAttempts: 3,
    attempts: [],
    verification: [],
    createdAt: new Date()
  };

  const attempt = {
    id: 'test-attempt-1',
    subtaskId: subtask.id,
    attemptNumber: 1,
    approach: 'Create a simple TypeScript file',
    startedAt: new Date(),
    success: false
  };

  console.log('Calling generate()...\n');

  try {
    const result = await codeGen.generate({
      task,
      subtask,
      attempt,
      codebaseContext: 'This is a test project. Create files in TypeScript format.'
    });

    console.log('\n=== Result ===');
    console.log('Success:', result.success);
    console.log('Files created:', result.filesCreated);
    console.log('Files modified:', result.filesModified);
    console.log('Tokens used:', result.tokensUsed);
    console.log('Error:', result.error || 'none');
    console.log('\nOutput preview:', result.output?.substring(0, 1000) || 'no output');
  } catch (error) {
    console.error('EXCEPTION:', error);
  }
}

main();
