import { parsePath } from './path-parser.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const CM_TO_PT = 28.4528;
const EPSILON = 1e-9;

const INHERITED_PROPS = new Set([
  'fill', 'fill-rule', 'stroke', 'stroke-width', 'stroke-dasharray',
  'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
  'font-family', 'font-size', 'font-style', 'font-weight',
  'text-anchor', 'dominant-baseline', 'alignment-baseline', 'visibility',
  'marker-start', 'marker-mid', 'marker-end',
]);

const CSS_COLOR_KEYWORDS = new Map([
  ['black', '000000'],
  ['silver', 'C0C0C0'],
  ['gray', '808080'],
  ['white', 'FFFFFF'],
  ['maroon', '800000'],
  ['red', 'FF0000'],
  ['purple', '800080'],
  ['fuchsia', 'FF00FF'],
  ['green', '008000'],
  ['lime', '00FF00'],
  ['olive', '808000'],
  ['yellow', 'FFFF00'],
  ['navy', '000080'],
  ['blue', '0000FF'],
  ['teal', '008080'],
  ['aqua', '00FFFF'],
  ['orange', 'FFA500'],
  ['brown', 'A52A2A'],
  ['pink', 'FFC0CB'],
  ['magenta', 'FF00FF'],
  ['cyan', '00FFFF'],
  ['darkgray', 'A9A9A9'],
  ['darkgrey', 'A9A9A9'],
  ['lightgray', 'D3D3D3'],
  ['lightgrey', 'D3D3D3'],
  ['transparent', null],
  ['none', null],
]);

const XCOLOR_COLORS = [
  ['black', 0, 0, 0], ['darkgray', 64, 64, 64], ['gray', 128, 128, 128],
  ['lightgray', 191, 191, 191], ['white', 255, 255, 255],
  ['red', 255, 0, 0], ['green', 0, 255, 0], ['blue', 0, 0, 255],
  ['cyan', 0, 255, 255], ['magenta', 255, 0, 255], ['yellow', 255, 255, 0],
  ['lime', 191, 255, 0], ['olive', 128, 128, 0], ['orange', 255, 128, 0],
  ['pink', 255, 191, 191], ['teal', 0, 128, 128], ['violet', 128, 0, 128],
  ['purple', 191, 0, 64], ['brown', 191, 128, 64],
];

const XCOLOR_EXACT = new Map();
for (const [name, r, g, b] of XCOLOR_COLORS) {
  const hex = ((r << 16) | (g << 8) | b).toString(16).toUpperCase().padStart(6, '0');
  XCOLOR_EXACT.set(hex, name);
}

export function svgToTikz(svgInput, options = {}) {
  const {
    precision = 2,
    scale = null,
    standalone = false,
  } = options;

  const svgEl = typeof svgInput === 'string' ? parseSvgElement(svgInput) : svgInput;
  if (!svgEl) throw new Error('No <svg> element found');

  const viewBox = parseViewBox(svgEl);
  const computedScale = scale ?? computeAutoScale(viewBox);

  const ctx = {
    precision,
    scale: computedScale,
    viewBox,
    colors: new Map(),
    lines: [],
    indent: 1,
    classStyles: new Map(),
    markers: new Map(),
    gradients: new Map(),
    usesArrows: false,
    tikzStyles: [],
  };

  preprocessDefs(svgEl, ctx);
  processChildren(svgEl, ctx);

  const parts = [];
  if (standalone) {
    parts.push('\\documentclass[tikz]{standalone}');
    parts.push('\\usepackage{tikz}');
    parts.push('');
    parts.push('\\begin{document}');
  }

  const picOpts = [];
  if (ctx.usesArrows) picOpts.push('>=stealth');
  parts.push(picOpts.length ? `\\begin{tikzpicture}[${picOpts.join(', ')}]` : '\\begin{tikzpicture}');

  for (const [hex, name] of ctx.colors) {
    parts.push(`  \\definecolor{${name}}{HTML}{${hex}}`);
  }

  for (const line of ctx.tikzStyles) {
    parts.push(line);
  }

  for (const line of ctx.lines) {
    parts.push(line);
  }

  parts.push('\\end{tikzpicture}');
  if (standalone) parts.push('\\end{document}');
  return parts.join('\n');
}

function parseSvgElement(svgInput) {
  if (typeof DOMParser === 'undefined') {
    throw new Error('DOMParser is not available in this environment');
  }

  const doc = new DOMParser().parseFromString(svgInput, 'image/svg+xml');
  return doc.querySelector('svg');
}

function preprocessDefs(svgEl, ctx) {
  for (const styleEl of svgEl.querySelectorAll('style')) {
    parseStyleElement(styleEl, ctx);
  }

  for (const marker of svgEl.querySelectorAll('marker')) {
    const id = marker.getAttribute('id');
    if (!id) continue;
    ctx.markers.set(id, { isArrow: detectArrowMarker(marker) });
  }

  for (const grad of svgEl.querySelectorAll('linearGradient, radialGradient')) {
    const id = grad.getAttribute('id');
    if (!id) continue;
    ctx.gradients.set(id, parseGradient(grad));
  }
}

function parseStyleElement(styleEl, ctx) {
  const text = styleEl.textContent || '';
  const ruleRe = /\.([a-zA-Z_][\w-]*)\s*\{([^}]+)\}/g;
  let match;

  while ((match = ruleRe.exec(text))) {
    const className = match[1];
    const props = parseStyleMap(match[2]);
    const tikzOpts = cssPropsToTikzOpts(props, ctx);
    ctx.classStyles.set(className, { props, tikzOpts });

    if (tikzOpts.length > 0) {
      ctx.tikzStyles.push(`  \\tikzset{${className}/.style={${tikzOpts.join(', ')}}}`);
    }
  }
}

