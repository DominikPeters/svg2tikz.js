import { parsePath } from './path-parser.js';

// ── Public API ──────────────────────────────────────────────────────────────

export function svgToTikz(svgInput, options = {}) {
  const {
    precision = 2,
    scale = null,       // auto-computed if null
    standalone = false,  // wrap in \documentclass{standalone} ...
  } = options;

  // Parse string input
  let svgEl;
  if (typeof svgInput === 'string') {
    const doc = new DOMParser().parseFromString(svgInput, 'image/svg+xml');
    svgEl = doc.querySelector('svg');
    if (!svgEl) throw new Error('No <svg> element found');
  } else {
    svgEl = svgInput;
  }

  // Determine coordinate space from viewBox or width/height
  const viewBox = parseViewBox(svgEl);
  const computedScale = scale ?? computeAutoScale(viewBox);

  const ctx = {
    precision,
    scale: computedScale,
    viewBox,
    colors: new Map(),       // hex -> colorName
    lines: [],
    indent: 1,
    // Preprocessing results
    classStyles: new Map(),  // className -> { props: Map, tikzOpts: string[] }
    markers: new Map(),      // id -> { isArrow: bool }
    gradients: new Map(),    // id -> { type, stops, angle, ... }
    usesArrows: false,       // whether any arrows are used (to add >=stealth)
    tikzStyles: [],          // \tikzset lines
  };

  // Preprocess defs and style elements
  preprocessDefs(svgEl, ctx);

  // Process children
  processElement(svgEl, ctx, identityTransform());

  // Assemble output
  const parts = [];
  if (standalone) {
    parts.push('\\documentclass[tikz]{standalone}');
    parts.push('\\usepackage{tikz}');
    parts.push('');
  }
  if (standalone) parts.push('\\begin{document}');

  // Tikzpicture with options
  const picOpts = [];
  if (ctx.usesArrows) picOpts.push('>=stealth');
  parts.push(picOpts.length > 0
    ? `\\begin{tikzpicture}[${picOpts.join(', ')}]`
    : '\\begin{tikzpicture}');

  // Color definitions
  for (const [hex, name] of ctx.colors) {
    parts.push(`  \\definecolor{${name}}{HTML}{${hex}}`);
  }

  // TikZ style definitions from CSS classes
  for (const line of ctx.tikzStyles) {
    parts.push(line);
  }

  // Drawing commands
  for (const line of ctx.lines) {
    parts.push(line);
  }

  parts.push('\\end{tikzpicture}');
  if (standalone) parts.push('\\end{document}');

  return parts.join('\n');
}

// ── Preprocessing: defs, styles, markers, gradients ─────────────────────────

function preprocessDefs(svgEl, ctx) {
  // 1. Parse <style> elements for simple class rules
  for (const styleEl of svgEl.querySelectorAll('style')) {
    parseStyleElement(styleEl, ctx);
  }

  // 2. Parse markers
  for (const marker of svgEl.querySelectorAll('marker')) {
    const id = marker.getAttribute('id');
    if (!id) continue;
    ctx.markers.set(id, { isArrow: detectArrowMarker(marker) });
  }

  // 3. Parse gradients
  for (const grad of svgEl.querySelectorAll('linearGradient, radialGradient')) {
    const id = grad.getAttribute('id');
    if (!id) continue;
    ctx.gradients.set(id, parseGradient(grad, ctx));
  }
}

function parseStyleElement(styleEl, ctx) {
  const text = styleEl.textContent || '';
  // Match simple class rules: .className { prop: value; ... }
  const ruleRe = /\.([a-zA-Z_][\w-]*)\s*\{([^}]+)\}/g;
  let m;
  while ((m = ruleRe.exec(text))) {
    const className = m[1];
    const body = m[2];
    const props = new Map();
    for (const decl of body.split(';')) {
      const colon = decl.indexOf(':');
      if (colon < 0) continue;
      const prop = decl.slice(0, colon).trim();
      const val = decl.slice(colon + 1).trim();
      if (prop && val) props.set(prop, val);
    }

    // Convert to TikZ options
    const tikzOpts = cssPropsToTikzOpts(props, ctx);
    if (tikzOpts.length > 0) {
      ctx.classStyles.set(className, { props, tikzOpts });
      ctx.tikzStyles.push(`  \\tikzset{${className}/.style={${tikzOpts.join(', ')}}}`);
    }
  }
}

