import { create } from 'zustand';
import type {
    MachineState,
    JogMode,
    ViewMode3D,
    ViewPreset,
    ConsoleLine,
    GCodeLine,
    ToolpathSegment,
    Position,
    FileInfo,
    MachineProfile,
    EthernetConfig,
    ProbeSettings,
    AppPreferences,
} from '../types/cnc';
import { getTimestamp } from '../utils/formatters';
import { jogDistanceStorage, coordSystemStorage } from '../utils/localStorage';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export type CoordSystem = 'Z' | 'XYZ' | 'XY' | 'X' | 'Y';

interface CNCStore {
    // Connection
    connected: boolean;
    connectionStatus: ConnectionStatus;
    isInitialized: boolean;
    firmwareType: string;
    firmwareVersion: string;
    backendSocketConnected: boolean;
    setConnected: (connected: boolean) => void;
    setConnectionStatus: (status: ConnectionStatus) => void;
    setInitialized: (initialized: boolean) => void;
    setFirmwareInfo: (type: string, version: string) => void;
    setBackendSocketConnected: (connected: boolean) => void;

    // Raw G-code content
    rawGcodeContent: string | null;
    setRawGcodeContent: (content: string | null) => void;

    // Machine State
    machineState: MachineState;
    setMachineState: (state: MachineState) => void;

    // Position
    position: Position;
    setPosition: (position: Position) => void;
    updatePosition: (axis: 'x' | 'y' | 'z', value: number) => void;

    // Jog Controls
    jogMode: JogMode;
    setJogMode: (mode: JogMode) => void;
    jogDistance: number;
    setJogDistance: (distance: number) => void;
    coordSystem: CoordSystem;
    setCoordSystem: (system: CoordSystem) => void;

    // Overrides
    feedRate: number;
    setFeedRate: (rate: number) => void;
    spindleSpeed: number;
    setSpindleSpeed: (speed: number) => void;
    rapidRate: number;
    setRapidRate: (rate: number) => void;

    // G-Code & File
    gcode: GCodeLine[];
    setGcode: (gcode: GCodeLine[]) => void;
    toolpathSegments: ToolpathSegment[];
    setToolpathSegments: (segments: ToolpathSegment[]) => void;
    fileInfo: FileInfo | null;
    setFileInfo: (info: FileInfo | null) => void;

    // 3D View
    viewMode3D: ViewMode3D;
    setViewMode3D: (mode: ViewMode3D) => void;
    viewPreset: ViewPreset;
    setViewPreset: (preset: ViewPreset) => void;
    showGrid3D: boolean;
    setShowGrid3D: (show: boolean) => void;

    // Console
    consoleLines: ConsoleLine[];
    addConsoleLog: (type: ConsoleLine['type'], text: string) => void;
    clearConsole: () => void;
    consoleExpanded: boolean;
    setConsoleExpanded: (expanded: boolean) => void;

    // Job Control
    jobProgress: number;
    setJobProgress: (progress: number) => void;
    currentLine: number;
    setCurrentLine: (line: number) => void;

    // Queue
    queueCounts: { jobId?: string; waiting: number; active: number; completed: number; failed: number };
    setQueueCounts: (counts: { jobId?: string; waiting?: number; active?: number; completed?: number; failed?: number }) => void;

    // Macros
    macros: Array<{ id: string; name: string; content: string; createdAt?: number }>;
    setMacros: (macros: Array<{ id: string; name: string; content: string; createdAt?: number }>) => void;

    // Tools
    tools: Array<{ id: string; name: string; number: number; diameter: number; length: number }>;
    setTools: (tools: Array<{ id: string; name: string; number: number; diameter: number; length: number }>) => void;

    // Tool Change
    toolChangeActive: boolean;
    toolChangeCurrentTool: number | null;
    toolChangeRequestedTool: number | null;
    setToolChangeState: (active: boolean, current: number | null, requested: number | null) => void;

    // Debug Monitor
    debugEnabled: boolean;
    debugEntries: Array<{ timestamp: number; type: string; data: string; meta: Record<string, unknown> }>;
    setDebugEnabled: (enabled: boolean) => void;
    addDebugEntry: (entry: { timestamp: number; type: string; data: string; meta: Record<string, unknown> }) => void;
    clearDebugEntries: () => void;

