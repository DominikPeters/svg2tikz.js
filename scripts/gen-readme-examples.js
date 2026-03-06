#!/usr/bin/env node
/**
 * Generates PNG renderings for README examples.
 *
 * Requirements:
 *   - rsvg-convert  (librsvg)   for SVG → PNG
 *   - pdflatex + pdftoppm       for TikZ → PDF → PNG
 *
 * Usage: node scripts/gen-readme-examples.js
 * (run from the repo root after `npm run build`)
 */

import { installNodeSvgEnvironment } from '../dist/src/node-env.js';
import { svgToTikz } from '../dist/src/svg2tikz.js';
import { execSync } from 'child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';

installNodeSvgEnvironment();

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const outDir = join(root, 'docs', 'examples');
mkdirSync(outDir, { recursive: true });

// ── Examples ────────────────────────────────────────────────────────────────

const EXAMPLES = [
  {
    name: 'basic-shapes',
    title: 'Basic Shapes',
    svg: `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <rect x="10" y="10" width="80" height="60" fill="#4a90d9" stroke="#2c3e50" stroke-width="2" rx="5"/>
  <circle cx="150" cy="40" r="30" fill="#e74c3c" stroke="#c0392b" stroke-width="2"/>
  <ellipse cx="60" cy="140" rx="40" ry="25" fill="#2ecc71" stroke="#27ae60" stroke-width="2"/>
  <line x1="110" y1="100" x2="190" y2="180" stroke="#8e44ad" stroke-width="3"/>
  <polygon points="150,100 180,170 120,170" fill="#f39c12" stroke="#e67e22" stroke-width="2"/>
</svg>`,
  },
  {
    name: 'chart',
    title: 'Bar Chart',
    svg: `<svg viewBox="0 0 260 180" xmlns="http://www.w3.org/2000/svg">
  <!-- axes -->
  <line x1="40" y1="10" x2="40" y2="150" stroke="#333" stroke-width="1.5"/>
  <line x1="40" y1="150" x2="250" y2="150" stroke="#333" stroke-width="1.5"/>
  <!-- bars -->
  <rect x="55" y="50" width="30" height="100" fill="#3498db"/>
  <rect x="100" y="80" width="30" height="70" fill="#2ecc71"/>
  <rect x="145" y="30" width="30" height="120" fill="#e74c3c"/>
  <rect x="190" y="100" width="30" height="50" fill="#f39c12"/>
  <!-- labels -->
  <text x="70" y="170" text-anchor="middle" font-size="11" fill="#333">A</text>
  <text x="115" y="170" text-anchor="middle" font-size="11" fill="#333">B</text>
  <text x="160" y="170" text-anchor="middle" font-size="11" fill="#333">C</text>
  <text x="205" y="170" text-anchor="middle" font-size="11" fill="#333">D</text>
</svg>`,
  },
  {
    name: 'group-scopes',
    title: 'Group Scopes & Transforms',
    svg: `<svg viewBox="0 0 260 200" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="260" height="200" fill="#f5f7fb"/>
  <g transform="translate(58 40) rotate(-12)" opacity="0.65">
    <rect x="-26" y="-16" width="120" height="74" rx="10"
          fill="#dfe9ff" stroke="#3c5aa6" stroke-width="3"/>
    <circle cx="26" cy="20" r="16" fill="#ffcc80" stroke="#9c5b19" stroke-width="2"/>
    <text x="34" y="28" font-family="Helvetica" font-size="18" font-weight="bold">Scope A</text>
  </g>
  <g transform="translate(172 118) scale(1.15 0.8) rotate(18)" opacity="0.82">
    <ellipse cx="0" cy="0" rx="44" ry="26" fill="#d7f4d3" stroke="#2d7a3e" stroke-width="3"/>
    <path d="M -30 0 L 0 -22 L 30 0 L 0 22 Z"
          fill="none" stroke="#2d7a3e" stroke-width="2.5" stroke-dasharray="8 3"/>
    <text x="0" y="6" text-anchor="middle" font-family="Helvetica" font-size="16" font-style="italic">Scope B</text>
  </g>
</svg>`,
  },
];

// ── Rendering helpers ────────────────────────────────────────────────────────

function renderSvgToPng(svgContent, outPng, widthPx = 400) {
  const tmp = join(tmpdir(), `svg2tikz-${Date.now()}.svg`);
  writeFileSync(tmp, svgContent, 'utf8');
  try {
    execSync(`rsvg-convert -w ${widthPx} "${tmp}" -o "${outPng}"`, { stdio: 'pipe' });
  } finally {
    rmSync(tmp, { force: true });
  }
}

function renderTikzToPng(tikzCode, outPng, dpi = 150) {
  const tmpDir = mkdtempSync(join(tmpdir(), 'svg2tikz-latex-'));
  const texFile = join(tmpDir, 'main.tex');
  const pdfFile = join(tmpDir, 'main.pdf');
  // Stem for pdftoppm output (it appends -1.png for the first page)
  const pngStem = join(tmpDir, 'main');

  const latexDoc = [
    '\\documentclass[tikz,border=8pt]{standalone}',
    '\\usepackage{tikz}',
    '\\begin{document}',
    tikzCode,
    '\\end{document}',
  ].join('\n');

  writeFileSync(texFile, latexDoc, 'utf8');

  try {
    execSync(`pdflatex -interaction=nonstopmode -output-directory="${tmpDir}" "${texFile}"`, {
      stdio: 'pipe',
    });
    execSync(`pdftoppm -r ${dpi} -png -singlefile "${pdfFile}" "${pngStem}"`, { stdio: 'pipe' });
    const produced = `${pngStem}.png`;
    if (!existsSync(produced)) throw new Error(`pdftoppm did not produce ${produced}`);
    // Move to final destination
    execSync(`cp "${produced}" "${outPng}"`, { stdio: 'pipe' });
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

for (const { name, title, svg } of EXAMPLES) {
  console.log(`\n── ${title} ──`);

  // SVG preview
  const svgPng = join(outDir, `${name}-svg.png`);
  process.stdout.write('  Rendering SVG… ');
  renderSvgToPng(svg, svgPng);
  console.log(`done → ${svgPng}`);

  // TikZ output
  const tikz = svgToTikz(svg);
  const tikzTxtFile = join(outDir, `${name}.tikz`);
  writeFileSync(tikzTxtFile, tikz, 'utf8');

  // TikZ render
  const tikzPng = join(outDir, `${name}-tikz.png`);
  process.stdout.write('  Rendering TikZ… ');
  try {
    renderTikzToPng(tikz, tikzPng);
    console.log(`done → ${tikzPng}`);
  } catch (e) {
    console.error(`FAILED: ${e.message}`);
  }

  // Print the TikZ for README copy-paste verification
  console.log('\n  TikZ output:');
  console.log(tikz.split('\n').map(l => '    ' + l).join('\n'));
}

console.log('\nDone. Images written to docs/examples/');
