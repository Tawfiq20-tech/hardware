import { useState, useEffect } from 'react';
import { FolderOpen, Clock, FileText, Trash2, Play, Eye, MoreVertical } from 'lucide-react';
import { useCNCStore } from '../stores/cncStore';
import { backendJobLoad, backendJobStart } from '../utils/backendConnection';
import './ProjectPanel.css';

interface Project {
    id: string;
    name: string;
    fileName: string;
    lastRun: string;
    createdAt: string;
    status: 'completed' | 'failed' | 'running' | 'pending';
    duration?: string;
    lines: number;
    fileSize: number;
    thumbnail?: string;
}

export default function ProjectPanel() {
    const [projects, setProjects] = useState<Project[]>([]);
    const [selectedProject, setSelectedProject] = useState<Project | null>(null);
    const [activeMenu, setActiveMenu] = useState<string | null>(null);

    // Load projects from localStorage on mount
    useEffect(() => {
        const savedProjects = localStorage.getItem('cncProjects');
        if (savedProjects) {
            setProjects(JSON.parse(savedProjects));
        } else {
            // Demo data for initial view
            setProjects([
                {
                    id: '1',
                    name: 'Enclosure Panel',
                    fileName: 'panel_v2.gcode',
                    lastRun: '2026-02-14T10:30:00',
                    createdAt: '2026-02-10T14:20:00',
                    status: 'completed',
                    duration: '2h 15m',
                    lines: 15420,
                    fileSize: 892000
                },
                {
                    id: '2',
                    name: 'Logo Engraving',
                    fileName: 'logo_design.nc',
                    lastRun: '2026-02-13T16:45:00',
                    createdAt: '2026-02-13T14:00:00',
                    status: 'completed',
                    duration: '45m',
                    lines: 8932,
                    fileSize: 456000
                },
                {
                    id: '3',
                    name: 'PCB Drilling',
                    fileName: 'pcb_holes.gcode',
                    lastRun: '2026-02-12T09:15:00',
                    createdAt: '2026-02-11T11:30:00',
                    status: 'failed',
                    duration: '1h 5m',
                    lines: 12045,
                    fileSize: 678000
                },
                {
                    id: '4',
                    name: 'Name Plate',
                    fileName: 'nameplate.nc',
                    lastRun: '2026-02-10T13:20:00',
                    createdAt: '2026-02-09T16:45:00',
                    status: 'completed',
                    duration: '30m',
                    lines: 5234,
                    fileSize: 234000
                }
            ]);
        }
    }, []);

    // Save projects to localStorage whenever they change
    useEffect(() => {
        if (projects.length > 0) {
            localStorage.setItem('cncProjects', JSON.stringify(projects));
        }
    }, [projects]);

    const formatDate = (dateString: string): string => {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    const formatFileSize = (bytes: number): string => {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1048576).toFixed(1) + ' MB';
    };

    const getStatusColor = (status: Project['status']): string => {
        switch (status) {
            case 'completed': return 'status-completed';
            case 'failed': return 'status-failed';
            case 'running': return 'status-running';
            case 'pending': return 'status-pending';
        }
    };

    const getStatusText = (status: Project['status']): string => {
        return status.charAt(0).toUpperCase() + status.slice(1);
    };

    const handleDeleteProject = (projectId: string) => {
        setProjects(projects.filter(p => p.id !== projectId));
        if (selectedProject?.id === projectId) {
            setSelectedProject(null);
        }
        setActiveMenu(null);
    };

    const handleRunProject = (project: Project) => {
        const { connected, machineState, rawGcodeContent } = useCNCStore.getState();
        if (!connected || machineState !== 'idle') {
            console.warn('Cannot run: machine not connected or not idle');
            return;
        }

        // Update project status to running
        setProjects(prev => prev.map(p =>
            p.id === project.id ? { ...p, status: 'running' as const, lastRun: new Date().toISOString() } : p
        ));

        // If we have cached G-code content, load and start the job
        // Otherwise the user needs to re-load the file first
        if (rawGcodeContent) {
            backendJobLoad(rawGcodeContent);
            setTimeout(() => backendJobStart(), 200);
        } else {
            console.warn('No G-code content loaded — please load the file first');
            useCNCStore.getState().addConsoleLog('warning', `Re-load ${project.fileName} to run it`);
        }

        setActiveMenu(null);
    };

    const handleViewProject = (project: Project) => {
        setSelectedProject(project);
        setActiveMenu(null);
    };

    return (
        <div className="project-panel">
            <div className="project-container">
                {/* Header */}
                <div className="project-header">
                    <div className="header-title">
                        <FolderOpen size={24} />
                        <h2>Project History</h2>
                    </div>
                    <div className="header-stats">
                        <div className="stat-item">
                            <span className="stat-label">Total Projects</span>
                            <span className="stat-value">{projects.length}</span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-label">Completed</span>
                            <span className="stat-value">{projects.filter(p => p.status === 'completed').length}</span>
                        </div>
                    </div>
                </div>

                {/* Project List */}
                <div className="project-content">
                    <div className="project-list">
                        {projects.length === 0 ? (
                            <div className="empty-state">
                                <FolderOpen size={64} />
                                <h3>No Projects Yet</h3>
                                <p>Your completed projects will appear here</p>
                            </div>
                        ) : (
                            projects.map((project) => (
                                <div
                                    key={project.id}
                                    className={`project-card ${selectedProject?.id === project.id ? 'selected' : ''}`}
                                    onClick={() => handleViewProject(project)}
                                >
                                    <div className="project-card-header">
                                        <div className="project-icon">
                                            <FileText size={20} />
                                        </div>
                                        <div className="project-info">
                                            <h3 className="project-name">{project.name}</h3>
                                            <p className="project-filename">{project.fileName}</p>
                                        </div>
                                        <div className="project-actions">
                                            <button
                                                className="action-menu-btn"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setActiveMenu(activeMenu === project.id ? null : project.id);
                                                }}
                                            >
                                                <MoreVertical size={16} />
                                            </button>
                                            {activeMenu === project.id && (
                                                <div className="action-menu">
                                                    <button onClick={() => handleRunProject(project)}>
                                                        <Play size={14} />
                                                        Run Again
                                                    </button>
                                                    <button onClick={() => handleViewProject(project)}>
                                                        <Eye size={14} />
                                                        View Details
                                                    </button>
                                                    <button 
                                                        className="delete-btn"
                                                        onClick={() => handleDeleteProject(project.id)}
                                                    >
                                                        <Trash2 size={14} />
                                                        Delete
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <div className="project-card-body">
                                        <div className="project-meta">
                                            <div className="meta-item">
                                                <Clock size={14} />
                                                <span>{formatDate(project.lastRun)}</span>
                                            </div>
                                            <div className={`project-status ${getStatusColor(project.status)}`}>
                                                <div className="status-dot"></div>
                                                <span>{getStatusText(project.status)}</span>
                                            </div>
                                        </div>

                                        <div className="project-stats">
                                            <div className="stat">
                                                <span className="stat-label">Lines</span>
                                                <span className="stat-value">{project.lines.toLocaleString()}</span>
                                            </div>
                                            <div className="stat">
                                                <span className="stat-label">Duration</span>
                                                <span className="stat-value">{project.duration || 'N/A'}</span>
                                            </div>
                                            <div className="stat">
                                                <span className="stat-label">Size</span>
                                                <span className="stat-value">{formatFileSize(project.fileSize)}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    {/* Project Details Sidebar */}
                    {selectedProject && (
                        <div className="project-details">
                            <div className="details-header">
                                <h3>Project Details</h3>
                                <button
                                    className="close-details"
                                    onClick={() => setSelectedProject(null)}
                                >
                                    ×
                                </button>
                            </div>

                            <div className="details-content">
                                <div className="detail-section">
                                    <h4>General Information</h4>
                                    <div className="detail-row">
                                        <span className="detail-label">Project Name</span>
                                        <span className="detail-value">{selectedProject.name}</span>
                                    </div>
                                    <div className="detail-row">
                                        <span className="detail-label">File Name</span>
                                        <span className="detail-value">{selectedProject.fileName}</span>
                                    </div>
                                    <div className="detail-row">
                                        <span className="detail-label">Status</span>
                                        <span className={`detail-value ${getStatusColor(selectedProject.status)}`}>
                                            {getStatusText(selectedProject.status)}
                                        </span>
                                    </div>
                                </div>

                                <div className="detail-section">
                                    <h4>Execution Details</h4>
                                    <div className="detail-row">
                                        <span className="detail-label">Last Run</span>
                                        <span className="detail-value">
                                            {new Date(selectedProject.lastRun).toLocaleString()}
                                        </span>
                                    </div>
                                    <div className="detail-row">
                                        <span className="detail-label">Created At</span>
                                        <span className="detail-value">
                                            {new Date(selectedProject.createdAt).toLocaleString()}
                                        </span>
                                    </div>
                                    <div className="detail-row">
                                        <span className="detail-label">Duration</span>
                                        <span className="detail-value">{selectedProject.duration || 'N/A'}</span>
                                    </div>
                                </div>

                                <div className="detail-section">
                                    <h4>File Information</h4>
                                    <div className="detail-row">
                                        <span className="detail-label">Total Lines</span>
                                        <span className="detail-value">{selectedProject.lines.toLocaleString()}</span>
                                    </div>
                                    <div className="detail-row">
                                        <span className="detail-label">File Size</span>
                                        <span className="detail-value">{formatFileSize(selectedProject.fileSize)}</span>
                                    </div>
                                </div>

                                <div className="detail-actions">
                                    <button 
                                        className="btn-primary-detail"
                                        onClick={() => handleRunProject(selectedProject)}
                                    >
                                        <Play size={16} />
                                        Run Again
                                    </button>
                                    <button 
                                        className="btn-danger-detail"
                                        onClick={() => handleDeleteProject(selectedProject.id)}
                                    >
                                        <Trash2 size={16} />
                                        Delete Project
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