    // Health
    healthMetrics: { healthy: boolean; successRate: number; reconnectAttempt: number } | null;
    setHealthMetrics: (metrics: { healthy: boolean; successRate: number; reconnectAttempt: number } | null) => void;

    // Machine Position (separate from work position)
    machinePosition: Position;
    setMachinePosition: (pos: Position) => void;

    // WCS
    activeWCS: string;
    setActiveWCS: (wcs: string) => void;

    // Homing
    homingLocation: string | null;
    setHomingLocation: (location: string | null) => void;

    // Machine profiles (Device tab)
    machineProfiles: MachineProfile[];
    activeMachineProfile: string | null;
    setMachineProfiles: (profiles: MachineProfile[]) => void;
    setActiveMachineProfile: (id: string | null) => void;

    // Connected port info (for Home menu Device Info when connected)
    connectedPortInfo: { port: string; manufacturer?: string; vendorId?: string; productId?: string } | null;
    setConnectedPortInfo: (info: { port: string; manufacturer?: string; vendorId?: string; productId?: string } | null) => void;

    // Home menu settings (ethernet, probe, app preferences)
    ethernet: EthernetConfig;
    probeSettings: ProbeSettings;
    appPreferences: AppPreferences;
    setEthernet: (v: EthernetConfig | ((prev: EthernetConfig) => EthernetConfig)) => void;
    setProbeSettings: (v: ProbeSettings | ((prev: ProbeSettings) => ProbeSettings)) => void;
    setAppPreferences: (v: AppPreferences | ((prev: AppPreferences) => AppPreferences)) => void;
}

