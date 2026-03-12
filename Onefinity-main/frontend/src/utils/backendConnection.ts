/**
 * Backend connection utilities using the Controller (Socket.IO client).
 *
 * This module bridges the Controller singleton to the Zustand store,
 * providing convenience functions for React components.
 */
import controller from './controller';
import type { ControllerState, SenderStatus, PortInfo, AlarmInfo, ErrorInfo } from './controller';
import { useCNCStore } from '../stores/cncStore';
import { log } from './logger';

const getBackendUrl = (): string => {
    const url = (import.meta as unknown as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL;
    if (url !== undefined && url !== null && String(url).trim() !== '') {
        return String(url).replace(/\/$/, '');
    }
    // Use same host as the page so external devices (e.g. tablet on network) can connect to backend
    if (typeof window !== 'undefined' && window.location?.hostname) {
        const { protocol, hostname } = window.location;
        return `${protocol}//${hostname}:4000`;
    }
    return 'http://localhost:4000';
};

export type BackendPort = PortInfo;

export function getController() {
    return controller;
}

export function isBackendSupported(): boolean {
    return true;
}

/**
 * Connect to the backend Socket.IO server and wire events to the store.
 */
export function connectBackendSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
        if (controller.socket?.connected) {
            resolve();
            return;
        }

        const url = getBackendUrl();
        const store = useCNCStore.getState();

        controller.connect(url, {}, (err) => {
            if (err) {
                store.setBackendSocketConnected(false);
                reject(err);
                return;
            }
            store.setBackendSocketConnected(true);
            // Wire controller events to store
            _wireControllerToStore();
            // Hydrate config from backend (machine profiles, ethernet, probe, preferences)
            controller.getConfigAll((_e, config) => {
                if (config && typeof config === 'object') {
                    const s = useCNCStore.getState();
                    const profiles = (config.machineProfiles as Array<{ id: string; name: string; voltage?: string; workArea?: string; maxFeed?: string; spindle?: string; controller?: string; notes?: string }>) ?? [];
                    const active = (config.activeMachineProfile as string | null) ?? null;
                    s.setMachineProfiles(Array.isArray(profiles) ? profiles : []);
                    s.setActiveMachineProfile(active);
                    const eth = config.ethernet as { connectToIP?: string } | undefined;
                    if (eth?.connectToIP) s.setEthernet({ connectToIP: eth.connectToIP });
                    const probe = config.probeSettings as Record<string, unknown> | undefined;
                    if (probe && typeof probe === 'object') {
                        s.setProbeSettings({
                            touchPlateType: (probe.touchPlateType as string) ?? 'Standard Block',
                            blockThickness: Number(probe.blockThickness) ?? 15,
                            xyThickness: Number(probe.xyThickness) ?? 10,
                            zProbeDistance: Number(probe.zProbeDistance) ?? 30,
                            fastFind: Number(probe.fastFind) ?? 150,
                            slowFind: Number(probe.slowFind) ?? 75,
                            retraction: Number(probe.retraction) ?? 2,
                            connectionTest: Boolean(probe.connectionTest ?? true),
                        });
                    }
                    const prefs = config.preferences as Record<string, unknown> | undefined;
                    if (prefs && typeof prefs === 'object') {
                        s.setAppPreferences({
                            units: (prefs.units as string) ?? 'mm',
                            safeHeight: Number(prefs.safeHeight) ?? 10,
                            reconnectAutomatically: Boolean(prefs.reconnectAutomatically ?? false),
                            firmwareFallback: (prefs.firmwareFallback as string) ?? 'grblHAL',
                            baudRate: Number(prefs.baudRate) ?? 115200,
                            runCheckOnFileLoad: Boolean(prefs.runCheckOnFileLoad ?? false),
                            outlineStyle: (prefs.outlineStyle as string) ?? 'Detailed',
                        });
                    }
                }
            });
            resolve();
        });
    });
}

/**
 * Disconnect from the backend.
 */
export function disconnectBackendSocket(): void {
    controller.disconnect();
    useCNCStore.getState().setBackendSocketConnected(false);
}

/**
 * Wire all controller events to the Zustand store.
 */
