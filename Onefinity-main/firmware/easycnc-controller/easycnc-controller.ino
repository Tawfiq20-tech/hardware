/**
 * EasyCNC Controller Firmware
 *
 * ESP32-based 4-axis CNC controller with step/dir drivers.
 * Axes: X, Y (Y1), Z, A (Y2) — Y1 and A(Y2) move together as dual-Y gantry.
 *
 * Accepts G-code over Serial (USB, 115200 baud):
 *   G0 X10 Y20 Z5          — Rapid move
 *   G1 X10 Y20 F1000       — Linear move at feed rate (mm/min)
 *   G28                    — Home all axes
 *   G28 X                  — Home single axis
 *   G90                    — Absolute positioning
 *   G91                    — Relative positioning
 *   G92 X0 Y0 Z0           — Set current position
 *   M114                   — Report position
 *   M0 / M1                — Stop all motion
 *   $X                     — Unlock/clear alarm
 *   $H                     — Home all axes
 *   ?                      — Status query
 *   $$                     — Show settings
 *
 * Pin assignments (ESP32):
 *   X_STEP=18, X_DIR=19
 *   Y_STEP=20, Y_DIR=21
 *   Z_STEP=10, Z_DIR=11
 *   A_STEP=4,  A_DIR=5
 */

#include <Arduino.h>

// ─── Pin Definitions ───────────────────────────────────────────────────────

#define X_STEP 18
#define X_DIR  19

#define Y_STEP 20
#define Y_DIR  21

#define Z_STEP 10
#define Z_DIR  11

#define A_STEP 4
#define A_DIR  5

// Enable pin (optional — set to -1 if not used)
#define ENABLE_PIN -1

// Limit switch pins (optional — set to -1 if not used)
#define X_LIMIT -1
#define Y_LIMIT -1
#define Z_LIMIT -1

// ─── Machine Configuration ────────────────────────────────────────────────

// Steps per mm (adjust based on your lead screw/belt and microstepping)
// Example: 200 steps/rev motor, 16 microsteps, 8mm lead = (200*16)/8 = 400 steps/mm
float stepsPerMm[4] = { 400.0, 400.0, 400.0, 400.0 };  // X, Y, Z, A

// Max travel in mm (for soft limits and homing)
float maxTravel[4] = { 300.0, 300.0, 100.0, 300.0 };  // X, Y, Z, A

// Max speed in mm/min
float maxSpeed[4] = { 5000.0, 5000.0, 2000.0, 5000.0 };

// Acceleration in mm/s²
float accel[4] = { 500.0, 500.0, 200.0, 500.0 };

// Homing direction: -1 = toward min, +1 = toward max
int homeDir[4] = { -1, -1, 1, -1 };  // X, Y, Z, A

// Homing speed in mm/min
float homeSpeed = 500.0;

// Invert direction: true = swap motor direction
bool invertDir[4] = { false, false, false, false };

// Dual-Y gantry: A axis mirrors Y axis during G-code moves
#define DUAL_Y_GANTRY true

// ─── State ─────────────────────────────────────────────────────────────────

// Current position in steps
volatile long posSteps[4] = { 0, 0, 0, 0 };

// Current position in mm
float posMm[4] = { 0.0, 0.0, 0.0, 0.0 };

// Target position in steps for current move
long targetSteps[4] = { 0, 0, 0, 0 };

// Movement state
bool isMoving = false;
bool isHoming = false;
bool isAbsolute = true;  // G90 = absolute, G91 = relative
bool isAlarm = false;
float currentFeedRate = 1000.0;  // mm/min

// Serial buffer
#define SERIAL_BUF_SIZE 256
char serialBuf[SERIAL_BUF_SIZE];
int serialBufIdx = 0;

// Step timing
const int STEP_PULSE_US = 5;  // Minimum step pulse width in microseconds

// ─── Stepper Engine (Bresenham line algorithm for coordinated motion) ─────

