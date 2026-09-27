import { DEFAULT_GRACE_MS, type LicenseState, type ServerLicenseResponse } from './license-types';

/**
 * Pure license-state transitions. The server's answer is authoritative; the
 * local clock is only used to measure elapsed time since the last verified
 * server answer (offline grace, expiry estimate), never to decide a status
 * on its own.
 */

export const INITIAL_LICENSE_STATE: LicenseState = {
  status: 'UNREGISTERED',
  codeHint: null,
  plan: null,
  customer: null,
  expiresAt: null,
  verifiedAt: null,
  verifiedAtLocal: null,
  graceUntilLocal: null,
  offline: false,
  message: 'Enter your license code to activate.',
  checkedAtLocal: null,
};

/** Allowed backwards clock drift before the cached answer is distrusted. */
const CLOCK_SKEW_MS = 60_000;

/** Apply a server answer (activate, validate or push). */
export function fromServer(
  previous: LicenseState,
  response: ServerLicenseResponse,
  localNow: number,
  graceMs: number = DEFAULT_GRACE_MS,
): LicenseState {
  // Defensive: an ACTIVE answer whose own expiry has passed is EXPIRED.
  const expired = response.expiresAt !== null && response.expiresAt <= response.serverTime;
  const status = response.status === 'ACTIVE' && expired ? 'EXPIRED' : response.status;
  return {
    status,
    codeHint: response.codeHint ?? previous.codeHint,
    plan: response.plan,
    customer: response.customer,
    expiresAt: response.expiresAt,
    verifiedAt: response.serverTime,
    verifiedAtLocal: localNow,
    graceUntilLocal: status === 'ACTIVE' ? localNow + graceMs : null,
    offline: false,
    message: response.message ?? describeStatus(status),
    checkedAtLocal: localNow,
  };
}

/**
 * The server could not be reached. An ACTIVE license keeps working until
 * its grace ends (and not past its expiry); then it locks as NETWORK_ERROR.
 * Other statuses stay as they were.
 */
export function onNetworkFailure(
  previous: LicenseState,
  localNow: number,
  reason = 'License server unreachable',
): LicenseState {
  const base = { ...previous, checkedAtLocal: localNow };
  if (previous.status !== 'ACTIVE') return { ...base, message: previous.message ?? reason };
  if (withinGrace(previous, localNow)) {
    return {
      ...base,
      offline: true,
      message: `${reason}. Working offline until the grace period ends.`,
    };
  }
  if (estimatedExpired(previous, localNow)) {
    return {
      ...base,
      status: 'EXPIRED',
      offline: false,
      graceUntilLocal: null,
      message: describeStatus('EXPIRED'),
    };
  }
  return {
    ...base,
    status: 'NETWORK_ERROR',
    offline: false,
    graceUntilLocal: null,
    message: `LICENSE VALIDATION REQUIRED. ${reason}; the 24-hour offline grace period has ended.`,
  };
}

function withinGrace(state: LicenseState, localNow: number): boolean {
  if (state.graceUntilLocal === null || state.verifiedAtLocal === null) return false;
  if (localNow + CLOCK_SKEW_MS < state.verifiedAtLocal) return false; // clock moved back
  return localNow < state.graceUntilLocal && !estimatedExpired(state, localNow);
}

/** Server time now, estimated from the last verified server time plus elapsed local time. */
export function estimatedServerTime(state: LicenseState, localNow: number): number | null {
  if (state.verifiedAt === null || state.verifiedAtLocal === null) return null;
  return state.verifiedAt + Math.max(0, localNow - state.verifiedAtLocal);
}

function estimatedExpired(state: LicenseState, localNow: number): boolean {
  const serverNow = estimatedServerTime(state, localNow);
  return state.expiresAt !== null && serverNow !== null && state.expiresAt <= serverNow;
}

/**
 * The single question the scanner and Auto-Click ask: may the extension work
 * right now? Only an ACTIVE license inside its grace window (verified
 * within the last 24 h by default) and not past its expiry.
 */
export function isUsable(state: LicenseState, localNow: number): boolean {
  return state.status === 'ACTIVE' && withinGrace(state, localNow);
}

/** Status after time passed without new information (grace or expiry may have lapsed). */
export function reconcile(state: LicenseState, localNow: number): LicenseState {
  if (state.status !== 'ACTIVE' || isUsable(state, localNow)) return state;
  return onNetworkFailure(state, localNow, 'License not verified recently');
}

export function describeStatus(status: LicenseState['status']): string {
  switch (status) {
    case 'ACTIVE':
      return 'License active.';
    case 'EXPIRED':
      return 'License expired. Renew it to continue.';
    case 'DISABLED':
      return 'License disabled by the administrator.';
    case 'SUSPENDED':
      return 'License suspended. Contact support.';
    case 'REVOKED':
      return 'License revoked.';
    case 'UNREGISTERED':
      return 'Enter your license code to activate.';
    case 'NETWORK_ERROR':
      return 'LICENSE VALIDATION REQUIRED. Connect to the internet so the license can be verified.';
  }
}
