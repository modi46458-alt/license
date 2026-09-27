import type { AutomationEvent } from '@/core/actions';
import { explainScore, type LeadScoreResult } from '@/core/scoring';
import { explainEvaluation, type FilterEvaluation } from '@/core/filters';
import type { ScanLog, ScanLogLevel, ScannerEvent } from '@/core/types/scanner';
import { leadLabel } from '../extraction/lead-extractor';

export const MAX_LOG_ENTRIES = 200;

type LogLine = { level: ScanLogLevel; message: string; leadId?: string };

function truncate(text: string, max = 70): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function filterLine(evaluation: FilterEvaluation, leadId: string): LogLine {
  return {
    level: evaluation.passed ? 'SUCCESS' : 'INFO',
    leadId,
    message: `Filter ${evaluation.passed ? 'matched' : 'rejected'}: ${explainEvaluation(evaluation)}`,
  };
}

function scoreLine(score: LeadScoreResult, leadId: string): LogLine {
  return { level: 'SUCCESS', leadId, message: explainScore(score) };
}

const AUTOMATION_TYPES: ReadonlySet<string> = new Set<AutomationEvent['type']>([
  'AUTOMATION_STARTED',
  'AUTOMATION_STOPPED',
  'ACTION_QUEUED',
  'ACTION_STARTED',
  'ACTION_SUCCESS',
  'ACTION_FAILED',
  'ACTION_RETRYING',
  'ACTION_SKIPPED',
  'ACTION_CANCELLED',
]);

function isAutomationEvent(event: ScannerEvent | AutomationEvent): event is AutomationEvent {
  return AUTOMATION_TYPES.has(event.type);
}

/** Log lines for auto-click events. Every attempt and outcome is logged. */
export function formatAutomationEvent(event: AutomationEvent): LogLine[] {
  switch (event.type) {
    case 'AUTOMATION_STARTED':
      return [
        {
          level: 'INFO',
          message:
            'Auto-Click ON: matched leads will be contacted automatically' +
            (event.queued > 0 ? ` (${event.queued} queued)` : ''),
        },
      ];
    case 'AUTOMATION_STOPPED':
      return [
        {
          level: 'WARN',
          message:
            (event.reason === 'license'
              ? 'Auto-Click locked: license not active'
              : event.reason === 'user'
                ? 'Auto-Click STOPPED by user'
                : event.reason === 'standby'
                  ? 'Auto-Click paused: running in another IndiaMART tab'
                  : 'Auto-Click OFF') +
            (event.cancelled > 0 ? ` (${event.cancelled} cancelled)` : ''),
        },
      ];
    default: {
      const a = event.action;
      const label = truncate(a.leadLabel, 50);
      const error = a.errorCode ? ` — ${a.errorCode}: ${a.errorMessage ?? ''}` : '';
      const lines: Record<
        Exclude<AutomationEvent['type'], 'AUTOMATION_STARTED' | 'AUTOMATION_STOPPED'>,
        LogLine
      > = {
        ACTION_QUEUED: {
          level: 'INFO',
          leadId: a.leadId,
          message: `Contact Buyer queued: ${label}`,
        },
        ACTION_STARTED: {
          level: 'INFO',
          leadId: a.leadId,
          message: `Contact Buyer attempt ${a.attempt}: ${label}`,
        },
        ACTION_SUCCESS: {
          level: 'SUCCESS',
          leadId: a.leadId,
          message: `Contact Buyer clicked: ${label}`,
        },
        ACTION_FAILED: {
          level: 'ERROR',
          leadId: a.leadId,
          message: `Contact Buyer not clicked: ${label}${error}`,
        },
        ACTION_RETRYING: {
          level: 'WARN',
          leadId: a.leadId,
          message: `Contact Buyer will retry: ${label}${error}`,
        },
        ACTION_SKIPPED: {
          level: 'WARN',
          leadId: a.leadId,
          message: `Contact Buyer skipped: ${label}${error}`,
        },
        ACTION_CANCELLED: {
          level: 'WARN',
          leadId: a.leadId,
          message: `Contact Buyer cancelled: ${label}`,
        },
      };
      return [lines[event.type]];
    }
  }
}

