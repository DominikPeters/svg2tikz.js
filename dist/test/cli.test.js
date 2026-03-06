import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
const cliPath = path.resolve('dist/bin/svg2tikz.js');
test('cli converts SVG from stdin', async () => {
    const svg = `<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="8" height="6" fill="#ff0000"/></svg>`;
    const stdout = execFileSync(process.execPath, [cliPath], {
        cwd: path.resolve('.'),
        input: svg,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
    });
    assert.match(stdout, /\\begin\{tikzpicture\}/);
    assert.match(stdout, /\\fill\[red\]/);
});
test('cli writes standalone output to a file', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'svg2tikz-cli-'));
    const inputPath = path.join(dir, 'input.svg');
    const outputPath = path.join(dir, 'output.tex');
    await fs.writeFile(inputPath, `<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="4" fill="none" stroke="#0000ff"/></svg>`, 'utf8');
    await execFileAsync(process.execPath, [cliPath, inputPath, '--output', outputPath, '--standalone', '--precision', '3'], {
        cwd: path.resolve('.'),
        maxBuffer: 1024 * 1024,
    });
    const output = await fs.readFile(outputPath, 'utf8');
    assert.match(output, /\\documentclass\[tikz\]\{standalone\}/);
    assert.match(output, /circle\[radius=2cm\]/);
});
//# sourceMappingURL=cli.test.js.map