function cssPropsToTikzOpts(props, ctx) {
  const opts = [];

  appendPaintOptions(opts, {
    fill: props.get('fill'),
    fillRule: props.get('fill-rule'),
    stroke: props.get('stroke'),
    strokeWidth: props.get('stroke-width'),
    strokeOpacity: props.get('stroke-opacity'),
    fillOpacity: props.get('fill-opacity'),
    strokeDasharray: props.get('stroke-dasharray'),
    strokeDashoffset: props.get('stroke-dashoffset'),
    strokeLinecap: props.get('stroke-linecap'),
    strokeLinejoin: props.get('stroke-linejoin'),
    strokeMiterlimit: props.get('stroke-miterlimit'),
    opacity: props.get('opacity'),
    markerStart: props.get('marker-start'),
    markerEnd: props.get('marker-end'),
  }, ctx);

  if (props.get('font-size') || props.get('font-weight') || props.get('font-style') || props.get('font-family')) {
    const fontOpt = buildFontOption({
      fontSize: props.get('font-size'),
      fontWeight: props.get('font-weight'),
      fontStyle: props.get('font-style'),
      fontFamily: props.get('font-family'),
    }, ctx);
    if (fontOpt) opts.push(fontOpt);
  }

  return opts;
}

function detectArrowMarker(marker) {
  const path = marker.querySelector('path, polygon');
  if (!path) return false;

  if (path.tagName?.toLowerCase() === 'polygon') {
    const pts = (path.getAttribute('points') || '').trim().split(/[\s,]+/).filter(Boolean);
    return pts.length >= 4 && pts.length <= 8;
  }

  const d = path.getAttribute('d') || '';
  const segments = parsePath(d);
  const nonClosed = segments.filter(seg => seg.type !== 'Z');
  return nonClosed.length >= 2 && nonClosed.length <= 5;
}

function parseGradient(gradEl) {
  const type = gradEl.tagName?.toLowerCase() === 'lineargradient' ? 'linear' : 'radial';
  const stops = [];

  for (const stop of gradEl.querySelectorAll('stop')) {
    const styleMap = parseStyleMap(stop.getAttribute('style'));
    const offset = parsePercentOrNumber(stop.getAttribute('offset')) ?? 0;
    const color = stop.getAttribute('stop-color')
      || styleMap.get('stop-color')
      || 'black';
    const opacity = parseNumeric(stop.getAttribute('stop-opacity'))
      ?? parseNumeric(styleMap.get('stop-opacity'))
      ?? 1;
    stops.push({ offset, hex: colorToHex(color), opacity });
  }

  stops.sort((a, b) => a.offset - b.offset);

  if (type === 'linear') {
    const x1 = parseNumeric(gradEl.getAttribute('x1')) ?? 0;
    const y1 = parseNumeric(gradEl.getAttribute('y1')) ?? 0;
    const x2 = parseNumeric(gradEl.getAttribute('x2')) ?? 1;
    const y2 = parseNumeric(gradEl.getAttribute('y2')) ?? 0;
    return {
      type,
      stops,
      angle: Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI,
    };
  }

  return { type, stops };
}

function identityTransform() {
  return [1, 0, 0, 1, 0, 0];
}

function isIdentityTransform(transform) {
  const matrix = getTransformMatrix(transform);
  return matrix.every((value, index) => Math.abs(value - identityTransform()[index]) < EPSILON);
}

function parseTransformAttr(str) {
  if (!str) return { matrix: identityTransform(), ops: [] };

  let matrix = identityTransform();
  const ops = [];
  const re = /(\w+)\(([^)]+)\)/g;
  let match;

  while ((match = re.exec(str))) {
    const fn = match[1];
    const args = match[2].trim().split(/[\s,]+/).map(Number);
    let op = null;
    let opMatrix = identityTransform();

    switch (fn) {
      case 'translate':
        op = { type: 'translate', tx: args[0] || 0, ty: args[1] || 0 };
        opMatrix = [1, 0, 0, 1, op.tx, op.ty];
        break;
      case 'scale':
        op = { type: 'scale', sx: args[0] ?? 1, sy: args[1] ?? args[0] ?? 1 };
        opMatrix = [op.sx, 0, 0, op.sy, 0, 0];
        break;
      case 'rotate': {
        const angle = (args[0] || 0) * Math.PI / 180;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const cx = args[1] || 0;
        const cy = args[2] || 0;
        const rotation = [cos, sin, -sin, cos, 0, 0];
        op = { type: 'rotate', angle: args[0] || 0, cx, cy };
        opMatrix = cx || cy
          ? multiplyTransforms(multiplyTransforms([1, 0, 0, 1, cx, cy], rotation), [1, 0, 0, 1, -cx, -cy])
          : rotation;
        break;
      }
      case 'skewX':
        op = { type: 'skewX', angle: args[0] || 0 };
        opMatrix = [1, 0, Math.tan((args[0] || 0) * Math.PI / 180), 1, 0, 0];
        break;
      case 'skewY':
        op = { type: 'skewY', angle: args[0] || 0 };
        opMatrix = [1, Math.tan((args[0] || 0) * Math.PI / 180), 0, 1, 0, 0];
        break;
      case 'matrix':
        if (args.length === 6 && args.every(Number.isFinite)) {
          op = { type: 'matrix', values: args };
          opMatrix = args;
        }
        break;
      default:
        break;
    }

    matrix = multiplyTransforms(matrix, opMatrix);
    if (op) ops.push(op);
  }

  return { matrix, ops };
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

function parseViewBox(svgEl) {
  const viewBox = svgEl.getAttribute('viewBox');
  if (viewBox) {
    const [x, y, w, h] = viewBox.split(/[\s,]+/).map(Number);
    return { x, y, w, h };
  }

  const width = parseNumeric(svgEl.getAttribute('width')) ?? 300;
  const height = parseNumeric(svgEl.getAttribute('height')) ?? 150;
  return { x: 0, y: 0, w: width, h: height };
}

function computeAutoScale(viewBox) {
  const maxDim = Math.max(viewBox.w, viewBox.h);
  return maxDim === 0 ? 1 : 10 / maxDim;
}

function getStyle(el, ctx) {
  const tag = el.tagName?.toLowerCase();
  const isShape = tag && !['text', 'g', 'svg', 'defs'].includes(tag);
  const defaultFill = isShape && !['line', 'polyline'].includes(tag) ? 'black' : null;

  const read = prop => resolveStyleValue(el, prop, ctx);

  return {
    fill: read('fill') ?? defaultFill,
    fillRule: read('fill-rule'),
    stroke: read('stroke') ?? (isShape ? 'none' : null),
    strokeWidth: read('stroke-width'),
    strokeOpacity: read('stroke-opacity'),
    fillOpacity: read('fill-opacity'),
    opacity: read('opacity'),
    strokeDasharray: read('stroke-dasharray'),
    strokeDashoffset: read('stroke-dashoffset'),
    strokeLinecap: read('stroke-linecap'),
    strokeLinejoin: read('stroke-linejoin'),
    strokeMiterlimit: read('stroke-miterlimit'),
    fontFamily: read('font-family'),
    fontSize: read('font-size'),
    fontStyle: read('font-style'),
    fontWeight: read('font-weight'),
    textAnchor: read('text-anchor'),
    dominantBaseline: read('dominant-baseline') ?? read('alignment-baseline'),
    baselineShift: read('baseline-shift'),
    display: read('display'),
    visibility: read('visibility'),
    markerStart: read('marker-start'),
    markerMid: read('marker-mid'),
    markerEnd: read('marker-end'),
  };
}

