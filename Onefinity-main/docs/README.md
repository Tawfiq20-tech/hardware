# CNC Industrial Control Interface

A modern, industrial-grade CNC machine control interface built with React, TypeScript, and Three.js, following the same tech stack as the OnefinityRepo.

## 📁 Project structure

- **`frontend/`** – React + Vite UI (TypeScript, Three.js, Zustand, Socket.io client). Run with `npm run dev` from root or from `frontend/`.
- **`backend/`** – Node.js server (Express, Socket.io, Serialport, GRBL). Run with `npm run backend` from root or `npm run start` from `backend/`.

From the **project root**:
- `npm run dev` – start frontend dev server (port 3000)
- `npm run backend` – start backend API (port 4000)
- `npm run dev:all` – start both frontend and backend

Install dependencies: run `npm install` at the root, then `npm install` in both `frontend/` and `backend/` (or run from each folder before first use).

### Logging

- **Backend:** Winston writes app logs to `backend/logs/app.log` and to the console. Frontend can send log entries via `POST /api/log` (they appear in the same app log). Machine/session data (position, state, console, job events) is written to JSON Lines files in `backend/logs/sessions/` (one file per connection). The `logs/` directory is gitignored.
- **Frontend:** A small logger in `frontend/src/utils/logger.ts` buffers entries in memory and optionally posts them to the backend; use for connection, file, and job events and in error handlers.

### Motion controller queue

G-code sent to the motion controller (GRBL or grblHAL) is sent through a single path: one line at a time, and the next line is sent only after the controller acknowledges the previous one (e.g. `ok`). The backend `GCodeFeeder` enforces this so the hardware never receives overlapping commands.

### Job queue (Bull)

The backend can queue g-code jobs (e.g. multiple files) and run them one after another. This requires **Redis**. Install and start Redis (e.g. `redis-server` or Docker), then set `REDIS_URL` if needed (default `redis://localhost:6379`). If Redis is not available, the "Add to queue" button will report an error; "Play" (run now) still works without Redis.

### Docker

From the project root run:

- `docker compose up -d` – start Redis (6060), backend (6070), frontend (6080). Open the app at **http://localhost:6080**; the frontend proxies `/api` and `/socket.io` to the backend.
- Backend logs (Winston + session logs) are stored in a named volume `backend-logs` and persist across restarts. Inspect with `docker compose exec backend cat /app/logs/app.log` or by mounting the volume.
- Optional: `docker compose --profile tools up -d` – also starts **Dozzle** on port 6040 for viewing container logs in the browser.
- Set `LOG_LEVEL=debug` and/or `VITE_API_URL=` in `.env` if needed (empty `VITE_API_URL` uses same-origin `/api` in production).

## 🚀 Tech Stack

- **React 18** - Modern React with hooks and functional components
- **TypeScript** - Type-safe development
- **Vite** - Fast build tool and dev server
- **Three.js** - 3D graphics and visualization
- **@react-three/fiber** - React renderer for Three.js
- **@react-three/drei** - Useful helpers for React Three Fiber
- **Zustand** - Lightweight state management
- **Lucide React** - Beautiful icon library

## 🎨 Features

### Industrial Dark Theme
- Professional dark color scheme optimized for long CNC operation sessions
- CSS variables for consistent theming
- Glassmorphism effects on HUD elements
- Smooth transitions and animations

### Main Components

#### 1. **Sidebar Navigation**
- Vertical navigation with icons
- Active state indicators with glow effects
- Sections: Carve, Scope, Paths, Logic
- Settings button at bottom

#### 2. **Header**
- Machine status with animated pulse indicator
- Real-time metrics (Feed Rate, Spindle Speed)
- Active tool display
- Emergency stop button

#### 3. **Control Panel**
- **Digital Readout (DRO)**: X, Y, Z coordinates with distance-to-go
- **Axis Load Indicators**: Visual load percentage for each axis
- **Jog Controls**: Directional buttons for manual positioning
- **Step Size Selector**: Quick selection of jog increments
- **Feed/Speed Overrides**: Sliders for feed rate, spindle, and rapid travel

#### 4. **3D Viewport**
- Interactive 3D visualization using Three.js
- Orbit controls for camera manipulation
- Grid system for spatial reference
- Mock toolpath visualization
- HUD overlays with viewport controls
- Navigation cube for orientation
- Axis legend with color-coded indicators

#### 5. **Bottom Panel**
- **Job Progress**: File name, percentage, elapsed/remaining time
- **Progress Bar**: Visual job completion indicator
- **Playback Controls**: Resume, pause, reset buttons
- **Console/Terminal**: G-code command output and input
- **Quick Commands**: Fast access to common G-code commands

## 📦 Installation

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## 🌐 Development Server

The app runs on `http://localhost:3000` by default.

## 🏗️ Project Structure

```
ui_enhance/
├── src/
│   ├── components/
│   │   ├── Sidebar.tsx / .css
│   │   ├── Header.tsx / .css
│   │   ├── ControlPanel.tsx / .css
│   │   ├── Viewport3D.tsx / .css
│   │   └── BottomPanel.tsx / .css
│   ├── stores/
│   ├── App.tsx
│   ├── App.css
│   ├── main.tsx
│   └── index.css (Design System)
├── package.json
├── tsconfig.json
├── vite.config.ts
└── index.html
```

## 🎨 Design System

The application uses a comprehensive CSS variable-based design system defined in `src/index.css`:

### Color Palette
- **Background**: Dark gradients (#0b0f14 to #141f2a)
- **Panels**: Semi-transparent dark overlays
- **Accent**: Blue (#6f8fe6)
- **Success**: Green (#62c48d)
- **Danger**: Red (#e15a5a)
- **Warning**: Amber (#d9a441)

### Spacing Scale
- `--space-1` to `--space-6` (4px to 24px)

### Border Radius
- `--radius-sm` to `--radius-2xl` (4px to 24px)

### Transitions
- Fast, normal, and slow timing functions

## 🔧 Customization

### Changing Colors
Edit the CSS variables in `src/index.css`:

```css
:root {
  --accent: #your-color;
  --success: #your-color;
  /* ... */
}
```

### Adding New Components
1. Create component file in `src/components/`
2. Create corresponding CSS file
3. Import and use in `App.tsx`

## 📱 Responsive Design

The interface is optimized for desktop CNC control stations. For tablet/mobile support, additional media queries would be needed.

## 🚧 Future Enhancements

- [ ] Real CNC machine connection via WebSocket
- [ ] G-code file upload and parsing
- [ ] Real-time toolpath visualization
- [ ] Job history and logging
- [ ] User preferences and settings
- [ ] Multi-language support
- [ ] Touch screen optimization

## 📄 License

This project follows the same structure and patterns as the OnefinityRepo.

## 🙏 Acknowledgments

- Design inspired by modern industrial HMI interfaces
- Tech stack matches the Onefinity CNC control system
- Icons by Lucide React
