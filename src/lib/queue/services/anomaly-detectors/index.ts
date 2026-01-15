// Types
export type {
  AnomalyDetector,
  AnomalyEvent,
  AnomalySeverity,
  AnomalyResult,
  DetectionContext,
  DetectorRegistrationOptions,
} from "./types.js";

// Registry
export {
  AnomalyDetectorRegistry,
  getGlobalRegistry,
  resetGlobalRegistry,
} from "./registry.js";

// Built-in detectors
export {
  builtInDetectors,
  flashMessageDetector,
  largePayloadDetector,
  longProcessingDetector,
  lockStolenDetector,
  nearDlqDetector,
  dlqMovementDetector,
  zombieMessageDetector,
  burstDequeueDetector,
  bulkEnqueueDetector,
  bulkDeleteDetector,
  bulkMoveDetector,
  queueClearedDetector,
} from "./detectors/index.js";

// Convenience function to create a registry with all built-in detectors
import { AnomalyDetectorRegistry } from "./registry.js";
import { builtInDetectors } from "./detectors/index.js";

/**
 * Creates a new registry pre-populated with all built-in detectors
 */
export function createRegistryWithBuiltInDetectors(): AnomalyDetectorRegistry {
  const registry = new AnomalyDetectorRegistry();
  for (const detector of builtInDetectors) {
    registry.register(detector);
  }
  return registry;
}