/** Human-readable log lines for an event. Some events produce none. */
export function formatEvent(event: ScannerEvent): LogLine[] {
  switch (event.type) {
    case 'SCAN_STARTED':
      return [
        {
          level: 'INFO',
          message: {
            start: 'Scanner started',
            navigation: 'Page changed, scanning again',
            activation: 'Lead list appeared, scanning',
          }[event.reason],
        },
      ];
    case 'LEAD_CANDIDATE_FOUND':
      return [
        {
          level: 'INFO',
          message: `Lead candidate found (${event.detection.signals.length} signals, ${Math.round(event.detection.confidence * 100)}%)`,
        },
      ];
    case 'LEAD_DETECTED':
      return [];
    case 'LEAD_PROCESSED': {
      const { lead } = event;
      const lines: LogLine[] = [
        {
          level: 'SUCCESS',
          leadId: lead.id,
          message: `Lead detected: ${truncate(leadLabel(lead))}`,
        },
      ];
      const facts = [
        lead.country && `Country: ${lead.country}`,
        lead.quantityRaw && `Quantity: ${lead.quantityRaw}`,
      ].filter(Boolean);
      if (facts.length > 0)
        lines.push({ level: 'INFO', leadId: lead.id, message: facts.join(', ') });
      const channels = [
        lead.contact.mobileAvailable && 'Mobile',
        lead.contact.whatsappAvailable && 'WhatsApp',
        lead.contact.emailAvailable && 'Email',
      ].filter(Boolean);
      lines.push({
        level: 'INFO',
        leadId: lead.id,
        message:
          channels.length > 0 ? `${channels.join(', ')} available` : 'No contact channels listed',
      });
      // Only FIELD_EXTRACTION_FAILED is logged; absent optional fields are normal.
      const failures = lead.extraction.warnings;
      for (const w of failures) {
        lines.push({ level: 'WARN', leadId: lead.id, message: `Extraction failed: ${w}` });
      }
      lines.push({
        level: failures.length > 0 ? 'WARN' : 'SUCCESS',
        leadId: lead.id,
        message:
          failures.length > 0
            ? `Lead processed with ${failures.length} warning${failures.length > 1 ? 's' : ''}`
            : 'Lead processed',
      });
      if (event.filter) lines.push(filterLine(event.filter, lead.id));
      if (event.score?.kind === 'SCORED') lines.push(scoreLine(event.score, lead.id));
      return lines;
    }
    case 'LEAD_UPDATED': {
      const lines: LogLine[] = [
        {
          level: 'INFO',
          leadId: event.leadId,
          message:
            `Lead updated: ${truncate(leadLabel(event.lead), 50)}` +
            (event.revealed.length > 0 ? ` (${event.revealed.join(', ')})` : ''),
        },
      ];
      // Only mention the filter/score when the verdict or priority changed.
      if (event.filter && event.previousStatus !== event.filter.status) {
        lines.push(filterLine(event.filter, event.leadId));
      }
      if (event.score?.kind === 'SCORED' && event.previousPriority !== event.score.priority) {
        lines.push(scoreLine(event.score, event.leadId));
      }
      return lines;
    }
    case 'LEAD_MATCHED':
      return []; // the filter verdict line already says MATCHED
    case 'SCANNER_LOCKED':
      return [{ level: 'WARN', message: `Scanner locked: ${event.reason}` }];
    case 'SCORING_APPLIED':
      return [
        {
          level: 'INFO',
          message:
            `Scoring applied: ${event.scored} scored` +
            (event.averageScore === null ? '' : `, average ${event.averageScore}`) +
            ` (${event.changed} changed)`,
        },
      ];
    case 'FILTERS_APPLIED':
      return [
        {
          level: 'INFO',
          message: `Filters applied: ${event.matched} matched, ${event.rejected} rejected (${event.changed} changed)`,
        },
      ];
    case 'LEAD_DUPLICATE':
      return [{ level: 'INFO', leadId: event.leadId, message: 'Duplicate lead skipped' }];
    case 'LEAD_EXTRACTION_FAILED':
      return [
        {
          level: 'ERROR',
          ...(event.leadId ? { leadId: event.leadId } : {}),
          message: `Extraction failed: ${event.error}`,
        },
      ];
    case 'SCAN_COMPLETED':
      if (!event.initial && event.newLeads === 0) return [];
      return [
        {
          level: 'INFO',
          message: `Scan completed: ${event.newLeads} new lead${event.newLeads === 1 ? '' : 's'} in ${Math.round(event.durationMs)} ms`,
        },
      ];
    case 'SCANNER_ERROR':
      return [{ level: 'ERROR', message: `Scanner error: ${event.error}` }];
    case 'PAGE_INACTIVE':
      return [{ level: 'INFO', message: 'No lead list on this page. Waiting for one to appear.' }];
    case 'SCANNER_STOPPED':
      return [{ level: 'INFO', message: 'Scanner stopped' }];
  }
}

/** Bounded, append-only log. Oldest entries drop off beyond `max`. */
export class ScanLogBuffer {
  private entries: ScanLog[] = [];
  private nextId = 1;

  constructor(private readonly max = MAX_LOG_ENTRIES) {}

  add(event: ScannerEvent | AutomationEvent): ScanLog[] {
    const lines = isAutomationEvent(event) ? formatAutomationEvent(event) : formatEvent(event);
    const added = lines.map<ScanLog>((line) => ({
      id: this.nextId++,
      timestamp: event.timestamp,
      event: event.type,
      level: line.level,
      message: line.message,
      ...(line.leadId ? { leadId: line.leadId } : {}),
    }));
    if (added.length === 0) return added;
    this.entries.push(...added);
    if (this.entries.length > this.max) this.entries = this.entries.slice(-this.max);
    return added;
  }

  all(): readonly ScanLog[] {
    return this.entries;
  }

  since(id: number): ScanLog[] {
    return this.entries.filter((e) => e.id > id);
  }

  clear(): void {
    this.entries = [];
  }

  get size(): number {
    return this.entries.length;
  }
}
