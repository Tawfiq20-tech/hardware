import type { ArcPlane, GCodeLine, ToolpathSegment } from '../types/cnc';
import { getMotionWord } from './gcodeParser';

/**
 * Build toolpath segments from parsed G-code lines.
 *
 * Modal state tracked per spec (RS-274/NIST):
 *   - units (G20 in / G21 mm) — internally normalised to mm
 *   - distance mode (G90 abs / G91 rel)
 *   - arc distance mode (G90.1 abs centre / G91.1 rel centre, default rel)
 *   - plane select (G17 XY / G18 ZX / G19 YZ)
 *   - work coordinate system (G54-G59) — offsets default 0 unless set via G10 L2 P# X..Y..Z..
 *   - sticky motion mode (G0/G1/G2/G3) — so "X10 Y10" after a G1 still moves in G1
 *   - G92 origin offset — additive shift so visualisation stays continuous
 *
 * Arcs (G2/G3) are tessellated into line segments with chord error < 0.05 mm.
 * Helical Z is linearly interpolated along the arc parameter.
 */

const ARC_CHORD_ERROR_MM = 0.05;
const ARC_MIN_SEGMENTS = 8;
const ARC_MAX_SEGMENTS = 256;

interface Vec3 { x: number; y: number; z: number; }

function arcSegmentCount(radius: number, sweepRad: number): number {
    const r = Math.max(radius, 0.01);
    // chord error c = r * (1 - cos(theta/2)) where theta = sweep / N
    // solve for N: theta = 2 * acos(1 - c/r)
    const maxStep = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - ARC_CHORD_ERROR_MM / r)));
    const n = Math.ceil(Math.abs(sweepRad) / Math.max(maxStep, 1e-4));
    return Math.max(ARC_MIN_SEGMENTS, Math.min(ARC_MAX_SEGMENTS, n));
}

// Tessellate an arc in the active plane. Returns intermediate end-points
// (start point is NOT included; first segment's start comes from `current`).
function tessellateArc(
    start: Vec3,
    end: Vec3,
    centre: { a: number; b: number },  // a,b are the two in-plane axes
    radius: number,
    clockwise: boolean,
    plane: ArcPlane,
): Vec3[] {
    // Pick the two in-plane coordinate accessors
    const pick = (p: Vec3): { a: number; b: number; c: number } => {
        if (plane === 'XY') return { a: p.x, b: p.y, c: p.z };
        if (plane === 'ZX') return { a: p.z, b: p.x, c: p.y };
        return { a: p.y, b: p.z, c: p.x }; // YZ
    };
    const assemble = (a: number, b: number, c: number): Vec3 => {
        if (plane === 'XY') return { x: a, y: b, z: c };
        if (plane === 'ZX') return { x: b, y: c, z: a };
        return { x: c, y: a, z: b }; // YZ
    };

    const s = pick(start);
    const e = pick(end);

    const startAngle = Math.atan2(s.b - centre.b, s.a - centre.a);
    let endAngle = Math.atan2(e.b - centre.b, e.a - centre.a);

    // Compute sweep with correct direction
    let sweep: number;
    if (clockwise) {
        // CW (G2) → angle decreases
        sweep = endAngle - startAngle;
        if (sweep >= -1e-9) sweep -= 2 * Math.PI;
        // Full-circle case: start == end coords
        if (Math.abs(start.x - end.x) < 1e-6 && Math.abs(start.y - end.y) < 1e-6 && Math.abs(start.z - end.z) < 1e-6) {
            sweep = -2 * Math.PI;
        }
    } else {
        // CCW (G3) → angle increases
        sweep = endAngle - startAngle;
        if (sweep <= 1e-9) sweep += 2 * Math.PI;
        if (Math.abs(start.x - end.x) < 1e-6 && Math.abs(start.y - end.y) < 1e-6 && Math.abs(start.z - end.z) < 1e-6) {
            sweep = 2 * Math.PI;
        }
    }

    const n = arcSegmentCount(radius, sweep);
    const points: Vec3[] = [];
    for (let i = 1; i <= n; i++) {
        const t = i / n;
        const theta = startAngle + sweep * t;
        const a = centre.a + radius * Math.cos(theta);
        const b = centre.b + radius * Math.sin(theta);
        const c = s.c + (e.c - s.c) * t;  // helical Z (or whichever is the out-of-plane axis)
        points.push(assemble(a, b, c));
    }
    // Ensure the last point exactly matches the requested end (avoid float drift)
    points[points.length - 1] = { ...end };
    return points;
}