function resolveStyleValue(el, prop, ctx) {
  const own = getOwnStyleValue(el, prop, ctx);
  if (own != null) return own;

  const computed = getComputedStyleValue(el, prop);
  if (computed != null) return computed;

  if (INHERITED_PROPS.has(prop) && el.parentElement) {
    return resolveStyleValue(el.parentElement, prop, ctx);
  }

  return null;
}

function getOwnStyleValue(el, prop, ctx) {
  const styleMap = parseStyleMap(el.getAttribute('style'));
  if (styleMap.has(prop)) return styleMap.get(prop);

  const attr = el.getAttribute(prop);
  if (attr != null && attr !== '') return attr;

  const classValue = getClassStyleValue(el, prop, ctx);
  if (classValue != null) return classValue;
  return null;
}

function getClassStyleValue(el, prop, ctx) {
  const classAttr = el.getAttribute('class');
  if (!classAttr) return null;

  let value = null;
  for (const cls of classAttr.trim().split(/\s+/)) {
    const entry = ctx.classStyles.get(cls);
    if (!entry) continue;
    if (entry.props.has(prop)) value = entry.props.get(prop);
  }
  return value;
}

function getComputedStyleValue(el, prop) {
  const win = el.ownerDocument?.defaultView;
  if (!win?.getComputedStyle) return null;

  const computed = win.getComputedStyle(el);
  if (!computed) return null;

  const camel = prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  const value = computed.getPropertyValue?.(prop) || computed[camel];
  return value && value !== '' ? value : null;
}

function parseStyleMap(styleText) {
  const props = new Map();
  if (!styleText) return props;

  for (const decl of styleText.split(';')) {
    const colon = decl.indexOf(':');
    if (colon < 0) continue;
    const prop = decl.slice(0, colon).trim();
    const value = decl.slice(colon + 1).trim();
    if (prop && value) props.set(prop, value);
  }

  return props;
}

function parseUrlRef(str) {
  if (!str) return null;
  const match = str.match(/url\(["']?#([^"')]+)["']?\)/);
  return match ? match[1] : null;
}

function resolveMarkerRef(str) {
  return parseUrlRef(str);
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

  const angle = grad.angle || 0;
  const tikzAngle = -angle;

  if (Math.abs(angle) < 1) {
    return [`left color=${c1}`, `right color=${c2}`];
  }
  if (Math.abs(angle - 90) < 1) {
    return [`top color=${c1}`, `bottom color=${c2}`];
  }
  if (Math.abs(angle + 90) < 1 || Math.abs(angle - 270) < 1) {
    return [`bottom color=${c1}`, `top color=${c2}`];
  }
  if (Math.abs(Math.abs(angle) - 180) < 1) {
    return [`right color=${c1}`, `left color=${c2}`];
  }
  return [`left color=${c1}`, `right color=${c2}`, `shading angle=${fmt(tikzAngle, ctx)}`];
}

function buildDrawCommand(el, style, ctx) {
  const opts = [...getClassStyleNames(el, ctx)];
  const gradId = parseUrlRef(style.fill);
  const gradOpts = gradId ? getGradientOpts(gradId, ctx) : null;
  const hasGradient = !!gradOpts;

  let hasFill = false;
  let fillColor = null;
  if (hasGradient) {
    hasFill = true;
    opts.push(...gradOpts);
  } else {
    const fillHex = colorToHex(style.fill);
    hasFill = fillHex !== null && style.fill !== 'none';
    if (hasFill) fillColor = getTikzColor(fillHex, ctx);
  }

  const strokeHex = colorToHex(style.stroke);
  const hasStroke = strokeHex !== null && style.stroke !== 'none';
  const strokeColor = hasStroke ? getTikzColor(strokeHex, ctx) : null;

  let cmd = 'draw';
  if (hasGradient && hasStroke) cmd = 'shadedraw';
  else if (hasGradient) cmd = 'shade';
  else if (hasStroke) cmd = 'draw';
  else if (hasFill) cmd = 'fill';

  if (hasStroke && strokeColor && strokeColor !== 'black') {
    opts.push(strokeColor);
  }

  if (!hasGradient && hasFill) {
    if (cmd === 'fill') {
      if (fillColor && fillColor !== 'black') opts.push(fillColor);
    } else if (fillColor === 'black') {
      opts.push('fill');
    } else if (fillColor) {
      opts.push(`fill=${fillColor}`);
    }
  }

  appendStrokeAndOpacityOptions(opts, style, ctx);

  return { cmd, opts };
}

function appendPaintOptions(opts, style, ctx) {
  const fillHex = colorToHex(style.fill);
  if (fillHex) {
    const color = getTikzColor(fillHex, ctx);
    opts.push(color === 'black' ? 'fill' : `fill=${color}`);
  }

  const strokeHex = colorToHex(style.stroke);
  if (strokeHex) {
    const color = getTikzColor(strokeHex, ctx);
    opts.push(color === 'black' ? 'draw' : `draw=${color}`);
  }

  appendStrokeAndOpacityOptions(opts, style, ctx);
}