function cssPropsToTikzOpts(props, ctx) {
  const opts = [];
  const fill = props.get('fill');
  const stroke = props.get('stroke');

  if (fill && fill !== 'none') {
    const hex = colorToHex(fill);
    if (hex) {
      const c = getTikzColor(hex, ctx);
      opts.push(c === 'black' ? 'fill' : `fill=${c}`);
    }
  }
  if (stroke && stroke !== 'none') {
    const hex = colorToHex(stroke);
    if (hex) {
      const c = getTikzColor(hex, ctx);
      opts.push(c === 'black' ? 'draw' : `draw=${c}`);
    }
  }

  const sw = props.get('stroke-width');
  if (sw) {
    const w = parseFloat(sw) || 1;
    opts.push(`line width=${dimPt(w, ctx)}`);
  }

  const opacity = props.get('opacity');
  if (opacity && parseFloat(opacity) < 1) opts.push(`opacity=${parseFloat(opacity)}`);

  const fillOpacity = props.get('fill-opacity');
  if (fillOpacity && parseFloat(fillOpacity) < 1) opts.push(`fill opacity=${parseFloat(fillOpacity)}`);

  const dash = props.get('stroke-dasharray');
  if (dash && dash !== 'none') opts.push('dashed');

  const linecap = props.get('stroke-linecap');
  if (linecap && linecap !== 'butt') opts.push(`line cap=${linecap}`);

  const linejoin = props.get('stroke-linejoin');
  if (linejoin && linejoin !== 'miter') opts.push(`line join=${linejoin}`);

  return opts;
}

function detectArrowMarker(marker) {
  // Heuristic: if the marker contains a path/polygon that looks like a triangle,
  // it's probably an arrowhead. We check if it has 3-4 vertices.
  const path = marker.querySelector('path, polygon');
  if (!path) return false;
  if (path.tagName === 'polygon') {
    const pts = (path.getAttribute('points') || '').trim().split(/[\s,]+/);
    return pts.length >= 4 && pts.length <= 8; // 2-4 points
  }
  // For path, check if d has ~3-4 points (M, L, L, Z pattern)
  const d = path.getAttribute('d') || '';
  const segments = parsePath(d);
  const nonZ = segments.filter(s => s.type !== 'Z');
  return nonZ.length >= 2 && nonZ.length <= 5;
}

function parseGradient(gradEl, ctx) {
  const type = gradEl.tagName === 'linearGradient' ? 'linear' : 'radial';
  const stops = [];

  for (const stop of gradEl.querySelectorAll('stop')) {
    const offset = parseFloat(stop.getAttribute('offset')) || 0;
    // Stop color can be in attribute or style
    const styleAttr = stop.getAttribute('style') || '';
    const color = stop.getAttribute('stop-color')
      || stop.style?.stopColor
      || extractStopColorFromStyle(styleAttr)
      || 'black';
    const opacity = parseFloat(
      stop.getAttribute('stop-opacity')
      || stop.style?.stopOpacity
      || extractFromStyle(styleAttr, 'stop-opacity')
      || '1');
    const hex = colorToHex(color);
    stops.push({ offset, hex, opacity });
  }

  // Sort by offset
  stops.sort((a, b) => a.offset - b.offset);

  if (type === 'linear') {
    // Compute angle from x1,y1 → x2,y2
    const x1 = parseFloat(gradEl.getAttribute('x1')) || 0;
    const y1 = parseFloat(gradEl.getAttribute('y1')) || 0;
    const x2 = parseFloat(gradEl.getAttribute('x2') ?? '1');
    const y2 = parseFloat(gradEl.getAttribute('y2')) || 0;
    const angleDeg = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
    return { type, stops, angle: angleDeg };
  }

  return { type, stops };
}

function extractFromStyle(styleStr, prop) {
  if (!styleStr) return null;
  const re = new RegExp(prop + ':\\s*([^;]+)');
  const m = styleStr.match(re);
  return m ? m[1].trim() : null;
}

function extractStopColorFromStyle(styleStr) {
  return extractFromStyle(styleStr, 'stop-color');
}

// ── Coordinate transforms ───────────────────────────────────────────────────

function identityTransform() {
  return [1, 0, 0, 1, 0, 0];
}

function multiplyTransforms(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function applyTransform(t, x, y) {
  return [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]];
}

