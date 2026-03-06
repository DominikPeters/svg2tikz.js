# svg2tikz

Convert SVG files to TikZ graphics for use in LaTeX.

## Installation

```bash
npm install svg2tikz
```

## CLI Usage

```bash
# Convert an SVG file
svg2tikz input.svg -o output.tex

# Read from stdin, write to stdout
cat input.svg | svg2tikz

# Generate a standalone LaTeX document
svg2tikz input.svg -s -o output.tex

# Set decimal precision (default: 2)
svg2tikz input.svg -p 3 -o output.tex
```

### CLI Options

| Option | Description |
|--------|-------------|
| `-o, --output FILE` | Write output to FILE |
| `-p, --precision N` | Decimal precision (default: 2) |
| `-s, --standalone` | Wrap output in a standalone LaTeX document |
| `-h, --help` | Show help message |

## Programmatic API

### Browser

```typescript
import { svgToTikz } from 'svg2tikz';

const svg = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <circle cx="50" cy="50" r="40" fill="red" />
</svg>`;

const tikz = svgToTikz(svg);
console.log(tikz);
```

### Node.js

In Node.js, you need to set up a DOM environment first:

```typescript
import { installNodeSvgEnvironment } from 'svg2tikz/node-env';
import { svgToTikz } from 'svg2tikz';

installNodeSvgEnvironment();

const tikz = svgToTikz(svgString, {
  precision: 2,
  standalone: false,
});
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `precision` | number | 2 | Decimal places for coordinates |
| `standalone` | boolean | false | Wrap in standalone LaTeX document |

## Supported SVG Features

- Basic shapes: `<rect>`, `<circle>`, `<ellipse>`, `<line>`, `<polyline>`, `<polygon>`, `<path>`
- Text: `<text>`, `<tspan>` with baseline shifts (subscript/superscript)
- Groups: `<g>` with transforms and opacity
- Transforms: `translate`, `rotate`, `scale`, `matrix`
- Styling: fill, stroke, stroke-width, dash patterns, line caps/joins
- Colors: hex, rgb(), named colors
- Gradients: basic linear and radial gradient support
- Markers: `<marker>` elements for arrowheads
- Clipping: `<clipPath>` support
- Use elements: `<use>` with href references

## Example Output

Input SVG:
```xml
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <rect x="10" y="10" width="80" height="80" fill="blue" stroke="black" />
</svg>
```

Output TikZ:
```latex
\begin{tikzpicture}
\definecolor{color0}{HTML}{0000FF}
\filldraw[fill=color0, draw=black] (1,9) rectangle (9,1);
\end{tikzpicture}
```

## License

MIT
