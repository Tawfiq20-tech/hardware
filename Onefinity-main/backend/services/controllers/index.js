/**
 * Controller factory: creates the appropriate controller based on detected firmware type.
 *
 * Supports:
 *   - 'Grbl' / 'FluidNC' -> GrblController (character-counting protocol)
 *   - 'GrblHAL' -> GrblHalController (send-response protocol, extended commands)
 *
 * Usage:
 *   const controller = createController('GrblHAL');
 *   controller.bind(connection);
 */
const { GrblController } = require('../GRBLController');
const { GrblHalController } = require('./GrblHalController');
const { RTSController } = require('./RTSController');
const { FIRMWARE_GRBL, FIRMWARE_GRBLHAL, FIRMWARE_FLUIDNC, FIRMWARE_RTS } = require('../Connection');

/**
 * Available controller classes keyed by firmware type.
 */
const CONTROLLER_CLASSES = {
    [FIRMWARE_GRBL]: GrblController,
    [FIRMWARE_GRBLHAL]: GrblHalController,
    [FIRMWARE_FLUIDNC]: GrblController, // FluidNC is grbl-compatible
    [FIRMWARE_RTS]: RTSController,       // RealtimeCNC RTS-1/RTS-2
};

/**
 * Create a controller instance for the given firmware type.
 * @param {string} [firmwareType='Grbl'] - Detected firmware type
 * @returns {GrblController|GrblHalController}
 */
function createController(firmwareType = FIRMWARE_GRBL) {
    const ControllerClass = CONTROLLER_CLASSES[firmwareType] || GrblController;
    return new ControllerClass(firmwareType);
}

/**
 * Get the list of supported controller types.
 * @returns {string[]}
 */
function getSupportedControllers() {
    return Object.keys(CONTROLLER_CLASSES);
}

module.exports = {
    createController,
    getSupportedControllers,
    CONTROLLER_CLASSES,
    GrblController,
    GrblHalController,
    RTSController,
};