function parseTransformAttr(str) {
  if (!str) return identityTransform();
  let result = identityTransform();
  const re = /(\w+)\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(str))) {
    const fn = m[1];
    const args = m[2].split(/[\s,]+/).map(Number);
    let t;
    switch (fn) {
      case 'translate':
        t = [1, 0, 0, 1, args[0] || 0, args[1] || 0];
        break;
      case 'scale':
        t = [args[0], 0, 0, args[1] ?? args[0], 0, 0];
        break;
      case 'rotate': {
        const a = args[0] * Math.PI / 180;
        const cos = Math.cos(a), sin = Math.sin(a);
        const cx = args[1] || 0, cy = args[2] || 0;
        if (cx || cy) {
          t = multiplyTransforms(
            multiplyTransforms([1, 0, 0, 1, cx, cy], [cos, sin, -sin, cos, 0, 0]),
            [1, 0, 0, 1, -cx, -cy]
          );
        } else {
          t = [cos, sin, -sin, cos, 0, 0];
        }
        break;
      }
      case 'skewX': {
        const a = Math.tan(args[0] * Math.PI / 180);
        t = [1, 0, a, 1, 0, 0];
        break;
      }
      case 'skewY': {
        const a = Math.tan(args[0] * Math.PI / 180);
        t = [1, a, 0, 1, 0, 0];
        break;
      }
      case 'matrix':
        t = args;
        break;
      default:
        t = identityTransform();
    }
    result = multiplyTransforms(result, t);
  }
  return result;
}

// ── ViewBox and scaling ─────────────────────────────────────────────────────

function parseViewBox(svgEl) {
  const vb = svgEl.getAttribute('viewBox');
  if (vb) {
    const parts = vb.split(/[\s,]+/).map(Number);
    return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
  }
  const w = parseFloat(svgEl.getAttribute('width')) || 300;
  const h = parseFloat(svgEl.getAttribute('height')) || 150;
  return { x: 0, y: 0, w, h };
}

function computeAutoScale(viewBox) {
  const maxDim = Math.max(viewBox.w, viewBox.h);
  if (maxDim === 0) return 1;
  return 10 / maxDim;
}

// ── Style resolution ────────────────────────────────────────────────────────

// SVG inherited presentation attributes
const INHERITED_PROPS = new Set([
  'fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity',
  'stroke-opacity', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin',
  'font-family', 'font-size', 'font-weight', 'text-anchor',
  'marker-start', 'marker-end', 'marker-mid',
]);

function getStyle(el) {
  const cs = el.ownerDocument.defaultView?.getComputedStyle(el) ?? null;

  function getOwn(prop) {
    return el.style?.[prop] || el.getAttribute(prop) || null;
  }

  function get(prop) {
    // Check element itself first
    const own = getOwn(prop);
    if (own) return own;

    // Computed style (works when rendered in a real document)
    if (cs?.[prop]) return cs[prop];

    // Manual inheritance: walk up ancestors for inherited SVG properties
    if (INHERITED_PROPS.has(prop)) {
      let ancestor = el.parentElement;
      while (ancestor) {
        const val = ancestor.style?.[prop] || ancestor.getAttribute(prop);
        if (val) return val;
        ancestor = ancestor.parentElement;
      }
    }

    return null;
  }

  // SVG defaults: fill is black (except for stroke-only elements), stroke is none
  const tag = el.tagName?.toLowerCase();
  const noFillElements = new Set(['line', 'polyline']);
  const isShape = tag && tag !== 'text' && tag !== 'g' && tag !== 'svg';
  const defaultFill = isShape && !noFillElements.has(tag) ? 'black' : null;

  return {
    fill: get('fill') ?? defaultFill,
    stroke: get('stroke') ?? (isShape ? 'none' : null),
    strokeWidth: get('stroke-width'),
    opacity: get('opacity'),
    fillOpacity: get('fill-opacity'),
    strokeOpacity: get('stroke-opacity'),
    strokeDasharray: get('stroke-dasharray'),
    strokeLinecap: get('stroke-linecap'),
    strokeLinejoin: get('stroke-linejoin'),
    fontFamily: get('font-family'),
    fontSize: get('font-size'),
    fontWeight: get('font-weight'),
    textAnchor: get('text-anchor'),
    display: get('display'),
    visibility: get('visibility'),
    markerStart: get('marker-start'),
    markerEnd: get('marker-end'),
    markerMid: get('marker-mid'),
  };
}