// Compute arc centre from R-form. Returns null if invalid (chord > 2R).
function centreFromR(
    start: Vec3, end: Vec3, r: number, clockwise: boolean, plane: ArcPlane,
): { a: number; b: number } | null {
    const pick = (p: Vec3) => {
        if (plane === 'XY') return { a: p.x, b: p.y };
        if (plane === 'ZX') return { a: p.z, b: p.x };
        return { a: p.y, b: p.z };
    };
    const s = pick(start);
    const e = pick(end);
    const dx = e.a - s.a;
    const dy = e.b - s.b;
    const d = Math.hypot(dx, dy);
    if (d < 1e-9) return null;
    const absR = Math.abs(r);
    if (d > 2 * absR + 1e-6) return null;

    const h = Math.sqrt(Math.max(0, absR * absR - (d / 2) * (d / 2)));
    const mid = { a: (s.a + e.a) / 2, b: (s.b + e.b) / 2 };
    // Perpendicular unit vector to (dx, dy) — two choices ±
    const nx = -dy / d;
    const ny = dx / d;

    // Per RS-274: R>0 = short arc, R<0 = long arc.
    // For CW + R>0: centre on RIGHT of motion → use -perpendicular
    // For CCW + R>0: centre on LEFT of motion → use +perpendicular
    // R<0 flips which side (long arc means centre on opposite side).
    const longArc = r < 0;
    let sign: number;
    if (clockwise) sign = longArc ? +1 : -1;
    else sign = longArc ? -1 : +1;

    return { a: mid.a + sign * h * nx, b: mid.b + sign * h * ny };
}

