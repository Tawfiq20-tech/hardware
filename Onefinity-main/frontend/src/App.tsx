import { useState } from 'react';
import './App.css';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import Workspace3D from './components/Workspace3D';
import DevicePanel from './components/DevicePanel';
import ProjectPanel from './components/ProjectPanel';
import ErrorBoundary from './components/ErrorBoundary';

export default function App() {
    const [activeHeaderTab, setActiveHeaderTab] = useState('Prepare');

    return (
        <ErrorBoundary fallbackMessage="Application encountered an error">
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
            </div>
        </ErrorBoundary>
    );
}
