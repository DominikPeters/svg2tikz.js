// SVG path `d` attribute parser
// Tokenizes, parses, and normalizes to absolute coordinates
const COMMANDS = new Set('MmLlHhVvCcSsQqTtAaZz');
function tokenize(d) {
    const tokens = [];
    let i = 0;
    while (i < d.length) {
        const ch = d[i];
        if (ch === ' ' || ch === ',' || ch === '\t' || ch === '\n' || ch === '\r') {
            i++;
        }
        else if (COMMANDS.has(ch)) {
            tokens.push({ type: 'command', value: ch });
            i++;
        }
        else if (ch === '-' || ch === '+' || ch === '.' || (ch >= '0' && ch <= '9')) {
            let num = '';
            if (ch === '-' || ch === '+') {
                num += ch;
                i++;
            }
            let hasDot = false;
            while (i < d.length) {
                const c = d[i];
                if (c >= '0' && c <= '9') {
                    num += c;
                    i++;
                }
                else if (c === '.' && !hasDot) {
                    hasDot = true;
                    num += c;
                    i++;
                }
                else if (c === 'e' || c === 'E') {
                    num += c;
                    i++;
                    if (i < d.length && (d[i] === '+' || d[i] === '-')) {
                        num += d[i];
                        i++;
                    }
                }
                else
                    break;
            }
            tokens.push({ type: 'number', value: parseFloat(num) });
        }
        else {
            i++; // skip unknown
        }
    }
    return tokens;
}
function consumeNumbers(tokens, pos, count) {
    const nums = [];
    for (let i = 0; i < count && pos.i < tokens.length; i++) {
        if (tokens[pos.i].type !== 'number')
            break;
        nums.push(tokens[pos.i].value);
        pos.i++;
    }
    return nums;
}
// Argument counts per command (uppercase)
const ARG_COUNTS = {
    M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0
};
// Parse and normalize all path segments to absolute coordinates
export function parsePath(d) {
    if (!d)
        return [];
    const tokens = tokenize(d);
    const segments = [];
    let cx = 0, cy = 0; // current point
    let sx = 0, sy = 0; // subpath start
    let lastCmd = '';
    let lastCx2 = 0, lastCy2 = 0; // last control point for S/T reflection
    const pos = { i: 0 };
    while (pos.i < tokens.length) {
        let cmd;
        if (tokens[pos.i].type === 'command') {
            cmd = tokens[pos.i].value;
            pos.i++;
        }
        else {
            // implicit repeat: L after M, same command otherwise
            cmd = lastCmd === 'M' ? 'L' : lastCmd === 'm' ? 'l' : lastCmd;
        }
        const upperCmd = cmd.toUpperCase();
        const relative = cmd !== upperCmd;
        const argCount = ARG_COUNTS[upperCmd];
        if (upperCmd === 'Z') {
            segments.push({ type: 'Z' });
            cx = sx;
            cy = sy;
            lastCmd = cmd;
            lastCx2 = cx;
            lastCy2 = cy;
            continue;
        }
        const args = consumeNumbers(tokens, pos, argCount);
        if (args.length < argCount)
            break;
        const rx = relative ? cx : 0;
        const ry = relative ? cy : 0;
        switch (upperCmd) {
            case 'M': {
                const x = args[0] + rx, y = args[1] + ry;
                segments.push({ type: 'M', x, y });
                cx = x;
                cy = y;
                sx = x;
                sy = y;
                lastCx2 = cx;
                lastCy2 = cy;
                break;
            }
            case 'L': {
                const x = args[0] + rx, y = args[1] + ry;
                segments.push({ type: 'L', x, y });
                cx = x;
                cy = y;
                lastCx2 = cx;
                lastCy2 = cy;
                break;
            }
            case 'H': {
                const x = args[0] + rx;
                segments.push({ type: 'L', x, y: cy });
                cx = x;
                lastCx2 = cx;
                lastCy2 = cy;
                break;
            }
            case 'V': {
                const y = args[0] + ry;
                segments.push({ type: 'L', x: cx, y });
                cy = y;
                lastCx2 = cx;
                lastCy2 = cy;
                break;
            }
            case 'C': {
                const x1 = args[0] + rx, y1 = args[1] + ry;
                const x2 = args[2] + rx, y2 = args[3] + ry;
                const x = args[4] + rx, y = args[5] + ry;
                segments.push({ type: 'C', x1, y1, x2, y2, x, y });
                lastCx2 = x2;
                lastCy2 = y2;
                cx = x;
                cy = y;
                break;
            }
            case 'S': {
                // Reflected control point
                const x1 = (lastCmd === 'C' || lastCmd === 'c' || lastCmd === 'S' || lastCmd === 's')
                    ? 2 * cx - lastCx2 : cx;
                const y1 = (lastCmd === 'C' || lastCmd === 'c' || lastCmd === 'S' || lastCmd === 's')
                    ? 2 * cy - lastCy2 : cy;
                const x2 = args[0] + rx, y2 = args[1] + ry;
                const x = args[2] + rx, y = args[3] + ry;
                segments.push({ type: 'C', x1, y1, x2, y2, x, y });
                lastCx2 = x2;
                lastCy2 = y2;
                cx = x;
                cy = y;
                break;
            }
            case 'Q': {
                const qx = args[0] + rx, qy = args[1] + ry;
                const x = args[2] + rx, y = args[3] + ry;
                // Convert quadratic to cubic: CP1 = P0 + 2/3*(QP-P0), CP2 = P + 2/3*(QP-P)
                const x1 = cx + 2 / 3 * (qx - cx), y1 = cy + 2 / 3 * (qy - cy);
                const x2 = x + 2 / 3 * (qx - x), y2 = y + 2 / 3 * (qy - y);
                segments.push({ type: 'C', x1, y1, x2, y2, x, y });
                lastCx2 = qx;
                lastCy2 = qy; // store quadratic control for T
                cx = x;
                cy = y;
                break;
            }
            case 'T': {
                const qx = (lastCmd === 'Q' || lastCmd === 'q' || lastCmd === 'T' || lastCmd === 't')
                    ? 2 * cx - lastCx2 : cx;
                const qy = (lastCmd === 'Q' || lastCmd === 'q' || lastCmd === 'T' || lastCmd === 't')
                    ? 2 * cy - lastCy2 : cy;
                const x = args[0] + rx, y = args[1] + ry;
                const x1 = cx + 2 / 3 * (qx - cx), y1 = cy + 2 / 3 * (qy - cy);
                const x2 = x + 2 / 3 * (qx - x), y2 = y + 2 / 3 * (qy - y);
                segments.push({ type: 'C', x1, y1, x2, y2, x, y });
                lastCx2 = qx;
                lastCy2 = qy;
                cx = x;
                cy = y;
                break;
            }
            case 'A': {
                const arcRx = args[0], arcRy = args[1];
                const xRot = args[2];
                const largeArc = args[3];
                const sweep = args[4];
                const x = args[5] + rx, y = args[6] + ry;
                // Convert arc to cubic bezier approximations
                const cubics = arcToCubics(cx, cy, x, y, arcRx, arcRy, xRot, largeArc, sweep);
                for (const c of cubics) {
                    segments.push({ type: 'C', x1: c[0], y1: c[1], x2: c[2], y2: c[3], x: c[4], y: c[5] });
                }
                lastCx2 = cx;
                lastCy2 = cy;
                cx = x;
                cy = y;
                break;
            }
        }
        lastCmd = cmd;
        // Handle implicit repeated commands (multiple coordinate sets)
        while (pos.i < tokens.length && tokens[pos.i].type === 'number') {
            const repeatArgs = consumeNumbers(tokens, pos, argCount);
            if (repeatArgs.length < argCount)
                break;
            const rrx = relative ? cx : 0;
            const rry = relative ? cy : 0;
            switch (upperCmd) {
                case 'M': // repeated M becomes L
                case 'L': {
                    const x = repeatArgs[0] + rrx, y = repeatArgs[1] + rry;
                    segments.push({ type: 'L', x, y });
                    cx = x;
                    cy = y;
                    if (upperCmd === 'M') {
                        sx = x;
                        sy = y;
                    }
                    lastCx2 = cx;
                    lastCy2 = cy;
                    break;
                }
                case 'H': {
                    const x = repeatArgs[0] + rrx;
                    segments.push({ type: 'L', x, y: cy });
                    cx = x;
                    lastCx2 = cx;
                    lastCy2 = cy;
                    break;
                }
                case 'V': {
                    const y = repeatArgs[0] + rry;
                    segments.push({ type: 'L', x: cx, y });
                    cy = y;
                    lastCx2 = cx;
                    lastCy2 = cy;
                    break;
                }
                case 'C': {
                    const x1 = repeatArgs[0] + rrx, y1 = repeatArgs[1] + rry;
                    const x2 = repeatArgs[2] + rrx, y2 = repeatArgs[3] + rry;
                    const x = repeatArgs[4] + rrx, y = repeatArgs[5] + rry;
                    segments.push({ type: 'C', x1, y1, x2, y2, x, y });
                    lastCx2 = x2;
                    lastCy2 = y2;
                    cx = x;
                    cy = y;
                    break;
                }
                case 'S': {
                    const rx1 = (lastCmd === 'C' || lastCmd === 'c' || lastCmd === 'S' || lastCmd === 's')
                        ? 2 * cx - lastCx2 : cx;
                    const ry1 = (lastCmd === 'C' || lastCmd === 'c' || lastCmd === 'S' || lastCmd === 's')
                        ? 2 * cy - lastCy2 : cy;
                    const x2 = repeatArgs[0] + rrx, y2 = repeatArgs[1] + rry;
                    const x = repeatArgs[2] + rrx, y = repeatArgs[3] + rry;
                    segments.push({ type: 'C', x1: rx1, y1: ry1, x2, y2, x, y });
                    lastCx2 = x2;
                    lastCy2 = y2;
                    cx = x;
                    cy = y;
                    break;
                }
                case 'Q': {
                    const qx = repeatArgs[0] + rrx, qy = repeatArgs[1] + rry;
                    const x = repeatArgs[2] + rrx, y = repeatArgs[3] + rry;
                    const x1 = cx + 2 / 3 * (qx - cx), y1 = cy + 2 / 3 * (qy - cy);
                    const x2 = x + 2 / 3 * (qx - x), y2 = y + 2 / 3 * (qy - y);
                    segments.push({ type: 'C', x1, y1, x2, y2, x, y });
                    lastCx2 = qx;
                    lastCy2 = qy;
                    cx = x;
                    cy = y;
                    break;
                }
                case 'T': {
                    const qx = (lastCmd === 'Q' || lastCmd === 'q' || lastCmd === 'T' || lastCmd === 't')
                        ? 2 * cx - lastCx2 : cx;
                    const qy = (lastCmd === 'Q' || lastCmd === 'q' || lastCmd === 'T' || lastCmd === 't')
                        ? 2 * cy - lastCy2 : cy;
                    const x = repeatArgs[0] + rrx, y = repeatArgs[1] + rry;
                    const x1 = cx + 2 / 3 * (qx - cx), y1 = cy + 2 / 3 * (qy - cy);
                    const x2 = x + 2 / 3 * (qx - x), y2 = y + 2 / 3 * (qy - y);
                    segments.push({ type: 'C', x1, y1, x2, y2, x, y });
                    lastCx2 = qx;
                    lastCy2 = qy;
                    cx = x;
                    cy = y;
                    break;
                }
                case 'A': {
                    const arcRx = repeatArgs[0], arcRy = repeatArgs[1];
                    const xRot = repeatArgs[2], largeArc = repeatArgs[3], sweep = repeatArgs[4];
                    const x = repeatArgs[5] + rrx, y = repeatArgs[6] + rry;
                    const cubics = arcToCubics(cx, cy, x, y, arcRx, arcRy, xRot, largeArc, sweep);
                    for (const c of cubics) {
                        segments.push({ type: 'C', x1: c[0], y1: c[1], x2: c[2], y2: c[3], x: c[4], y: c[5] });
                    }
                    cx = x;
                    cy = y;
                    lastCx2 = cx;
                    lastCy2 = cy;
                    break;
                }
            }
            lastCmd = cmd;
        }
    }
    return segments;
}
// Convert SVG endpoint arc to cubic bezier curves
// Returns array of [x1, y1, x2, y2, x, y] (cubic control points)
function arcToCubics(x1, y1, x2, y2, rx, ry, xRotDeg, largeArcFlag, sweepFlag) {
    if (rx === 0 || ry === 0)
        return [[x1, y1, x2, y2, x2, y2]]; // degenerate
    const phi = xRotDeg * Math.PI / 180;
    const cosPhi = Math.cos(phi), sinPhi = Math.sin(phi);
    // Step 1: Transform to unit circle space
    const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
    const x1p = cosPhi * dx + sinPhi * dy;
    const y1p = -sinPhi * dx + cosPhi * dy;
    // Correct radii
    rx = Math.abs(rx);
    ry = Math.abs(ry);
    let lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lambda > 1) {
        const sqrtLambda = Math.sqrt(lambda);
        rx *= sqrtLambda;
        ry *= sqrtLambda;
    }
    // Step 2: Compute center
    const rxSq = rx * rx, rySq = ry * ry;
    const x1pSq = x1p * x1p, y1pSq = y1p * y1p;
    let sq = (rxSq * rySq - rxSq * y1pSq - rySq * x1pSq) / (rxSq * y1pSq + rySq * x1pSq);
    if (sq < 0)
        sq = 0;
    let coef = Math.sqrt(sq);
    if (largeArcFlag === sweepFlag)
        coef = -coef;
    const cxp = coef * rx * y1p / ry;
    const cyp = -coef * ry * x1p / rx;
    const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
    const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;
    // Step 3: Compute angles
    function angle(ux, uy, vx, vy) {
        const dot = ux * vx + uy * vy;
        const len = Math.sqrt(ux * ux + uy * uy) * Math.sqrt(vx * vx + vy * vy);
        let a = Math.acos(Math.max(-1, Math.min(1, dot / len)));
        if (ux * vy - uy * vx < 0)
            a = -a;
        return a;
    }
    const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let dTheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!sweepFlag && dTheta > 0)
        dTheta -= 2 * Math.PI;
    if (sweepFlag && dTheta < 0)
        dTheta += 2 * Math.PI;
    // Step 4: Split into 90-degree segments and approximate with cubics
    const numSegs = Math.ceil(Math.abs(dTheta) / (Math.PI / 2));
    const segAngle = dTheta / numSegs;
    const results = [];
    for (let i = 0; i < numSegs; i++) {
        const a1 = theta1 + i * segAngle;
        const a2 = theta1 + (i + 1) * segAngle;
        const alpha = 4 * Math.tan((a2 - a1) / 4) / 3;
        const cos1 = Math.cos(a1), sin1 = Math.sin(a1);
        const cos2 = Math.cos(a2), sin2 = Math.sin(a2);
        // Control points on unit circle, then scale by rx/ry
        const ep1x = rx * cos1, ep1y = ry * sin1;
        const ep2x = rx * cos2, ep2y = ry * sin2;
        const cp1x = ep1x - alpha * rx * sin1, cp1y = ep1y + alpha * ry * cos1;
        const cp2x = ep2x + alpha * rx * sin2, cp2y = ep2y - alpha * ry * cos2;
        // Rotate back
        results.push([
            cosPhi * cp1x - sinPhi * cp1y + cx,
            sinPhi * cp1x + cosPhi * cp1y + cy,
            cosPhi * cp2x - sinPhi * cp2y + cx,
            sinPhi * cp2x + cosPhi * cp2y + cy,
            cosPhi * ep2x - sinPhi * ep2y + cx,
            sinPhi * ep2x + cosPhi * ep2y + cy,
        ]);
    }
    return results;
}
//# sourceMappingURL=path-parser.js.map