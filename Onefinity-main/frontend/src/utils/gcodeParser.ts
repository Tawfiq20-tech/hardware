import type { GCodeLine, ToolpathSegment } from '../types/cnc';

/**
 * Enhanced G-code parser with visualization support
 */
export interface GCodeFile {
    lines: GCodeLine[];
    totalLines: number;
    bounds: {
        minX: number;
        maxX: number;
        minY: number;
        maxY: number;
        minZ: number;
        maxZ: number;
    };
    segments: ToolpathSegment[];
}

export class GCodeParser {
    private currentX = 0;
    private currentY = 0;
    private currentZ = 0;
    private absoluteMode = true;
    private units: 'mm' | 'inches' = 'mm'; // Track G20 (inches) vs G21 (mm)

    parseGCode(content: string): GCodeFile {
        const lines = content.split('\n');
        const parsedLines: GCodeLine[] = [];
        const segments: ToolpathSegment[] = [];
        
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;
        let layer = 0;

        console.log('[GCodeParser] Starting parse. Total lines:', lines.length);
        let sampleCount = 0;

        lines.forEach((line) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) return;

            const parsed = this.parseLine(trimmed);
            if (parsed) {
                parsedLines.push(parsed);

                // Create toolpath segment for moves
                if (this.isMoveCommand(parsed.command)) {
                    const x = parsed.x ?? this.currentX;
                    const y = parsed.y ?? this.currentY;
                    const z = parsed.z ?? this.currentZ;
                    
                    const segment: ToolpathSegment = {
                        start: { x: this.currentX, y: this.currentY, z: this.currentZ },
                        end: { x, y, z },
                        rapid: this.isRapidMove(parsed.command),
                        layer
                    };
                    
                    // Sample logging for first few segments
                    if (sampleCount < 5) {
                        console.log('[GCodeParser] Segment', sampleCount, ':', segment, 'from line:', trimmed);
                        sampleCount++;
                    }
                    
                    segments.push(segment);

                    // Update bounds
                    minX = Math.min(minX, x, this.currentX);
                    maxX = Math.max(maxX, x, this.currentX);
                    minY = Math.min(minY, y, this.currentY);
                    maxY = Math.max(maxY, y, this.currentY);
                    minZ = Math.min(minZ, z, this.currentZ);
                    maxZ = Math.max(maxZ, z, this.currentZ);

                    this.currentX = x;
                    this.currentY = y;
                    this.currentZ = z;
                }

                // Track layer changes (simplified)
                if (parsed.command.includes('G0') && parsed.z !== undefined) {
                    layer++;
                }
            }
        });

        // Convert inches to mm if needed (standard CNC units are mm)
        const unitMultiplier = this.units === 'inches' ? 25.4 : 1.0;
        if (unitMultiplier !== 1.0) {
            console.log('[GCodeParser] Converting from inches to mm (multiplier:', unitMultiplier, ')');
            segments.forEach(seg => {
                seg.start.x *= unitMultiplier;
                seg.start.y *= unitMultiplier;
                seg.start.z = (seg.start.z ?? 0) * unitMultiplier;
                seg.end.x *= unitMultiplier;
                seg.end.y *= unitMultiplier;
                seg.end.z = (seg.end.z ?? 0) * unitMultiplier;
            });
            minX *= unitMultiplier;
            maxX *= unitMultiplier;
            minY *= unitMultiplier;
            maxY *= unitMultiplier;
            minZ *= unitMultiplier;
            maxZ *= unitMultiplier;
        }

        console.log('[GCodeParser] Parse complete. Segments:', segments.length, 'Units:', this.units);
        console.log('[GCodeParser] Bounds:', { minX, maxX, minY, maxY, minZ, maxZ });

        return {
            lines: parsedLines,
            totalLines: parsedLines.length,
            bounds: {
                minX: minX === Infinity ? 0 : minX,
                maxX: maxX === -Infinity ? 0 : maxX,
                minY: minY === Infinity ? 0 : minY,
                maxY: maxY === -Infinity ? 0 : maxY,
                minZ: minZ === Infinity ? 0 : minZ,
                maxZ: maxZ === -Infinity ? 0 : maxZ,
            },
            segments
        };
    }

    private parseLine(line: string): GCodeLine | null {
        // Remove comments
        const commentMatch = line.match(/;(.*)/);
        const comment = commentMatch ? commentMatch[1].trim() : undefined;
        const code = line.split(';')[0].trim();

        if (!code) return null;

        const parsedLine: GCodeLine = {
            command: code,
            comment,
        };

        // Parse parameters
        const parts = code.split(/\s+/);
        parts.slice(1).forEach(part => {
            const match = part.match(/^([XYZEF])(-?\d*\.?\d+)$/);
            if (match) {
                const [, axis, value] = match;
                const numValue = parseFloat(value);
                
                switch (axis) {
                    case 'X':
                        parsedLine.x = this.absoluteMode ? numValue : this.currentX + numValue;
                        break;
                    case 'Y':
                        parsedLine.y = this.absoluteMode ? numValue : this.currentY + numValue;
                        break;
                    case 'Z':
                        parsedLine.z = this.absoluteMode ? numValue : this.currentZ + numValue;
                        break;
                    case 'F':
                        parsedLine.f = numValue;
                        break;
                }
            }
        });

        // Handle G90/G91 (absolute/relative mode)
        if (code === 'G90') this.absoluteMode = true;
        if (code === 'G91') this.absoluteMode = false;
        
        // Handle G20/G21 (inches/mm)
        if (code === 'G20' || code.includes('G20')) this.units = 'inches';
        if (code === 'G21' || code.includes('G21')) this.units = 'mm';

        return parsedLine;
    }

    private isMoveCommand(command: string): boolean {
        return /\b(G0|G00|G1|G01)\b/i.test(command);
    }

    private isRapidMove(command: string): boolean {
        return /\b(G0|G00)\b/i.test(command);
    }

    getToolpathVertices(segments: ToolpathSegment[]): Float32Array {
        const vertices: number[] = [];

        segments.forEach(segment => {
            // Map G-code coordinates to XY plane on the bed
            // X stays X, Y becomes Z (depth), and Z (height) becomes Y (up)
            vertices.push(
                segment.start.x, segment.start.z || 0, segment.start.y,  // X, height, Y
                segment.end.x, segment.end.z || 0, segment.end.y          // X, height, Y
            );
        });

        return new Float32Array(vertices);
    }

    getToolpathColors(segments: ToolpathSegment[]): Float32Array {
        const colors: number[] = [];
        // Light blue/cyan for cutting (high contrast on dark background, like reference)
        const cutR = 0.35, cutG = 0.85, cutB = 1.0;
        const rapidR = 0.5, rapidG = 0.65, rapidB = 0.75;

        segments.forEach(segment => {
            if (segment.rapid) {
                colors.push(rapidR, rapidG, rapidB, rapidR, rapidG, rapidB);
            } else {
                colors.push(cutR, cutG, cutB, cutR, cutG, cutB);
            }
        });

        return new Float32Array(colors);
    }
}

// Legacy functions for backward compatibility
export function parseGCode(content: string): GCodeLine[] {
    const parser = new GCodeParser();
    return parser.parseGCode(content).lines;
}

export function isMoveCommand(command: string): boolean {
    return /\b(G0|G00|G1|G01)\b/i.test(command);
}

export function isRapidMove(command: string): boolean {
    return /\b(G0|G00)\b/i.test(command);
}

export function getCommandType(command: string): string | null {
    const match = command.match(/\b(G\d+)\b/i);
    return match ? match[1].toUpperCase() : null;
}