struct Move {
    long steps[4];       // Steps to move per axis (signed)
    long absSteps[4];    // Absolute steps per axis
    long totalSteps;     // Longest axis steps (drives the timing)
    long error[4];       // Bresenham error accumulators
    long stepsDone;      // Steps completed on dominant axis
    float feedRate;      // Feed rate in mm/min
    unsigned long stepIntervalUs;  // Microseconds between dominant axis steps
    unsigned long lastStepUs;      // Last step timestamp
    bool active;
};

Move currentMove = { .active = false };

// Acceleration state
float currentSpeedMmPerMin = 0;
float targetSpeedMmPerMin = 0;
unsigned long lastAccelUs = 0;

// ─── Pin Setup ─────────────────────────────────────────────────────────────

const int stepPins[4] = { X_STEP, Y_STEP, Z_STEP, A_STEP };
const int dirPins[4]  = { X_DIR,  Y_DIR,  Z_DIR,  A_DIR };
const int limitPins[4] = { X_LIMIT, Y_LIMIT, Z_LIMIT, -1 };

void setup() {
    Serial.begin(115200);

    // Configure step/dir pins
    for (int i = 0; i < 4; i++) {
        pinMode(stepPins[i], OUTPUT);
        pinMode(dirPins[i], OUTPUT);
        digitalWrite(stepPins[i], LOW);
        digitalWrite(dirPins[i], LOW);
    }

    // Configure enable pin
    if (ENABLE_PIN >= 0) {
        pinMode(ENABLE_PIN, OUTPUT);
        digitalWrite(ENABLE_PIN, LOW);  // LOW = enabled for most drivers
    }

    // Configure limit switch pins (active LOW with pullup)
    for (int i = 0; i < 4; i++) {
        if (limitPins[i] >= 0) {
            pinMode(limitPins[i], INPUT_PULLUP);
        }
    }

    Serial.println("EasyCNC Controller v0.1");
    Serial.println("ok");
}

// ─── Main Loop ─────────────────────────────────────────────────────────────

void loop() {
    // Process serial input
    processSerial();

    // Execute motion
    if (currentMove.active) {
        executeStep();
    }
}

// ─── Serial Processing ────────────────────────────────────────────────────

void processSerial() {
    while (Serial.available()) {
        char c = Serial.read();

        if (c == '\n' || c == '\r') {
            if (serialBufIdx > 0) {
                serialBuf[serialBufIdx] = '\0';
                processCommand(serialBuf);
                serialBufIdx = 0;
            }
        } else if (serialBufIdx < SERIAL_BUF_SIZE - 1) {
            serialBuf[serialBufIdx++] = c;
        }
    }
}

void processCommand(const char* cmd) {
    // Skip whitespace
    while (*cmd == ' ') cmd++;

    if (cmd[0] == '\0') return;

    // Status query
    if (cmd[0] == '?') {
        reportStatus();
        return;
    }

    // GRBL-style commands
    if (cmd[0] == '$') {
        processGrblCommand(cmd);
        return;
    }

    // Emergency stop
    if (cmd[0] == 0x18) {  // Ctrl+X
        emergencyStop();
        return;
    }

    // G-code commands
    char letter = toupper(cmd[0]);

    if (letter == 'G') {
        processGCommand(cmd);
    } else if (letter == 'M') {
        processMCommand(cmd);
    } else {
        Serial.println("error: unknown command");
    }
}

// ─── G-code Parser ────────────────────────────────────────────────────────

float parseValue(const char* cmd, char letter, float defaultVal) {
    letter = toupper(letter);
    const char* p = cmd;
    while (*p) {
        if (toupper(*p) == letter) {
            return atof(p + 1);
        }
        p++;
    }
    return defaultVal;
}

bool hasParam(const char* cmd, char letter) {
    letter = toupper(letter);
    const char* p = cmd;
    while (*p) {
        if (toupper(*p) == letter) return true;
        p++;
    }
    return false;
}