// Resolve the CSS classes on an element to TikZ style names
function getClassStyleNames(el, ctx) {
  const classAttr = el.getAttribute('class');
  if (!classAttr) return [];
  const names = [];
  for (const cls of classAttr.trim().split(/\s+/)) {
    if (ctx.classStyles.has(cls)) names.push(cls);
  }
  return names;
}

// ── Color handling ──────────────────────────────────────────────────────────

// xcolor base colors: exact RGB values from the xcolor package
const XCOLOR_COLORS = [
  ['black', 0, 0, 0], ['darkgray', 64, 64, 64], ['gray', 128, 128, 128],
  ['lightgray', 191, 191, 191], ['white', 255, 255, 255],
  ['red', 255, 0, 0], ['green', 0, 255, 0], ['blue', 0, 0, 255],
  ['cyan', 0, 255, 255], ['magenta', 255, 0, 255], ['yellow', 255, 255, 0],
  ['lime', 191, 255, 0], ['olive', 128, 128, 0], ['orange', 255, 128, 0],
  ['pink', 255, 191, 191], ['teal', 0, 128, 128], ['violet', 128, 0, 128],
  ['purple', 191, 0, 64], ['brown', 191, 128, 64],
];

// Build exact-match lookup: hex → xcolor name
const XCOLOR_EXACT = new Map();
for (const [name, r, g, b] of XCOLOR_COLORS) {
  const hex = ((r << 16) | (g << 8) | b).toString(16).toUpperCase().padStart(6, '0');
  XCOLOR_EXACT.set(hex, name);
}

function hexToRgb(hex) {
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function nearestColorName(hex) {
  const [r, g, b] = hexToRgb(hex);
  let bestName = 'gray';
  let bestDist = Infinity;
  for (const [name, pr, pg, pb] of XCOLOR_COLORS) {
    const dr = r - pr, dg = g - pg, db = b - pb;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      bestName = name;
    }
  }
  return bestName;
}

function colorToHex(colorStr) {
  if (!colorStr || colorStr === 'none' || colorStr === 'transparent') return null;

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const c = canvas.getContext('2d');
  c.fillStyle = colorStr;
  c.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = c.getImageData(0, 0, 1, 1).data;
  if (a === 0 && colorStr !== 'black' && colorStr !== '#000' && colorStr !== '#000000') {
    return null;
  }
  return ((r << 16) | (g << 8) | b).toString(16).toUpperCase().padStart(6, '0');
}

function getTikzColor(hex, ctx) {
  if (!hex) return null;
  // Exact xcolor built-in: use directly, no \definecolor needed
  if (XCOLOR_EXACT.has(hex)) return XCOLOR_EXACT.get(hex);
  // Already defined custom color
  if (ctx.colors.has(hex)) return ctx.colors.get(hex);
  // Name based on nearest xcolor, always with numeric suffix to avoid clashes
  const baseName = nearestColorName(hex);
  let suffix = 1;
  let name = baseName + suffix;
  const usedNames = new Set(ctx.colors.values());
  while (usedNames.has(name)) {
    suffix++;
    name = baseName + suffix;
  }
  ctx.colors.set(hex, name);
  return name;
}

// ── Gradient fill detection ─────────────────────────────────────────────────

function parseUrlRef(str) {
  if (!str) return null;
  // Handle url(#id), url("#id"), url('#id')
  const m = str.match(/url\(["']?#([^"')]+)["']?\)/);
  return m ? m[1] : null;
}

function getGradientOpts(gradId, ctx) {
  const grad = ctx.gradients.get(gradId);
  if (!grad || grad.stops.length < 2) return null;

  const first = grad.stops[0];
  const last = grad.stops[grad.stops.length - 1];
  const c1 = first.hex ? getTikzColor(first.hex, ctx) : 'white';
  const c2 = last.hex ? getTikzColor(last.hex, ctx) : 'white';

  if (grad.type === 'radial') {
    return [`inner color=${c1}`, `outer color=${c2}`];
  }

  // Linear gradient: map angle to TikZ shading direction
  // SVG angle: 0° = left→right, 90° = top→bottom
  // TikZ: left color / right color with shading angle
  const angle = grad.angle || 0;

  // Normalize to TikZ shading angle (TikZ 0° = left→right)
  // SVG y-axis is flipped relative to TikZ, so negate the vertical component
  const tikzAngle = -angle;

  if (Math.abs(angle) < 1) {
    return [`left color=${c1}`, `right color=${c2}`];
  } else if (Math.abs(angle - 90) < 1) {
    return [`top color=${c1}`, `bottom color=${c2}`];
  } else if (Math.abs(angle + 90) < 1 || Math.abs(angle - 270) < 1) {
    return [`bottom color=${c1}`, `top color=${c2}`];
  } else if (Math.abs(Math.abs(angle) - 180) < 1) {
    return [`right color=${c1}`, `left color=${c2}`];
  } else {
    return [`left color=${c1}`, `right color=${c2}`, `shading angle=${fmt(tikzAngle, ctx)}`];
  }
}

