import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, LegalSection } from "@/components/legal/LegalPage";
import { faqPageSchema, contactPageGraph } from "@/lib/seo/schema";
import {
  absoluteUrl,
  CONTACT,
  LEGAL_LAST_UPDATED,
  LEGAL_ROUTES,
  SITE_NAME,
} from "@/lib/seo/site-config";

const PATH = LEGAL_ROUTES.contact;
const PAGE_TITLE = "Contact Us: Support, Privacy & General Enquiries";
const PAGE_DESCRIPTION =
  "Contact the " + SITE_NAME + " team about NAPLAN and exam preparation, account or billing questions, accessibility, or privacy requests.";

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
  robots: { index: true, follow: true },
};

const CONTACT_FAQ = [
  {
    question: "How quickly will I get a reply?",
    answer:
      "We aim to respond to every message within " + CONTACT.responseTime + ". Billing and privacy requests may take a little longer where we need to verify your identity first.",
  },
  {
    question: "Can my child contact you directly?",
    answer:
      "Students use the platform under a parent or guardian account. We ask that account, billing and privacy enquiries come from the parent or guardian who registered, so we can verify authority to access the data.",
  },
  {
    question: "How do I request a copy or deletion of my data?",
    answer:
      "Email " + CONTACT.privacyEmail + ". You can request access to, correction of, or deletion of your personal information and your child's account data. See our privacy policy for the full list of rights and how we handle requests.",
  },
  {
    question: "Do you offer refunds?",
    answer:
      "Yes - a 14-day money-back guarantee on every purchase, for any reason. Email " + CONTACT.supportEmail + " with your order reference within 14 days of purchase and we refund it in full. No form, no reason required, and you keep any reports generated in the meantime. Subscriptions can also be paused or cancelled at any time from the billing portal. Full wording is in the refunds section of our terms.",
  },
  {
    question: "Are the practice tests aligned to the Australian Curriculum?",
    answer:
      "Yes. Practice content is aligned to the Australian Curriculum and mirrors the format of NAPLAN Online. Our editorial process is described in the privacy policy and on our about page.",
  },
];

export default function ContactPage() {
  const url = absoluteUrl(PATH);

  return (
    <LegalPage
      title="Contact Us"
      intro={
        "Questions about practice tests, your account, billing, accessibility or privacy? " +
        "Email us and a real person on the " + SITE_NAME + " team will reply."
      }
      updated={LEGAL_LAST_UPDATED}
      path={PATH}
      extraSchema={[
        contactPageGraph(url, PAGE_DESCRIPTION),
        faqPageSchema(CONTACT_FAQ, url),
      ]}
    >      <LegalSection id="email-us" title="Email us">
        <table>
          <thead>
            <tr>
              <th scope="col">For</th>
              <th scope="col">Email</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Practice tests, accounts, billing, technical problems</td>
              <td><a href={'mailto:' + CONTACT.supportEmail}>{CONTACT.supportEmail}</a></td>
            </tr>
            <tr>
              <td>Privacy requests, data access, deletion, children&apos;s data</td>
              <td><a href={'mailto:' + CONTACT.privacyEmail}>{CONTACT.privacyEmail}</a></td>
            </tr>
          </tbody>
        </table>
        <p>
          We reply within {CONTACT.responseTime}. We are based in {CONTACT.country} and
          answer in English.
        </p>
      </LegalSection>

      <LegalSection id="what-to-include" title="What to include in your message">
        <p>Including these details lets us answer in one reply instead of several:</p>
        <ul>
          <li>The email address registered on the account</li>
          <li>Which test, report or page you are asking about</li>
          <li>Your device and browser if you are reporting a technical fault</li>
          <li>For billing: the order or receipt reference from your confirmation email</li>
        </ul>
        <p>
          Please do not send passwords, full card numbers or other sensitive details by email.
        </p>
      </LegalSection>

      <LegalSection id="privacy-requests" title="Privacy and children&apos;s data">
        <div className="notice">
          <p>
            <strong>Parents and guardians:</strong> student accounts are created and managed by a
            parent or guardian. Students sign in with a system-generated pseudonymous username
            rather than their real name. To request access to, correction of, or deletion of your
            child&apos;s data, email {CONTACT.privacyEmail} from the address registered on the
            parent account so we can verify you are authorised to act.
          </p>
        </div>
        <p>
          Full details of what we collect, why we collect it, who we share it with and how long we
          keep it are in our{' '}
          <Link href={LEGAL_ROUTES.privacy}>Privacy Policy</Link>.
        </p>
      </LegalSection>

      <LegalSection id="faq" title="Frequently asked questions">
        {CONTACT_FAQ.map((faq) => (
          <div key={faq.question} style={{ marginBottom: "1.5rem" }}>
            <h3 style={{ marginTop: 0 }}>{faq.question}</h3>
            <p style={{ marginBottom: 0 }}>{faq.answer}</p>
          </div>
        ))}
      </LegalSection>

      <LegalSection id="other-pages" title="Other information">
        <ul>
          <li><Link href={LEGAL_ROUTES.privacy}>Privacy Policy</Link></li>
          <li><Link href={LEGAL_ROUTES.terms}>Terms &amp; Conditions</Link></li>
          <li><Link href="/about">About us and our editorial standards</Link></li>
          <li><Link href="/free">Free practice tests</Link></li>
          <li><Link href="/blog">Exam preparation guides</Link></li>
        </ul>
      </LegalSection>
    </LegalPage>
  );
}