void processGCommand(const char* cmd) {
    int code = atoi(cmd + 1);

    switch (code) {
        case 0:   // G0 - Rapid move
        case 1: { // G1 - Linear move
            if (isAlarm) {
                Serial.println("error: alarm active, unlock with $X");
                return;
            }
            if (currentMove.active) {
                Serial.println("error: busy");
                return;
            }

            float feedRate = (code == 0) ? maxSpeed[0] : currentFeedRate;
            if (hasParam(cmd, 'F')) {
                feedRate = parseValue(cmd, 'F', feedRate);
                if (code == 1) currentFeedRate = feedRate;
            }

            // Parse target positions
            float target[4];
            for (int i = 0; i < 4; i++) target[i] = posMm[i];

            char axes[] = { 'X', 'Y', 'Z', 'A' };
            for (int i = 0; i < 4; i++) {
                if (hasParam(cmd, axes[i])) {
                    float val = parseValue(cmd, axes[i], 0);
                    if (isAbsolute) {
                        target[i] = val;
                    } else {
                        target[i] = posMm[i] + val;
                    }
                }
            }

            // Dual-Y gantry: A mirrors Y
            if (DUAL_Y_GANTRY && !hasParam(cmd, 'A')) {
                target[3] = target[1];  // A follows Y
            }

            startMove(target, feedRate);
            break;
        }

        case 28:  // G28 - Home
            if (hasParam(cmd, 'X')) homeAxis(0);
            else if (hasParam(cmd, 'Y')) { homeAxis(1); if (DUAL_Y_GANTRY) homeAxis(3); }
            else if (hasParam(cmd, 'Z')) homeAxis(2);
            else homeAll();
            break;

        case 90:  // G90 - Absolute positioning
            isAbsolute = true;
            Serial.println("ok");
            break;

        case 91:  // G91 - Relative positioning
            isAbsolute = false;
            Serial.println("ok");
            break;

        case 92: { // G92 - Set position
            char axes[] = { 'X', 'Y', 'Z', 'A' };
            for (int i = 0; i < 4; i++) {
                if (hasParam(cmd, axes[i])) {
                    posMm[i] = parseValue(cmd, axes[i], 0);
                    posSteps[i] = (long)(posMm[i] * stepsPerMm[i]);
                }
            }
            if (DUAL_Y_GANTRY) {
                posMm[3] = posMm[1];
                posSteps[3] = posSteps[1];
            }
            Serial.println("ok");
            break;
        }

        default:
            Serial.print("error: unsupported G");
            Serial.println(code);
            break;
    }
}

void processMCommand(const char* cmd) {
    int code = atoi(cmd + 1);

    switch (code) {
        case 0:   // M0 - Stop
        case 1:   // M1 - Optional stop
            emergencyStop();
            break;

        case 114:  // M114 - Report position
            reportPosition();
            break;

        case 17:  // M17 - Enable steppers
            if (ENABLE_PIN >= 0) digitalWrite(ENABLE_PIN, LOW);
            Serial.println("ok");
            break;

        case 18:  // M18 - Disable steppers
        case 84:  // M84 - Disable steppers
            if (ENABLE_PIN >= 0) digitalWrite(ENABLE_PIN, HIGH);
            Serial.println("ok");
            break;

        case 119:  // M119 - Report endstop status
            reportEndstops();
            break;

        default:
            Serial.print("error: unsupported M");
            Serial.println(code);
            break;
    }
}

void processGrblCommand(const char* cmd) {
    if (cmd[1] == 'X') {
        // $X - Unlock
        isAlarm = false;
        Serial.println("[MSG:Unlocked]");
        Serial.println("ok");
    } else if (cmd[1] == 'H') {
        // $H - Home
        homeAll();
    } else if (cmd[1] == '$') {
        // $$ - Show settings
        reportSettings();
    } else if (cmd[1] == 'I') {
        // $I - Build info
        Serial.println("[VER:0.1.EasyCNC]");
        Serial.println("[OPT:V]");
        Serial.println("ok");
    } else {
        Serial.println("error: unknown $ command");
    }
}

// ─── Motion Control (Bresenham with acceleration) ─────────────────────────

