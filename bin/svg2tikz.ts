#!/usr/bin/env node

import fs from 'node:fs/promises';
import process from 'node:process';

import { installNodeSvgEnvironment } from '../src/node-env.js';
import { svgToTikz } from '../src/svg2tikz.js';

function printHelp() {
  process.stdout.write(`Usage: svg2tikz [input.svg] [options]

Convert an SVG file to TikZ.

Options:
  -o, --output FILE       Write TikZ output to FILE
  -p, --precision N       Decimal precision (default: 2)
  -s, --standalone        Wrap output in a standalone LaTeX document
  -h, --help              Show this help message

If no input file is provided, SVG is read from stdin.
`);
}

function fail(message) {
  process.stderr.write(`svg2tikz: ${message}\n`);
  process.exitCode = 1;
}

function parseArgs(argv) {
  const args = {
    inputPath: null,
    outputPath: null,
    precision: 2,
    standalone: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '-h' || arg === '--help') {
      args.help = true;
      continue;
    }

    if (arg === '-s' || arg === '--standalone') {
      args.standalone = true;
      continue;
    }

    if (arg === '-o' || arg === '--output') {
      args.outputPath = argv[++i] ?? null;
      if (!args.outputPath) throw new Error(`missing value for ${arg}`);
      continue;
    }

    if (arg === '-p' || arg === '--precision') {
      const value = argv[++i] ?? null;
      if (value == null) throw new Error(`missing value for ${arg}`);
      const precision = Number.parseInt(value, 10);
      if (!Number.isInteger(precision) || precision < 0 || precision > 12) {
        throw new Error(`invalid precision: ${value}`);
      }
      args.precision = precision;
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`unknown option: ${arg}`);
    }

    if (args.inputPath) {
      throw new Error('only one input file may be provided');
    }
    args.inputPath = arg;
  }

  return args;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    fail(error.message);
    return;
  }

  if (args.help) {
    printHelp();
    return;
  }

  let svgSource = '';
  try {
    svgSource = args.inputPath
      ? await fs.readFile(args.inputPath, 'utf8')
      : await readStdin();
  } catch (error) {
    fail(error.message);
    return;
  }

  if (!svgSource.trim()) {
    fail('no SVG input provided');
    return;
  }

  installNodeSvgEnvironment();

  let tikz;
  try {
    tikz = svgToTikz(svgSource, {
      precision: args.precision,
      standalone: args.standalone,
    });
  } catch (error) {
    fail(error.message);
    return;
  }

  try {
    if (args.outputPath) {
      await fs.writeFile(args.outputPath, tikz, 'utf8');
    } else {
      process.stdout.write(`${tikz}\n`);
    }
  } catch (error) {
    fail(error.message);
  }
}

await main();
