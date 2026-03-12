# CNC Controller Application Status

## ✅ Current Running Servers:

### Backend Server
- **Status:** ✅ RUNNING
- **Port:** 4000
- **URL:** http://localhost:4000
- **Test:** http://localhost:4000/api/health

### Frontend Server  
- **Status:** ✅ RUNNING
- **Port:** 3001 (changed from 3000!)
- **URL:** http://localhost:3001
- **Network:** http://10.1.186.243:3001

## 🔧 Troubleshooting Steps:

### Step 1: Access the Correct URL
**IMPORTANT:** The frontend is now on **PORT 3001** (not 3000!)

Open your browser and go to:
```
http://localhost:3001
```

### Step 2: Clear Browser Cache
If you see the old page:
1. Press `Ctrl + Shift + R` (Windows) or `Cmd + Shift + R` (Mac)
2. Or open browser DevTools (F12) and right-click refresh → "Empty Cache and Hard Reload"

### Step 3: Check Backend Connection
Open in browser: http://localhost:4000/api/health

You should see:
```json
{
  "status": "ok",
  "uptime": 123.45,
  "connected": false,
  "health": null
}
```

### Step 4: Check Browser Console
1. Open the page: http://localhost:3001
2. Press F12 to open DevTools
3. Go to Console tab
4. Look for any error messages (especially WebSocket or connection errors)
5. Share any red error messages you see

### Step 5: Verify Processes
Run in PowerShell:
```powershell
# Check backend (should show port 4000)
netstat -ano | findstr ":4000"

# Check frontend (should show port 3001)  
netstat -ano | findstr ":3001"
```

## 🚀 Quick Start Commands

If you need to restart:

### Restart Backend:
```bash
cd backend
npm start
```

### Restart Frontend:
```bash
cd frontend
npm run dev
```

## 📱 Mobile Access

From your phone/tablet on the same network:
```
http://10.1.186.243:3001
```

## 🆘 Still Not Working?

1. **Check Windows Firewall** - Make sure it's not blocking ports 3001 or 4000
2. **Check Antivirus** - Temporarily disable to test
3. **Try Different Browser** - Chrome, Firefox, or Edge
4. **Check Terminal Output** - Look for errors in the terminal windows

## 📊 Current Configuration

- **Backend:** Node.js + Express + Socket.IO on port 4000
- **Frontend:** React + Vite on port 3001
- **CORS:** Enabled (allows all origins)
- **WebSocket:** Available at ws://localhost:4000/socket.io

## ✨ Features Available

Once connected, you'll have access to:
- ✅ Digital Readout (DRO) with position display
- ✅ Jog controls (8-direction + Z axis)
- ✅ File upload and G-code visualization
- ✅ Job control (start, pause, stop)
- ✅ Emergency stop
- ✅ Console/Terminal
- ✅ Macro system
- ✅ Probing tools
- ✅ Mobile responsive design
