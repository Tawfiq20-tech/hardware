import type { GCodeLine, ToolpathSegment } from '../types/cnc';

/**
 * G-code parser. Extracts every motion-relevant word (X Y Z I J K R F S)
 * and preserves the original line text in `command` for downstream
 * state-machine reading (plane, WCS, G92, units, abs/rel).
 *
 * Why a single regex per word instead of part-by-part split:
 *  - some CAM outputs run words together: "G1X10Y20F500"
 *  - some prefix with N-line numbers: "N42 G1 X10"
 *  - parenthesised inline comments must be stripped before parsing
 */

export interface GCodeFile {
    lines: GCodeLine[];
    totalLines: number;
}

const WORD_RE: Record<string, RegExp> = {
    x: /(?:^|[^A-Z])X(-?\d*\.?\d+)/i,
    y: /(?:^|[^A-Z])Y(-?\d*\.?\d+)/i,
    z: /(?:^|[^A-Z])Z(-?\d*\.?\d+)/i,
    i: /(?:^|[^A-Z])I(-?\d*\.?\d+)/i,
    j: /(?:^|[^A-Z])J(-?\d*\.?\d+)/i,
    k: /(?:^|[^A-Z])K(-?\d*\.?\d+)/i,
    r: /(?:^|[^A-Z])R(-?\d*\.?\d+)/i,
    f: /(?:^|[^A-Z])F(-?\d*\.?\d+)/i,
    s: /(?:^|[^A-Z])S(-?\d*\.?\d+)/i,
};

function stripComments(raw: string): { code: string; comment?: string } {
    let s = raw;
    let comment: string | undefined;

    // Block-delete prefix "/" — caller will skip if returned code is empty
    if (s.trimStart().startsWith('/')) {
        s = s.trimStart().slice(1);
    }

    // (...) parenthesised comments — first one wins for `comment` field
    const paren = s.match(/\(([^)]*)\)/);
    if (paren) comment = paren[1].trim();
    s = s.replace(/\([^)]*\)/g, ' ');

    // ; line comment
    const semi = s.indexOf(';');
    if (semi >= 0) {
        if (!comment) comment = s.slice(semi + 1).trim();
        s = s.slice(0, semi);
    }

    // N-line numbers — strip leading N123
    s = s.replace(/^\s*N\d+\s*/i, '');

    return { code: s.trim(), comment };
}

function extractWord(code: string, key: keyof typeof WORD_RE): number | undefined {
    const m = code.match(WORD_RE[key]);
    return m ? parseFloat(m[1]) : undefined;
}

export class GCodeParser {
    parseGCode(content: string): GCodeFile {
        const rawLines = content.split(/\r?\n/);
        const out: GCodeLine[] = [];

        for (const raw of rawLines) {
            if (!raw.trim()) continue;
            const { code, comment } = stripComments(raw);
            if (!code) continue;

            const line: GCodeLine = { command: code, comment };
            line.x = extractWord(code, 'x');
            line.y = extractWord(code, 'y');
            line.z = extractWord(code, 'z');
            line.i = extractWord(code, 'i');
            line.j = extractWord(code, 'j');
            line.k = extractWord(code, 'k');
            line.r = extractWord(code, 'r');
            line.f = extractWord(code, 'f');
            line.s = extractWord(code, 's');
            out.push(line);
        }

        return { lines: out, totalLines: out.length };
    }
}

// Legacy/back-compat exports — Sidebar.tsx and SurfacingTool.tsx import these
export function parseGCode(content: string): GCodeLine[] {
    return new GCodeParser().parseGCode(content).lines;
}

// Returns ONLY the modal G-word that controls motion (G0/G1/G2/G3),
// honouring sticky motion mode is the toolpath builder's job, not ours.
export function getMotionWord(command: string): 'G0' | 'G1' | 'G2' | 'G3' | null {
    const m = command.match(/\bG0*([0123])\b/i);
    if (!m) return null;
    return (`G${m[1]}`) as 'G0' | 'G1' | 'G2' | 'G3';
}

export function isMoveCommand(command: string): boolean {
    return /\bG0*[0-3]\b/i.test(command);
}

export function isRapidMove(command: string): boolean {
    return /\bG0*0\b/i.test(command);
}

export function getCommandType(command: string): string | null {
    const match = command.match(/\b(G\d+)\b/i);
    return match ? match[1].toUpperCase() : null;
}

// Re-export for callers that previously imported ToolpathSegment from here
export type { ToolpathSegment };
