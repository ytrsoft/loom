/**
 * @fileoverview Command dispatch for the `loom` CLI.
 */

import {exportCommand, listCommand} from './commands/data.js';
import {initCommand, newCommand} from './commands/scaffold.js';
import {devCommand, runCommand, startCommand} from './commands/serve.js';

type Command = (args: string[]) => Promise<number>;

const COMMANDS: Readonly<Record<string, Command>> = {
  dev: devCommand,
  start: startCommand,
  run: runCommand,
  list: listCommand,
  new: newCommand,
  export: exportCommand,
  init: initCommand,
};

const HELP = `loom — convention-over-configuration crawling

Usage
  loom dev                     dashboard + API, restarts on file changes
  loom start [-p 3000]         production server with schedules
  loom run <spider>            run one spider in the terminal
      --max-requests <n>       stop after n requests
      --concurrency <n>        override parallelism
      --headful                show the browser (browser mode)
      --resume                 continue an interrupted run
  loom list                    spiders, files and item counts
  loom new <name> [--browser | --api]
                               scaffold src/spiders/<name>.ts
  loom export <spider> [-f csv|json|ndjson] [-o file]
  loom init                    create loom.config.ts and a first spider

Environment
  LOOM_DATABASE_URL  LOOM_PORT  LOOM_HOST  LOOM_TOKEN  LOOM_LOG_LEVEL
`;

/** Runs the CLI and returns the exit code. */
export async function main(argv: readonly string[]): Promise<number> {
  const [name, ...args] = argv;
  if (!name || name === 'help' || name === '--help' || name === '-h') {
    console.log(HELP);
    return 0;
  }
  const command = COMMANDS[name];
  if (!command) {
    console.error(`unknown command "${name}"\n\n${HELP}`);
    return 2;
  }
  try {
    return await command(args);
  } catch (error) {
    console.error(`\n✖ ${error instanceof Error ? error.message : String(error)}`);
    if (process.env['LOOM_LOG_LEVEL'] === 'debug' && error instanceof Error) {
      console.error(error.stack);
    }
    return 1;
  }
}
