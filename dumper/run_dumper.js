#!/usr/bin/env node

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { Pipeline } from './Main.js';

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.log(JSON.stringify({ error: 'usage: node cli.js <file> [mode]' }));
    process.exit(2);
  }

  const path = args[0];
  const mode = args[1] || 'full';

  // Validate file exists
  if (!existsSync(path)) {
    console.log(JSON.stringify({ error: `File not found: ${path}` }));
    process.exit(1);
  }

  const pipe = new Pipeline();

  try {
    const res = await pipe.analyze(path, mode);
    const sm = pipe.summary([res]);
    const out = { summary: sm, result: res };
    
    console.log(JSON.stringify(out));
  } catch (e) {
    if (e.code === 'ENOENT') {
      console.log(JSON.stringify({ error: `File not found: ${e.message}` }));
      process.exit(1);
    }

    const errorMsg = `${e.name || 'Error'}: ${e.message}`;
    console.log(JSON.stringify({ 
      error: errorMsg, 
      traceback: e.stack || String(e) 
    }));
    process.exit(1);
  }
}

main();
