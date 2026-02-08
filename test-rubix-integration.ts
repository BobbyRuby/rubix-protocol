/**
 * Test script for RUBIX Department Head integration with TaskExecutor
 *
 * Usage:
 *   npm run build
 *   node dist/test-rubix-integration.js
 */

import { MemoryEngine } from './src/core/MemoryEngine.js';
import { TaskExecutor } from './src/codex/TaskExecutor.js';

async function testRubixIntegration() {
  console.log('=== RUBIX Integration Test ===\n');

  // Initialize memory engine
  console.log('1. Initializing MemoryEngine...');
  const engine = new MemoryEngine();
  await engine.init();
  console.log('   ✓ MemoryEngine initialized\n');

  // Create TaskExecutor
  console.log('2. Creating TaskExecutor...');
  const executor = new TaskExecutor(engine);
  console.log('   ✓ TaskExecutor created\n');

  // Enable RUBIX mode
  console.log('3. Enabling RUBIX mode...');
  executor.enableRubixMode({
    model: 'claude-sonnet-4-20250514',
    maxSubAgentsPerDepartment: 5,
    codebaseRoot: process.cwd()
  });
  console.log('   ✓ RUBIX mode enabled with 5 department heads\n');

  // Test task submission
  console.log('4. Submitting test task...');
  const task = {
    description: 'Create a simple TypeScript utility function that adds two numbers',
    specification: `
      - Function name: add
      - Parameters: a: number, b: number
      - Returns: number
      - Include JSDoc comments
      - Include unit tests
    `,
    codebase: process.cwd()
  };

  console.log('   Task description:', task.description);
  console.log('   Executing through RUBIX Department Heads...\n');

  try {
    const result = await executor.execute(task);

    console.log('=== RUBIX Execution Result ===');
    console.log('Success:', result.success);
    console.log('Summary:', result.summary);
    console.log('Subtasks completed:', result.subtasksCompleted);
    console.log('Subtasks failed:', result.subtasksFailed);
    console.log('Files modified:', result.filesModified.length);
    console.log('Tests written:', result.testsWritten);
    console.log('Duration:', result.duration, 'ms');
    console.log('\nFiles created/modified:');
    result.filesModified.forEach(file => {
      console.log('  -', file);
    });

    if (result.decisions.length > 0) {
      console.log('\nDecisions made:');
      result.decisions.forEach(decision => {
        console.log('  -', decision.rationale);
      });
    }

  } catch (error) {
    console.error('❌ Error executing task:', error);
    process.exit(1);
  }

  // Disable RUBIX mode
  console.log('\n5. Disabling RUBIX mode...');
  executor.disableRubixMode();
  console.log('   ✓ RUBIX mode disabled\n');

  console.log('=== Test Complete ===');
}

// Run test if executed directly
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  testRubixIntegration().catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
  });
}

export { testRubixIntegration };