void startMove(float targetMm[4], float feedRate) {
    // Convert target mm to steps
    for (int i = 0; i < 4; i++) {
        targetSteps[i] = (long)(targetMm[i] * stepsPerMm[i]);
    }

    // Calculate steps to move
    long totalMax = 0;
    for (int i = 0; i < 4; i++) {
        currentMove.steps[i] = targetSteps[i] - posSteps[i];
        currentMove.absSteps[i] = abs(currentMove.steps[i]);
        if (currentMove.absSteps[i] > totalMax) {
            totalMax = currentMove.absSteps[i];
        }
    }

    if (totalMax == 0) {
        Serial.println("ok");
        return;
    }

    // Set direction pins
    for (int i = 0; i < 4; i++) {
        bool dir = currentMove.steps[i] >= 0;
        if (invertDir[i]) dir = !dir;
        digitalWrite(dirPins[i], dir ? HIGH : LOW);
    }

    // Bresenham init
    currentMove.totalSteps = totalMax;
    currentMove.stepsDone = 0;
    for (int i = 0; i < 4; i++) {
        currentMove.error[i] = totalMax / 2;
    }

    // Calculate step interval from feed rate
    // feedRate is in mm/min, convert to steps/sec on dominant axis
    // Find which axis is dominant and its mm-per-step
    float dominantMmPerStep = 1.0;
    for (int i = 0; i < 4; i++) {
        if (currentMove.absSteps[i] == totalMax) {
            dominantMmPerStep = 1.0 / stepsPerMm[i];
            break;
        }
    }

    // Clamp feed rate
    if (feedRate > maxSpeed[0]) feedRate = maxSpeed[0];
    if (feedRate < 1.0) feedRate = 1.0;

    float mmPerSec = feedRate / 60.0;
    float stepsPerSec = mmPerSec / dominantMmPerStep;
    if (stepsPerSec < 1.0) stepsPerSec = 1.0;

    currentMove.feedRate = feedRate;
    targetSpeedMmPerMin = feedRate;
    currentMove.stepIntervalUs = (unsigned long)(1000000.0 / stepsPerSec);

    // Start with acceleration (begin slow)
    currentSpeedMmPerMin = min(feedRate, 60.0f);  // Start at 60 mm/min or target if lower
    float startStepsPerSec = (currentSpeedMmPerMin / 60.0) / dominantMmPerStep;
    if (startStepsPerSec < 1.0) startStepsPerSec = 1.0;
    currentMove.stepIntervalUs = (unsigned long)(1000000.0 / startStepsPerSec);

    currentMove.lastStepUs = micros();
    lastAccelUs = micros();
    currentMove.active = true;
    isMoving = true;
}

void executeStep() {
    unsigned long now = micros();

    if (now - currentMove.lastStepUs < currentMove.stepIntervalUs) return;

    currentMove.lastStepUs = now;

    // Acceleration ramp
    if (now - lastAccelUs >= 5000) {  // Update accel every 5ms
        lastAccelUs = now;

        // Deceleration: slow down when approaching target
        long stepsRemaining = currentMove.totalSteps - currentMove.stepsDone;
        float decelDistance = (currentSpeedMmPerMin * currentSpeedMmPerMin) / (2.0 * accel[0] * 3600.0);  // in mm
        float decelSteps = decelDistance * stepsPerMm[0];

        if (stepsRemaining <= (long)decelSteps && currentSpeedMmPerMin > 60.0) {
            // Decelerate
            currentSpeedMmPerMin -= accel[0] * 0.005 * 60.0;
            if (currentSpeedMmPerMin < 60.0) currentSpeedMmPerMin = 60.0;
        } else if (currentSpeedMmPerMin < targetSpeedMmPerMin) {
            // Accelerate
            currentSpeedMmPerMin += accel[0] * 0.005 * 60.0;
            if (currentSpeedMmPerMin > targetSpeedMmPerMin) currentSpeedMmPerMin = targetSpeedMmPerMin;
        }

        // Update step interval
        float dominantMmPerStep = 1.0 / stepsPerMm[0];
        float stepsPerSec = (currentSpeedMmPerMin / 60.0) / dominantMmPerStep;
        if (stepsPerSec < 1.0) stepsPerSec = 1.0;
        currentMove.stepIntervalUs = (unsigned long)(1000000.0 / stepsPerSec);
    }

    // Bresenham step generation
    for (int i = 0; i < 4; i++) {
        if (currentMove.absSteps[i] == 0) continue;

        currentMove.error[i] -= currentMove.absSteps[i];
        if (currentMove.error[i] < 0) {
            currentMove.error[i] += currentMove.totalSteps;

            // Check limit switch
            if (limitPins[i] >= 0 && digitalRead(limitPins[i]) == LOW) {
                emergencyStop();
                isAlarm = true;
                Serial.println("ALARM: limit switch triggered");
                return;
            }

            // Generate step pulse
            digitalWrite(stepPins[i], HIGH);
            delayMicroseconds(STEP_PULSE_US);
            digitalWrite(stepPins[i], LOW);

            // Update position
            if (currentMove.steps[i] > 0) {
                posSteps[i]++;
            } else {
                posSteps[i]--;
            }
        }
    }

    currentMove.stepsDone++;

    // Move complete?
    if (currentMove.stepsDone >= currentMove.totalSteps) {
        currentMove.active = false;
        isMoving = false;

        // Update mm positions from steps
        for (int i = 0; i < 4; i++) {
            posMm[i] = (float)posSteps[i] / stepsPerMm[i];
        }

        Serial.println("ok");
    }
}

