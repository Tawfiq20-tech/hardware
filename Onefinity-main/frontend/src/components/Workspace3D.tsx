import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
    Image, Grid3x3, Lock, Target, ZoomIn, ZoomOut, Upload,
    RotateCcw, Eye
} from 'lucide-react';
import type { ViewPreset } from '../types/cnc';
import { useCNCStore } from '../stores/cncStore';
import JobControlBar from './JobControlBar';
import './Workspace3D.css';

export default function Workspace3D() {
    const mountRef = useRef<HTMLDivElement>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const controlsRef = useRef<OrbitControls | null>(null);
    const bedRef = useRef<THREE.Mesh | null>(null);
    const gridRef = useRef<THREE.Group | null>(null);
    const toolpathRef = useRef<THREE.LineSegments | null>(null);
    const axisOverlayRef = useRef<THREE.Group | null>(null);
    const guideLinesRef = useRef<THREE.LineSegments | null>(null);

    const [showGrid, setShowGrid] = useState(true);
    const [isLocked, setIsLocked] = useState(false);
    const [showLabels, setShowLabels] = useState(true);
    const [showViewPresets, setShowViewPresets] = useState(false);

    const { 
        viewPreset, setViewPreset,
        gcode, toolpathSegments, fileInfo, currentLine 
    } = useCNCStore();


    // ── View Presets: 7 camera angles with smooth 320ms transitions ──
    const VIEW_PRESET_LABELS: Record<ViewPreset, string> = {
        iso: 'ISO', top: 'Top', front: 'Front', right: 'Right',
        bottom: 'Bottom', left: 'Left', back: 'Back',
    };

    const getPresetCamera = useCallback((preset: ViewPreset, dist: number, target: THREE.Vector3) => {
        const d = dist || 150;
        switch (preset) {
            case 'iso':    return new THREE.Vector3(target.x + d * 0.4, target.y + d * 0.7, target.z + d * 0.4);
            case 'top':    return new THREE.Vector3(target.x, target.y + d, target.z);
            case 'front':  return new THREE.Vector3(target.x, target.y, target.z + d);
            case 'right':  return new THREE.Vector3(target.x + d, target.y, target.z);
            case 'bottom': return new THREE.Vector3(target.x, target.y - d, target.z);
            case 'left':   return new THREE.Vector3(target.x - d, target.y, target.z);
            case 'back':   return new THREE.Vector3(target.x, target.y, target.z - d);
            default:       return new THREE.Vector3(target.x + d * 0.4, target.y + d * 0.7, target.z + d * 0.4);
        }
    }, []);

    const animateCameraTo = useCallback((targetPos: THREE.Vector3, duration = 320) => {
        const camera = cameraRef.current;
        const controls = controlsRef.current;
        if (!camera || !controls) return;

        const startPos = camera.position.clone();
        const startTime = performance.now();

        const animate = (now: number) => {
            const elapsed = now - startTime;
            const t = Math.min(elapsed / duration, 1);
            const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

            camera.position.lerpVectors(startPos, targetPos, ease);
            controls.update();

            if (t < 1) requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
    }, []);

    const handleViewPreset = useCallback((preset: ViewPreset) => {
        setViewPreset(preset);
        setShowViewPresets(false);

        const camera = cameraRef.current;
        const controls = controlsRef.current;
        if (!camera || !controls) return;

        const target = controls.target.clone();
        const dist = camera.position.distanceTo(target);
        const newPos = getPresetCamera(preset, dist, target);
        animateCameraTo(newPos);
    }, [setViewPreset, getPresetCamera, animateCameraTo]);

    const handleCycleView = useCallback(() => {
        const presets: ViewPreset[] = ['iso', 'top', 'front', 'right', 'bottom', 'left', 'back'];
        const idx = presets.indexOf(viewPreset);
        const next = presets[(idx + 1) % presets.length];
        handleViewPreset(next);
    }, [viewPreset, handleViewPreset]);

    // Initialize 3D scene
    useEffect(() => {
        if (!mountRef.current) return;

        const scene = new THREE.Scene();
        scene.background = new THREE.Color('#1a1a1a');
        sceneRef.current = scene;

        const camera = new THREE.PerspectiveCamera(
            75,
            mountRef.current.clientWidth / mountRef.current.clientHeight,
            0.1,
            5000
        );
        camera.position.set(80, 120, 80);
        camera.lookAt(0, 0, 0);
        cameraRef.current = camera;

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        mountRef.current.appendChild(renderer.domElement);
        rendererRef.current = renderer;

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.maxPolarAngle = Math.PI / 2.2;
        controls.minDistance = 5;
        controls.maxDistance = 2000;
        controlsRef.current = controls;

        // Lighting – strong enough for solid shaded geometry
        const ambientLight = new THREE.AmbientLight(0x4477aa, 0.5);
        scene.add(ambientLight);

        const keyLight = new THREE.DirectionalLight(0xffffff, 0.8);
        keyLight.position.set(150, 200, 100);
        keyLight.castShadow = true;
        keyLight.shadow.camera.left = -300;
        keyLight.shadow.camera.right = 300;
        keyLight.shadow.camera.top = 300;
        keyLight.shadow.camera.bottom = -300;
        scene.add(keyLight);

        const fillLight = new THREE.DirectionalLight(0x6699cc, 0.35);
        fillLight.position.set(-100, 80, -80);
        scene.add(fillLight);

        const rimLight = new THREE.DirectionalLight(0x88bbff, 0.25);
        rimLight.position.set(0, 50, -150);
        scene.add(rimLight);

        // Create bed surface – subtle dark plane below the toolpath
        const bedSize = 600;
        const bedGeometry = new THREE.PlaneGeometry(bedSize, bedSize);
        const bedMaterial = new THREE.MeshStandardMaterial({
            color: '#0f1a2a',
            roughness: 0.95,
            metalness: 0.05,
            side: THREE.DoubleSide,
        });
        const bed = new THREE.Mesh(bedGeometry, bedMaterial);
        bed.rotation.x = -Math.PI / 2;
        bed.position.y = -0.5;
        bed.receiveShadow = true;
        bedRef.current = bed;
        scene.add(bed);

        // Grid – subtle lines matching the dark navy background
        const createBedGrid = () => {
            const gridGroup = new THREE.Group();
            const half = bedSize / 2;
            
            const majorGridMaterial = new THREE.LineBasicMaterial({ 
                color: 0x1a2d45, 
                transparent: true, 
                opacity: 0.7 
            });
            const minorGridMaterial = new THREE.LineBasicMaterial({ 
                color: 0x142338, 
                transparent: true, 
                opacity: 0.4 
            });

            for (let i = -half; i <= half; i += 5) {
                const isMajor = i % 10 === 0;
                const material = isMajor ? majorGridMaterial : minorGridMaterial;
                
                const xGeometry = new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3(-half, -0.4, i),
                    new THREE.Vector3(half, -0.4, i)
                ]);
                gridGroup.add(new THREE.Line(xGeometry, material));
                
                const zGeometry = new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3(i, -0.4, -half),
                    new THREE.Vector3(i, -0.4, half)
                ]);
                gridGroup.add(new THREE.Line(zGeometry, material));
            }
            
            return gridGroup;
        };

        const bedGrid = createBedGrid();
        gridRef.current = bedGrid;
        if (showGrid) {
            scene.add(bedGrid);
        }

        // Axis overlay (XY on bed plane => X is world X, Y is world Z)
        const createAxisOverlay = () => {
            const group = new THREE.Group();

            const axisLength = 160;
            const tickStep = 10;  // Labels every 10 units
            const tickSizeMinor = 1.2;
            const tickSizeMajor = 2.4;

            const makeTextSprite = (text: string, position: THREE.Vector3, color: string) => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                if (!ctx) return null;

                canvas.width = 256;
                canvas.height = 128;

                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.font = 'Bold 44px Arial';
                ctx.fillStyle = color;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
                ctx.shadowBlur = 6;
                ctx.shadowOffsetX = 2;
                ctx.shadowOffsetY = 2;
                ctx.fillText(text, canvas.width / 2, canvas.height / 2);

                const texture = new THREE.CanvasTexture(canvas);
                texture.anisotropy = 4;
                const material = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0.9 });
                const sprite = new THREE.Sprite(material);
                sprite.position.copy(position);
                sprite.scale.set(10, 5, 1);
                return sprite;
            };

            // Dashed X axis (red)
            const xAxisGeom = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(-axisLength, 1.05, 0),
                new THREE.Vector3(axisLength, 1.05, 0),
            ]);
            const xAxisMat = new THREE.LineDashedMaterial({
                color: 0xff4040,
                dashSize: 4,
                gapSize: 3,
                transparent: true,
                opacity: 0.9,
            });
            const xAxis = new THREE.Line(xAxisGeom, xAxisMat);
            xAxis.computeLineDistances();
            group.add(xAxis);

            // Dashed Y axis on bed plane (green) => world Z
            const yAxisGeom = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(0, 1.05, -axisLength),
                new THREE.Vector3(0, 1.05, axisLength),
            ]);
            const yAxisMat = new THREE.LineDashedMaterial({
                color: 0x34d399,
                dashSize: 4,
                gapSize: 3,
                transparent: true,
                opacity: 0.9,
            });
            const yAxis = new THREE.Line(yAxisGeom, yAxisMat);
            yAxis.computeLineDistances();
            group.add(yAxis);

            // Ticks + numeric labels (every 10 units)
            const ticks: THREE.Vector3[] = [];
            for (let v = -axisLength; v <= axisLength; v += tickStep) {
                const isLabeled = v % 10 === 0;  // Label at 0, ±10, ±20, ±30, ...
                const t = isLabeled ? tickSizeMajor : tickSizeMinor;

                // X ticks (perpendicular along Z)
                ticks.push(new THREE.Vector3(v, 1.05, -t), new THREE.Vector3(v, 1.05, t));
                // Y ticks (perpendicular along X)
                ticks.push(new THREE.Vector3(-t, 1.05, v), new THREE.Vector3(t, 1.05, v));

                if (isLabeled && v !== 0) {
                    const xLabel = makeTextSprite(`${v}`, new THREE.Vector3(v, 1.2, 6), '#ff4040');
                    if (xLabel) group.add(xLabel);

                    const yLabel = makeTextSprite(`${v}`, new THREE.Vector3(6, 1.2, v), '#34d399');
                    if (yLabel) group.add(yLabel);
                }
            }

            const tickGeom = new THREE.BufferGeometry().setFromPoints(ticks);
            const tickMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 });
            const tickLines = new THREE.LineSegments(tickGeom, tickMat);
            group.add(tickLines);

            // Axis letters near origin (match screenshot feel)
            const zLabel = makeTextSprite('Z', new THREE.Vector3(-8, 1.2, -8), 'rgba(255,255,255,0.65)');
            if (zLabel) group.add(zLabel);

            return group;
        };

        const axisOverlay = createAxisOverlay();
        axisOverlayRef.current = axisOverlay;
        scene.add(axisOverlay);

        // Small origin crosshair (no obstructive text)
        const originSize = 2;
        const originMat = new THREE.LineBasicMaterial({ color: 0x555555, transparent: true, opacity: 0.5 });
        const oX = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-originSize, 0.05, 0), new THREE.Vector3(originSize, 0.05, 0)]);
        const oZ = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.05, -originSize), new THREE.Vector3(0, 0.05, originSize)]);
        scene.add(new THREE.Line(oX, originMat));
        scene.add(new THREE.Line(oZ, originMat));

        // Animation loop
        const animate = () => {
            requestAnimationFrame(animate);
            
            if (controlsRef.current && !isLocked) {
                controlsRef.current.update();
            }
            
            if (rendererRef.current && sceneRef.current && cameraRef.current) {
                rendererRef.current.render(sceneRef.current, cameraRef.current);
            }
        };
        
        animate();

        // Handle window resize
        const handleResize = () => {
            if (!mountRef.current || !cameraRef.current || !rendererRef.current) return;
            
            const width = mountRef.current.clientWidth;
            const height = mountRef.current.clientHeight;
            
            cameraRef.current.aspect = width / height;
            cameraRef.current.updateProjectionMatrix();
            rendererRef.current.setSize(width, height);
        };
        
        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            if (mountRef.current && renderer.domElement) {
                mountRef.current.removeChild(renderer.domElement);
            }
            renderer.dispose();
        };
    }, []);

    // Update grid visibility
    useEffect(() => {
        if (gridRef.current && sceneRef.current) {
            if (showGrid) {
                sceneRef.current.add(gridRef.current);
            } else {
                sceneRef.current.remove(gridRef.current);
            }
        }
    }, [showGrid]);

    // Update G-code visualization
    useEffect(() => {
        if (toolpathSegments.length > 0 && sceneRef.current) {
            // Remove existing toolpath
            if (toolpathRef.current) {
                const obj = toolpathRef.current as any;
                sceneRef.current.remove(obj);
                // Handle Group (meshes) vs LineSegments
                if (obj.geometry) {
                    obj.geometry.dispose();
                    if (obj.material?.dispose) obj.material.dispose();
                } else if (obj.children?.length > 0) {
                    obj.traverse((child: any) => {
                        if (child.geometry) child.geometry.dispose();
                        if (child.material) {
                            if (Array.isArray(child.material)) child.material.forEach((m: any) => m.dispose?.());
                            else child.material.dispose?.();
                        }
                    });
                }
                toolpathRef.current = null;
            }

            // Remove existing guide line
            if (guideLinesRef.current) {
                sceneRef.current.remove(guideLinesRef.current);
                guideLinesRef.current.geometry.dispose();
                if (guideLinesRef.current.material instanceof THREE.Material) {
                    guideLinesRef.current.material.dispose();
                }
                guideLinesRef.current = null;
            }

            const cutSegments = toolpathSegments.filter(s => !s.rapid);
            const toolpathGroup = new THREE.Group();

            // ── Compute cut-only bounds ──
            let bMinX = Infinity, bMaxX = -Infinity;
            let bMinY = Infinity, bMaxY = -Infinity;
            let bMinZ = Infinity, bMaxZ = -Infinity;
            cutSegments.forEach(s => {
                bMinX = Math.min(bMinX, s.start.x, s.end.x);
                bMaxX = Math.max(bMaxX, s.start.x, s.end.x);
                bMinY = Math.min(bMinY, s.start.y, s.end.y);
                bMaxY = Math.max(bMaxY, s.start.y, s.end.y);
                bMinZ = Math.min(bMinZ, s.start.z, s.end.z);
                bMaxZ = Math.max(bMaxZ, s.start.z, s.end.z);
            });
            if (!isFinite(bMinX)) { bMinX = 0; bMaxX = 10; bMinY = 0; bMaxY = 10; bMinZ = 0; bMaxZ = 0; }

            const spanX = bMaxX - bMinX;
            const spanY = bMaxY - bMinY;
            const maxSpan = Math.max(spanX, spanY, 1);

            // ── Tube radius – thinner for cleaner appearance ──
            const tubeRadius = maxSpan * 0.002;

            // Solid shaded material for the cut toolpath (like the reference)
            const tubeMat = new THREE.MeshStandardMaterial({
                color: 0x3399cc,
                roughness: 0.35,
                metalness: 0.15,
                side: THREE.DoubleSide,
            });

            // Build tube segments – group consecutive moves into polylines for smooth tubes
            const buildTubes = () => {
                const chains: THREE.Vector3[][] = [];
                let currentChain: THREE.Vector3[] = [];

                // Tolerance for continuity: if segments are closer than 0.1% of design span, they're continuous
                const continuityTol = maxSpan * 0.001;

                cutSegments.forEach((seg) => {
                    const startPt = new THREE.Vector3(seg.start.x, seg.start.z, -seg.start.y);
                    const endPt = new THREE.Vector3(seg.end.x, seg.end.z, -seg.end.y);

                    if (currentChain.length === 0) {
                        currentChain.push(startPt, endPt);
                    } else {
                        const lastPt = currentChain[currentChain.length - 1];
                        if (lastPt.distanceTo(startPt) < continuityTol) {
                            // Continuous – extend the chain
                            currentChain.push(endPt);
                        } else {
                            // Discontinuity – save current chain, start new
                            if (currentChain.length >= 2) chains.push(currentChain);
                            currentChain = [startPt, endPt];
                        }
                    }
                });
                if (currentChain.length >= 2) chains.push(currentChain);

                chains.forEach(pts => {
                    if (pts.length < 2) return;

                    // For chains with only 2 points, use a cylinder
                    if (pts.length === 2) {
                        const dir = new THREE.Vector3().subVectors(pts[1], pts[0]);
                        const len = dir.length();
                        if (len < 0.001) return;
                        const cyl = new THREE.CylinderGeometry(tubeRadius, tubeRadius, len, 6, 1);
                        const mesh = new THREE.Mesh(cyl, tubeMat);
                        mesh.position.copy(pts[0]).add(dir.clone().multiplyScalar(0.5));
                        mesh.quaternion.setFromUnitVectors(
                            new THREE.Vector3(0, 1, 0),
                            dir.clone().normalize()
                        );
                        toolpathGroup.add(mesh);
                        return;
                    }

                    // For longer chains, use TubeGeometry with a CatmullRomCurve3
                    try {
                        const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.1);
                        const tubeSegs = Math.max(pts.length * 3, 12);
                        const tubeGeom = new THREE.TubeGeometry(curve, tubeSegs, tubeRadius, 6, false);
                        toolpathGroup.add(new THREE.Mesh(tubeGeom, tubeMat));
                    } catch {
                        // Fallback: individual cylinders
                        for (let j = 0; j < pts.length - 1; j++) {
                            const dir = new THREE.Vector3().subVectors(pts[j + 1], pts[j]);
                            const len = dir.length();
                            if (len < 0.001) continue;
                            const cyl = new THREE.CylinderGeometry(tubeRadius, tubeRadius, len, 6, 1);
                            const mesh = new THREE.Mesh(cyl, tubeMat);
                            mesh.position.copy(pts[j]).add(dir.clone().multiplyScalar(0.5));
                            mesh.quaternion.setFromUnitVectors(
                                new THREE.Vector3(0, 1, 0),
                                dir.clone().normalize()
                            );
                            toolpathGroup.add(mesh);
                        }
                    }
                });
            };

            buildTubes();

            // Add rapid (travel) segments to show the complete path
            const rapidSegments = toolpathSegments.filter(s => s.rapid);
            if (rapidSegments.length > 0) {
                const rapidPoints: THREE.Vector3[] = [];
                rapidSegments.forEach(seg => {
                    rapidPoints.push(
                        new THREE.Vector3(seg.start.x, seg.start.z, -seg.start.y),
                        new THREE.Vector3(seg.end.x, seg.end.z, -seg.end.y)
                    );
                });
                const rapidGeom = new THREE.BufferGeometry().setFromPoints(rapidPoints);
                const rapidMat = new THREE.LineDashedMaterial({
                    color: 0x34d399,
                    dashSize: 2,
                    gapSize: 4,
                    transparent: true,
                    opacity: 0.45,
                });
                const rapidLines = new THREE.LineSegments(rapidGeom, rapidMat);
                rapidLines.computeLineDistances();
                toolpathGroup.add(rapidLines);
            }

            if (toolpathGroup.children.length > 0) {
                toolpathRef.current = toolpathGroup as any;
                sceneRef.current.add(toolpathGroup);

                // Center and scale camera on the G-code bounds for XY plane
                if (cameraRef.current && controlsRef.current) {
                    const cy = 0;
                    // Ensure the view includes origin AND design (so origin guide lines are visible)
                    const minX = Math.min(bMinX, 0);
                    const maxX = Math.max(bMaxX, 0);
                    const minZ = Math.min(-bMaxY, 0);
                    const maxZ = Math.max(-bMinY, 0);

                    const span = Math.max(maxX - minX, maxZ - minZ, 1);

                    // Distance so design appears at good size (~50% of viewport)
                    const fov = cameraRef.current.fov * (Math.PI / 180);
                    const dist = (span / (2 * Math.tan(fov / 2))) * 2.0;

                    const cx = (minX + maxX) / 2;
                    const cz = (minZ + maxZ) / 2;
                    controlsRef.current.target.set(cx, cy, cz);
                    cameraRef.current.position.set(
                        cx + dist * 0.4,
                        cy + dist * 0.7,
                        cz + dist * 0.4
                    );
                    controlsRef.current.update();
                }
            }
        }
    }, [toolpathSegments]);


    const handleResetView = () => {
        if (cameraRef.current && controlsRef.current) {
            cameraRef.current.position.set(80, 120, 80);
            cameraRef.current.lookAt(0, 0, 0);
            controlsRef.current.target.set(0, 0, 0);
            controlsRef.current.update();
        }
    };

    const handleZoomIn = () => {
        if (cameraRef.current && controlsRef.current) {
            const distance = cameraRef.current.position.distanceTo(controlsRef.current.target);
            const newDistance = Math.max(5, distance * 0.8);
            const direction = cameraRef.current.position.clone().sub(controlsRef.current.target).normalize();
            cameraRef.current.position.copy(controlsRef.current.target).add(direction.multiplyScalar(newDistance));
            controlsRef.current.update();
        }
    };

    const handleZoomOut = () => {
        if (cameraRef.current && controlsRef.current) {
            const distance = cameraRef.current.position.distanceTo(controlsRef.current.target);
            const newDistance = Math.min(2000, distance * 1.2);
            const direction = cameraRef.current.position.clone().sub(controlsRef.current.target).normalize();
            cameraRef.current.position.copy(controlsRef.current.target).add(direction.multiplyScalar(newDistance));
            controlsRef.current.update();
        }
    };

    return (
        <div className="workspace-3d">
            <div 
                className="workspace-viewport"
                ref={mountRef}
            >


                {/* No file message */}
                {gcode.length === 0 && (
                    <div className="no-file-message">
                        <Upload size={48} />
                        <span>Load G-code from FILE MANAGEMENT sidebar</span>
                    </div>
                )}
                
                {/* Top-right control panel */}
                <div className="workspace-controls">
                    <button 
                        className="control-btn"
                        onClick={() => setShowLabels(!showLabels)}
                        title="Toggle Labels"
                    >
                        <Image size={16} />
                    </button>
                    <button 
                        className={`control-btn ${showGrid ? 'active' : ''}`}
                        onClick={() => setShowGrid(!showGrid)}
                        title="Toggle Grid"
                    >
                        <Grid3x3 size={16} />
                    </button>
                    <button 
                        className={`control-btn ${isLocked ? 'active' : ''}`}
                        onClick={() => setIsLocked(!isLocked)}
                        title="Lock Camera"
                    >
                        <Lock size={16} />
                    </button>
                    <button 
                        className="control-btn"
                        onClick={handleResetView}
                        title="Reset View"
                    >
                        <Target size={16} />
                    </button>
                    <button 
                        className="control-btn"
                        onClick={handleZoomIn}
                        title="Zoom In"
                    >
                        <ZoomIn size={16} />
                    </button>
                    <button 
                        className="control-btn"
                        onClick={handleZoomOut}
                        title="Zoom Out"
                    >
                        <ZoomOut size={16} />
                    </button>
                    <div className="control-divider" />
                    <button
                        className="control-btn"
                        onClick={handleCycleView}
                        title={`Cycle View (${VIEW_PRESET_LABELS[viewPreset]})`}
                    >
                        <RotateCcw size={16} />
                    </button>
                    <button
                        className={`control-btn ${showViewPresets ? 'active' : ''}`}
                        onClick={() => setShowViewPresets(!showViewPresets)}
                        title="View Presets"
                    >
                        <Eye size={16} />
                    </button>
                </div>

                {/* View Presets Panel */}
                {showViewPresets && (
                    <div className="view-presets-panel">
                        {(Object.keys(VIEW_PRESET_LABELS) as ViewPreset[]).map(preset => (
                            <button
                                key={preset}
                                className={`view-preset-btn ${viewPreset === preset ? 'active' : ''}`}
                                onClick={() => handleViewPreset(preset)}
                            >
                                {VIEW_PRESET_LABELS[preset]}
                            </button>
                        ))}
                    </div>
                )}

                {/* Job Control Bar - positioned above info panel */}
                <JobControlBar />

                {/* Bottom info panel */}
                <div className="workspace-info">
                    <div className="info-section">
                        <span className="info-label">Position:</span>
                        <span className="info-value">X: 0.0 Y: 0.0 Z: 0.0</span>
                    </div>
                    {gcode.length > 0 && (
                        <>
                            <div className="info-section">
                                <span className="info-label">Lines:</span>
                                <span className="info-value">{gcode.length}</span>
                            </div>
                            <div className="info-section">
                                <span className="info-label">Current:</span>
                                <span className="info-value">{currentLine}</span>
                            </div>
                            <div className="info-section">
                                <span className="info-label">Progress:</span>
                                <span className="info-value">
                                    {gcode.length > 0 ? Math.round((currentLine / gcode.length) * 100) : 0}%
                                </span>
                            </div>
                        </>
                    )}
                </div>

                {/* File management panel */}
                {fileInfo && (
                    <div className="file-management">
                        <div className="file-info">
                            <div className="file-name">{fileInfo.name}</div>
                            <div className="file-details">
                                {fileInfo.lines} lines • {(fileInfo.size / 1024).toFixed(2)} KB
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
