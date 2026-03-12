import { Play, Pause, Square, Zap } from 'lucide-react';
import { useCNCStore } from '../stores/cncStore';
import {
    backendJobStart,
    backendJobPause,
    backendJobResume,
    backendJobStop,
    sendBackendCommand,
} from '../utils/backendConnection';
import controller from '../utils/controller';
import './JobControlBar.css';

export default function JobControlBar() {
    const {
        connected,
        machineState,
        gcode,
        jobProgress,
        currentLine,
        fileInfo,
        rawGcodeContent,
        addConsoleLog,
    } = useCNCStore();

    const handlePlayPause = () => {
        if (!connected || gcode.length === 0) return;
        if (machineState === 'idle') {
            // Load file into backend sender and start
            if (rawGcodeContent) {
                controller.loadFile(fileInfo?.name || 'job.gcode', rawGcodeContent);
            }
            backendJobStart();
            addConsoleLog('info', 'Job started');
        } else if (machineState === 'paused') {
            backendJobResume();
            addConsoleLog('info', 'Job resumed');
        } else if (machineState === 'running') {
            backendJobPause();
            addConsoleLog('warning', 'Job paused');
        }
    };

    const handleStop = () => {
        if (!connected) return;
        backendJobStop();
        addConsoleLog('warning', 'Job stopped');
    };

    const handleEmergencyStop = () => {
        if (!connected) return;
        // Send immediate halt command (0x85 - jog cancel, then reset)
        sendBackendCommand('!'); // Feed hold
        setTimeout(() => {
            sendBackendCommand('\x18'); // Soft reset (Ctrl+X)
        }, 100);
        addConsoleLog('error', 'EMERGENCY STOP ACTIVATED');
    };

    const isJobDisabled = !connected || gcode.length === 0;
    const canStop = connected && (machineState === 'running' || machineState === 'paused');

    // Only render if there's a file loaded
    if (gcode.length === 0) return null;

    return (
        <div className="job-control-bar">
            <button
                className={`job-play-btn ${machineState === 'running' ? 'running' : ''}`}
                onClick={handlePlayPause}
                disabled={isJobDisabled}
                title={machineState === 'running' ? 'Pause' : 'Play'}
            >
                {machineState === 'running' ? <Pause size={16} /> : <Play size={16} />}
            </button>

            <div className="job-info">
                <div className="job-stats-row">
                    <span>Lines <span className="job-stat-val">{gcode.length}</span></span>
                    <span>Current <span className="job-stat-val">{currentLine}</span></span>
                    <span><span className="job-stat-val">{Math.round(jobProgress)}%</span></span>
                </div>
                <div className="job-progress-bar">
                    <div className="job-progress-fill" style={{ width: `${jobProgress}%` }} />
                </div>
            </div>

            <button
                className="job-stop-btn"
                onClick={handleStop}
                disabled={!canStop}
                title="Stop"
            >
                <Square size={14} />
            </button>

            <button
                className="emergency-stop-btn"
                onClick={handleEmergencyStop}
                disabled={!connected}
                title="Emergency Stop (Feed Hold + Reset)"
            >
                <Zap size={14} />
                E-STOP
            </button>
        </div>
    );
}