function appendStrokeAndOpacityOptions(opts, style, ctx) {
  const strokeHex = colorToHex(style.stroke);
  const hasStroke = strokeHex !== null && style.stroke !== 'none';

  if (hasStroke && style.strokeWidth != null) {
    const width = parseNumeric(style.strokeWidth) ?? 1;
    opts.push(`line width=${dimPt(width, ctx)}`);
  }

  const arrow = getArrowOpts(style, ctx);
  if (arrow) opts.push(arrow);

  const opacity = parseNumeric(style.opacity);
  if (opacity != null && opacity < 1) opts.push(`opacity=${fmt(opacity, ctx)}`);

  const fillOpacity = parseNumeric(style.fillOpacity);
  if (fillOpacity != null && fillOpacity < 1) opts.push(`fill opacity=${fmt(fillOpacity, ctx)}`);

  const strokeOpacity = parseNumeric(style.strokeOpacity);
  if (strokeOpacity != null && strokeOpacity < 1) opts.push(`draw opacity=${fmt(strokeOpacity, ctx)}`);

  if (style.fillRule === 'evenodd') opts.push('even odd rule');
  else if (style.fillRule === 'nonzero') opts.push('nonzero rule');

  const miterLimit = parseNumeric(style.strokeMiterlimit);
  if (miterLimit != null && miterLimit >= 1 && Math.abs(miterLimit - 4) > EPSILON) {
    opts.push(`miter limit=${fmt(miterLimit, ctx)}`);
  }

  const dashPattern = buildDashPattern(style, ctx);
  if (dashPattern) opts.push(`dash pattern=${dashPattern}`);

  const dashPhase = parseNumeric(style.strokeDashoffset);
  if (dashPhase != null && Math.abs(dashPhase) > EPSILON) {
    opts.push(`dash phase=${dimPt(dashPhase, ctx)}`);
  }

  const linecap = mapLinecap(style.strokeLinecap);
  if (linecap) opts.push(`line cap=${linecap}`);

  const linejoin = mapLinejoin(style.strokeLinejoin);
  if (linejoin) opts.push(`line join=${linejoin}`);
}

function buildDashPattern(style, ctx) {
  const parts = parseDashArray(style.strokeDasharray);
  if (!parts.length) return null;

  return parts.map((value, index) => `${index % 2 === 0 ? 'on' : 'off'} ${dimPt(value, ctx)}`).join(' ');
}

function parseDashArray(dasharray) {
  if (!dasharray || dasharray === 'none') return [];

  const parts = dasharray
    .replace(/,/g, ' ')
    .trim()
    .split(/\s+/)
    .map(parseNumeric)
    .filter(value => value != null && value >= 0);

  if (!parts.length) return [];
  return parts.length % 2 === 1 ? [...parts, ...parts] : parts;
}

function mapLinecap(linecap) {
  if (!linecap || linecap === 'butt') return null;
  if (linecap === 'square') return 'rect';
  return linecap;
}

function mapLinejoin(linejoin) {
  if (!linejoin || linejoin === 'miter') return null;
  return linejoin;
}

function getArrowOpts(style, ctx) {
  const startRef = resolveMarkerRef(style.markerStart);
  const endRef = resolveMarkerRef(style.markerEnd);
  const startIsArrow = startRef && ctx.markers.get(startRef)?.isArrow;
  const endIsArrow = endRef && ctx.markers.get(endRef)?.isArrow;

  if (startIsArrow && endIsArrow) {
    ctx.usesArrows = true;
    return '<->';
  }
  if (endIsArrow) {
    ctx.usesArrows = true;
    return '->';
  }
  if (startIsArrow) {
    ctx.usesArrows = true;
    return '<-';
  }
  return null;
}

function getClassStyleNames(el, ctx) {
  const classAttr = el.getAttribute('class');
  if (!classAttr) return [];

  return classAttr
    .trim()
    .split(/\s+/)
    .filter(cls => ctx.classStyles.has(cls));
}

function buildTransformScopes(transform, ctx, forNode) {
  if (!transform || isIdentityTransform(transform)) return [];

  let opts = buildAtomicTransformOptionList(transform, ctx);
  if (opts == null) opts = buildCmTransformOpts(transform, ctx);
  if (forNode && opts.length > 0) {
    opts = ['transform shape', ...opts];
  }
  return opts.length ? [opts] : [];
}

function buildAtomicTransformOptionList(transform, ctx) {
  const ops = transform?.ops ?? [];
  if (!ops.length) return [];

  const steps = [];
  for (const op of ops) {
    const opSteps = buildAtomicScopesForOp(op, ctx);
    if (opSteps == null) return null;
    steps.push(...opSteps);
  }

  return compactTransformSteps(steps);
}

function buildAtomicScopesForOp(op, ctx) {
  switch (op.type) {
    case 'translate': {
      const opts = buildShiftOpts(op.tx * ctx.scale, -op.ty * ctx.scale, ctx);
      return opts.length ? [opts] : [];
    }
    case 'rotate': {
      const angle = -(op.angle || 0);
      if (Math.abs(angle) < EPSILON) return [];
      const pivot = coord(op.cx || 0, op.cy || 0, ctx);
      return [[`rotate around={${fmt(angle, ctx)}:${pivot}}`]];
    }
    case 'scale': {
      const sx = op.sx ?? 1;
      const sy = op.sy ?? 1;
      const scaleOpts = [];
      if (Math.abs(sx - sy) < EPSILON) {
        if (Math.abs(sx - 1) < EPSILON) return [];
        scaleOpts.push(`scale=${fmt(sx, ctx)}`);
      } else {
        if (Math.abs(sx - 1) >= EPSILON) scaleOpts.push(`xscale=${fmt(sx, ctx)}`);
        if (Math.abs(sy - 1) >= EPSILON) scaleOpts.push(`yscale=${fmt(sy, ctx)}`);
        if (!scaleOpts.length) return [];
      }
      return wrapPivotedTransform(coord(0, 0, ctx), scaleOpts, ctx);
    }
    case 'skewX': {
      const factor = -Math.tan((op.angle || 0) * Math.PI / 180);
      if (Math.abs(factor) < EPSILON) return [];
      return wrapPivotedTransform(coord(0, 0, ctx), [`xslant=${fmt(factor, ctx)}`], ctx);
    }
    case 'skewY': {
      const factor = -Math.tan((op.angle || 0) * Math.PI / 180);
      if (Math.abs(factor) < EPSILON) return [];
      return wrapPivotedTransform(coord(0, 0, ctx), [`yslant=${fmt(factor, ctx)}`], ctx);
    }
    default:
      return null;
  }
}

function compactTransformSteps(steps) {
  const compacted = [];

  for (const step of steps) {
    if (!step.length) continue;

    const prev = compacted[compacted.length - 1];
    if (prev && isShiftStep(prev) && isShiftStep(step)) {
      const merged = mergeShiftSteps(prev, step);
      if (merged.length) {
        compacted[compacted.length - 1] = merged;
      } else {
        compacted.pop();
      }
      continue;
    }

    compacted.push(step);
  }

  return compacted.flat();
}