// ─── Homing ────────────────────────────────────────────────────────────────

void homeAxis(int axis) {
    if (axis < 0 || axis > 3) return;
    if (limitPins[axis] < 0) {
        Serial.print("error: no limit switch on axis ");
        Serial.println(axis);
        // Just zero the position
        posSteps[axis] = 0;
        posMm[axis] = 0.0;
        Serial.println("ok");
        return;
    }

    isHoming = true;
    Serial.print("[MSG:Homing axis ");
    Serial.print("XYZA"[axis]);
    Serial.println("]");

    // Set direction toward home
    bool dir = homeDir[axis] < 0;
    if (invertDir[axis]) dir = !dir;
    digitalWrite(dirPins[axis], dir ? LOW : HIGH);

    // Calculate step interval from homing speed
    float stepsPerSec = (homeSpeed / 60.0) * stepsPerMm[axis];
    unsigned long intervalUs = (unsigned long)(1000000.0 / stepsPerSec);

    // Move toward limit switch
    unsigned long maxSteps = (unsigned long)(maxTravel[axis] * stepsPerMm[axis] * 1.5);
    unsigned long stepCount = 0;

    while (stepCount < maxSteps) {
        // Check limit switch
        if (digitalRead(limitPins[axis]) == LOW) {
            // Hit the switch — back off slightly
            delay(10);

            // Reverse direction
            digitalWrite(dirPins[axis], dir ? HIGH : LOW);
            delay(1);

            // Back off 2mm
            unsigned long backoffSteps = (unsigned long)(2.0 * stepsPerMm[axis]);
            for (unsigned long i = 0; i < backoffSteps; i++) {
                digitalWrite(stepPins[axis], HIGH);
                delayMicroseconds(STEP_PULSE_US);
                digitalWrite(stepPins[axis], LOW);
                delayMicroseconds(intervalUs * 2);  // Slow backoff
            }

            // Approach again slowly
            digitalWrite(dirPins[axis], dir ? LOW : HIGH);
            delay(1);
            unsigned long slowInterval = intervalUs * 4;

            for (unsigned long i = 0; i < backoffSteps * 2; i++) {
                if (digitalRead(limitPins[axis]) == LOW) break;
                digitalWrite(stepPins[axis], HIGH);
                delayMicroseconds(STEP_PULSE_US);
                digitalWrite(stepPins[axis], LOW);
                delayMicroseconds(slowInterval);
            }

            // Set position to 0
            posSteps[axis] = 0;
            posMm[axis] = 0.0;

            Serial.print("[MSG:Axis ");
            Serial.print("XYZA"[axis]);
            Serial.println(" homed]");
            isHoming = false;
            return;
        }

        // Step
        digitalWrite(stepPins[axis], HIGH);
        delayMicroseconds(STEP_PULSE_US);
        digitalWrite(stepPins[axis], LOW);
        delayMicroseconds(intervalUs);
        stepCount++;

        // Check for serial abort
        if (Serial.available()) {
            char c = Serial.peek();
            if (c == 0x18 || c == '!') {
                Serial.read();
                Serial.println("error: homing aborted");
                isHoming = false;
                return;
            }
        }
    }

    Serial.print("error: homing failed on axis ");
    Serial.println("XYZA"[axis]);
    isAlarm = true;
    isHoming = false;
}

