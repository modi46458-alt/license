import { INDIAMART_PAGE, type PageConfig } from '../selectors/indiamart-selectors';

export interface PageDetection {
  readonly supportedUrl: boolean;
  readonly leadListPresent: boolean;
  /** Scanner may run: supported URL AND lead-list signals in the DOM. */
  readonly active: boolean;
}

export function isSupportedUrl(url: string, config: PageConfig = INDIAMART_PAGE): boolean {
  if (!config.hostPattern.test(url)) return false;
  if (config.supportedPaths.length === 0) return true;
  let path: string;
  try {
    const parsed = new URL(url);
    path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return false;
  }
  return config.supportedPaths.some((pattern) => pattern.test(path));
}

/** Lead-list markup inside `root`; with includeSelf, `root` itself may match. */
export function hasLeadList(
  root: ParentNode,
  config: PageConfig = INDIAMART_PAGE,
  includeSelf = false,
): boolean {
  return config.leadListSignals.some(
    (selector) =>
      (includeSelf && root instanceof Element && root.matches(selector)) ||
      root.querySelector(selector) !== null,
  );
}

/**
 * The scanner never runs merely because the host matches: the page must also
 * render lead-list markup. With confirmed path patterns configured, the URL
 * must match one of them as well.
 */
export function detectPage(
  url: string,
  root: ParentNode,
  config: PageConfig = INDIAMART_PAGE,
): PageDetection {
  const supportedUrl = isSupportedUrl(url, config);
  const leadListPresent = supportedUrl && hasLeadList(root, config);
  return { supportedUrl, leadListPresent, active: supportedUrl && leadListPresent };
}
