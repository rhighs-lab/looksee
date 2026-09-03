import { main } from '@/server/cli.js';

main().catch((err: Error) => {
  process.stderr.write(`looksee failed to start: ${err.message}\n`);
  process.exit(1);
});
