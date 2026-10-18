import { PRIVACY_PATH } from '../lib/privacy';
// A new tab preserves private forms, unsaved work and exports in the current tab.
export function PrivacyLink({ className = '' }: { className?: string }) {
  return <a href={PRIVACY_PATH} target="_blank" rel="noopener noreferrer"
    aria-label="Privacy notice (opens in a new tab)" className={`text-sm underline underline-offset-4 ${className}`}>
    Privacy notice<span className="sr-only"> (opens in a new tab)</span>
  </a>;
}