// ── Arrow/marker detection ──────────────────────────────────────────────────

function resolveMarkerRef(str) {
  return parseUrlRef(str);
}

function getArrowOpts(style, ctx) {
  const startRef = resolveMarkerRef(style.markerStart);
  const endRef = resolveMarkerRef(style.markerEnd);

  const startIsArrow = startRef && ctx.markers.get(startRef)?.isArrow;
  const endIsArrow = endRef && ctx.markers.get(endRef)?.isArrow;

  if (startIsArrow && endIsArrow) { ctx.usesArrows = true; return '<->'; }
  if (endIsArrow) { ctx.usesArrows = true; return '->'; }
  if (startIsArrow) { ctx.usesArrows = true; return '<-'; }
  return null;
}

// ── TikZ option building ────────────────────────────────────────────────────

// Returns { cmd, opts } where cmd is draw/fill/filldraw/shade/shadedraw
// and opts are clean (no redundant fill/draw that the cmd already implies).
function buildDrawCommand(el, style, ctx) {
  const opts = [];

  // CSS class styles (as named TikZ styles)
  const classNames = getClassStyleNames(el, ctx);
  for (const cn of classNames) opts.push(cn);

  // Skip inline fill/stroke if fully covered by class styles
  const classCoversAll = classNames.length > 0 && !el.getAttribute('fill')
    && !el.getAttribute('stroke') && !el.style?.fill && !el.style?.stroke;

  // Check for gradient fill
  const gradId = parseUrlRef(style.fill);
  const gradOpts = gradId ? getGradientOpts(gradId, ctx) : null;
  const hasGrad = !!gradOpts;

  // Resolve fill
  let fillColor = null; // TikZ color name, or true for black
  let hasFill = false;
  if (hasGrad) {
    hasFill = true;
    opts.push(...gradOpts);
  } else if (!classCoversAll) {
    const fillHex = colorToHex(style.fill);
    hasFill = fillHex !== null && style.fill !== 'none';
    if (hasFill) fillColor = getTikzColor(fillHex, ctx);
  }

  // Resolve stroke
  let strokeColor = null;
  let hasStroke = false;
  if (!classCoversAll) {
    const strokeHex = colorToHex(style.stroke);
    hasStroke = strokeHex !== null && style.stroke !== 'none';
    if (hasStroke) strokeColor = getTikzColor(strokeHex, ctx);
  }

  // Pick command
  // Pick command: prefer \draw (with fill= if needed) over \filldraw
  let cmd;
  if (hasGrad && hasStroke) cmd = 'shadedraw';
  else if (hasGrad) cmd = 'shade';
  else if (hasStroke) cmd = 'draw';
  else if (hasFill) cmd = 'fill';
  else cmd = 'draw';

  // Build color options (prepended for nice ordering)
  // \draw[blue, fill=red, ...] — stroke color bare, fill explicit
  // \fill[red, ...] — fill color bare
  const colorOpts = [];

  if (hasStroke) {
    if (strokeColor && strokeColor !== 'black') colorOpts.push(strokeColor);
  }
  if (!hasGrad && hasFill) {
    if (cmd === 'fill') {
      // \fill: fill color goes bare
      if (fillColor === 'black') { /* implied */ }
      else if (fillColor) colorOpts.push(fillColor);
    } else {
      // \draw with fill: need explicit fill=
      if (fillColor === 'black') colorOpts.push('fill');
      else if (fillColor) colorOpts.push(`fill=${fillColor}`);
    }
  }

  opts.unshift(...colorOpts);

  // Stroke width
  if (hasStroke) {
    const w = parseFloat(style.strokeWidth) || 1;
    opts.push(`line width=${dimPt(w, ctx)}`);
  }

  // Arrow tips
  const arrow = getArrowOpts(style, ctx);
  if (arrow) opts.push(arrow);

  // Opacity
  if (style.opacity && parseFloat(style.opacity) < 1) {
    opts.push(`opacity=${parseFloat(style.opacity)}`);
  }
  if (style.fillOpacity && parseFloat(style.fillOpacity) < 1) {
    opts.push(`fill opacity=${parseFloat(style.fillOpacity)}`);
  }
  if (style.strokeOpacity && parseFloat(style.strokeOpacity) < 1) {
    opts.push(`draw opacity=${parseFloat(style.strokeOpacity)}`);
  }

  // Dash
  if (style.strokeDasharray && style.strokeDasharray !== 'none') {
    const parts = style.strokeDasharray.split(/[\s,]+/).map(Number);
    if (parts.length === 1 || (parts.length === 2 && parts[0] === parts[1])) {
      opts.push('dashed');
    } else {
      const pattern = parts.map((v, i) =>
        (i % 2 === 0 ? 'on ' : 'off ') + dimPt(v, ctx)
      ).join(' ');
      opts.push(`dash pattern=${pattern}`);
    }
  }

  // Line cap/join
  if (style.strokeLinecap && style.strokeLinecap !== 'butt') {
    opts.push(`line cap=${style.strokeLinecap}`);
  }
  if (style.strokeLinejoin && style.strokeLinejoin !== 'miter') {
    opts.push(`line join=${style.strokeLinejoin}`);
  }

  return { cmd, opts };
}