export function buildToolpathSegments(lines: GCodeLine[]): ToolpathSegment[] {
    const segments: ToolpathSegment[] = [];

    let unitScale = 1;            // G20=25.4, G21=1
    let absolute = true;          // G90 abs / G91 rel for X Y Z
    let absoluteArcCentre = false; // G90.1 / G91.1 — G91.1 (rel I/J/K) is the common default
    let plane: ArcPlane = 'XY';
    let motionMode: 'G0' | 'G1' | 'G2' | 'G3' = 'G0';

    // G54-G59 WCS offsets, all zero until G10 L2 P# X.. Y.. Z.. is seen
    const wcsOffsets: Array<Vec3> = Array.from({ length: 6 }, () => ({ x: 0, y: 0, z: 0 }));
    let activeWcs = 0; // index into wcsOffsets, default G54

    // G92 additive offset — applied to all subsequent positions to keep visualisation continuous
    const g92Offset: Vec3 = { x: 0, y: 0, z: 0 };

    const current: Vec3 = { x: 0, y: 0, z: 0 };
    let currentLayer = 0;
    let lastZ = 0;

    // Apply WCS + G92 to a raw G-code coordinate so the segment ends up in
    // a single continuous frame for visualisation.
    const toFrame = (raw: Vec3): Vec3 => {
        const wcs = wcsOffsets[activeWcs];
        return {
            x: raw.x + wcs.x + g92Offset.x,
            y: raw.y + wcs.y + g92Offset.y,
            z: raw.z + wcs.z + g92Offset.z,
        };
    };

    for (const line of lines) {
        const cmd = line.command.toUpperCase();

        // Modal switches (these may appear on a line WITH a motion command too)
        if (/\bG20\b/.test(cmd)) unitScale = 25.4;
        if (/\bG21\b/.test(cmd)) unitScale = 1;
        if (/\bG90\.1\b/.test(cmd)) absoluteArcCentre = true;
        else if (/\bG91\.1\b/.test(cmd)) absoluteArcCentre = false;
        if (/\bG90\b/.test(cmd) && !/\bG90\.1\b/.test(cmd)) absolute = true;
        if (/\bG91\b/.test(cmd) && !/\bG91\.1\b/.test(cmd)) absolute = false;
        if (/\bG17\b/.test(cmd)) plane = 'XY';
        if (/\bG18\b/.test(cmd)) plane = 'ZX';
        if (/\bG19\b/.test(cmd)) plane = 'YZ';
        const wcsMatch = cmd.match(/\bG5([4-9])\b/);
        if (wcsMatch) activeWcs = parseInt(wcsMatch[1], 10) - 4;

        // G10 L2 P# X.. Y.. Z.. — set WCS offset for system P (P1=G54 ... P6=G59)
        if (/\bG10\b/.test(cmd) && /\bL2\b/.test(cmd)) {
            const pMatch = cmd.match(/\bP(\d+)\b/);
            const p = pMatch ? parseInt(pMatch[1], 10) - 1 : -1;
            if (p >= 0 && p < wcsOffsets.length) {
                if (line.x !== undefined) wcsOffsets[p].x = line.x * unitScale;
                if (line.y !== undefined) wcsOffsets[p].y = line.y * unitScale;
                if (line.z !== undefined) wcsOffsets[p].z = line.z * unitScale;
            }
            continue;
        }

        // G92 — set current position to specified values (in work coords).
        // We don't move the machine; we shift the visualisation frame so
        // (raw X10) after G92 X10 maps to wherever we are right now.
        if (/\bG92\b/.test(cmd) && !/\bG92\.1\b/.test(cmd)) {
            if (line.x !== undefined) {
                const targetWork = line.x * unitScale + wcsOffsets[activeWcs].x;
                g92Offset.x = current.x - targetWork;
            }
            if (line.y !== undefined) {
                const targetWork = line.y * unitScale + wcsOffsets[activeWcs].y;
                g92Offset.y = current.y - targetWork;
            }
            if (line.z !== undefined) {
                const targetWork = line.z * unitScale + wcsOffsets[activeWcs].z;
                g92Offset.z = current.z - targetWork;
            }
            continue;
        }
        // G92.1 — clear G92 offsets
        if (/\bG92\.1\b/.test(cmd)) {
            g92Offset.x = 0; g92Offset.y = 0; g92Offset.z = 0;
            continue;
        }

        // Update sticky motion mode if this line names one
        const motion = getMotionWord(cmd);
        if (motion) motionMode = motion;

        // Is this line actually a motion? Either it has an explicit motion word,
        // OR it has axis words and a sticky motion mode is active.
        const hasAxisWords = (line.x !== undefined || line.y !== undefined || line.z !== undefined);
        if (!motion && !hasAxisWords) continue;
        if (!hasAxisWords && (motionMode === 'G2' || motionMode === 'G3')) continue; // arc needs axes

        // Compute requested end position in the visualisation frame
        const rawX = (line.x !== undefined ? line.x : 0) * unitScale;
        const rawY = (line.y !== undefined ? line.y : 0) * unitScale;
        const rawZ = (line.z !== undefined ? line.z : 0) * unitScale;

        let endPos: Vec3;
        if (absolute) {
            // Absent axis → keep current value (already in frame)
            const framed = toFrame({ x: rawX, y: rawY, z: rawZ });
            endPos = {
                x: line.x !== undefined ? framed.x : current.x,
                y: line.y !== undefined ? framed.y : current.y,
                z: line.z !== undefined ? framed.z : current.z,
            };
        } else {
            // Relative: just add the delta (offsets cancel out)
            endPos = {
                x: current.x + (line.x !== undefined ? rawX : 0),
                y: current.y + (line.y !== undefined ? rawY : 0),
                z: current.z + (line.z !== undefined ? rawZ : 0),
            };
        }

        const startPos: Vec3 = { ...current };

        if (motionMode === 'G2' || motionMode === 'G3') {
            const clockwise = motionMode === 'G2';

            // Determine in-plane axes & centre offsets
            // G17 (XY): I=X-offset, J=Y-offset
            // G18 (ZX): I=X-offset, K=Z-offset → but in our (Z,X) coord pair, a=Z(K), b=X(I)
            // G19 (YZ): J=Y-offset, K=Z-offset → a=Y(J), b=Z(K)
            const ijk = {
                i: (line.i ?? 0) * unitScale,
                j: (line.j ?? 0) * unitScale,
                k: (line.k ?? 0) * unitScale,
            };

            let centre: { a: number; b: number } | null = null;
            let radius = 0;

            if (line.r !== undefined) {
                centre = centreFromR(startPos, endPos, line.r * unitScale, clockwise, plane);
                radius = Math.abs(line.r * unitScale);
            } else if (line.i !== undefined || line.j !== undefined || line.k !== undefined) {
                // I/J/K give the centre. Default mode is INCREMENTAL from current pos.
                // G90.1 makes them absolute.
                const sa = plane === 'XY' ? startPos.x : plane === 'ZX' ? startPos.z : startPos.y;
                const sb = plane === 'XY' ? startPos.y : plane === 'ZX' ? startPos.x : startPos.z;
                const offA = plane === 'XY' ? ijk.i : plane === 'ZX' ? ijk.k : ijk.j;
                const offB = plane === 'XY' ? ijk.j : plane === 'ZX' ? ijk.i : ijk.k;
                if (absoluteArcCentre) {
                    centre = { a: offA, b: offB };
                } else {
                    centre = { a: sa + offA, b: sb + offB };
                }
                const sa2 = sa - centre.a;
                const sb2 = sb - centre.b;
                radius = Math.hypot(sa2, sb2);
            }

            if (centre && radius > 1e-6) {
                const arcPoints = tessellateArc(startPos, endPos, centre, radius, clockwise, plane);
                let prev = startPos;
                for (const p of arcPoints) {
                    segments.push({
                        start: { ...prev },
                        end: { ...p },
                        rapid: false,
                        layer: currentLayer,
                    });
                    prev = p;
                }
                current.x = endPos.x; current.y = endPos.y; current.z = endPos.z;
                continue;
            }
            // Fallback if arc data missing/invalid → treat as straight line
        }

        // Linear motion (G0/G1, or arc fallback)
        const rapid = motionMode === 'G0';
        if (current.x !== endPos.x || current.y !== endPos.y || current.z !== endPos.z) {
            segments.push({
                start: { ...current },
                end: { ...endPos },
                rapid,
                layer: currentLayer,
            });
        }
        if (line.z !== undefined && endPos.z !== lastZ) {
            currentLayer += 1;
            lastZ = endPos.z;
        }
        current.x = endPos.x; current.y = endPos.y; current.z = endPos.z;
    }

    return segments;
}

/**
 * Calculate bounding box from toolpath segments.
 */
export function calculateBoundingBox(segments: ToolpathSegment[]) {
    if (segments.length === 0) {
        return {
            min: { x: 0, y: 0, z: 0 },
            max: { x: 0, y: 0, z: 0 },
            center: { x: 0, y: 0, z: 0 },
            size: { x: 0, y: 0, z: 0 },
        };
    }

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (const segment of segments) {
        minX = Math.min(minX, segment.start.x, segment.end.x);
        minY = Math.min(minY, segment.start.y, segment.end.y);
        minZ = Math.min(minZ, segment.start.z, segment.end.z);
        maxX = Math.max(maxX, segment.start.x, segment.end.x);
        maxY = Math.max(maxY, segment.start.y, segment.end.y);
        maxZ = Math.max(maxZ, segment.start.z, segment.end.z);
    }

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const centerZ = (minZ + maxZ) / 2;

    return {
        min: { x: minX, y: minY, z: minZ },
        max: { x: maxX, y: maxY, z: maxZ },
        center: { x: centerX, y: centerY, z: centerZ },
        size: { x: maxX - minX, y: maxY - minY, z: maxZ - minZ },
    };
}
