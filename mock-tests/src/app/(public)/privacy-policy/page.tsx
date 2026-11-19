import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, LegalSection } from "@/components/legal/LegalPage";
import { absoluteUrl, CONTACT, INDEXABLE_ROBOTS, LEGAL_LAST_UPDATED, LEGAL_ROUTES, SITE_NAME } from "@/lib/seo/site-config";
import { ContactAction } from "@/components/legal/ContactChannel";

const PATH = LEGAL_ROUTES.privacy;
const PAGE_TITLE = "Privacy Policy: How We Handle Student & Parent Data";
const PAGE_DESCRIPTION =
  "How " + SITE_NAME + " collects, uses, stores and shares personal information, including children's test data, under the Australian Privacy Principles.";

export const metadata: Metadata = {
  title: { absolute: PAGE_TITLE },
  description: PAGE_DESCRIPTION,
  alternates: { canonical: PATH },
  openGraph: {
    type: "website",
    url: absoluteUrl(PATH),
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
  },
  robots: INDEXABLE_ROBOTS,
};

/**
 * Sub-processors, reflecting the services this platform actually runs on.
 * Keep this table in sync with the real infrastructure - a privacy policy that
 * omits a processor is a compliance problem, not a documentation nicety.
 */
const SUBPROCESSORS = [
  { name: "Vercel Inc.", purpose: "Application hosting and content delivery", region: "United States / global edge" },
  { name: "Supabase Inc.", purpose: "Database, authentication and access control", region: "See Supabase region selection" },
  { name: "Stripe, Inc.", purpose: "Payment processing. Card details are handled by Stripe and are not stored on our servers.", region: "United States / global" },
  { name: "Upstash (QStash)", purpose: "Asynchronous job queue used to run writing assessments", region: "See Upstash region selection" },
  { name: "Twilio SendGrid", purpose: "Delivery of transactional email such as sign-in and password reset messages", region: "United States" },
  { name: "Google LLC", purpose: "Optional \"Sign in with Google\" authentication, only if you choose it", region: "United States" },
  { name: "DeepSeek", purpose: "AI marking of student writing responses. The text a student types for a writing task is sent to this provider for scoring.", region: "See provider" },
];

