/**
 * Capture Missing Command
 *
 * Find and capture any Claude Code sessions that weren't captured due to
 * connection failures or crashes.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { readdirSync, existsSync, statSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';
import { isSessionCaptured } from './capture-session.js';

/**
 * Find Claude Code projects directory
 */
function findProjectsDir(): string {
  const claudeDir = join(homedir(), '.claude');
  const projectsDir = join(claudeDir, 'projects');

  if (!existsSync(projectsDir)) {
    throw new Error(`Claude projects directory not found: ${projectsDir}`);
  }

  return projectsDir;
}

/**
 * Get project hash for a given project path
 * Claude Code uses a hash of the project path as the directory name
 */
function getProjectHash(projectPath: string): string | null {
  // Try to find the hash by scanning project directories
  // Each project dir contains a .project file with the path
  const projectsDir = findProjectsDir();
  const dirs = readdirSync(projectsDir);

  for (const dir of dirs) {
    const projectFile = join(projectsDir, dir, '.project');
    if (existsSync(projectFile)) {
      try {
        const content = execSync(`cat "${projectFile}"`, { encoding: 'utf-8' }).trim();
        if (content === projectPath) {
          return dir;
        }
      } catch {
        // Skip directories we can't read
      }
    }
  }

  return null;
}

/**
 * Find all transcript files for a project
 */
function findTranscripts(projectHash: string): { sessionId: string; path: string; mtime: Date }[] {
  const projectsDir = findProjectsDir();
  const projectDir = join(projectsDir, projectHash);

  if (!existsSync(projectDir)) {
    return [];
  }

  const files = readdirSync(projectDir);
  const transcripts: { sessionId: string; path: string; mtime: Date }[] = [];

  for (const file of files) {
    // Transcript files are UUIDs with .jsonl extension
    if (file.endsWith('.jsonl') && file.length > 30) {
      const sessionId = file.replace('.jsonl', '');
      const filePath = join(projectDir, file);
      const stats = statSync(filePath);
      transcripts.push({
        sessionId,
        path: filePath,
        mtime: stats.mtime,
      });
    }
  }

  // Sort by modification time (newest first)
  transcripts.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  return transcripts;
}

/**
 * Find all transcripts across all projects
 */
function findAllTranscripts(): { sessionId: string; path: string; project: string; mtime: Date }[] {
  const projectsDir = findProjectsDir();
  const dirs = readdirSync(projectsDir);
  const allTranscripts: { sessionId: string; path: string; project: string; mtime: Date }[] = [];

  for (const dir of dirs) {
    const projectDir = join(projectsDir, dir);
    const stat = statSync(projectDir);
    if (!stat.isDirectory()) continue;

    // Try to get project path
    let projectPath = dir;
    const projectFile = join(projectDir, '.project');
    if (existsSync(projectFile)) {
      try {
        projectPath = execSync(`cat "${projectFile}"`, { encoding: 'utf-8' }).trim();
      } catch {
        // Use hash as fallback
      }
    }

    const files = readdirSync(projectDir);
    for (const file of files) {
      if (file.endsWith('.jsonl') && file.length > 30) {
        const sessionId = file.replace('.jsonl', '');
        const filePath = join(projectDir, file);
        const stats = statSync(filePath);
        allTranscripts.push({
          sessionId,
          path: filePath,
          project: projectPath,
          mtime: stats.mtime,
        });
      }
    }
  }

  // Sort by modification time (newest first)
  allTranscripts.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  return allTranscripts;
}

export const captureMissingCommand = new Command('capture-missing')
  .description('Find and capture any uncaptured Claude Code sessions')
  .option('-p, --project <path>', 'Limit to specific project directory')
  .option('-d, --data-dir <path>', 'God Agent data directory', './data')
  .option('-n, --limit <number>', 'Maximum number of sessions to capture', '10')
  .option('--list', 'Just list uncaptured sessions, don\'t capture', false)
  .option('--all-projects', 'Scan all projects, not just the specified one', false)
  .action(async (options) => {
    const spinner = ora('Scanning for uncaptured sessions...').start();

    try {
      let transcripts: { sessionId: string; path: string; project: string; mtime: Date }[];

      if (options.allProjects || !options.project) {
        // Scan all projects
        transcripts = findAllTranscripts();
      } else {
        // Find project hash
        const projectHash = getProjectHash(options.project);
        if (!projectHash) {
          spinner.warn(`Project not found in Claude history: ${options.project}`);
          console.log(chalk.dim('Run with --all-projects to scan all projects'));
          return;
        }

        transcripts = findTranscripts(projectHash).map(t => ({
          ...t,
          project: options.project,
        }));
      }

      // Filter to uncaptured sessions
      const uncaptured = transcripts.filter(
        t => !isSessionCaptured(options.dataDir, t.sessionId)
      );

      spinner.stop();

      if (uncaptured.length === 0) {
        console.log(chalk.green('✓ All sessions are captured'));
        return;
      }

      console.log(chalk.yellow(`Found ${uncaptured.length} uncaptured session(s)`));
      console.log();

      // List mode
      if (options.list) {
        for (const t of uncaptured.slice(0, parseInt(options.limit, 10))) {
          const age = Math.round((Date.now() - t.mtime.getTime()) / 60000);
          console.log(`  ${chalk.cyan(t.sessionId.substring(0, 8))} - ${basename(t.project)} (${age}m ago)`);
        }
        if (uncaptured.length > parseInt(options.limit, 10)) {
          console.log(chalk.dim(`  ... and ${uncaptured.length - parseInt(options.limit, 10)} more`));
        }
        console.log();
        console.log(chalk.dim('Run without --list to capture these sessions'));
        return;
      }

      // Capture sessions
      const limit = parseInt(options.limit, 10);
      const toCapture = uncaptured.slice(0, limit);

      console.log(`Capturing ${toCapture.length} session(s)...`);
      console.log();

      let captured = 0;
      let failed = 0;

      for (const t of toCapture) {
        const sessionSpinner = ora(`Capturing ${t.sessionId.substring(0, 8)}...`).start();

        try {
          // Import and run capture-session logic
          const { spawn } = await import('child_process');
          const captureProcess = spawn('node', [
            join(process.cwd(), 'dist/cli/index.js'),
            'capture-session',
            '--transcript', t.path,
            '--session-id', t.sessionId,
            '--project', t.project,
            '--data-dir', options.dataDir,
          ], {
            stdio: 'pipe',
          });

          await new Promise<void>((resolve, reject) => {
            captureProcess.on('close', (code) => {
              if (code === 0) {
                resolve();
              } else {
                reject(new Error(`Process exited with code ${code}`));
              }
            });
            captureProcess.on('error', reject);
          });

          sessionSpinner.succeed(`Captured ${t.sessionId.substring(0, 8)}`);
          captured++;
        } catch (error) {
          sessionSpinner.fail(`Failed to capture ${t.sessionId.substring(0, 8)}`);
          failed++;
        }
      }

      console.log();
      console.log(chalk.green(`✓ Captured: ${captured}`));
      if (failed > 0) {
        console.log(chalk.yellow(`⚠ Failed: ${failed}`));
      }
      if (uncaptured.length > limit) {
        console.log(chalk.dim(`Remaining: ${uncaptured.length - limit} (run again to capture more)`));
      }

    } catch (error) {
      spinner.fail(chalk.red('Failed to scan for sessions'));
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