function isShiftStep(step) {
  return step.every(opt => opt.startsWith('xshift=') || opt.startsWith('yshift='));
}

function mergeShiftSteps(a, b) {
  const merged = new Map([
    ['xshift', 0],
    ['yshift', 0],
  ]);

  for (const step of [a, b]) {
    for (const opt of step) {
      const match = opt.match(/^(xshift|yshift)=(-?\d+(?:\.\d+)?)cm$/);
      if (!match) continue;
      merged.set(match[1], (merged.get(match[1]) || 0) + parseFloat(match[2]));
    }
  }

  const result = [];
  const x = merged.get('xshift') || 0;
  const y = merged.get('yshift') || 0;
  if (Math.abs(x) >= EPSILON) result.push(`xshift=${trimFloat(x)}cm`);
  if (Math.abs(y) >= EPSILON) result.push(`yshift=${trimFloat(y)}cm`);
  return result;
}

function trimFloat(value) {
  return parseFloat(value.toFixed(12));
}

function wrapPivotedTransform(pivot, transformOpts, ctx) {
  const [px, py] = parseCoordTuple(pivot);
  const startShift = buildShiftOpts(px, py, ctx);
  const endShift = buildShiftOpts(-px, -py, ctx);

  const scopes = [];
  if (startShift.length) scopes.push(startShift);
  scopes.push(transformOpts);
  if (endShift.length) scopes.push(endShift);
  return scopes;
}

function buildShiftOpts(x, y, ctx) {
  const opts = [];
  if (Math.abs(x) >= EPSILON) opts.push(`xshift=${fmt(x, ctx)}cm`);
  if (Math.abs(y) >= EPSILON) opts.push(`yshift=${fmt(y, ctx)}cm`);
  return opts;
}

function parseCoordTuple(coordText) {
  const match = coordText.match(/^\(([^,]+),([^)]+)\)$/);
  if (!match) return [0, 0];
  return [parseFloat(match[1]), parseFloat(match[2])];
}

function buildCmTransformOpts(transform, ctx) {
  const [a, b, c, d, tx, ty] = svgTransformToTikzCm(getTransformMatrix(transform), ctx);
  return [`cm={${fmt(a, ctx)},${fmt(b, ctx)},${fmt(c, ctx)},${fmt(d, ctx)},${formatPoint(tx, ty, ctx)}}`];
}

function getTransformMatrix(transform) {
  return Array.isArray(transform) ? transform : (transform?.matrix ?? identityTransform());
}

function svgTransformToTikzCm(transform, ctx) {
  const [a, b, c, d, e, f] = transform;
  const x0 = -ctx.viewBox.x * ctx.scale;
  const y0 = (ctx.viewBox.y + ctx.viewBox.h) * ctx.scale;

  const ma = a;
  const mb = -b;
  const mc = -c;
  const md = d;
  const tx = ctx.scale * e + x0 - (ma * x0 + mc * y0);
  const ty = -ctx.scale * f + y0 - (mb * x0 + md * y0);

  return [ma, mb, mc, md, tx, ty];
}

function fmt(val, ctx) {
  return parseFloat(Number(val).toFixed(ctx.precision));
}

function dimPt(svgUnits, ctx) {
  return `${fmt(svgUnits * ctx.scale * CM_TO_PT, ctx)}pt`;
}

function coord(x, y, ctx) {
  const sx = (x - ctx.viewBox.x) * ctx.scale;
  const sy = (ctx.viewBox.y + ctx.viewBox.h - y) * ctx.scale;
  return formatPoint(sx, sy, ctx);
}

function formatPoint(x, y, ctx) {
  return `(${fmt(x, ctx)},${fmt(y, ctx)})`;
}

function emit(ctx, line) {
  ctx.lines.push(`${'  '.repeat(ctx.indent)}${line}`);
}

function withScope(ctx, opts, callback) {
  if (!opts.length) {
    callback();
    return;
  }

  emit(ctx, `\\begin{scope}${optsStr(opts)}`);
  ctx.indent++;
  callback();
  ctx.indent--;
  emit(ctx, '\\end{scope}');
}

function withTransformScopes(ctx, transform, forNode, callback) {
  const scopes = buildTransformScopes(transform, ctx, forNode);
  if (!scopes.length) {
    callback();
    return;
  }

  for (const opts of scopes) {
    emit(ctx, `\\begin{scope}${optsStr(opts)}`);
    ctx.indent++;
  }

  callback();

  for (let i = scopes.length - 1; i >= 0; i--) {
    ctx.indent--;
    emit(ctx, '\\end{scope}');
  }
}

function processChildren(parent, ctx) {
  for (const child of parent.children || []) {
    const tag = child.tagName?.toLowerCase();
    if (!tag) continue;

    const style = getStyle(child, ctx);
    if (style.display === 'none' || style.visibility === 'hidden') continue;

    const transform = parseTransformAttr(child.getAttribute('transform'));

    switch (tag) {
      case 'defs':
      case 'clippath':
      case 'mask':
      case 'style':
      case 'metadata':
      case 'title':
      case 'desc':
        break;
      case 'g':
      case 'svg':
        emitGroup(child, ctx, style, transform);
        break;
      case 'rect':
        emitRect(child, ctx, style, transform);
        break;
      case 'circle':
        emitCircle(child, ctx, style, transform);
        break;
      case 'ellipse':
        emitEllipse(child, ctx, style, transform);
        break;
      case 'line':
        emitLine(child, ctx, style, transform);
        break;
      case 'polyline':
        emitPolyline(child, ctx, style, transform, false);
        break;
      case 'polygon':
        emitPolyline(child, ctx, style, transform, true);
        break;
      case 'path':
        emitPath(child, ctx, style, transform);
        break;
      case 'text':
        emitText(child, ctx, style, transform);
        break;
      case 'use':
        emitUse(child, ctx, style, transform);
        break;
      default:
        if (child.children?.length) emitGroup(child, ctx, style, transform);
    }
  }
}

function emitGroup(el, ctx, style, transform) {
  const opacity = parseNumeric(style.opacity);
  if (opacity != null && opacity < 1) {
    withScope(ctx, [`opacity=${fmt(opacity, ctx)}`, 'transparency group'], () => {
      withTransformScopes(ctx, transform, true, () => processChildren(el, ctx));
    });
    return;
  }

  withTransformScopes(ctx, transform, true, () => processChildren(el, ctx));
}

