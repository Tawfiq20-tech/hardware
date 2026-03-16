import { useEffect, useRef, useState } from 'react';
import { Cpu, Monitor, Wifi, Crosshair, Settings, Keyboard } from 'lucide-react';
import { useCNCStore } from '../stores/cncStore';
import {
    setBackendActiveMachineProfile,
    setBackendConfig,
} from '../utils/backendConnection';
import OnScreenKeyboard from './OnScreenKeyboard';
import './HomeMenu.css';

type HomeMenuSection = 'machine' | 'device' | 'ethernet' | 'probe' | 'basics';

const SECTIONS: { id: HomeMenuSection; label: string; Icon: React.ComponentType<{ size?: string | number; className?: string }> }[] = [
    { id: 'machine', label: 'Machine Information', Icon: Cpu },
    { id: 'device', label: 'Device Info', Icon: Monitor },
    { id: 'ethernet', label: 'Ethernet', Icon: Wifi },
    { id: 'probe', label: 'Probe settings', Icon: Crosshair },
    { id: 'basics', label: 'Basics', Icon: Settings },
];

interface HomeMenuProps {
    isOpen: boolean;
    onClose: () => void;
    anchorRef: React.RefObject<HTMLButtonElement | null>;
}

export default function HomeMenu({ isOpen, onClose, anchorRef }: HomeMenuProps) {
    const panelRef = useRef<HTMLDivElement>(null);
    const keyboardPanelRef = useRef<HTMLDivElement>(null);
    const [selectedSection, setSelectedSection] = useState<HomeMenuSection>('machine');
    const [keyboardTarget, setKeyboardTarget] = useState<HTMLInputElement | null>(null);

    const {
        connected,
        connectedPortInfo,
        machineProfiles,
        activeMachineProfile,
        setActiveMachineProfile,
        ethernet,
        setEthernet,
        probeSettings,
        setProbeSettings,
        appPreferences,
        setAppPreferences,
    } = useCNCStore();

    const activeProfile = activeMachineProfile
        ? machineProfiles.find((p) => p.id === activeMachineProfile)
        : null;

    useEffect(() => {
        if (!isOpen) return;
        const handleClick = (e: MouseEvent) => {
            if (
                panelRef.current?.contains(e.target as Node) ||
                anchorRef.current?.contains(e.target as Node) ||
                keyboardPanelRef.current?.contains(e.target as Node)
            )
                return;
            onClose();
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [isOpen, onClose, anchorRef]);

    useEffect(() => {
        if (!isOpen) setKeyboardTarget(null);
    }, [isOpen]);

    const updateEthernet = (connectToIP: string) => {
        const next = { connectToIP };
        setEthernet(next);
        setBackendConfig('ethernet', next);
    };

    const updateProbe = <K extends keyof typeof probeSettings>(
        key: K,
        value: (typeof probeSettings)[K]
    ) => {
        setProbeSettings((prev) => ({ ...prev, [key]: value }));
        setBackendConfig(`probeSettings.${key}`, value);
    };

    const updatePref = <K extends keyof typeof appPreferences>(
        key: K,
        value: (typeof appPreferences)[K]
    ) => {
        setAppPreferences((prev) => ({ ...prev, [key]: value }));
        setBackendConfig(`preferences.${key}`, value);
    };

    const openKeyboardForInput = (e: React.MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        const wrap = (e.currentTarget as HTMLElement).closest('.home-menu-input-with-kb, .home-menu-input-wrap');
        const input = wrap?.querySelector('input');
        if (input instanceof HTMLInputElement) {
            setKeyboardTarget(input);
            input.focus();
        }
    };

    if (!isOpen) return null;

    return (
        <div
            ref={panelRef}
            className="home-menu-panel"
            role="dialog"
            aria-label="Home menu - Machine and device settings"
        >
            {/* Left: headings only */}
            <nav className="home-menu-nav" aria-label="Settings sections">
                {SECTIONS.map(({ id, label, Icon }) => (
                    <button
                        key={id}
                        type="button"
                        className={`home-menu-nav-item ${selectedSection === id ? 'active' : ''}`}
                        onClick={() => setSelectedSection(id)}
                    >
                        <Icon size={18} className="home-menu-nav-icon" />
                        <span className="home-menu-nav-label">{label}</span>
                    </button>
                ))}
            </nav>

            {/* Right: content for selected section */}
            <div className="home-menu-detail">
                {selectedSection === 'machine' && (
                    <>
                        <h4 className="home-menu-section-title">Machine Information</h4>
                        <div className="home-menu-row">
                            <label className="home-menu-label">Machine profile</label>
                            <select
                                className="home-menu-select"
                                value={activeMachineProfile ?? ''}
                                onChange={(e) => {
                                    const id = e.target.value || null;
                                    setActiveMachineProfile(id);
                                    setBackendActiveMachineProfile(id);
                                }}
                            >
                                {machineProfiles.map((p) => (
                                    <option key={p.id} value={p.id}>
                                        {p.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                        {activeProfile && (
                            <>
                                {activeProfile.voltage && (
                                    <div className="home-menu-row">
                                        <span className="home-menu-label">Voltage</span>
                                        <span className="home-menu-value">{activeProfile.voltage}</span>
                                    </div>
                                )}
                                {activeProfile.workArea && (
                                    <div className="home-menu-row">
                                        <span className="home-menu-label">Work area</span>
                                        <span className="home-menu-value">{activeProfile.workArea}</span>
                                    </div>
                                )}
                            </>
                        )}
                    </>
                )}

                {selectedSection === 'device' && (
                    <>
                        <h4 className="home-menu-section-title">Device Info</h4>
                        {connected && connectedPortInfo ? (
                            <>
                                <div className="home-menu-row">
                                    <span className="home-menu-label">Port</span>
                                    <span className="home-menu-value">{connectedPortInfo.port}</span>
                                </div>
                                {connectedPortInfo.manufacturer && (
                                    <div className="home-menu-row">
                                        <span className="home-menu-label">Manufacturer</span>
                                        <span className="home-menu-value">{connectedPortInfo.manufacturer}</span>
                                    </div>
                                )}
                                {connectedPortInfo.vendorId && (
                                    <div className="home-menu-row">
                                        <span className="home-menu-label">Vendor ID</span>
                                        <span className="home-menu-value">{connectedPortInfo.vendorId}</span>
                                    </div>
                                )}
                                <div className="home-menu-row">
                                    <span className="home-menu-label">Baud Rate</span>
                                    <span className="home-menu-value">115200</span>
                                </div>
                            </>
                        ) : (
                            <div className="home-menu-row">
                                <span className="home-menu-dim">Not connected</span>
                            </div>
                        )}
                    </>
                )}

                {selectedSection === 'ethernet' && (
                    <>
                        <h4 className="home-menu-section-title">Ethernet</h4>
                        <div className="home-menu-row home-menu-row-with-desc">
                            <label className="home-menu-label">Connect to IP</label>
                            <div className="home-menu-input-with-kb">
                                <input
                                    type="text"
                                    className="home-menu-ip-input"
                                    value={ethernet.connectToIP}
                                    onChange={(e) => updateEthernet(e.target.value)}
                                    placeholder="192.168.5.1"
                                />
                                <button
                                    type="button"
                                    className="home-menu-kb-btn"
                                    aria-label="Open on-screen keyboard"
                                    title="Open on-screen keyboard"
                                    onClick={openKeyboardForInput}
                                >
                                    <Keyboard size={14} />
                                </button>
                            </div>
                            <p className="home-menu-desc">
                                IP address used to connect to CNCs over Ethernet. (Default 192.168.5.1)
                            </p>
                        </div>
                    </>
                )}

                {selectedSection === 'probe' && (
                    <>
                        <h4 className="home-menu-section-title">Probe settings</h4>
                        <div className="home-menu-row home-menu-row-with-desc">
                            <label className="home-menu-label">Touch plate type</label>
                            <select
                                className="home-menu-select"
                                value={probeSettings.touchPlateType}
                                onChange={(e) => updateProbe('touchPlateType', e.target.value)}
                            >
                                <option value="Standard Block">Standard Block</option>
                                <option value="AutoZero">AutoZero</option>
                            </select>
                            <p className="home-menu-desc">Select the touch plate you're using. (Default Standard block)</p>
                        </div>
                        <div className="home-menu-row home-menu-row-with-desc">
                            <label className="home-menu-label">Block thickness</label>
                            <div className="home-menu-input-wrap">
                                <input
                                    type="number"
                                    className="home-menu-input"
                                    value={probeSettings.blockThickness}
                                    onChange={(e) => updateProbe('blockThickness', Number(e.target.value) || 0)}
                                />
                                <span className="home-menu-unit">mm</span>
                                <button type="button" className="home-menu-kb-btn" aria-label="Open on-screen keyboard" title="Open on-screen keyboard" onClick={openKeyboardForInput}><Keyboard size={14} /></button>
                            </div>
                            <p className="home-menu-desc">Plate thickness where the bit touches for Z-axis probing. (Default 15)</p>
                        </div>
                        <div className="home-menu-row home-menu-row-with-desc">
                            <label className="home-menu-label">XY thickness</label>
                            <div className="home-menu-input-wrap">
                                <input
                                    type="number"
                                    className="home-menu-input"
                                    value={probeSettings.xyThickness}
                                    onChange={(e) => updateProbe('xyThickness', Number(e.target.value) || 0)}
                                />
                                <span className="home-menu-unit">mm</span>
                                <button type="button" className="home-menu-kb-btn" aria-label="Open on-screen keyboard" title="Open on-screen keyboard" onClick={openKeyboardForInput}><Keyboard size={14} /></button>
                            </div>
                            <p className="home-menu-desc">Plate thickness for X/Y-axis probing. (Default 10)</p>
                        </div>
                        <div className="home-menu-row home-menu-row-with-desc">
                            <label className="home-menu-label">Z probe distance</label>
                            <div className="home-menu-input-wrap">
                                <input
                                    type="number"
                                    className="home-menu-input"
                                    value={probeSettings.zProbeDistance}
                                    onChange={(e) => updateProbe('zProbeDistance', Number(e.target.value) || 0)}
                                />
                                <span className="home-menu-unit">mm</span>
                                <button type="button" className="home-menu-kb-btn" aria-label="Open on-screen keyboard" title="Open on-screen keyboard" onClick={openKeyboardForInput}><Keyboard size={14} /></button>
                            </div>
                            <p className="home-menu-desc">Movement in Z before it gives up on probing. (Default 30)</p>
                        </div>
                        <div className="home-menu-row home-menu-row-with-desc">
                            <label className="home-menu-label">Fast find</label>
                            <div className="home-menu-input-wrap">
                                <input
                                    type="number"
                                    className="home-menu-input"
                                    value={probeSettings.fastFind}
                                    onChange={(e) => updateProbe('fastFind', Number(e.target.value) || 0)}
                                />
                                <span className="home-menu-unit">mm/min</span>
                                <button type="button" className="home-menu-kb-btn" aria-label="Open on-screen keyboard" title="Open on-screen keyboard" onClick={openKeyboardForInput}><Keyboard size={14} /></button>
                            </div>
                            <p className="home-menu-desc">Probe speed before the first touch-off. (Default 150)</p>
                        </div>
                        <div className="home-menu-row home-menu-row-with-desc">
                            <label className="home-menu-label">Slow find</label>
                            <div className="home-menu-input-wrap">
                                <input
                                    type="number"
                                    className="home-menu-input"
                                    value={probeSettings.slowFind}
                                    onChange={(e) => updateProbe('slowFind', Number(e.target.value) || 0)}
                                />
                                <span className="home-menu-unit">mm/min</span>
                                <button type="button" className="home-menu-kb-btn" aria-label="Open on-screen keyboard" title="Open on-screen keyboard" onClick={openKeyboardForInput}><Keyboard size={14} /></button>
                            </div>
                            <p className="home-menu-desc">Speed for the more accurate second touch-off. (Default 75)</p>
                        </div>
                        <div className="home-menu-row home-menu-row-with-desc">
                            <label className="home-menu-label">Retraction</label>
                            <div className="home-menu-input-wrap">
                                <input
                                    type="number"
                                    className="home-menu-input"
                                    value={probeSettings.retraction}
                                    onChange={(e) => updateProbe('retraction', Number(e.target.value) || 0)}
                                />
                                <span className="home-menu-unit">mm</span>
                                <button type="button" className="home-menu-kb-btn" aria-label="Open on-screen keyboard" title="Open on-screen keyboard" onClick={openKeyboardForInput}><Keyboard size={14} /></button>
                            </div>
                            <p className="home-menu-desc">How far the bit moves away after a successful touch. (Default 2)</p>
                        </div>
                        <div className="home-menu-row home-menu-row-with-desc">
                            <label className="home-menu-label">Connection test</label>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={probeSettings.connectionTest}
                                className={`home-menu-toggle ${probeSettings.connectionTest ? 'on' : ''}`}
                                onClick={() => updateProbe('connectionTest', !probeSettings.connectionTest)}
                            >
                                <span className="home-menu-toggle-thumb" />
                            </button>
                            <p className="home-menu-desc">Safety check to ensure your probe is connected correctly.</p>
                        </div>
                    </>
                )}

                {selectedSection === 'basics' && (
                    <>
                        <h4 className="home-menu-section-title">Basics</h4>
                        <div className="home-menu-row home-menu-row-with-desc">
                            <label className="home-menu-label">Carve screen units</label>
                            <div className="home-menu-radio-group">
                                <label className="home-menu-radio">
                                    <input
                                        type="radio"
                                        name="units"
                                        checked={appPreferences.units === 'mm'}
                                        onChange={() => updatePref('units', 'mm')}
                                    />
                                    <span>mm</span>
                                </label>
                                <label className="home-menu-radio">
                                    <input
                                        type="radio"
                                        name="units"
                                        checked={appPreferences.units === 'in'}
                                        onChange={() => updatePref('units', 'in')}
                                    />
                                    <span>in</span>
                                </label>
                            </div>
                            <p className="home-menu-desc">Units on the carve screen. Config remains metric.</p>
                        </div>
                        <div className="home-menu-row home-menu-row-with-desc">
                            <label className="home-menu-label">Reconnect automatically</label>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={appPreferences.reconnectAutomatically}
                                className={`home-menu-toggle ${appPreferences.reconnectAutomatically ? 'on' : ''}`}
                                onClick={() => updatePref('reconnectAutomatically', !appPreferences.reconnectAutomatically)}
                            >
                                <span className="home-menu-toggle-thumb" />
                            </button>
                            <p className="home-menu-desc">Reconnect to the last machine when you open the app.</p>
                        </div>
                        <div className="home-menu-row home-menu-row-with-desc">
                            <label className="home-menu-label">Firmware fallback</label>
                            <select
                                className="home-menu-select"
                                value={appPreferences.firmwareFallback}
                                onChange={(e) => updatePref('firmwareFallback', e.target.value)}
                            >
                                <option value="grbl">grbl</option>
                                <option value="grblHAL">grblHAL</option>
                                <option value="FluidNC">FluidNC</option>
                            </select>
                            <p className="home-menu-desc">Firmware to use if automatic detection fails.</p>
                        </div>
                        <div className="home-menu-row home-menu-row-with-desc">
                            <label className="home-menu-label">Baud rate</label>
                            <select
                                className="home-menu-select"
                                value={String(appPreferences.baudRate)}
                                onChange={(e) => updatePref('baudRate', Number(e.target.value))}
                            >
                                <option value="9600">9600</option>
                                <option value="19200">19200</option>
                                <option value="38400">38400</option>
                                <option value="57600">57600</option>
                                <option value="115200">115200</option>
                                <option value="230400">230400</option>
                                <option value="460800">460800</option>
                                <option value="921600">921600</option>
                            </select>
                            <p className="home-menu-desc">GRBL/grblHAL: 115200, RTS/Buildbotics: 230400</p>
                        </div>
                        <div className="home-menu-row home-menu-row-with-desc">
                            <label className="home-menu-label">Flow control</label>
                            <select
                                className="home-menu-select"
                                value={appPreferences.rtscts ? 'rtscts' : 'none'}
                                onChange={(e) => updatePref('rtscts', e.target.value === 'rtscts')}
                            >
                                <option value="none">None</option>
                                <option value="rtscts">RTS/CTS (Hardware)</option>
                            </select>
                            <p className="home-menu-desc">RTS/Buildbotics boards need RTS/CTS enabled</p>
                        </div>
                        <div className="home-menu-row home-menu-row-with-desc">
                            <label className="home-menu-label">Safe height</label>
                            <div className="home-menu-input-wrap">
                                <input
                                    type="number"
                                    className="home-menu-input"
                                    value={appPreferences.safeHeight}
                                    onChange={(e) => updatePref('safeHeight', Number(e.target.value) || 0)}
                                />
                                <span className="home-menu-unit">mm</span>
                                <button type="button" className="home-menu-kb-btn" aria-label="Open on-screen keyboard" title="Open on-screen keyboard" onClick={openKeyboardForInput}><Keyboard size={14} /></button>
                            </div>
                            <p className="home-menu-desc">Z moves up by this amount before X/Y in go-tos. (Default 0)</p>
                        </div>
                        <div className="home-menu-row home-menu-row-with-desc">
                            <label className="home-menu-label">Run Check mode on file load</label>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={appPreferences.runCheckOnFileLoad}
                                className={`home-menu-toggle ${appPreferences.runCheckOnFileLoad ? 'on' : ''}`}
                                onClick={() => updatePref('runCheckOnFileLoad', !appPreferences.runCheckOnFileLoad)}
                            >
                                <span className="home-menu-toggle-thumb" />
                            </button>
                            <p className="home-menu-desc">Runs Check Mode ($C) on the gcode file after loading.</p>
                        </div>
                        <div className="home-menu-row home-menu-row-with-desc">
                            <label className="home-menu-label">Outline style</label>
                            <select
                                className="home-menu-select"
                                value={appPreferences.outlineStyle}
                                onChange={(e) => updatePref('outlineStyle', e.target.value)}
                            >
                                <option value="Detailed">Detailed</option>
                                <option value="Square">Square</option>
                            </select>
                            <p className="home-menu-desc">Detailed follows the file outline; Square is a faster box outline.</p>
                        </div>
                    </>
                )}
            </div>
            <OnScreenKeyboard
                targetInput={keyboardTarget}
                onClose={() => setKeyboardTarget(null)}
                panelRef={keyboardPanelRef}
            />
        </div>
    );
}
