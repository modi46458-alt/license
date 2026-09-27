import type { AdminAction, LicenseStatus } from './api';

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export const date = (ms: number | null | undefined) => (ms ? dateFmt.format(ms) : '—');
export const dateTime = (ms: number | null | undefined) => (ms ? dateTimeFmt.format(ms) : '—');
export const maskedCode = (hint: string | null | undefined) =>
  hint ? `IMS-••••-••••-${hint}` : '—';

/** Friendly label for stored audit action names (e.g. LICENSE_DISABLED → "License disabled"). */
export function actionLabel(action: string): string {
  const text = action.toLowerCase().replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Which actions make sense for a license in a given state (server rules still decide). */
export function actionsFor(status: LicenseStatus): Array<AdminAction | 'extend'> {
  switch (status) {
    case 'ACTIVE':
      return ['disable', 'suspend', 'extend', 'revoke', 'reset-device'];
    case 'EXPIRED':
      return ['extend', 'disable', 'suspend', 'revoke', 'reset-device'];
    case 'DISABLED':
    case 'SUSPENDED':
      return ['reactivate', 'extend', 'revoke', 'reset-device'];
    case 'REVOKED':
      return [];
  }
}

export const ACTION_TEXT: Record<
  AdminAction | 'extend',
  { label: string; question: string; danger: boolean }
> = {
  disable: { label: 'Disable', question: 'Disable this license?', danger: true },
  suspend: { label: 'Suspend', question: 'Suspend this license?', danger: true },
  reactivate: { label: 'Reactivate', question: 'Reactivate this license?', danger: false },
  revoke: {
    label: 'Revoke',
    question: 'Revoke this license? This cannot be undone.',
    danger: true,
  },
  'reset-device': {
    label: 'Reset Device',
    question: 'Reset all devices of this license? They will have to activate again.',
    danger: true,
  },
  extend: { label: 'Extend', question: '', danger: false },
};