function emitRect(el, ctx, style, transform) {
  const x = parseNumeric(el.getAttribute('x')) ?? 0;
  const y = parseNumeric(el.getAttribute('y')) ?? 0;
  const w = parseNumeric(el.getAttribute('width')) ?? 0;
  const h = parseNumeric(el.getAttribute('height')) ?? 0;
  const rx = parseNumeric(el.getAttribute('rx'));
  const ry = parseNumeric(el.getAttribute('ry'));
  if (w === 0 || h === 0) return;

  const { cmd, opts } = buildDrawCommand(el, style, ctx);
  const radius = rx ?? ry;
  if (radius != null && radius > 0) opts.push(`rounded corners=${dimPt(radius, ctx)}`);

  withTransformScopes(ctx, transform, false, () => {
    emit(ctx, `\\${cmd}${optsStr(opts)} ${coord(x, y, ctx)} rectangle ${coord(x + w, y + h, ctx)};`);
  });
}

function emitCircle(el, ctx, style, transform) {
  const cx = parseNumeric(el.getAttribute('cx')) ?? 0;
  const cy = parseNumeric(el.getAttribute('cy')) ?? 0;
  const r = parseNumeric(el.getAttribute('r')) ?? 0;
  if (r === 0) return;

  const { cmd, opts } = buildDrawCommand(el, style, ctx);
  withTransformScopes(ctx, transform, false, () => {
    emit(ctx, `\\${cmd}${optsStr(opts)} ${coord(cx, cy, ctx)} circle[radius=${fmt(r * ctx.scale, ctx)}cm];`);
  });
}

function emitEllipse(el, ctx, style, transform) {
  const cx = parseNumeric(el.getAttribute('cx')) ?? 0;
  const cy = parseNumeric(el.getAttribute('cy')) ?? 0;
  const rx = parseNumeric(el.getAttribute('rx')) ?? 0;
  const ry = parseNumeric(el.getAttribute('ry')) ?? 0;
  if (rx === 0 && ry === 0) return;

  const { cmd, opts } = buildDrawCommand(el, style, ctx);
  withTransformScopes(ctx, transform, false, () => {
    emit(ctx, `\\${cmd}${optsStr(opts)} ${coord(cx, cy, ctx)} ellipse[x radius=${fmt(rx * ctx.scale, ctx)}cm, y radius=${fmt(ry * ctx.scale, ctx)}cm];`);
  });
}

function emitLine(el, ctx, style, transform) {
  const x1 = parseNumeric(el.getAttribute('x1')) ?? 0;
  const y1 = parseNumeric(el.getAttribute('y1')) ?? 0;
  const x2 = parseNumeric(el.getAttribute('x2')) ?? 0;
  const y2 = parseNumeric(el.getAttribute('y2')) ?? 0;

  const { cmd, opts } = buildDrawCommand(el, style, ctx);
  withTransformScopes(ctx, transform, false, () => {
    emit(ctx, `\\${cmd}${optsStr(opts)} ${coord(x1, y1, ctx)} -- ${coord(x2, y2, ctx)};`);
  });
}

function emitPolyline(el, ctx, style, transform, close) {
  const pointsAttr = el.getAttribute('points');
  if (!pointsAttr) return;

  const coords = pointsAttr.trim().split(/[\s,]+/).map(Number);
  if (coords.length < 4) return;

  const points = [];
  for (let i = 0; i < coords.length; i += 2) {
    points.push(coord(coords[i], coords[i + 1], ctx));
  }

  const { cmd, opts } = buildDrawCommand(el, style, ctx);
  withTransformScopes(ctx, transform, false, () => {
    if (points.length <= 4) {
      emit(ctx, `\\${cmd}${optsStr(opts)} ${points.join(' -- ')}${close ? ' -- cycle' : ''};`);
      return;
    }

    const indent = '  '.repeat(ctx.indent);
    const contIndent = `${indent}  `;
    ctx.lines.push(`${indent}\\${cmd}${optsStr(opts)} ${points[0]}`);
    for (let i = 1; i < points.length; i++) {
      ctx.lines.push(`${contIndent}-- ${points[i]}`);
    }
    ctx.lines[ctx.lines.length - 1] += close ? ' -- cycle;' : ';';
  });
}

function emitPath(el, ctx, style, transform) {
  const d = el.getAttribute('d');
  if (!d) return;

  const segments = parsePath(d);
  if (!segments.length) return;

  const { cmd, opts } = buildDrawCommand(el, style, ctx);
  const ops = [];

  for (const seg of segments) {
    switch (seg.type) {
      case 'M':
        ops.push({ text: coord(seg.x, seg.y, ctx) });
        break;
      case 'L':
        ops.push({ text: `-- ${coord(seg.x, seg.y, ctx)}` });
        break;
      case 'C':
        ops.push({
          text: `.. controls ${coord(seg.x1, seg.y1, ctx)} and ${coord(seg.x2, seg.y2, ctx)} .. ${coord(seg.x, seg.y, ctx)}`,
          isCurve: true,
        });
        break;
      case 'Z':
        ops.push({ text: '-- cycle' });
        break;
      default:
        break;
    }
  }

  if (!ops.length) return;
  withTransformScopes(ctx, transform, false, () => {
    if (ops.length <= 3 && !ops.some(op => op.isCurve)) {
      emit(ctx, `\\${cmd}${optsStr(opts)} ${ops.map(op => op.text).join(' ')};`);
      return;
    }

    const indent = '  '.repeat(ctx.indent);
    const contIndent = `${indent}  `;
    ctx.lines.push(`${indent}\\${cmd}${optsStr(opts)} ${ops[0].text}`);
    for (let i = 1; i < ops.length; i++) {
      ctx.lines.push(`${contIndent}${ops[i].text}${i === ops.length - 1 ? ';' : ''}`);
    }
  });
}

function emitText(el, ctx, style, transform) {
  const x = parseTextCoord(el, 'x') ?? 0;
  const y = parseTextCoord(el, 'y') ?? 0;
  const text = serializeText(el, ctx).trim();
  if (!text) return;

  const opts = buildTextOpts(style, ctx);
  withTransformScopes(ctx, transform, true, () => {
    emit(ctx, `\\node${optsStr(opts)} at ${coord(x, y, ctx)} {${text}};`);
  });
}

