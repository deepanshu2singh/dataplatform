import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { BrandLogo } from '../components/BrandLogo';
import { ThemeControl } from '../components/ThemeControl';
import { ThemeStorageControl } from '../components/ThemeStorageControl';
import { PRIVACY_CONTACT_LINK, PRIVACY_EMAIL, PRIVACY_OPERATOR, PRIVACY_VERSION } from '../lib/privacy';
import './PrivacyPage.css';
const contents = [['operator','Who runs the app'],['information','Information we handle'],['purposes','Why we use it'],['uploads','What you may upload'],['providers','Providers and international processing'],['retention','Keeping and deleting information'],['browser','Browser storage and your choices'],['rights','Your rights and requests'],['changes','Changes to this notice']];
export function PrivacyPage() {
  useEffect(() => { const previous = document.title; document.title = 'Privacy notice | Data Platform'; return () => { document.title = previous; }; }, []);
  return <div className="privacy-page">
    <a href="#privacy-main" className="privacy-skip">Skip to privacy notice</a>
    <header className="privacy-header"><Link to="/" aria-label="Data Platform home"><BrandLogo /></Link><div className="privacy-header-actions"><Link to="/">Open workspace</Link><ThemeControl /></div></header>
    <main id="privacy-main" tabIndex={-1} className="privacy-main">
      <header className="privacy-intro"><p className="eyebrow">Your information</p><h1>Privacy notice</h1><p>Understand what Data Platform uses, where it goes, and your choices.</p><p className="privacy-version">Updated 18 October 2026 · Version {PRIVACY_VERSION}</p></header>
      <div className="privacy-summary workspace-panel"><strong>Your workspace stays yours.</strong><p>We use uploaded content only to run and support your workspace. We do not sell it, use it for advertising, or use it for unrelated research, demonstrations or AI model training.</p><p>Data Platform is currently a free analytics and learning service for people aged 16 and above. Please do not create an account if you are under 16.</p></div>
      <nav aria-label="Privacy notice contents" className="privacy-contents">{contents.map(([id,label]) => <a key={id} href={`#${id}`}>{label}</a>)}</nav>
      <article className="privacy-article workspace-panel">
        <section id="operator" aria-labelledby="privacy-operator-title"><h2 id="privacy-operator-title">Who runs the app</h2>
          <p>{PRIVACY_OPERATOR} operates Data Platform personally from the United Kingdom. Contact <a href={PRIVACY_CONTACT_LINK}>{PRIVACY_EMAIL}</a> about this notice or your information.</p>
          <p>We determine how account administration, service security and privacy correspondence are handled. Where we process workspace content on an organisation’s instructions, it determines the purpose and we act on its instructions. This notice does not replace any processing agreement needed for that arrangement.</p>
        </section>
        <section id="information" aria-labelledby="privacy-information-title"><h2 id="privacy-information-title">Information we handle</h2>
          <ul><li><strong>Accounts:</strong> your email, optional name, password hash, verification status, account dates and security state. Passwords are used to sign in or confirm sensitive actions; the account database stores a password hash rather than a readable password.</li>
            <li><strong>Workspace content:</strong> original CSVs, filenames/descriptions, dataset schemas and sample rows, saved notebook code/content, and dashboard queries, labels, charts and layouts. Samples and saved content may contain personal information from your uploads.</li>
            <li><strong>Upload/security records:</strong> upload states and object references, verification/reset records, delivery/attempt limits and sessions.</li>
            <li><strong>Technical information:</strong> request identifiers, routes, statuses, timing and selected account/resource identifiers in app logs. Hosting providers also handle connection/request information to serve and protect the app.</li>
            <li><strong>Correspondence:</strong> your contact details and information included in support/privacy requests.</li></ul>
          <p>Information comes from you, your browser, service operations and uploaded content. If someone uploads information about you, that uploader is the source of the workspace information.</p>
          <p>Standard notebook saves omit transient results; older or otherwise stored notebook content may include outputs. Exports copy what is actually saved. Original CSVs are downloaded separately.</p>
          <p>Email and password are needed for a password-based account; your name is optional. Uploads are your choice. Without a dataset, features requiring it cannot run.</p>
        </section>
        <section id="purposes" aria-labelledby="privacy-purposes-title"><h2 id="privacy-purposes-title">Why we use it</h2>
          <p>For account administration, operating the free workspace, proportionate troubleshooting and preventing abuse, our lawful basis is legitimate interests: providing the service you choose to use and protecting accounts and saved work. We limit use to what those purposes need and consider users’ interests, including 16–17-year-olds.</p>
          <p>We use email for verification, recovery and account-security messages. We use privacy-request information to handle your request and meet applicable data-protection obligations. Where a specific legal obligation requires processing, we rely on that obligation.</p>
          <p>Where we process content on an organisation’s behalf, it is responsible for its lawful basis, notices and instructions. Uploading does not itself establish that every use is lawful. We do not use workspace content to make decisions about you with legal or similarly significant effects; your own analysis and decisions remain your responsibility.</p>
        </section>
        <section id="uploads" aria-labelledby="privacy-uploads-title"><h2 id="privacy-uploads-title">What you may upload</h2>
          <p>Upload ordinary personal data only with the necessary authority and lawful arrangements, and include only what your analysis needs.</p>
          <p>This release does not support personal data revealing health, genetic or identification-biometric information, racial/ethnic origin, political opinions, religious/philosophical beliefs, trade-union membership, sex life or sexual orientation. Do not upload criminal allegations, proceedings or conviction records, payment-cardholder details, passwords or secret access keys.</p>
          <p>These are use rules, not a promise that every prohibited value is detected automatically. Contact the operator about an accidental prohibited upload so it can be handled privately. Do not attach the dataset, passwords or verification codes to your message.</p>
        </section>
        <section id="providers" aria-labelledby="privacy-providers-title"><h2 id="privacy-providers-title">Providers and international processing</h2>
          <dl className="privacy-provider-list"><div><dt>Supabase</dt><dd>Account/workspace database records, private original CSVs and a bounded CSV snapshot for browser Python. The project is hosted in London. <a href="https://supabase.com/legal/customer-resources/data-processing-addendum" target="_blank" rel="noopener noreferrer">Supabase processing terms</a>.</dd></div>
            <div><dt>Vercel</dt><dd>Frontend hosting, backend requests, temporary CSV processing for SQL/previews, and hosting/runtime logs. Backend functions are configured for London; delivery/provider operations are not limited to that region. <a href="https://vercel.com/legal/dpa" target="_blank" rel="noopener noreferrer">Vercel processing terms</a>.</dd></div>
            <div><dt>Resend</dt><dd>Security-email recipients, message content and delivery records. The sending region is Ireland; Resend stores email data in the United States. The app’s security-email functions do not send uploaded CSVs to Resend. <a href="https://resend.com/security/gdpr" target="_blank" rel="noopener noreferrer">Resend data handling</a>.</dd></div>
            <div><dt>Microsoft Outlook</dt><dd>Correspondence sent to the operator’s privacy inbox. Include only what is needed to explain your request. <a href="https://www.microsoft.com/privacy/privacystatement" target="_blank" rel="noopener noreferrer">Microsoft privacy information</a>.</dd></div></dl>
          <p>Providers/subprocessors may handle information outside the UK, including the US. Vercel, Supabase and Resend publish processing terms with international-transfer provisions, including standard contractual clauses and UK addenda where applicable. Contact us for information about applicable safeguards or a copy, with necessary redactions.</p>
          <p>Workspaces are private from other app users. Operator/provider access may be needed to run/support the service, investigate security issues or meet legal requirements. London hosting does not mean that all processing stays in the UK.</p>
        </section>
        <section id="retention" aria-labelledby="privacy-retention-title"><h2 id="privacy-retention-title">Keeping and deleting information</h2>
          <p>We keep account/workspace information while needed to provide the requested workspace. You can delete individual items through their workspace pages and contact us about account closure or information no longer needed. We review retention when a request is made or a purpose ends; information is not kept for unrelated future uses.</p>
          <p><strong>Available in this release:</strong> individual-item controls and password-confirmed exports are available. Self-service account deletion and scheduled inactivity, unverified-account and expired-upload purges are not yet running. Contact the operator to request account deletion; sending a request does not itself delete your account.</p>
          <p>Verification/reset codes expire after 10 minutes. Expiry does not necessarily remove the associated security record at that moment. Upload authorisation expiry is also separate from removing stored bytes and upload records.</p>
          <p>For resolved privacy/support requests, unnecessary attachments should be removed sooner; necessary case correspondence is retained for 12 months after closure unless a specific ongoing need requires a limited, documented extension.</p>
          <p>Resend’s standard Free-plan email/log retention is 30 days; backups and other provider records have separate terms. Hosting/security records follow applicable provider retention. Deleting an app item does not promise simultaneous erasure of every provider-held copy.</p>
          <p>The Supabase Free plan does not provide dashboard project backups or Point-in-Time Recovery. Database backups, when used, do not contain the actual uploaded Storage files. Downloaded exports are copies you control and are not removed by deleting an app item.</p>
        </section>
        <section id="browser" aria-labelledby="privacy-browser-title"><h2 id="privacy-browser-title">Browser storage and your choices</h2>
          <ul><li><strong>Sign-in cookie:</strong> used for your authenticated session until its configured sign-in expiry or sign-out. Your browser shows its expiry. Sign out everywhere also revokes existing sessions.</li>
            <li><strong>Appearance:</strong> an optional Light, Dark or System preference. Existing saved choices remain readable. Use the control below to remember or forget it. Selecting System alone does not forget a saved preference.</li>
            <li><strong>Upload resume information:</strong> the upload library may store file metadata, an object locator and an upload URL in this browser to resume a transfer. Success removes the resume fingerprint; abandoned attempts can leave records. These records are separate from cloud CSVs. Treat upload URLs as private.</li>
            <li><strong>Program assets:</strong> browsers may cache app/Python runtime code. This is separate from workspace records. Export passwords and confirmations stay in page memory rather than persistent browser storage.</li></ul>
          <div className="privacy-browser-control"><ThemeControl /><ThemeStorageControl /></div>
          <p>The current app does not include a visitor-analytics SDK, advertising tracker or session-replay integration. Providers still produce operational/security information; deployment-protection or storage infrastructure may set its own cookies. This appearance control does not clear sign-in cookies, upload-resume records, cloud files or unrelated browser data.</p>
        </section>
        <section id="rights" aria-labelledby="privacy-rights-title"><h2 id="privacy-rights-title">Your rights and requests</h2>
          <p>Depending on applicable law and circumstances, you can request access, correction, erasure or restriction. A portability right applies where its legal conditions are met; the workspace export is available separately.</p>
          <aside className="privacy-objection"><h3>Your right to object</h3><p>You can object to our use of your information based on legitimate interests. Contact <a href={PRIVACY_CONTACT_LINK}>{PRIVACY_EMAIL}</a> and explain the use you object to. We will assess your circumstances and applicable rules.</p></aside>
          <p>You do not need a working sign-in to email a request. Tell us which account/information it concerns, without sending a password, reset code or full dataset. We may need proportionate identity/clarification information. We will explain our response, applicable exceptions and the relevant legal timeframe.</p>
          <p>If your information is in another person’s uploaded dataset, you may also contact that person/organisation. We can help route a request about processing on their instructions.</p>
          <p>You can complain to the UK Information Commissioner’s Office at <a href="https://ico.org.uk/make-a-complaint/" target="_blank" rel="noopener noreferrer">ico.org.uk/make-a-complaint</a>, or your local supervisory authority where applicable.</p>
        </section>
        <section id="changes" aria-labelledby="privacy-changes-title"><h2 id="privacy-changes-title">Changes to this notice</h2><p>We will update this page when purposes, providers or controls change. The date/version above identify this notice. Material changes affecting your information will be brought to your attention appropriately. This notice does not give permission to reuse uploads for a new purpose.</p></section>
      </article>
      <footer className="privacy-footer"><p>Questions? <a href={PRIVACY_CONTACT_LINK}>{PRIVACY_EMAIL}</a></p><Link to="/">Return to Data Platform</Link></footer>
    </main>
  </div>;
}
