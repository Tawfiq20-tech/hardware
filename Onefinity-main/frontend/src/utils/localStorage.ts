/**
 * LocalStorage utility for persisting user preferences
 */

const STORAGE_KEYS = {
    JOG_DISTANCE: 'onefinity_jog_distance',
    COORD_SYSTEM: 'onefinity_coord_system',
} as const;

/**
 * Save a value to localStorage with error handling
 */
function saveToStorage<T>(key: string, value: T): void {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
        console.warn(`Failed to save to localStorage (${key}):`, error);
    }
}

/**
 * Load a value from localStorage with error handling and default fallback
 */
function loadFromStorage<T>(key: string, defaultValue: T): T {
    try {
        const stored = localStorage.getItem(key);
        if (stored === null) {
            return defaultValue;
        }
        return JSON.parse(stored) as T;
    } catch (error) {
        console.warn(`Failed to load from localStorage (${key}):`, error);
        return defaultValue;
    }
}

/**
 * Jog distance persistence
 */
export const jogDistanceStorage = {
    save: (distance: number): void => saveToStorage(STORAGE_KEYS.JOG_DISTANCE, distance),
    load: (): number => loadFromStorage(STORAGE_KEYS.JOG_DISTANCE, 1), // Default to 1mm
};

/**
 * Coordinate system persistence
 */
export const coordSystemStorage = {
    save: (system: 'Z' | 'XYZ' | 'XY' | 'X' | 'Y'): void => saveToStorage(STORAGE_KEYS.COORD_SYSTEM, system),
    load: (): 'Z' | 'XYZ' | 'XY' | 'X' | 'Y' => loadFromStorage(STORAGE_KEYS.COORD_SYSTEM, 'Y'), // Default to 'Y'
};