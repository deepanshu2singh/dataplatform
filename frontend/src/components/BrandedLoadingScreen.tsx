/** Uses the existing auth/route loading lifecycle; never delays a ready page. */
export function BrandedLoadingScreen() {
  return (
    <div className="brand-loading-screen" role="status" aria-live="polite" aria-label="Loading page">
      <picture className="brand-loading-picture">
        <source media="(max-width: 600px)" srcSet="/android-chrome-512x512.png" />
        <img className="brand-loading-art" src="/loading-screen-1920x1080.png" alt="" aria-hidden="true" width="1920" height="1080" fetchPriority="low" />
      </picture>
      <strong className="brand-loading-mobile-title">Data Platform</strong>
      <div className="brand-loading-caption">
        <span className="brand-loading-indicator" aria-hidden="true" />
        <p className="brand-loading-message">Preparing your workspace…</p>
      </div>
    </div>
  );
}
