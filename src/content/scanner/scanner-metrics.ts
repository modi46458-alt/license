import type { LeadExtractionInfo, LeadField } from '@/core/types/lead';
import type { ExtractionSample, ScannerDiagnostics } from '@/core/types/scanner';
import { NORMALIZATION_VERSION } from '@/core/normalization/normalization-types';
import { SELECTOR_MAP_VERSION } from '../selectors/indiamart-selectors';

/** Fixed-size ring of recent samples; memory stays constant. */
export class Ring {
  private readonly values: number[] = [];
  private next = 0;
  constructor(private readonly size: number) {}
  push(value: number): void {
    if (this.values.length < this.size) this.values.push(value);
    else this.values[this.next] = value;
    this.next = (this.next + 1) % this.size;
  }
  percentile(p: number): number {
    if (this.values.length === 0) return 0;
    const sorted = [...this.values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
  }
}

const round = (n: number) => Math.round(n * 100) / 100;

function bump<K>(map: Map<K, number>, keys: readonly K[]): void {
  for (const key of keys) map.set(key, (map.get(key) ?? 0) + 1);
}

export class ScannerMetrics {
  mutationCount = 0;
  batchCount = 0;
  candidateCount = 0;
  cardsResolved = 0;
  rejectedCandidates = 0;
  errors = 0;

  private latencyTotal = 0;
  private latencyCount = 0;
  private latencyMax = 0;
  private readonly latencies = new Ring(200);
  /** DOM extraction time per card (the costliest stage), bounded sample. */
  private extractionTotal = 0;
  private extractionCount = 0;
  private extractionMax = 0;
  private readonly extractions = new Ring(200);
  /** Candidates waiting in the mutation queue at the last snapshot (set by the scanner). */
  queueSize = 0;

  recordExtractionTime(ms: number): void {
    this.extractionTotal += ms;
    this.extractionCount++;
    this.extractionMax = Math.max(this.extractionMax, ms);
    this.extractions.push(ms);
  }
  private confidenceTotal = 0;
  private completenessTotal = 0;
  private confidenceCount = 0;
  private readonly selectorFailures = new Map<string, number>();
  private readonly failedFields = new Map<LeadField, number>();
  private readonly missingFields = new Map<LeadField, number>();
  private readonly notes = new Map<string, number>();
  private samples: ExtractionSample[] = [];
  private normalizedCount = 0;
  private normalizationErrors = 0;
  private normalizationTotal = 0;
  private normalizationMax = 0;
  private readonly normalizationWarnings = new Map<string, number>();

  recordNormalization(ms: number, warnings: readonly string[]): void {
    this.normalizedCount++;
    this.normalizationTotal += ms;
    this.normalizationMax = Math.max(this.normalizationMax, ms);
    bump(this.normalizationWarnings, warnings);
  }

  recordNormalizationError(): void {
    this.normalizationErrors++;
    this.errors++;
  }

  constructor(private readonly maxSamples = 20) {}

  private contactFound = 0;
  private contactNotFound = 0;
  private contactMismatch = 0;
  private contactByReference = 0;
  private contactByText = 0;
  private contactLastFailure: string | null = null;

  recordContactButton(
    result: { ok: true; strategyIndex: number } | { ok: false; code: string; reason: string },
  ): void {
    if (result.ok) {
      this.contactFound++;
      if (result.strategyIndex === 0) this.contactByReference++;
      else this.contactByText++;
      return;
    }
    if (result.code === 'IDENTITY_MISMATCH') this.contactMismatch++;
    else this.contactNotFound++;
    this.contactLastFailure = `${result.code}: ${result.reason}`;
  }

  recordSample(sample: ExtractionSample): void {
    this.samples.push(sample);
    if (this.samples.length > this.maxSamples) this.samples.shift();
  }

  recordLatency(ms: number): void {
    this.latencyTotal += ms;
    this.latencyCount++;
    this.latencyMax = Math.max(this.latencyMax, ms);
    this.latencies.push(ms);
  }

  recordExtraction(info: LeadExtractionInfo, selectorFailures: readonly string[]): void {
    this.confidenceTotal += info.confidence;
    this.completenessTotal += info.completeness;
    this.confidenceCount++;
    bump(this.selectorFailures, selectorFailures);
    bump(this.failedFields, info.failedFields);
    bump(this.missingFields, info.missingFields);
    bump(this.notes, info.notes);
  }

  get averageLatency(): number {
    return this.latencyCount === 0 ? 0 : round(this.latencyTotal / this.latencyCount);
  }

  /** Everything except filter/scoring diagnostics, which LeadResults owns. */
  snapshot(): Omit<ScannerDiagnostics, 'filter' | 'scoring'> {
    return {
      mutationCount: this.mutationCount,
      batchCount: this.batchCount,
      candidateCount: this.candidateCount,
      cardsResolved: this.cardsResolved,
      rejectedCandidates: this.rejectedCandidates,
      averageProcessingTimeMs: this.averageLatency,
      p95ProcessingTimeMs: round(this.latencies.percentile(95)),
      maxProcessingTimeMs: round(this.latencyMax),
      extraction: {
        averageMs:
          this.extractionCount === 0 ? 0 : round(this.extractionTotal / this.extractionCount),
        p50Ms: round(this.extractions.percentile(50)),
        p95Ms: round(this.extractions.percentile(95)),
        maxMs: round(this.extractionMax),
      },
      queueSize: this.queueSize,
      averageConfidence:
        this.confidenceCount === 0 ? 0 : round(this.confidenceTotal / this.confidenceCount),
      averageCompleteness:
        this.confidenceCount === 0 ? 0 : round(this.completenessTotal / this.confidenceCount),
      selectorFailures: Object.fromEntries(this.selectorFailures),
      failedFields: Object.fromEntries(this.failedFields),
      missingFields: Object.fromEntries(this.missingFields),
      notes: Object.fromEntries(this.notes),
      errors: this.errors,
      selectorMapVersion: SELECTOR_MAP_VERSION,
      normalization: {
        version: NORMALIZATION_VERSION,
        normalized: this.normalizedCount,
        errors: this.normalizationErrors,
        averageTimeMs:
          this.normalizedCount === 0 ? 0 : round(this.normalizationTotal / this.normalizedCount),
        maxTimeMs: round(this.normalizationMax),
        warnings: Object.fromEntries(this.normalizationWarnings),
      },
      contactButton: {
        found: this.contactFound,
        notFound: this.contactNotFound,
        identityMismatch: this.contactMismatch,
        byReference: this.contactByReference,
        byText: this.contactByText,
        lastFailure: this.contactLastFailure,
      },
      recentExtractions: [...this.samples],
    };
  }
}
