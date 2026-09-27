/**
 * In-page emergency STOP, shown only while Auto-Click runs. The popup closes
 * as soon as the user clicks the page, so the STOP must live on the page
 * itself. Isolated in a shadow root; it never touches IndiaMART's own DOM.
 */
export class StopOverlay {
  private host: HTMLElement | null = null;
  private status: HTMLElement | null = null;

  constructor(
    private readonly doc: Document,
    private readonly onStop: () => void,
  ) {}

  get visible(): boolean {
    return this.host?.isConnected ?? false;
  }

  show(statusText: string): void {
    if (!this.host?.isConnected) this.create();
    if (this.status) this.status.textContent = statusText;
  }

  hide(): void {
    this.host?.remove();
    this.host = null;
    this.status = null;
  }

  private create(): void {
    const host = this.doc.createElement('div');
    host.setAttribute('data-imsli-overlay', 'stop');
    const root = host.attachShadow({ mode: 'open' });

    const style = this.doc.createElement('style');
    style.textContent = `
      .bar { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
        display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 12px;
        background: #1c2433; color: #fff; border-radius: 8px;
        font: 13px/1.3 system-ui, -apple-system, 'Segoe UI', sans-serif;
        box-shadow: 0 4px 16px rgba(0,0,0,.3); }
      button { all: unset; cursor: pointer; background: #c62828; color: #fff;
        font-weight: 700; letter-spacing: .02em; padding: 8px 14px; border-radius: 6px; }
      button:hover { background: #b71c1c; }
      button:focus-visible { outline: 3px solid #ffd54f; outline-offset: 2px; }
      @media (prefers-reduced-motion: no-preference) {
        .dot { width: 8px; height: 8px; border-radius: 50%; background: #ef5350;
          animation: pulse 1.2s infinite; }
        @keyframes pulse { 50% { opacity: .3; } }
      }`;

    const bar = this.doc.createElement('div');
    bar.className = 'bar';
    bar.setAttribute('role', 'status');
    const dot = this.doc.createElement('span');
    dot.className = 'dot';
    const status = this.doc.createElement('span');
    const button = this.doc.createElement('button');
    button.type = 'button';
    button.textContent = 'STOP AUTOMATION';
    button.setAttribute('aria-label', 'Stop Auto-Click automation');
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.onStop();
    });
    bar.append(dot, status, button);
    root.append(style, bar);
    (this.doc.body ?? this.doc.documentElement).append(host);

    this.host = host;
    this.status = status;
  }
}