function _wireControllerToStore(): void {
    const getStore = () => useCNCStore.getState();

    // Connection events
    controller.on('connect', () => {
        getStore().setBackendSocketConnected(true);
    });

    controller.on('disconnect', () => {
        getStore().setBackendSocketConnected(false);
    });

    // Serial port events
    controller.on('serialport:open', (data: { port: string; controllerType?: string }) => {
        const s = getStore();
        s.setConnectionStatus('connected');
        s.setConnected(true);
        s.addConsoleLog('success', `Connected to ${data.port}`);
        s.addConsoleLog('info', 'Detecting firmware...');
        log('info', `Connected to ${data.port}`);
    });

    controller.on('serialport:close', () => {
        const s = getStore();
        s.setConnectionStatus('disconnected');
        s.setConnected(false);
        s.setInitialized(false);
        s.setConnectedPortInfo(null);
        s.addConsoleLog('warning', 'Disconnected from controller');
        log('warn', 'Disconnected from controller');
    });

    controller.on('serialport:error', (data: { error: string }) => {
        getStore().addConsoleLog('error', data.error || 'Connection error');
        log('error', data.error);
    });

    controller.on('serialport:read', (line: string) => {
        getStore().addConsoleLog('system', line);
    });

    // Controller type detection
    controller.on('controller:type', (type: string) => {
        getStore().addConsoleLog('info', `Controller type: ${type}`);
    });

    // Controller state updates
    controller.on('controller:state', (_type: string, state: ControllerState) => {
        const s = getStore();

        if (state.status) {
            // Map active state
            const stateMap: Record<string, 'idle' | 'running' | 'paused' | 'alarm'> = {
                'Idle': 'idle', 'Run': 'running', 'Hold': 'paused',
                'Jog': 'running', 'Alarm': 'alarm', 'Door': 'paused',
                'Check': 'idle', 'Home': 'running', 'Sleep': 'idle',
            };
            const mapped = stateMap[state.status.activeState];
            if (mapped) s.setMachineState(mapped);

            // Update position (prefer work position)
            if (state.status.wpos) {
                const newPos = {
                    x: state.status.wpos.x,
                    y: state.status.wpos.y,
                    z: state.status.wpos.z,
                };
                console.log('[Position Update] Work:', newPos);
                s.setPosition(newPos);
            }

            // Update feed rate and spindle
            if (state.status.feedrate !== undefined) s.setFeedRate(state.status.feedrate);
            if (state.status.spindle !== undefined) s.setSpindleSpeed(state.status.spindle);

            // Update overrides
            if (state.status.ov) {
                s.setFeedRate(state.status.ov.feed);
                s.setRapidRate(state.status.ov.rapid);
            }
        }
    });

    // Initialization
    controller.on('controller:initialized', (info: { firmwareType: string; firmwareVersion: string }) => {
        const s = getStore();
        s.setInitialized(true);
        s.setFirmwareInfo(info.firmwareType, info.firmwareVersion);
        s.addConsoleLog('success', `Controller initialized: ${info.firmwareType} ${info.firmwareVersion}`);
        log('info', `Controller initialized: ${info.firmwareType} ${info.firmwareVersion}`);
    });

    // Alarms
    controller.on('controller:alarm', (alarm: AlarmInfo) => {
        const s = getStore();
        s.setMachineState('alarm');
        s.addConsoleLog('error', `ALARM ${alarm.code}: ${alarm.message} - ${alarm.description}`);
    });

    // Errors
    controller.on('controller:error', (err: ErrorInfo) => {
        getStore().addConsoleLog('error', `Error ${err.code}: ${err.message}`);
    });

    // Workflow state
    controller.on('workflow:state', (state: string) => {
        const s = getStore();
        if (state === 'running') s.setMachineState('running');
        else if (state === 'paused') s.setMachineState('paused');
        else if (state === 'idle') {
            // Only set to idle if not in alarm
            if (s.machineState !== 'alarm') s.setMachineState('idle');
        }
    });

    // Sender status
    controller.on('sender:status', (status: SenderStatus) => {
        const s = getStore();
        s.setJobProgress(status.progress);
        s.setCurrentLine(status.received);
    });

    controller.on('sender:end', () => {
        const s = getStore();
        s.setMachineState('idle');
        s.setJobProgress(100);
        s.addConsoleLog('success', 'Job completed');
        log('info', 'Job completed');
    });

    controller.on('sender:error', () => {
        getStore().addConsoleLog('error', 'Streaming error');
    });

    // File events
    controller.on('file:load', (data: { name: string; total: number }) => {
        getStore().addConsoleLog('info', `File loaded: ${data.name} (${data.total} lines)`);
    });

    // Settings
    controller.on('controller:settings', (setting: { key: number; value: number; message: string }) => {
        getStore().addConsoleLog('system', `$${setting.key}=${setting.value} (${setting.message})`);
    });

    // Feedback
    controller.on('controller:feedback', (fb: { message: string }) => {
        getStore().addConsoleLog('info', `[MSG: ${fb.message}]`);
    });

    // ─── New Feature Events ──────────────────────────────────────

    // Machine position (from controller state)
    controller.on('controller:state', (_type: string, state: ControllerState) => {
        if (state.status?.mpos) {
            const newMachinePos = {
                x: state.status.mpos.x,
                y: state.status.mpos.y,
                z: state.status.mpos.z,
            };
            console.log('[Position Update] Machine:', newMachinePos);
            getStore().setMachinePosition(newMachinePos);
        }
        // Track active WCS from parser state
        if (state.parserstate?.modal?.wcs) {
            getStore().setActiveWCS(state.parserstate.modal.wcs);
        }
    });

    // Macros
    controller.on('macro:list', (macros: Array<{ id: string; name: string; content: string; createdAt?: number }>) => {
        getStore().setMacros(macros);
    });

    // Tools
    controller.on('tool:list', (tools: Array<{ id: string; name: string; number: number; diameter: number; length: number }>) => {
        getStore().setTools(tools);
    });

    // Tool change events
    controller.on('toolchange:start', (data: { currentTool: number | null; requestedTool: number | null }) => {
        const s = getStore();
        s.setToolChangeState(true, data.currentTool, data.requestedTool);
        s.addConsoleLog('warning', `Tool change requested: T${data.requestedTool}`);
    });

    controller.on('toolchange:complete', (data: { tool: number }) => {
        const s = getStore();
        s.setToolChangeState(false, data.tool, null);
        s.addConsoleLog('success', `Tool change complete: T${data.tool}`);
    });

    controller.on('toolchange:cancel', () => {
        const s = getStore();
        s.setToolChangeState(false, s.toolChangeCurrentTool, null);
        s.addConsoleLog('info', 'Tool change cancelled');
    });

    // Debug monitor
    controller.on('serial:debug:log', (entry: { timestamp: number; type: string; data: string; meta: Record<string, unknown> }) => {
        getStore().addDebugEntry(entry);
    });

    // Health monitor
    controller.on('health:stale', () => {
        getStore().addConsoleLog('warning', 'Connection health: stale - no status reports received');
    });

    controller.on('health:reconnect:attempt', (data: { attempt: number; maxAttempts: number }) => {
        getStore().addConsoleLog('info', `Auto-reconnect attempt ${data.attempt}/${data.maxAttempts}`);
    });

    controller.on('health:reconnect:success', () => {
        getStore().addConsoleLog('success', 'Auto-reconnect successful');
    });

    controller.on('health:reconnect:failed', (data: { message: string }) => {
        getStore().addConsoleLog('error', `Auto-reconnect failed: ${data.message}`);
    });

    // Homing
    controller.on('homing:location', (data: { location: string }) => {
        getStore().setHomingLocation(data.location);
    });

    // Event triggers
    controller.on('eventtrigger:fired', (data: { event: string; trigger: string }) => {
        getStore().addConsoleLog('info', `Event trigger fired: ${data.trigger}`);
    });

    // Config (machine profiles, ethernet, probe, preferences)
    controller.on('config:all', (config: Record<string, unknown>) => {
        const s = getStore();
        const profiles = (config?.machineProfiles as Array<{ id: string; name: string; voltage?: string; workArea?: string; maxFeed?: string; spindle?: string; controller?: string; notes?: string }>) ?? [];
        const active = (config?.activeMachineProfile as string | null) ?? null;
        s.setMachineProfiles(Array.isArray(profiles) ? profiles : []);
        s.setActiveMachineProfile(active);

        const eth = config?.ethernet as { connectToIP?: string } | undefined;
        if (eth && typeof eth.connectToIP === 'string') {
            s.setEthernet({ connectToIP: eth.connectToIP });
        }
        const probe = config?.probeSettings as Record<string, unknown> | undefined;
        if (probe && typeof probe === 'object') {
            s.setProbeSettings({
                touchPlateType: (probe.touchPlateType as string) ?? 'Standard Block',
                blockThickness: Number(probe.blockThickness) ?? 15,
                xyThickness: Number(probe.xyThickness) ?? 10,
                zProbeDistance: Number(probe.zProbeDistance) ?? 30,
                fastFind: Number(probe.fastFind) ?? 150,
                slowFind: Number(probe.slowFind) ?? 75,
                retraction: Number(probe.retraction) ?? 2,
                connectionTest: Boolean(probe.connectionTest ?? true),
            });
        }
        const prefs = config?.preferences as Record<string, unknown> | undefined;
        if (prefs && typeof prefs === 'object') {
            s.setAppPreferences({
                units: (prefs.units as string) ?? 'mm',
                safeHeight: Number(prefs.safeHeight) ?? 10,
                reconnectAutomatically: Boolean(prefs.reconnectAutomatically ?? false),
                firmwareFallback: (prefs.firmwareFallback as string) ?? 'grblHAL',
                baudRate: Number(prefs.baudRate) ?? 115200,
                runCheckOnFileLoad: Boolean(prefs.runCheckOnFileLoad ?? false),
                outlineStyle: (prefs.outlineStyle as string) ?? 'Detailed',
            });
        }
    });

    controller.on('config:change', (data: { key: string; value: unknown }) => {
        const s = getStore();
        if (data.key === 'machineProfiles') {
            s.setMachineProfiles(Array.isArray(data.value) ? (data.value as Parameters<typeof s.setMachineProfiles>[0]) : []);
        } else if (data.key === 'activeMachineProfile') {
            s.setActiveMachineProfile(data.value as string | null);
        } else if (data.key === 'ethernet' && data.value && typeof data.value === 'object') {
            const eth = data.value as { connectToIP?: string };
            s.setEthernet((prev) => ({ ...prev, connectToIP: eth.connectToIP ?? prev.connectToIP }));
        } else if (data.key === 'ethernet.connectToIP') {
            s.setEthernet((prev) => ({ ...prev, connectToIP: String(data.value ?? '') }));
        } else if (data.key === 'probeSettings' && data.value && typeof data.value === 'object') {
            const p = data.value as Record<string, unknown>;
            s.setProbeSettings((prev) => ({
                ...prev,
                ...(p.touchPlateType !== undefined && { touchPlateType: String(p.touchPlateType) }),
                ...(p.blockThickness !== undefined && { blockThickness: Number(p.blockThickness) }),
                ...(p.xyThickness !== undefined && { xyThickness: Number(p.xyThickness) }),
                ...(p.zProbeDistance !== undefined && { zProbeDistance: Number(p.zProbeDistance) }),
                ...(p.fastFind !== undefined && { fastFind: Number(p.fastFind) }),
                ...(p.slowFind !== undefined && { slowFind: Number(p.slowFind) }),
                ...(p.retraction !== undefined && { retraction: Number(p.retraction) }),
                ...(p.connectionTest !== undefined && { connectionTest: Boolean(p.connectionTest) }),
            }));
        } else if (data.key.startsWith('probeSettings.')) {
            const field = data.key.slice('probeSettings.'.length);
            s.setProbeSettings((prev) => ({ ...prev, [field]: data.value }));
        } else if (data.key === 'preferences' && data.value && typeof data.value === 'object') {
            const p = data.value as Record<string, unknown>;
            s.setAppPreferences((prev) => ({
                ...prev,
                ...(p.units !== undefined && { units: String(p.units) }),
                ...(p.safeHeight !== undefined && { safeHeight: Number(p.safeHeight) }),
                ...(p.reconnectAutomatically !== undefined && { reconnectAutomatically: Boolean(p.reconnectAutomatically) }),
                ...(p.firmwareFallback !== undefined && { firmwareFallback: String(p.firmwareFallback) }),
                ...(p.baudRate !== undefined && { baudRate: Number(p.baudRate) }),
                ...(p.runCheckOnFileLoad !== undefined && { runCheckOnFileLoad: Boolean(p.runCheckOnFileLoad) }),
                ...(p.outlineStyle !== undefined && { outlineStyle: String(p.outlineStyle) }),
            }));
        } else if (data.key.startsWith('preferences.')) {
            const field = data.key.slice('preferences.'.length);
            s.setAppPreferences((prev) => ({ ...prev, [field]: data.value }));
        }
    });
}

