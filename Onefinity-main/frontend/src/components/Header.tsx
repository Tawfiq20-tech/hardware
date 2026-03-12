import { useState, useRef } from 'react';
import { Square, Home, ChevronDown } from 'lucide-react';
import { useCNCStore } from '../stores/cncStore';
import { backendSoftReset } from '../utils/backendConnection';
import HomeMenu from './HomeMenu';
import './Header.css';

interface HeaderProps {
    activeTab: string;
    setActiveTab: (tab: string) => void;
}

const NAV_TABS = ['Prepare', 'Preview', 'Device', 'Project'];

export default function Header({ activeTab, setActiveTab }: HeaderProps) {
    const [homeMenuOpen, setHomeMenuOpen] = useState(false);
    const homeBtnRef = useRef<HTMLButtonElement>(null);

    const { 
        connected, 
        machineState, 
        feedRate, 
        spindleSpeed, 
        isInitialized,
        firmwareType,
        firmwareVersion,
        addConsoleLog 
    } = useCNCStore();

    const getStatusText = () => {
        if (!connected) return 'OFFLINE';
        if (connected && !isInitialized) return 'INITIALIZING';
        return machineState.toUpperCase();
    };

    const getStatusDotClass = () => {
        if (!connected) return 'disconnected';
        if (connected && !isInitialized) return 'initializing';
        return machineState;
    };

    return (
        <header className="header flex items-center justify-between h-12 px-4 bg-bg-sidebar border-b border-border-ui">
            <div className="header-left flex items-center gap-3">
                {/* Home button + dropdown */}
                <div className="header-home-wrap">
                    <button
                        ref={homeBtnRef}
                        type="button"
                        className={`home-btn flex items-center gap-1 px-3 py-1.5 text-text-dim hover:text-text-main transition-colors duration-fast ${homeMenuOpen ? 'active' : ''}`}
                        aria-label="Home menu"
                        aria-expanded={homeMenuOpen}
                        aria-haspopup="dialog"
                        onClick={() => setHomeMenuOpen((v) => !v)}
                    >
                        <Home size={16} />
                        <ChevronDown size={8} />
                    </button>
                    <HomeMenu
                        isOpen={homeMenuOpen}
                        onClose={() => setHomeMenuOpen(false)}
                        anchorRef={homeBtnRef}
                    />
                </div>

                {/* Navigation Tabs */}
                <nav className="nav-tabs flex" role="tablist">
                    {NAV_TABS.map(tab => (
                        <button
                            key={tab}
                            className={`nav-tab px-4 py-2 text-sm font-medium transition-colors duration-fast border-b-2 ${
                                activeTab === tab 
                                    ? 'text-primary border-primary' 
                                    : 'text-text-dim border-transparent hover:text-text-main'
                            }`}
                            role="tab"
                            aria-selected={activeTab === tab}
                            onClick={() => setActiveTab(tab)}
                        >
                            {tab}
                        </button>
                    ))}
                </nav>
            </div>

            {/* Center — Status */}
            <div className="header-center flex items-center gap-4">
                <div className="machine-status-pill flex items-center gap-2 px-3 py-1 bg-bg-panel border border-border-ui rounded-md">
                    <div className={`status-dot w-2 h-2 rounded-full ${getStatusDotClass()}`} />
                    <span className="text-xs font-semibold text-text-main tracking-wider">{getStatusText()}</span>
                </div>

                {connected && isInitialized && (
                    <>
                        <div className="metric-inline text-xs text-text-dim font-mono">
                            F <span className="metric-val text-primary font-bold">{(feedRate * 32.4).toFixed(0)}</span> mm/min
                        </div>
                        <div className="metric-inline text-xs text-text-dim font-mono">
                            S <span className="metric-val text-primary font-bold">{(spindleSpeed * 185).toFixed(0)}</span> RPM
                        </div>
                        {firmwareType !== 'unknown' && (
                            <div className="metric-inline text-xs text-text-dim font-mono">
                                <span className="metric-val text-primary font-bold">{firmwareType}</span> {firmwareVersion}
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Right — Actions */}
            <div className="header-right">
                <button
                    className={`btn-danger flex items-center gap-2 px-3 py-1.5 text-xs font-bold rounded-md border transition-all duration-fast ${
                        !connected 
                            ? 'opacity-30 cursor-not-allowed bg-bg-panel border-border-ui text-text-dim' 
                            : 'bg-status-danger border-status-danger text-white hover:bg-red-600 hover:border-red-600'
                    }`}
                    disabled={!connected}
                    onClick={() => {
                        try {
                            backendSoftReset();
                            addConsoleLog('warning', 'E-STOP: Soft reset sent');
                        } catch (_) {}
                    }}
                >
                    <Square size={12} fill="currentColor" />
                    E-Stop
                </button>
            </div>
        </header>
    );
}
