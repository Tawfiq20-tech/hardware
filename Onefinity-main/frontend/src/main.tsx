import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { log } from './utils/logger'

window.onerror = (message, source, lineno, colno, error) => {
    log('error', String(message), { source, lineno, colno, stack: error?.stack })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
)