void homeAll() {
    Serial.println("[MSG:Homing all axes]");
    // Home Z first (up for safety), then X, then Y (+ A if dual gantry)
    homeAxis(2);  // Z
    homeAxis(0);  // X
    homeAxis(1);  // Y
    if (DUAL_Y_GANTRY) homeAxis(3);  // A (Y2)

    if (!isAlarm) {
        Serial.println("[MSG:All axes homed]");
        Serial.println("ok");
    }
}

// ─── Emergency Stop ────────────────────────────────────────────────────────

void emergencyStop() {
    currentMove.active = false;
    isMoving = false;
    isHoming = false;
    currentSpeedMmPerMin = 0;

    // Update mm positions from steps
    for (int i = 0; i < 4; i++) {
        posMm[i] = (float)posSteps[i] / stepsPerMm[i];
    }

    Serial.println("[MSG:Emergency stop]");
    Serial.println("ok");
}

// ─── Status Reporting ──────────────────────────────────────────────────────

void reportStatus() {
    // GRBL-compatible status format: <State|MPos:x,y,z|WPos:x,y,z>
    Serial.print("<");

    if (isAlarm) Serial.print("Alarm");
    else if (isHoming) Serial.print("Home");
    else if (isMoving) Serial.print("Run");
    else Serial.print("Idle");

    Serial.print("|MPos:");
    Serial.print(posMm[0], 3); Serial.print(",");
    Serial.print(posMm[1], 3); Serial.print(",");
    Serial.print(posMm[2], 3);

    Serial.print("|A:");
    Serial.print(posMm[3], 3);

    Serial.print("|F:");
    Serial.print(currentFeedRate, 0);

    Serial.println(">");
}

void reportPosition() {
    Serial.print("X:"); Serial.print(posMm[0], 3);
    Serial.print(" Y:"); Serial.print(posMm[1], 3);
    Serial.print(" Z:"); Serial.print(posMm[2], 3);
    Serial.print(" A:"); Serial.print(posMm[3], 3);
    Serial.println();
    Serial.println("ok");
}

void reportEndstops() {
    const char* names[] = { "X", "Y", "Z", "A" };
    for (int i = 0; i < 4; i++) {
        Serial.print(names[i]);
        Serial.print(": ");
        if (limitPins[i] >= 0) {
            Serial.println(digitalRead(limitPins[i]) == LOW ? "TRIGGERED" : "open");
        } else {
            Serial.println("not configured");
        }
    }
    Serial.println("ok");
}

void reportSettings() {
    Serial.println("[Settings]");
    const char* names[] = { "X", "Y", "Z", "A" };
    for (int i = 0; i < 4; i++) {
        Serial.print(names[i]);
        Serial.print(": steps/mm="); Serial.print(stepsPerMm[i], 1);
        Serial.print(" max_speed="); Serial.print(maxSpeed[i], 0);
        Serial.print(" accel="); Serial.print(accel[i], 0);
        Serial.print(" max_travel="); Serial.print(maxTravel[i], 0);
        Serial.print(" invert="); Serial.println(invertDir[i] ? "yes" : "no");
    }
    Serial.print("Feed rate: "); Serial.println(currentFeedRate, 0);
    Serial.print("Mode: "); Serial.println(isAbsolute ? "absolute (G90)" : "relative (G91)");
    Serial.print("Dual-Y: "); Serial.println(DUAL_Y_GANTRY ? "yes" : "no");
    Serial.println("ok");
}
