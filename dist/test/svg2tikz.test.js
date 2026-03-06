import test from 'node:test';
import assert from 'node:assert/strict';
import { installNodeSvgEnvironment } from '../src/node-env.js';
import { svgToTikz } from '../src/svg2tikz.js';
installNodeSvgEnvironment();
test('preserves exact dash patterns and dash phase', () => {
    const svg = `
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <line x1="10" y1="10" x2="90" y2="10"
        stroke="#000"
        stroke-width="2"
        stroke-dasharray="5 2 1"
        stroke-dashoffset="4" />
    </svg>
  `;
    const tikz = svgToTikz(svg);
    assert.match(tikz, /dash pattern=on 14\.23pt off 5\.69pt on 2\.85pt off 14\.23pt on 5\.69pt off 2\.85pt/);
    assert.match(tikz, /dash phase=11\.38pt/);
});
test('emits group scopes for transforms and group opacity', () => {
    const svg = `
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <g transform="translate(10 20) rotate(30)" opacity="0.5">
        <rect x="10" y="10" width="20" height="10" fill="#f00" />
        <text x="20" y="30">Hello</text>
      </g>
    </svg>
  `;
    const tikz = svgToTikz(svg);
    assert.match(tikz, /\\begin\{scope\}\[opacity=0\.5, transparency group\]/);
    assert.match(tikz, /\\begin\{scope\}\[transform shape, xshift=1cm, yshift=-2cm, rotate around=\{-30:\(0,10\)\}\]/);
    assert.doesNotMatch(tikz, /cm=\{/);
    assert.match(tikz, /transform shape/);
    assert.match(tikz, /opacity=0\.5/);
    assert.match(tikz, /transparency group/);
    assert.match(tikz, /\\end\{scope\}/);
});
test('uses xshift and yshift for pure translations', () => {
    const svg = `
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect x="10" y="10" width="20" height="10" fill="#f00" transform="translate(10 20)" />
    </svg>
  `;
    const tikz = svgToTikz(svg);
    assert.match(tikz, /\\begin\{scope\}\[xshift=1cm, yshift=-2cm\]/);
    assert.doesNotMatch(tikz, /cm=\{/);
});
test('keeps transformed circles as circles with idiomatic scale options', () => {
    const svg = `
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="25" r="10" fill="none" stroke="#00f" transform="scale(2 1)" />
    </svg>
  `;
    const tikz = svgToTikz(svg);
    assert.match(tikz, /\\begin\{scope\}\[yshift=10cm, xscale=2, yshift=-10cm\]/);
    assert.doesNotMatch(tikz, /cm=\{/);
    assert.match(tikz, /circle\[radius=1cm\]/);
});
test('falls back to cm transforms when the SVG transform is not idiomatic', () => {
    const svg = `
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect x="10" y="10" width="20" height="20" fill="none" stroke="#000" transform="matrix(1 0.2 0.4 1 5 7)" />
    </svg>
  `;
    const tikz = svgToTikz(svg);
    assert.match(tikz, /cm=\{/);
});
test('supports richer text content with tspans and baseline shifts', () => {
    const svg = `
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <text x="10" y="20" font-family="Helvetica" font-style="italic">
        T<tspan baseline-shift="sub">1</tspan><tspan baseline-shift="super">2</tspan>
      </text>
    </svg>
  `;
    const tikz = svgToTikz(svg);
    assert.match(tikz, /font=\{\\sffamily\\itshape\}/);
    assert.match(tikz, /T\\\(_\{1\}\\\)\\\(\^\{2\}\\\)/);
});
test('covers additional stroke and fill properties from inline style', () => {
    const svg = `
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <path d="M 10 10 L 90 10 L 90 90 Z"
        style="fill:#00ff00;fill-rule:evenodd;stroke:#000000;stroke-width:3;stroke-linecap:square;stroke-linejoin:bevel;stroke-miterlimit:8" />
    </svg>
  `;
    const tikz = svgToTikz(svg);
    assert.match(tikz, /fill=green/);
    assert.match(tikz, /even odd rule/);
    assert.match(tikz, /line cap=rect/);
    assert.match(tikz, /line join=bevel/);
    assert.match(tikz, /miter limit=8/);
});
//# sourceMappingURL=svg2tikz.test.js.map