export const useCNCStore = create<CNCStore>((set) => ({
    // Connection
    connected: false,
    connectionStatus: 'disconnected',
    isInitialized: false,
    firmwareType: 'unknown',
    firmwareVersion: '',
    backendSocketConnected: false,
    setConnected: (connected) => set({ connected }),
    setConnectionStatus: (status) => set({ connectionStatus: status }),
    setInitialized: (isInitialized) => set({ isInitialized }),
    setFirmwareInfo: (firmwareType, firmwareVersion) => set({ firmwareType, firmwareVersion }),
    setBackendSocketConnected: (backendSocketConnected) => set({ backendSocketConnected }),

    // Raw G-code content
    rawGcodeContent: null,
    setRawGcodeContent: (rawGcodeContent) => set({ rawGcodeContent }),

    // Machine State
    machineState: 'idle',
    setMachineState: (machineState) => set({ machineState }),

    // Position
    position: { x: 0, y: 0, z: 0 },
    setPosition: (position) => {
        console.log('[Store] Setting work position:', position);
        set({ position: { ...position } });
    },
    updatePosition: (axis, value) =>
        set((state) => ({
            position: { ...state.position, [axis]: value },
        })),

    // Jog Controls
    jogMode: 'step',
    setJogMode: (jogMode) => set({ jogMode }),
    jogDistance: jogDistanceStorage.load(),
    setJogDistance: (jogDistance) => {
        jogDistanceStorage.save(jogDistance);
        set({ jogDistance });
    },
    coordSystem: coordSystemStorage.load(),
    setCoordSystem: (coordSystem) => {
        coordSystemStorage.save(coordSystem);
        set({ coordSystem });
    },

    // Overrides
    feedRate: 100,
    setFeedRate: (feedRate) => set({ feedRate }),
    spindleSpeed: 100,
    setSpindleSpeed: (spindleSpeed) => set({ spindleSpeed }),
    rapidRate: 100,
    setRapidRate: (rapidRate) => set({ rapidRate }),

    // G-Code & File
    gcode: [],
    setGcode: (gcode) => set({ gcode }),
    toolpathSegments: [],
    setToolpathSegments: (toolpathSegments) => set({ toolpathSegments }),
    fileInfo: null,
    setFileInfo: (fileInfo) => set({ fileInfo }),

    // 3D View
    viewMode3D: 'wireframe',
    setViewMode3D: (viewMode3D) => set({ viewMode3D }),
    viewPreset: 'iso',
    setViewPreset: (viewPreset) => set({ viewPreset }),
    showGrid3D: true,
    setShowGrid3D: (showGrid3D) => set({ showGrid3D }),

    // Console
    consoleLines: [
        { type: 'system', text: 'CNC Control System v1.0', time: getTimestamp() },
        { type: 'system', text: 'Ready to connect...', time: getTimestamp() },
    ],
    addConsoleLog: (type, text) =>
        set((state) => ({
            consoleLines: [...state.consoleLines, { type, text, time: getTimestamp() }],
        })),
    clearConsole: () => set({ consoleLines: [] }),
    consoleExpanded: false,
    setConsoleExpanded: (consoleExpanded) => set({ consoleExpanded }),

    // Job Control
    jobProgress: 0,
    setJobProgress: (jobProgress) => set({ jobProgress }),
    currentLine: 0,
    setCurrentLine: (currentLine) => set({ currentLine }),

    // Queue
    queueCounts: { waiting: 0, active: 0, completed: 0, failed: 0 },
    setQueueCounts: (counts) =>
        set((state) => ({
            queueCounts: {
                ...state.queueCounts,
                ...(counts.jobId !== undefined && { jobId: counts.jobId }),
                waiting: counts.waiting ?? state.queueCounts.waiting,
                active: counts.active ?? state.queueCounts.active,
                completed: counts.completed ?? state.queueCounts.completed,
                failed: counts.failed ?? state.queueCounts.failed,
            },
        })),

    // Macros
    macros: [],
    setMacros: (macros) => set({ macros }),

    // Tools
    tools: [],
    setTools: (tools) => set({ tools }),

    // Tool Change
    toolChangeActive: false,
    toolChangeCurrentTool: null,
    toolChangeRequestedTool: null,
    setToolChangeState: (active, current, requested) => set({
        toolChangeActive: active,
        toolChangeCurrentTool: current,
        toolChangeRequestedTool: requested,
    }),

    // Debug Monitor
    debugEnabled: false,
    debugEntries: [],
    setDebugEnabled: (debugEnabled) => set({ debugEnabled }),
    addDebugEntry: (entry) =>
        set((state) => ({
            debugEntries: [...state.debugEntries.slice(-499), entry],
        })),
    clearDebugEntries: () => set({ debugEntries: [] }),

    // Health
    healthMetrics: null,
    setHealthMetrics: (healthMetrics) => set({ healthMetrics }),

    // Machine Position
    machinePosition: { x: 0, y: 0, z: 0 },
    setMachinePosition: (machinePosition) => {
        console.log('[Store] Setting machine position:', machinePosition);
        set({ machinePosition: { ...machinePosition } });
    },

    // WCS
    activeWCS: 'G54',
    setActiveWCS: (activeWCS) => set({ activeWCS }),

    // Homing
    homingLocation: null,
    setHomingLocation: (homingLocation) => set({ homingLocation }),

    // Machine profiles (Device tab)
    machineProfiles: [],
    activeMachineProfile: null,
    setMachineProfiles: (machineProfiles) => set({ machineProfiles }),
    setActiveMachineProfile: (activeMachineProfile) => set({ activeMachineProfile }),

    connectedPortInfo: null,
    setConnectedPortInfo: (connectedPortInfo) => set({ connectedPortInfo }),

    // Home menu settings
    ethernet: { connectToIP: '192.168.5.1' },
    probeSettings: {
        touchPlateType: 'Standard Block',
        blockThickness: 15,
        xyThickness: 10,
        zProbeDistance: 30,
        fastFind: 150,
        slowFind: 75,
        retraction: 2,
        connectionTest: true,
    },
    appPreferences: {
        units: 'mm',
        safeHeight: 10,
        reconnectAutomatically: false,
        firmwareFallback: 'grblHAL',
        baudRate: 115200,
        runCheckOnFileLoad: false,
        outlineStyle: 'Detailed',
    },
    setEthernet: (v) => set((s) => ({ ethernet: typeof v === 'function' ? v(s.ethernet) : v })),
    setProbeSettings: (v) => set((s) => ({ probeSettings: typeof v === 'function' ? v(s.probeSettings) : v })),
    setAppPreferences: (v) => set((s) => ({ appPreferences: typeof v === 'function' ? v(s.appPreferences) : v })),
}));
