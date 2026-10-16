/** Compact supplied mark with real text that follows the current app theme. */
export function BrandLogo({ centered = false }: { centered?: boolean }) {
  return (
    <span className={`brand-lockup${centered ? ' brand-lockup-centered' : ''}`}>
      <img src="/favicon.svg?v=20261016" alt="" aria-hidden="true" width="36" height="36" />
      <span className="brand-wordmark">Data Platform</span>
    </span>
  );
}
