#!/usr/bin/env node
/**
 * God Agent CLI
 *
 * Command-line interface for the God Agent memory system.
 */

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { storeCommand } from './commands/store.js';
import { queryCommand } from './commands/query.js';
import { traceCommand } from './commands/trace.js';
import { causalCommand } from './commands/causal.js';
import { statsCommand } from './commands/stats.js';
import { migrateCommand } from './commands/migrate.js';
import { captureSessionCommand } from './commands/capture-session.js';
import { captureMissingCommand } from './commands/capture-missing.js';
import { assimilateCommand } from './commands/assimilate.js';
import { allowPathCommand } from './commands/allow-path.js';

const program = new Command();

program
  .name('rubix')
  .description('Rubix - Autonomous developer agent with unlimited memory')
  .version('0.1.0');

program.addCommand(initCommand);
program.addCommand(storeCommand);
program.addCommand(queryCommand);
program.addCommand(traceCommand);
program.addCommand(causalCommand);
program.addCommand(statsCommand);
program.addCommand(migrateCommand);
program.addCommand(captureSessionCommand);
program.addCommand(captureMissingCommand);
program.addCommand(assimilateCommand);
program.addCommand(allowPathCommand);

program.parse();