function optsStr(opts) {
  return opts.length > 0 ? `[${opts.join(', ')}]` : '';
}

// ── Coordinate formatting ───────────────────────────────────────────────────

function fmt(val, ctx) {
  return parseFloat(val.toFixed(ctx.precision));
}

const CM_TO_PT = 28.4528; // TeX points: 1cm = 28.4528pt (1pt = 1/72.27in)

// Format a dimension in pt (for line width, rounded corners, dash patterns)
function dimPt(svgUnits, ctx) {
  return `${fmt(svgUnits * ctx.scale * CM_TO_PT, ctx)}pt`;
}

function coord(x, y, ctx, transform) {
  const [tx, ty] = applyTransform(transform, x, y);
  const sx = (tx - ctx.viewBox.x) * ctx.scale;
  const sy = (ctx.viewBox.y + ctx.viewBox.h - ty) * ctx.scale;
  return `(${fmt(sx, ctx)},${fmt(sy, ctx)})`;
}

// ── Emit helpers ────────────────────────────────────────────────────────────

function emit(ctx, line) {
  const indent = '  '.repeat(ctx.indent);
  ctx.lines.push(indent + line);
}

// ── Element processing ──────────────────────────────────────────────────────

function processElement(el, ctx, parentTransform) {
  for (const child of el.children) {
    const tag = child.tagName?.toLowerCase();
    if (!tag) continue;

    const style = getStyle(child);
    if (style.display === 'none' || style.visibility === 'hidden') continue;

    const localTransform = parseTransformAttr(child.getAttribute('transform'));
    const transform = multiplyTransforms(parentTransform, localTransform);

    switch (tag) {
      case 'g':
      case 'svg':
        processElement(child, ctx, transform);
        break;
      case 'defs':
      case 'clippath':
      case 'mask':
      case 'style':
      case 'metadata':
      case 'title':
      case 'desc':
        break;
      case 'rect':
        emitRect(child, ctx, transform, style);
        break;
      case 'circle':
        emitCircle(child, ctx, transform, style);
        break;
      case 'ellipse':
        emitEllipse(child, ctx, transform, style);
        break;
      case 'line':
        emitLine(child, ctx, transform, style);
        break;
      case 'polyline':
        emitPolyline(child, ctx, transform, style, false);
        break;
      case 'polygon':
        emitPolyline(child, ctx, transform, style, true);
        break;
      case 'path':
        emitPath(child, ctx, transform, style);
        break;
      case 'text':
        emitText(child, ctx, transform, style);
        break;
      case 'use':
        emitUse(child, ctx, transform);
        break;
      default:
        if (child.children.length > 0) {
          processElement(child, ctx, transform);
        }
    }
  }
}

// ── Shape emitters ──────────────────────────────────────────────────────────

