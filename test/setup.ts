// Test-wide settings: the wait before re-checking new box sets (ADR-040) is seconds in production, milliseconds here.
import { IDENTITY_TIMING } from '../src/pipeline/boxset-identity.js';

IDENTITY_TIMING.recheckMs = 25;