// ─── Convenience Functions ───────────────────────────────────────

export function requestBackendPorts(): Promise<BackendPort[]> {
    return new Promise((resolve, reject) => {
        if (!controller.socket?.connected) {
            reject(new Error('Not connected to backend'));
            return;
        }
        controller.listPorts((err, ports) => {
            if (err) reject(err);
            else resolve(ports || []);
        });
    });
}

const IPV4_REGEX = /^(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/;

export function connectToBackendPort(
    path: string,
    options: { baudRate?: number; network?: boolean } = {}
): Promise<void> {
    const baudRate = options.baudRate ?? 115200;
    const network = options.network ?? IPV4_REGEX.test(path.trim());
    return new Promise((resolve, reject) => {
        if (!controller.socket?.connected) {
            reject(new Error('Not connected to backend. Start the backend server (port 4000) or check the connection.'));
            return;
        }
        controller.openPort(path, { baudRate, network }, (err: Error | { message?: string } | null) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

export function disconnectFromBackendPort(): Promise<void> {
    return new Promise((resolve) => {
        controller.closePort(undefined, () => resolve());
        setTimeout(resolve, 1000);
    });
}

export function sendBackendCommand(command: string): Promise<void> {
    controller.sendGcode(command);
    return Promise.resolve();
}

export function backendJog(x?: number, y?: number, z?: number, feedRate = 1000): void {
    controller.jog({ x, y, z, feedRate });
}

export function backendHome(): void { controller.home(); }
export function backendUnlock(): void { controller.unlock(); }

export function backendJobLoad(content: string): void {
    controller.loadFile('loaded.gcode', content);
}

export function backendJobStart(): void { controller.startJob(); }
export function backendJobStartFromLine(line: number): void { controller.startFromLine(line); }
export function backendJobPause(): void { controller.pauseJob(); }
export function backendJobResume(): void { controller.resumeJob(); }
export function backendJobStop(): void { controller.stopJob(); }

export function backendJobQueue(content: string, _startFromLine = 0): void {
    controller.loadFile('queued.gcode', content);
}

export function backendFeedHold(): void { controller.feedHold(); }
export function backendCycleStart(): void { controller.cycleStart(); }
export function backendSoftReset(): void { controller.reset(); }
export function backendCheckMode(): void { controller.checkMode(); }
export function backendGetHelp(): void { controller.sendGcode('$'); }
export function backendGetBuildInfo(): void { controller.getBuildInfo(); }
export function backendGetWorkCoordinates(): void { controller.getWorkCoordinates(); }
export function backendGetParserState(): void { controller.getParserState(); }
export function backendJogCancel(): void { controller.jogCancel(); }

// ─── New Feature Functions ───────────────────────────────────────

export function backendHomeAxis(axis: string): void { controller.homeAxis(axis); }
export function backendProbeZ(params?: { depth?: number; feedRate?: number; retract?: number }): void {
    controller.probeZ(params);
}
export function backendSetWCS(wcs: string): void { controller.setWCS(wcs); }
export function backendZeroWCS(params?: { axes?: string[]; wcs?: string }): void { controller.zeroWCS(params); }
export function backendZeroAll(): void { controller.zeroAll(); }

/** Set active machine profile on backend (persists and triggers config:change). */
export function setBackendActiveMachineProfile(id: string | null): void {
    controller.setConfig('activeMachineProfile', id);
}

/** Persist a config key to backend (e.g. 'ethernet', 'probeSettings', 'preferences'). */
export function setBackendConfig(key: string, value: unknown): void {
    controller.setConfig(key, value);
}
export function backendConfirmToolChange(): void { controller.confirmToolChange(); }
export function backendCancelToolChange(): void { controller.cancelToolChange(); }
export function backendRunMacro(id: string): void { controller.runMacro(id); }
export function backendRunMacroContent(content: string): void { controller.runMacroContent(content); }
export function backendEnableDebug(): void { controller.enableDebug(); }
export function backendDisableDebug(): void { controller.disableDebug(); }

export { getBackendUrl };