function emitRect(el, ctx, transform, style) {
  const x = parseFloat(el.getAttribute('x')) || 0;
  const y = parseFloat(el.getAttribute('y')) || 0;
  const w = parseFloat(el.getAttribute('width')) || 0;
  const h = parseFloat(el.getAttribute('height')) || 0;
  const rx = parseFloat(el.getAttribute('rx')) || parseFloat(el.getAttribute('ry')) || 0;

  if (w === 0 || h === 0) return;

  const { cmd, opts } = buildDrawCommand(el, style, ctx);
  if (rx > 0) {
    opts.push(`rounded corners=${dimPt(rx, ctx)}`);
  }

  const c1 = coord(x, y, ctx, transform);
  const c2 = coord(x + w, y + h, ctx, transform);
  emit(ctx, `\\${cmd}${optsStr(opts)} ${c1} rectangle ${c2};`);
}

function emitCircle(el, ctx, transform, style) {
  const cx = parseFloat(el.getAttribute('cx')) || 0;
  const cy = parseFloat(el.getAttribute('cy')) || 0;
  const r = parseFloat(el.getAttribute('r')) || 0;

  if (r === 0) return;

  const { cmd, opts } = buildDrawCommand(el, style, ctx);
  const center = coord(cx, cy, ctx, transform);
  emit(ctx, `\\${cmd}${optsStr(opts)} ${center} circle[radius=${fmt(r * ctx.scale, ctx)}cm];`);
}

function emitEllipse(el, ctx, transform, style) {
  const cx = parseFloat(el.getAttribute('cx')) || 0;
  const cy = parseFloat(el.getAttribute('cy')) || 0;
  const rx = parseFloat(el.getAttribute('rx')) || 0;
  const ry = parseFloat(el.getAttribute('ry')) || 0;

  if (rx === 0 && ry === 0) return;

  const { cmd, opts } = buildDrawCommand(el, style, ctx);
  const center = coord(cx, cy, ctx, transform);
  emit(ctx, `\\${cmd}${optsStr(opts)} ${center} ellipse[x radius=${fmt(rx * ctx.scale, ctx)}cm, y radius=${fmt(ry * ctx.scale, ctx)}cm];`);
}

function emitLine(el, ctx, transform, style) {
  const x1 = parseFloat(el.getAttribute('x1')) || 0;
  const y1 = parseFloat(el.getAttribute('y1')) || 0;
  const x2 = parseFloat(el.getAttribute('x2')) || 0;
  const y2 = parseFloat(el.getAttribute('y2')) || 0;

  const { cmd, opts } = buildDrawCommand(el, style, ctx);
  const c1 = coord(x1, y1, ctx, transform);
  const c2 = coord(x2, y2, ctx, transform);
  emit(ctx, `\\${cmd}${optsStr(opts)} ${c1} -- ${c2};`);
}

function emitPolyline(el, ctx, transform, style, close) {
  const pts = el.getAttribute('points');
  if (!pts) return;
  const coords = pts.trim().split(/[\s,]+/).map(Number);
  if (coords.length < 4) return;

  const { cmd, opts } = buildDrawCommand(el, style, ctx);
  const points = [];
  for (let i = 0; i < coords.length; i += 2) {
    points.push(coord(coords[i], coords[i + 1], ctx, transform));
  }

  // Line-wrap if many points
  if (points.length > 4) {
    const indent = '  '.repeat(ctx.indent);
    const contIndent = indent + '  ';
    const lines = [`\\${cmd}${optsStr(opts)} ${points[0]}`];
    for (let i = 1; i < points.length; i++) {
      lines.push(`${contIndent}-- ${points[i]}`);
    }
    if (close) lines.push(`${contIndent}-- cycle`);
    ctx.lines.push(indent + lines[0]);
    for (let i = 1; i < lines.length - 1; i++) ctx.lines.push(lines[i]);
    ctx.lines.push(lines[lines.length - 1] + ';');
  } else {
    emit(ctx, `\\${cmd}${optsStr(opts)} ${points.join(' -- ')}${close ? ' -- cycle' : ''};`);
  }
}

