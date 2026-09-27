import { useState } from 'react';
import { FiltersPanel } from './FiltersPanel';
import { ScannerPanel } from './ScannerPanel';
import { ScoringPanel } from './ScoringPanel';
import { AutomationPanel, StopBanner } from './AutomationPanel';
import { LicenseBanner, LicensePanel } from './LicensePanel';
import { useLicense } from './use-license';
import { useAutomationConfig } from './use-automation-config';
import { useFilterConfig } from './use-filter-config';
import { useScoringConfig } from './use-scoring-config';
import { type CheckState, useConnectionStatus } from './use-connection-status';
import { useScanner } from './use-scanner';

const SELLER_HOME = 'https://seller.indiamart.com/';

const DOT: Record<CheckState, string> = {
  checking: 'border-muted bg-transparent',
  ok: 'border-ok bg-ok',
  waiting: 'border-wait bg-transparent',
  failed: 'border-fail bg-fail',
};

const STATE_LABEL: Record<CheckState, string> = {
  checking: 'Checking',
  ok: 'OK',
  waiting: 'Waiting',
  failed: 'Problem',
};

interface StepProps {
  state: CheckState;
  title: string;
  detail: string;
  last?: boolean;
}

function Step({ state, title, detail, last = false }: StepProps) {
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {!last && <span aria-hidden className="absolute top-4 left-[5px] h-full w-px bg-rule" />}
      <span
        aria-hidden
        className={`relative mt-1 size-[11px] shrink-0 rounded-full border-2 ${DOT[state]}`}
      />
      <div className="min-w-0">
        <p className="text-[13px] leading-5 font-semibold">
          {title}
          <span className="sr-only">: {STATE_LABEL[state]}</span>
        </p>
        <p className="text-[12px] leading-[18px] text-muted">{detail}</p>
      </div>
    </li>
  );
}

type Tab = 'scanner' | 'filters' | 'scoring' | 'automation' | 'license';
const TAB_LABEL: Record<Tab, string> = {
  scanner: 'Scanner',
  filters: 'Filters',
  scoring: 'Scoring',
  automation: 'Auto-Click',
  license: 'License',
};

export function Popup() {
  const s = useConnectionStatus();
  const scanner = useScanner(s.content === 'ok' ? s.tabId : null);
  const filters = useFilterConfig();
  const scoring = useScoringConfig();
  const automationSettings = useAutomationConfig();
  const license = useLicense();
  /** STOP: the page cancels its queue now; the setting is switched OFF either way. */
  const stopEverywhere = () => {
    scanner.stopAutomation();
    automationSettings.setEnabled(false);
  };
  const [tab, setTab] = useState<Tab>('scanner');
  const allOk = [s.worker, s.page, s.content, s.leadList].every((x) => x === 'ok');

  const pageDetail =
    s.page === 'ok'
      ? (s.host ?? 'IndiaMART')
      : s.page === 'checking'
        ? 'Looking at this tab'
        : 'This tab is not an IndiaMART seller page';

  const contentDetail = {
    checking: 'Waiting for the page',
    ok: 'Connected',
    waiting: 'Opens on IndiaMART seller pages',
    failed: 'Not responding. Reload the IndiaMART tab.',
  }[s.content];

  const leadDetail =
    s.leadList === 'ok'
      ? 'Lead cards found on this page'
      : s.content === 'ok'
        ? 'No lead cards here. Open Lead Manager or Buy Leads.'
        : 'Needs the page reader first';

  const workerDetail = {
    checking: 'Starting',
    ok: 'Running',
    waiting: 'Starting',
    failed: 'Not responding. Reload the extension in chrome://extensions.',
  }[s.worker];

  return (
    <main className="w-[380px] bg-paper text-ink">
      <header className="flex items-center gap-3 border-b border-rule bg-surface px-4 py-3">
        <img src="/icons/icon-48.png" alt="" className="size-7" />
        <div className="min-w-0 flex-1">
          <h1 className="text-[15px] leading-5 font-semibold">Lead Intelligence</h1>
          <p className="text-[12px] leading-4 text-muted">for IndiaMART Lead Manager</p>
        </div>
        <span className="text-[11px] text-muted">
          v{s.workerStatus?.version ?? chrome.runtime.getManifest().version}
        </span>
      </header>

      {allOk ? (
        <p className="flex items-center gap-2 border-b border-rule px-4 py-2 text-[12px] text-muted">
          <span aria-hidden className="size-[7px] rounded-full bg-ok" />
          Connected to the lead list on {s.host}
        </p>
      ) : (
        <section aria-labelledby="conn-heading" className="px-4 pt-4 pb-3">
          <h2 id="conn-heading" className="mb-3 text-[12px] font-medium text-muted">
            Connection
          </h2>
          <ol aria-live="polite">
            <Step state={s.worker} title="Background service" detail={workerDetail} />
            <Step state={s.page} title="IndiaMART page" detail={pageDetail} />
            <Step state={s.content} title="Page reader" detail={contentDetail} />
            <Step state={s.leadList} title="Lead list" detail={leadDetail} last />
          </ol>
        </section>
      )}

      <LicenseBanner state={license.state} onOpen={() => setTab('license')} />
      <StopBanner
        enabled={automationSettings.saved?.autoClickEnabled === true}
        automation={scanner.automation}
        onStop={stopEverywhere}
      />

      <div role="tablist" aria-label="View" className="flex gap-1 border-b border-rule px-4 pt-2">
        {(['scanner', 'filters', 'scoring', 'automation', 'license'] as const).map((id) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`-mb-px border-b-2 px-2 pb-1.5 text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-ok ${
              tab === id ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            {TAB_LABEL[id]}
          </button>
        ))}
      </div>

      {tab === 'scanner' &&
        (s.content === 'ok' ? (
          <ScannerPanel view={scanner} />
        ) : (
          <p className="px-4 py-4 text-[12px] text-muted">
            Open an IndiaMART lead list to see scanner results. Filters and scoring can be edited
            any time.
          </p>
        ))}
      {tab === 'filters' && <FiltersPanel view={filters} />}
      {tab === 'scoring' && <ScoringPanel view={scoring} />}
      {tab === 'license' && <LicensePanel view={license} />}
      {tab === 'automation' && (
        <AutomationPanel
          settings={automationSettings}
          automation={scanner.automation}
          automationError={scanner.automationError}
          onToggle={automationSettings.setEnabled}
          onStop={stopEverywhere}
        />
      )}

      <footer className="border-t border-rule bg-surface px-4 py-3">
        {s.page === 'waiting' ? (
          <button
            type="button"
            onClick={() => void chrome.tabs.create({ url: SELLER_HOME })}
            className="w-full rounded-md border border-rule bg-paper px-3 py-2 text-[13px] font-medium hover:border-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ok"
          >
            Open IndiaMART seller panel
          </button>
        ) : (
          <p className="text-[12px] leading-[18px] text-muted">
            Read-only. Leads are read on this page, never clicked, contacted, or sent anywhere.
          </p>
        )}
      </footer>
    </main>
  );
}
