import { LicenseError } from './license-errors';
import { INITIAL_LICENSE_STATE, isUsable, reconcile } from './license-state';
import type { LicenseState } from './license-types';

type Listener = (active: boolean, state: LicenseState) => void;

/**
 * The central local gate. Scanner and Auto-Click ask it synchronously; it
 * never makes network requests (the service worker validates in the
 * background and pushes new states in through update()).
 */
export class LicenseGate {
  private state: LicenseState = INITIAL_LICENSE_STATE;
  private active = false;
  private readonly listeners = new Set<Listener>();

  constructor(private readonly now: () => number = Date.now) {}

  /** New state from storage / the service worker. */
  update(state: LicenseState): void {
    this.state = state;
    this.recheck();
  }

  /** Re-evaluate with the current time (grace or expiry may have lapsed). */
  recheck(): void {
    this.state = reconcile(this.state, this.now());
    const active = isUsable(this.state, this.now());
    if (active !== this.active) {
      this.active = active;
      for (const listener of this.listeners) listener(active, this.state);
    }
  }

  isLicenseActive(): boolean {
    return this.active && isUsable(this.state, this.now());
  }

  getLicenseState(): LicenseState {
    return this.state;
  }

  /** true when the last server answer is older than `maxAgeMs` (or there is none). */
  needsValidation(maxAgeMs: number): boolean {
    const at = this.state.verifiedAtLocal;
    return at === null || this.now() - at > maxAgeMs;
  }

  requireActiveLicense(): void {
    if (!this.isLicenseActive()) {
      throw new LicenseError(
        'LICENSE_INACTIVE',
        this.state.message ?? 'License is not active',
        this.state.status,
      );
    }
  }

  /** Called with the new active flag whenever it changes. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** Module-level convenience API over one gate instance per context. */
let defaultGate = new LicenseGate();
export const getLicenseGate = (): LicenseGate => defaultGate;
export const setLicenseGate = (gate: LicenseGate): void => {
  defaultGate = gate;
};
export const isLicenseActive = (): boolean => defaultGate.isLicenseActive();
export const getLicenseState = (): LicenseState => defaultGate.getLicenseState();
export const requireActiveLicense = (): void => defaultGate.requireActiveLicense();
