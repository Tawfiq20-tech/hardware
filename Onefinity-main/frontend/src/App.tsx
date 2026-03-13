import { useRef } from 'react';
import { useState } from 'react';
import './App.css';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import Workspace3D from './components/Workspace3D';
import DevicePanel from './components/DevicePanel';
import ProjectPanel from './components/ProjectPanel';
import ErrorBoundary from './components/ErrorBoundary';
import StatusBar from './components/StatusBar';
import { QuickHelpButton } from './components/KeyboardShortcuts';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

function AppInner() {
    const [activeHeaderTab, setActiveHeaderTab] = useState('Prepare');
    const fileInputTriggerRef = useRef<(() => void) | null>(null);

    // Activate global keyboard shortcuts — Ctrl+O triggers file open via sidebar
    useKeyboardShortcuts(() => {
        // Try to find and trigger the file input in Sidebar
        const fileInput = document.querySelector<HTMLInputElement>('input[type="file"][accept]');
        if (fileInput) fileInput.click();
    });

    return (
        <div className="app">
            <Header activeTab={activeHeaderTab} setActiveTab={setActiveHeaderTab} />

            <main className="app-main">
                {(activeHeaderTab === 'Prepare' || activeHeaderTab === 'Preview') && (
                    <ErrorBoundary fallbackMessage="Sidebar error">
                        <Sidebar />
                    </ErrorBoundary>
                )}

                <div className="viewport-container">
                    {activeHeaderTab === 'Device' && (
                        <ErrorBoundary fallbackMessage="Device panel error">
                            <DevicePanel />
                        </ErrorBoundary>
                    )}
                    {activeHeaderTab === 'Project' && (
                        <ErrorBoundary fallbackMessage="Project panel error">
                            <ProjectPanel />
                        </ErrorBoundary>
                    )}
                    {(activeHeaderTab === 'Prepare' || activeHeaderTab === 'Preview') && (
                        <ErrorBoundary fallbackMessage="3D viewport error">
                            <Workspace3D />
                        </ErrorBoundary>
                    )}
                </div>
            </main>

            {/* Bottom status bar — always visible */}
            <StatusBar />

            {/* Floating quick-help button */}
            <QuickHelpButton />

            {/* Hidden ref holder */}
            <span ref={fileInputTriggerRef as React.RefObject<HTMLSpanElement>} style={{ display: 'none' }} />
        </div>
    );
}

export default function App() {
    return (
        <ErrorBoundary fallbackMessage="Application encountered an error">
            <AppInner />
        </ErrorBoundary>
    );
}
