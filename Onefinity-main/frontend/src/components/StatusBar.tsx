import { useCNCStore } from '../stores/cncStore';
import './StatusBar.css';

const STATE_LABELS: Record<string, string> = {
    idle: 'IDLE',
    running: 'RUNNING',
    paused: 'PAUSED',
    alarm: 'ALARM',
};

export default function StatusBar() {
    const {
        connected,
        connectionStatus,
        machineState,
        activeWCS,
        appPreferences,
        firmwareType,
        firmwareVersion,
        position,
    } = useCNCStore();

    const stateLabel = !connected
        ? 'OFFLINE'
        : (STATE_LABELS[machineState] ?? machineState.toUpperCase());

    const stateClass = !connected
        ? 'state-offline'
        : `state-${machineState}`;

    return (
        <footer className="status-bar" role="status" aria-label="Machine status">
            {/* Connection indicator */}
            <div className="sb-item sb-connection" title={`Connection: ${connectionStatus}`}>
                <span className={`sb-dot ${connected ? 'connected' : 'disconnected'}`} />
                <span className="sb-label">{connected ? 'Connected' : 'Disconnected'}</span>
            </div>

            <div className="sb-divider" />

            {/* Machine state */}
            <div className={`sb-item sb-state ${stateClass}`} title="Machine state">
                <span className="sb-label">{stateLabel}</span>
            </div>

            <div className="sb-divider" />

            {/* WCS */}
            <div className="sb-item" title="Active Work Coordinate System">
                <span className="sb-key">WCS</span>
                <span className="sb-val">{activeWCS}</span>
            </div>

            <div className="sb-divider" />

            {/* Units */}
            <div className="sb-item" title="Units">
                <span className="sb-key">Units</span>
                <span className="sb-val">{appPreferences.units}</span>
            </div>

            {/* Position readout */}
            {connected && (
                <>
                    <div className="sb-divider" />
                    <div className="sb-item sb-position" title="Current work position">
                        <span className="sb-key">Pos</span>
                        <span className="sb-val sb-pos-val">
                            X<b>{position.x.toFixed(2)}</b>&nbsp;
                            Y<b>{position.y.toFixed(2)}</b>&nbsp;
                            Z<b>{position.z.toFixed(2)}</b>
                        </span>
                    </div>
                </>
            )}

            {/* Alarm badge */}
            {machineState === 'alarm' && (
                <>
                    <div className="sb-divider" />
                    <div className="sb-item sb-alarm-badge" title="Machine is in alarm state — check console">
                        ⚠ ALARM
                    </div>
                </>
            )}

            {/* Firmware */}
            {connected && firmwareType !== 'unknown' && (
                <>
                    <div className="sb-spacer" />
                    <div className="sb-item sb-firmware" title="Controller firmware">
                        <span className="sb-key">FW</span>
                        <span className="sb-val">{firmwareType} {firmwareVersion}</span>
                    </div>
                </>
            )}
        </footer>
    );
}