export default function PrivacyPolicyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro={
        "This policy explains what personal information " + SITE_NAME + " collects, why we collect it, " +
        "who we share it with, and the choices and rights you have. It applies to our website and " +
        "to the practice-testing platform."
      }
      updated={LEGAL_LAST_UPDATED}
      path={PATH}
    >
      <LegalSection id="summary" title="In short">
        <ul>
          <li>
            <strong>Students are pseudonymous.</strong> A student signs in with a system-generated
            username (for example a flower, a fruit and some digits) and a year level between 2
            and 8. We do not ask a student for their real name, date of birth or photograph.
          </li>
          <li>
            <strong>A parent or guardian owns the account.</strong> The adult registers with an
            email address and links one or more students to it.
          </li>
          <li>
            <strong>We store learning data, not identity data.</strong> Test attempts, answers,
            timing, scores and writing feedback are kept so reports and progress tracking work.
          </li>
          <li>
            <strong>Writing is marked by a third-party AI model.</strong> When a student submits a
            writing task, the text they typed is sent to DeepSeek for scoring. This is disclosed
            below and in our sub-processor table.
          </li>
          <li>
            <strong>We do not sell personal information</strong> and we do not show third-party
            advertising.
          </li>
        </ul>
      </LegalSection>
      <LegalSection id="what-we-collect" title="What information we collect">
        <h3>From the parent or guardian who registers</h3>
        <ul>
          <li>Email address and a password (stored only as a cryptographic hash by our authentication provider)</li>
          <li>If you choose &quot;Sign in with Google&quot;: the name and email address Google returns to us</li>
          <li>
            Your registration confirmations: that you confirmed you are 18 or over, that you accepted
            the Terms of Service and acknowledged this Privacy Policy, the version of that wording,
            and the date and time you accepted it
          </li>
          <li>
            Your optional email preference - whether you asked to receive occasional updates about new
            practice tests, exam dates and study resources
          </li>
          <li>Purchase records - what you bought and when. Card numbers are processed by Stripe and never reach our servers.</li>
          <li>Messages you send to our support or privacy addresses</li>
        </ul>

        <h3>About each student</h3>
        <ul>
          <li>A system-generated pseudonymous username</li>
          <li>Year level (restricted to 2 through 8)</li>
          <li>The link between the student profile and the parent account that manages it</li>
        </ul>

        <h3>Generated while using the platform</h3>
        <ul>
          <li>Test attempts: which test, when it started and was submitted, and its status</li>
          <li>Per-question responses: the answer given, whether it was correct, the difficulty served, and time spent</li>
          <li>Scores: overall score, section breakdown, raw accuracy and weighted score</li>
          <li>Writing tasks: the text the student typed, plus the AI-generated score, strengths, suggested improvements and an improved sample</li>
          <li>Notifications we generate for the parent account</li>
        </ul>

        <h3>Collected automatically</h3>
        <ul>
          <li>IP address, browser type and device information in standard server logs</li>
          <li>Session cookies required to keep you signed in</li>
        </ul>
      </LegalSection>

      <LegalSection id="how-we-use-it" title="How we use your information">
        <ul>
          <li>To provide practice tests, adaptive difficulty, scoring and progress reports</li>
          <li>To mark writing tasks and return feedback</li>
          <li>To authenticate you and keep your account secure</li>
          <li>To process purchases and grant access to what you bought</li>
          <li>To send transactional email such as sign-in links and purchase receipts</li>
          <li>
            To send occasional product and exam-date updates, <strong>only if</strong> you ticked the
            optional box at registration. This is never sent to parents who left it unticked, and you
            can withdraw it at any time.
          </li>
          <li>To respond to support and privacy requests</li>
          <li>To detect and prevent abuse, and to debug and improve the platform</li>
        </ul>
        <p>
          We do not use student learning data to build advertising profiles, and we do not sell or
          rent personal information to anyone.
        </p>
      </LegalSection>

      <LegalSection id="children" title="Children&apos;s information">
        <div className="notice">
          <p>
            {SITE_NAME} is designed for students in Years 2 to 8. We do not knowingly let a child
            register an account on their own: accounts are created and managed by a parent or
            guardian, and the student signs in under that household.
          </p>
        </div>
        <p>Our approach to children&apos;s data follows three rules:</p>
        <ol>
          <li>
            <strong>Minimise identity data.</strong> We use a pseudonymous generated username
            instead of a real name, and we collect no date of birth, photograph or address for a
            student.
          </li>
          <li>
            <strong>Limit collection to learning.</strong> We store only what is needed to score a
            test and show progress to the parent or guardian who manages the account.
          </li>
          <li>
            <strong>Give the adult control.</strong> A parent or guardian can request access to,
            correction of, or deletion of their child&apos;s data at any time.
          </li>
        </ol>
        <p>
          If you believe a child has given us personal information without a parent or guardian
          registering the account, <ContactAction channel="privacy" /> and we will remove it.
        </p>
      </LegalSection>

      <LegalSection id="ai-writing" title="AI marking of student writing">
        <p>
          When a student submits a writing task, the text they typed is sent to DeepSeek, a
          third-party AI provider, which scores it against our rubric and returns strengths,
          suggested improvements and an improved sample. We store the result against the attempt.
        </p>
        <p>
          Students are not required to enter their real name in a writing response, and we ask that
          they do not. Writing text is used for the purpose of marking that response.
        </p>
        <p>
          If you would prefer your child not to use AI-marked writing tasks, you can disable or
          avoid the writing component and still use the multiple-choice practice tests.{' '}
          <ContactAction channel="privacy" /> if you would like this arranged for an existing
          account.
        </p>
      </LegalSection>
      <LegalSection id="sharing" title="Who we share information with">
        <p>
          We do not sell personal information. We share it only with the service providers listed
          below, and only to the extent needed to run the platform. Each is engaged under terms that
          restrict its use of the data.
        </p>
        <table>
          <thead>
            <tr>
              <th scope="col">Provider</th>
              <th scope="col">Purpose</th>
              <th scope="col">Location</th>
            </tr>
          </thead>
          <tbody>
            {SUBPROCESSORS.map((sp) => (
              <tr key={sp.name}>
                <td>{sp.name}</td>
                <td>{sp.purpose}</td>
                <td>{sp.region}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>We may also disclose information where we are legally required to do so.</p>
      </LegalSection>

      <LegalSection id="overseas" title="Overseas disclosure">
        <p>
          Some providers above operate outside Australia, including in the United States. When we
          disclose personal information overseas we take reasonable steps to ensure the recipient
          handles it in a way consistent with the Australian Privacy Principles.
        </p>
      </LegalSection>

      <LegalSection id="cookies" title="Cookies and similar technologies">
        <p>
          We use cookies and local storage that are necessary to keep you signed in, to remember a
          test in progress, and to keep the interface working. We do not use third-party advertising
          or cross-site tracking cookies.
        </p>
        <p>
          You can block or delete cookies in your browser settings. If you do, sign-in and in-progress
          tests may stop working.
        </p>
      </LegalSection>

      <LegalSection id="retention" title="How long we keep information">
        <ul>
          <li>
            <strong>Account data</strong> is kept while your account is open.
          </li>
          <li>
            <strong>Learning records</strong> - attempts, responses, scores and writing feedback -
            are kept while the account is open because progress tracking depends on history.
          </li>
          <li>
            <strong>Purchase records</strong> are kept as long as Australian tax and consumer law
            requires.
          </li>
          <li>
            <strong>Server logs</strong> are kept for a limited period for security and debugging.
          </li>
        </ul>
        <p>
          When you delete an account, or when you ask us to, the associated student profiles and
          their attempts, responses and writing evaluations are deleted with it.
        </p>
      </LegalSection>

      <LegalSection id="security" title="How we protect information">
        <ul>
          <li>Passwords are stored only as salted hashes by our authentication provider; we never see them.</li>
          <li>All traffic is served over HTTPS.</li>
          <li>Database access is restricted by role, and row-level security rules limit what each account can read.</li>
          <li>Secrets are held in environment variables and are never exposed to the browser.</li>
          <li>Privileged database access is restricted to trusted server-side jobs.</li>
        </ul>
        <p>
          No system is completely secure. If we become aware of an eligible data breach affecting
          your personal information, we will notify you and the Office of the Australian Information
          Commissioner as the Notifiable Data Breaches scheme requires.
        </p>
      </LegalSection>
      <LegalSection id="rights" title="Your rights and choices">
        <p>Subject to limited legal exceptions, you can ask us to:</p>
        <ul>
          <li><strong>Access</strong> the personal information we hold about you or your child</li>
          <li><strong>Correct</strong> information that is inaccurate or out of date</li>
          <li><strong>Delete</strong> an account and its associated learning records</li>
          <li><strong>Opt out</strong> of non-essential email</li>
          <li><strong>Object or restrict</strong> particular processing, including AI marking of writing</li>
        </ul>
        <p>
          <ContactAction channel="privacy" /> to make a request. To protect student data we will
          verify that the request comes from the parent or guardian who registered the account
          before we act on it. We aim to respond within 30 days.
        </p>
        <p>
          Many requests can also be handled directly in the product: parents can manage linked
          student profiles, and account settings let you update your own details.
        </p>
      </LegalSection>

      <LegalSection id="apps" title="Australian Privacy Principles">
        <p>
          We handle personal information in accordance with the Australian Privacy Principles in the{' '}
          <em>Privacy Act 1988</em> (Cth). This policy describes our APP 5 notification. Where the
          APPs give you a right, we honour it.
        </p>
      </LegalSection>

      <LegalSection id="complaints" title="Complaints">
        <p>
          If you believe we have breached the Australian Privacy Principles,{' '}
          <ContactAction channel="privacy" /> with the details and we will investigate and reply in
          writing.
        </p>
        <p>
          If you are not satisfied with our response, you can complain to the{' '}
          <a href="https://www.oaic.gov.au" target="_blank" rel="noopener noreferrer">
            Office of the Australian Information Commissioner
          </a>{' '}
          (oaic.gov.au).
        </p>
      </LegalSection>

      <LegalSection id="changes" title="Changes to this policy">
        <p>
          We may update this policy as the platform and the law change. The &quot;Last updated&quot;
          date at the top of this page shows the current revision. Material changes will be
          announced to account holders by email or by a notice in the product.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="Contact us">
        <p>
          {CONTACT.privacyEmail && (
            <>
              Privacy enquiries: <a href={'mailto:' + CONTACT.privacyEmail}>{CONTACT.privacyEmail}</a>
              <br />
            </>
          )}
          {CONTACT.supportEmail && (
            <>
              General support: <a href={'mailto:' + CONTACT.supportEmail}>{CONTACT.supportEmail}</a>
              <br />
            </>
          )}
          {/*
            Always rendered, and no longer introduced as an alternative ("Or ...").
            Until a mailbox exists this is not the second-best route to a human — it
            is the only one, and it is the one that actually records the request.
          */}
          Use our <Link href={LEGAL_ROUTES.contact}>contact page</Link>. Every message sent that
          way is logged with a reference number and a response clock, so it cannot be lost the way
          an email in a shared inbox can.
        </p>
        <p>
          See also our <Link href={LEGAL_ROUTES.terms}>Terms &amp; Conditions</Link> and{' '}
          <Link href="/about">About page</Link>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}