function emitUse(el, ctx, style, transform) {
  const href = el.getAttribute('href') || el.getAttributeNS(XLINK_NS, 'href');
  if (!href?.startsWith('#')) return;

  const target = el.ownerDocument.getElementById(href.slice(1));
  if (!target) return;

  const x = parseNumeric(el.getAttribute('x')) ?? 0;
  const y = parseNumeric(el.getAttribute('y')) ?? 0;
  const useTransform = combineTransforms(transform, {
    matrix: [1, 0, 0, 1, x, y],
    ops: (Math.abs(x) < EPSILON && Math.abs(y) < EPSILON) ? [] : [{ type: 'translate', tx: x, ty: y }],
  });
  const opacity = parseNumeric(style.opacity);
  const render = () => {
    withTransformScopes(ctx, useTransform, true, () => {
      if (target.tagName?.toLowerCase() === 'g') processChildren(target, ctx);
      else processChildren(wrapElement(target), ctx);
    });
  };

  if (opacity != null && opacity < 1) {
    withScope(ctx, [`opacity=${fmt(opacity, ctx)}`, 'transparency group'], render);
    return;
  }

  render();
}

function combineTransforms(a, b) {
  return {
    matrix: multiplyTransforms(getTransformMatrix(a), getTransformMatrix(b)),
    ops: [...(a?.ops ?? []), ...(b?.ops ?? [])],
  };
}

function wrapElement(el) {
  const doc = el.ownerDocument;
  const group = doc.createElementNS?.(SVG_NS, 'g') ?? doc.createElement('g');
  group.appendChild(el.cloneNode(true));
  return group;
}

function buildTextOpts(style, ctx) {
  const opts = [];
  const fillHex = colorToHex(style.fill);
  if (fillHex && fillHex !== '000000') {
    opts.push(`text=${getTikzColor(fillHex, ctx)}`);
  }

  const opacity = parseNumeric(style.opacity);
  if (opacity != null && opacity < 1) opts.push(`text opacity=${fmt(opacity, ctx)}`);

  const anchor = mapTextAnchor(style.textAnchor, style.dominantBaseline);
  if (anchor) opts.push(`anchor=${anchor}`);

  const fontOpt = buildFontOption(style, ctx);
  if (fontOpt) opts.push(fontOpt);

  return opts;
}

function buildFontOption(style, ctx) {
  const commands = [];
  const family = mapFontFamily(style.fontFamily);
  if (family) commands.push(family);

  const size = mapFontSize(style.fontSize, ctx);
  if (size) commands.push(size);

  const weight = style.fontWeight?.toLowerCase?.();
  if (weight === 'bold' || (parseNumeric(style.fontWeight) ?? 0) >= 700) {
    commands.push('\\bfseries');
  }

  if (style.fontStyle?.toLowerCase?.() === 'italic' || style.fontStyle?.toLowerCase?.() === 'oblique') {
    commands.push('\\itshape');
  }

  if (!commands.length) return null;
  return `font={${commands.join('')}}`;
}

function mapFontFamily(fontFamily) {
  if (!fontFamily) return null;
  const family = fontFamily.toLowerCase();
  if (family.includes('mono') || family.includes('courier') || family.includes('consolas') || family.includes('cascadia')) {
    return '\\ttfamily';
  }
  if (family.includes('sans') || family.includes('helvetica') || family.includes('arial') || family.includes('montserrat')) {
    return '\\sffamily';
  }
  return null;
}

function mapFontSize(fontSize, ctx) {
  const size = parseNumeric(fontSize);
  if (size == null) return null;

  const scaled = size * ctx.scale;
  if (scaled < 0.18) return '\\tiny';
  if (scaled < 0.24) return '\\scriptsize';
  if (scaled < 0.3) return '\\footnotesize';
  if (scaled < 0.4) return '\\small';
  if (scaled > 0.85) return '\\Large';
  if (scaled > 0.6) return '\\large';
  return null;
}

function mapTextAnchor(textAnchor, dominantBaseline) {
  const horizontal = textAnchor === 'middle' ? '' : textAnchor === 'end' ? ' east' : ' west';

  switch ((dominantBaseline || '').toLowerCase()) {
    case 'middle':
    case 'central':
      return `mid${horizontal}`.trim();
    case 'hanging':
    case 'text-before-edge':
      return `north${horizontal}`.trim();
    case 'text-after-edge':
    case 'ideographic':
    case 'bottom':
      return `south${horizontal}`.trim();
    default:
      return `base${horizontal}`.trim();
  }
}

function parseTextCoord(el, attr) {
  const own = el.getAttribute(attr);
  if (own) return parseNumeric(own.split(/[\s,]+/)[0]);

  const tspan = el.querySelector('tspan');
  const tspanValue = tspan?.getAttribute(attr);
  return tspanValue ? parseNumeric(tspanValue.split(/[\s,]+/)[0]) : null;
}

function serializeText(el, ctx) {
  const style = getStyle(el, ctx);
  const state = { hasText: false };
  return serializeTextNode(el, ctx, style, style, state);
}

function serializeTextNode(node, ctx, inheritedStyle, rootStyle, state) {
  if (node.nodeType === 3) {
    const text = normalizeTextChunk(node.nodeValue || '');
    if (!text) return '';
    state.hasText = true;
    return escapeLatex(text);
  }

  if (node.nodeType !== 1) return '';
  const tag = node.tagName?.toLowerCase();
  if (tag !== 'text' && tag !== 'tspan') return '';

  const style = getStyle(node, ctx);
  const hadContentBefore = state.hasText;
  let content = '';

  for (const child of node.childNodes) {
    const part = serializeTextNode(child, ctx, style, rootStyle, state);
    if (!part) continue;
    content += part;
  }

  if (!content.trim()) return '';

  if (tag === 'tspan' && shouldStartNewTextLine(node) && hadContentBefore) {
    content = `\\\\ ${content}`;
  }

  content = applyInlineTextStyles(content, style, inheritedStyle, rootStyle);
  return content;
}

function shouldStartNewTextLine(node) {
  return node.hasAttribute('x') || node.hasAttribute('y') || node.hasAttribute('dy');
}

