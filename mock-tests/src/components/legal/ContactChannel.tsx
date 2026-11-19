import Link from 'next/link';
import { CONTACT, LEGAL_ROUTES } from '@/lib/seo/site-config';

/**
 * The one place that decides how a reader is told to reach a human.
 *
 * WHY THIS EXISTS AT ALL
 *   The privacy policy, the terms and the footer each used `CONTACT.privacyEmail`
 *   and `CONTACT.supportEmail` inline, in prose that assumed a mailbox ("email
 *   privacy@... and we will remove it"). Those addresses were `support@` and
 *   `privacy@mocktestspro.com.au` - a domain that was never purchased - so every
 *   one of those sentences pointed at a dead end, and simply making the addresses
 *   nullable would have turned them into "email  and we will remove it".
 *
 *   Fixing that by hand in eleven sentences across three pages guarantees
 *   divergence: one page will end up advertising a mailbox another has stopped
 *   naming, which is worse for a parent trying to exercise a privacy right than
 *   having no stated channel at all. Both readings live here, so the pages can
 *   only ever say what this file can back up.
 *
 * WHY A COMPONENT AND NOT A STRING
 *   The fallback is a *link*, not an address. A `mailto:` string cannot degrade
 *   into a Next.js `<Link>` to `/contact`, and the form is the channel that
 *   actually works today: it produces a tracked enquiry with a reference number
 *   and a response clock, which an unmonitored inbox does not.
 */

export type ContactChannelName = 'support' | 'privacy';

function addressFor(channel: ContactChannelName): string | null {
  return channel === 'support' ? CONTACT.supportEmail : CONTACT.privacyEmail;
}

/**
 * A noun phrase usable after a preposition or a colon:
 * "Privacy enquiries: ...", "Send requests to ...".
 */
export function ContactRef({ channel }: { channel: ContactChannelName }) {
  const address = addressFor(channel);
  if (address) {
    return <a href={`mailto:${address}`}>{address}</a>;
  }
  return <Link href={LEGAL_ROUTES.contact}>our contact form</Link>;
}

/**
 * A verb phrase usable as the imperative of a sentence: "... email privacy@x and
 * we will remove it" / "... use our contact form and we will remove it".
 *
 * The verb changes with the channel because "email our contact form" is not a
 * sentence, and neither is "use privacy@x".
 */
export function ContactAction({ channel }: { channel: ContactChannelName }) {
  const address = addressFor(channel);
  if (address) {
    return (
      <>
        email <a href={`mailto:${address}`}>{address}</a>
      </>
    );
  }
  return (
    <>
      use <Link href={LEGAL_ROUTES.contact}>our contact form</Link>
    </>
  );
}