function emitPath(el, ctx, transform, style) {
  const d = el.getAttribute('d');
  if (!d) return;

  const segments = parsePath(d);
  if (segments.length === 0) return;

  const { cmd, opts } = buildDrawCommand(el, style, ctx);

  // Build path operations
  const ops = []; // each op is a string like "(x,y)" or "-- (x,y)" etc.
  for (const seg of segments) {
    switch (seg.type) {
      case 'M':
        ops.push({ text: coord(seg.x, seg.y, ctx, transform), isMoveTo: true });
        break;
      case 'L':
        ops.push({ text: `-- ${coord(seg.x, seg.y, ctx, transform)}` });
        break;
      case 'C':
        ops.push({
          text: `.. controls ${coord(seg.x1, seg.y1, ctx, transform)} and ${coord(seg.x2, seg.y2, ctx, transform)}\n`
            + '  '.repeat(ctx.indent + 2) + `.. ${coord(seg.x, seg.y, ctx, transform)}`,
          isCurve: true,
        });
        break;
      case 'Z':
        ops.push({ text: '-- cycle' });
        break;
    }
  }

  if (ops.length === 0) return;

  // Format: one operation per line for readability (if path is non-trivial)
  const indent = '  '.repeat(ctx.indent);
  const contIndent = '  '.repeat(ctx.indent + 1);

  if (ops.length <= 3 && !ops.some(o => o.isCurve)) {
    // Short path: single line
    emit(ctx, `\\${cmd}${optsStr(opts)} ${ops.map(o => o.text).join(' ')};`);
  } else {
    // Multi-line path
    const firstLine = `\\${cmd}${optsStr(opts)} ${ops[0].text}`;
    ctx.lines.push(indent + firstLine);
    for (let i = 1; i < ops.length; i++) {
      const isLast = i === ops.length - 1;
      const suffix = isLast ? ';' : '';
      ctx.lines.push(contIndent + ops[i].text + suffix);
    }
    if (ops.length === 1) {
      // Edge case: single moveto, add semicolon
      ctx.lines[ctx.lines.length - 1] += ';';
    }
  }
}

function emitText(el, ctx, transform, style) {
  const x = parseFloat(el.getAttribute('x')) || 0;
  const y = parseFloat(el.getAttribute('y')) || 0;
  const text = el.textContent?.trim();
  if (!text) return;

  const opts = [];

  // CSS class styles
  for (const cn of getClassStyleNames(el, ctx)) opts.push(cn);

  // Color
  const fillHex = colorToHex(style.fill);
  if (fillHex && fillHex !== '000000') {
    const c = getTikzColor(fillHex, ctx);
    opts.push(`text=${c}`);
  }

  // Font size
  if (style.fontSize) {
    const size = parseFloat(style.fontSize);
    if (!isNaN(size)) {
      const scaledSize = size * ctx.scale;
      if (scaledSize < 0.25) opts.push('font=\\tiny');
      else if (scaledSize < 0.3) opts.push('font=\\scriptsize');
      else if (scaledSize < 0.35) opts.push('font=\\footnotesize');
      else if (scaledSize < 0.4) opts.push('font=\\small');
      else if (scaledSize > 0.6) opts.push('font=\\large');
      else if (scaledSize > 0.8) opts.push('font=\\Large');
    }
  }

  // Bold
  if (style.fontWeight === 'bold' || parseFloat(style.fontWeight) >= 700) {
    const existing = opts.findIndex(o => o.startsWith('font='));
    if (existing >= 0) {
      opts[existing] = opts[existing] + '\\bfseries';
    } else {
      opts.push('font=\\bfseries');
    }
  }

  // Anchor
  const anchor = style.textAnchor;
  if (anchor === 'middle') opts.push('anchor=base');
  else if (anchor === 'end') opts.push('anchor=base east');
  else opts.push('anchor=base west');

  const c = coord(x, y, ctx, transform);
  emit(ctx, `\\node${optsStr(opts)} at ${c} {${escapeLatex(text)}};`);
}

function emitUse(el, ctx, transform) {
  const href = el.getAttribute('href') || el.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
  if (!href || !href.startsWith('#')) return;
  const target = el.ownerDocument.getElementById(href.slice(1));
  if (!target) return;

  const x = parseFloat(el.getAttribute('x')) || 0;
  const y = parseFloat(el.getAttribute('y')) || 0;
  const localTransform = parseTransformAttr(el.getAttribute('transform'));
  const useTransform = multiplyTransforms(
    multiplyTransforms(transform, localTransform),
    [1, 0, 0, 1, x, y]
  );

  const fakeParent = { children: [target], tagName: 'g' };
  processElement(fakeParent, ctx, useTransform);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function escapeLatex(str) {
  return str
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/[&%$#_{}~^]/g, m => '\\' + m);
}