function applyInlineTextStyles(content, style, inheritedStyle, rootStyle) {
  let result = content;
  const rootFillHex = colorToHex(rootStyle.fill);

  if (style.fontStyle !== inheritedStyle.fontStyle && (style.fontStyle === 'italic' || style.fontStyle === 'oblique')) {
    result = `\\textit{${result}}`;
  }

  const weight = parseNumeric(style.fontWeight) ?? 0;
  const inheritedWeight = parseNumeric(inheritedStyle.fontWeight) ?? 0;
  const isBold = style.fontWeight === 'bold' || weight >= 700;
  const inheritedBold = inheritedStyle.fontWeight === 'bold' || inheritedWeight >= 700;
  if (isBold && !inheritedBold) {
    result = `\\textbf{${result}}`;
  }

  const fillHex = colorToHex(style.fill);
  const inheritedFillHex = colorToHex(inheritedStyle.fill);
  const needsExplicitBlack = fillHex === '000000' && inheritedFillHex != null && inheritedFillHex !== '000000';
  if (fillHex && fillHex !== inheritedFillHex && fillHex !== rootFillHex && (fillHex !== '000000' || needsExplicitBlack)) {
    result = fillHex === '000000'
      ? `\\textcolor{black}{${result}}`
      : `\\textcolor[HTML]{${fillHex}}{${result}}`;
  }

  const baseline = (style.baselineShift || '').toLowerCase();
  if (baseline.includes('super')) result = `\\(^{${result}}\\)`;
  else if (baseline.includes('sub')) result = `\\(_{${result}}\\)`;

  return result;
}

function normalizeTextChunk(text) {
  return text.replace(/\s+/g, ' ');
}

function optsStr(opts) {
  return opts.length ? `[${opts.join(', ')}]` : '';
}

function colorToHex(colorStr) {
  if (!colorStr) return null;
  const color = colorStr.trim().toLowerCase();
  if (!color || color === 'none' || color === 'transparent') return null;

  if (CSS_COLOR_KEYWORDS.has(color)) return CSS_COLOR_KEYWORDS.get(color);

  const hexMatch = color.match(/^#([0-9a-f]{3,8})$/i);
  if (hexMatch) return normalizeHex(hexMatch[1]);

  const rgbMatch = color.match(/^rgba?\(([^)]+)\)$/i);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(',').map(part => part.trim());
    if (parts.length >= 3) {
      const rgb = parts.slice(0, 3).map(parseCssChannel);
      if (rgb.every(value => value != null)) {
        return toHex(rgb[0], rgb[1], rgb[2]);
      }
    }
  }

  const hslMatch = color.match(/^hsla?\(([^)]+)\)$/i);
  if (hslMatch) {
    const parts = hslMatch[1].split(',').map(part => part.trim());
    if (parts.length >= 3) {
      const h = parseNumeric(parts[0]) ?? 0;
      const s = parsePercentOrNumber(parts[1]);
      const l = parsePercentOrNumber(parts[2]);
      if (s != null && l != null) {
        const [r, g, b] = hslToRgb(h, s, l);
        return toHex(r, g, b);
      }
    }
  }

  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d');
    if (context) {
      context.fillStyle = colorStr;
      const normalized = context.fillStyle;
      if (normalized && normalized !== '#000000' && normalized !== 'rgba(0, 0, 0, 0)') {
        return colorToHex(normalized);
      }
      if (normalized === '#000000' && color === 'black') return '000000';
    }
  }

  return null;
}

function normalizeHex(hex) {
  if (hex.length === 3) {
    return hex.split('').map(ch => ch + ch).join('').toUpperCase();
  }
  if (hex.length === 4) {
    return hex.slice(0, 3).split('').map(ch => ch + ch).join('').toUpperCase();
  }
  if (hex.length === 6) return hex.toUpperCase();
  if (hex.length === 8) return hex.slice(0, 6).toUpperCase();
  return null;
}

function parseCssChannel(part) {
  if (part.endsWith('%')) {
    const pct = parseNumeric(part.slice(0, -1));
    return pct == null ? null : clampChannel((pct / 100) * 255);
  }

  const value = parseNumeric(part);
  return value == null ? null : clampChannel(value);
}

function clampChannel(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function hslToRgb(h, s, l) {
  const hue = ((h % 360) + 360) % 360 / 360;
  const sat = Math.max(0, Math.min(1, s));
  const light = Math.max(0, Math.min(1, l));

  if (sat === 0) {
    const gray = clampChannel(light * 255);
    return [gray, gray, gray];
  }

  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
  const p = 2 * light - q;
  const toChannel = t => {
    let value = t;
    if (value < 0) value += 1;
    if (value > 1) value -= 1;
    if (value < 1 / 6) return p + (q - p) * 6 * value;
    if (value < 1 / 2) return q;
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
    return p;
  };

  return [
    clampChannel(toChannel(hue + 1 / 3) * 255),
    clampChannel(toChannel(hue) * 255),
    clampChannel(toChannel(hue - 1 / 3) * 255),
  ];
}

function toHex(r, g, b) {
  return ((r << 16) | (g << 8) | b).toString(16).toUpperCase().padStart(6, '0');
}

function hexToRgb(hex) {
  const value = parseInt(hex, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function nearestColorName(hex) {
  const [r, g, b] = hexToRgb(hex);
  let bestName = 'gray';
  let bestDistance = Infinity;

  for (const [name, pr, pg, pb] of XCOLOR_COLORS) {
    const dr = r - pr;
    const dg = g - pg;
    const db = b - pb;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDistance) {
      bestDistance = dist;
      bestName = name;
    }
  }

  return bestName;
}

function getTikzColor(hex, ctx) {
  if (!hex) return null;
  if (XCOLOR_EXACT.has(hex)) return XCOLOR_EXACT.get(hex);
  if (ctx.colors.has(hex)) return ctx.colors.get(hex);

  const baseName = nearestColorName(hex);
  let suffix = 1;
  let name = `${baseName}${suffix}`;
  const usedNames = new Set(ctx.colors.values());
  while (usedNames.has(name)) {
    suffix += 1;
    name = `${baseName}${suffix}`;
  }

  ctx.colors.set(hex, name);
  return name;
}

function parseNumeric(value) {
  if (value == null || value === '') return null;
  const num = parseFloat(String(value));
  return Number.isFinite(num) ? num : null;
}

function parsePercentOrNumber(value) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  if (text.endsWith('%')) {
    const num = parseNumeric(text.slice(0, -1));
    return num == null ? null : num / 100;
  }
  return parseNumeric(text);
}

function escapeLatex(str) {
  return str
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/[&%$#_{}~^]/g, char => `\\${char}`);
}
