/**
 * Test script for ClaudeCodeExecutor
 * Verifies CLI execution works with Max subscription
 */
import { ClaudeCodeExecutor } from './src/codex/ClaudeCodeExecutor.js';
async function testCliExecutor() {
    console.log('='.repeat(60));
    console.log('Testing ClaudeCodeExecutor (Claude Code CLI Integration)');
    console.log('='.repeat(60));
    const executor = new ClaudeCodeExecutor({
        cwd: process.cwd(),
        model: 'opus',
        timeout: 60000, // 1 minute for test
        allowEdits: false // Don't allow edits for this test
    });
    // Test 1: Check CLI availability
    console.log('\n[Test 1] Checking if Claude CLI is available...');
    const cliAvailable = await executor.checkCliAvailable();
    console.log(`  CLI Available: ${cliAvailable ? '✓ YES' : '✗ NO'}`);
    if (!cliAvailable) {
        console.log('\n❌ Claude CLI not found. Make sure `claude` is installed and in PATH.');
        console.log('   Install with: npm install -g @anthropic-ai/claude-code');
        process.exit(1);
    }
    // Test 2: Simple prompt execution
    console.log('\n[Test 2] Executing simple prompt...');
    const simplePrompt = 'What is 2 + 2? Reply with just the number.';
    console.log(`  Prompt: "${simplePrompt}"`);
    const result1 = await executor.execute(simplePrompt);
    console.log(`  Success: ${result1.success ? '✓' : '✗'}`);
    console.log(`  Output: ${result1.output.substring(0, 200)}${result1.output.length > 200 ? '...' : ''}`);
    if (result1.error) {
        console.log(`  Error: ${result1.error}`);
    }
    console.log(`  Quota Exhausted: ${result1.quotaExhausted}`);
    console.log(`  CLI Unavailable: ${result1.cliUnavailable}`);
    // Test 3: Code generation prompt
    console.log('\n[Test 3] Testing code generation prompt...');
    const codePrompt = `Write a simple TypeScript function that adds two numbers.
Output ONLY the code, no explanation. Format:
\`\`\`typescript
// code here
\`\`\``;
    const result2 = await executor.execute(codePrompt);
    console.log(`  Success: ${result2.success ? '✓' : '✗'}`);
    console.log(`  Output preview: ${result2.output.substring(0, 300)}${result2.output.length > 300 ? '...' : ''}`);
    if (result2.error) {
        console.log(`  Error: ${result2.error}`);
    }
    // Test 4: Get executor status
    console.log('\n[Test 4] Executor Status:');
    const status = executor.getStatus();
    console.log(`  CLI Available: ${status.cliAvailable}`);
    console.log(`  Consecutive Quota Errors: ${status.consecutiveQuotaErrors}`);
    console.log(`  In Quota Cooldown: ${status.inQuotaCooldown}`);
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('Test Summary');
    console.log('='.repeat(60));
    const passed = cliAvailable && result1.success;
    console.log(`  Overall: ${passed ? '✓ PASSED' : '✗ FAILED'}`);
    console.log(`  CLI Integration: ${cliAvailable ? 'Working' : 'Not Available'}`);
    console.log(`  Execution: ${result1.success ? 'Working' : 'Failed'}`);
    if (passed) {
        console.log('\n✓ RUBIX can now use your Max subscription via Claude Code CLI!');
    }
}
testCliExecutor().catch(console.error);
