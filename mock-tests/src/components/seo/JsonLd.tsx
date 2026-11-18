import type { JsonLdObject } from '@/lib/seo/schema';

/**
 * Renders a schema.org JSON-LD payload.
 *
 * Server component only (no "use client") so it can be placed inside
 * `generateMetadata`-driven server pages and streamed HTML. Structured data
 * must be present in the initial HTML - injecting it from the client means AI
 * crawlers that do not execute JS will never see it.
 *
 * `<` is escaped to `\u003c` so a `</script>` sequence inside post content can
 * never terminate the tag early.
 */
export function JsonLd({ data }: { data: JsonLdObject | JsonLdObject[] | null }) {
  if (!data) return null;

  const payload = (Array.isArray(data) ? data : [data]).filter(Boolean);
  if (payload.length === 0) return null;

  // One <script> per document. Concatenating separate JSON documents into a
  // single tag would produce invalid JSON (e.g. `{...}{...}`), which Google and
  // AI parsers reject outright - silently losing all structured data on the page.
  return (
    <>
      {payload.map((node, i) => (
        <script
          key={i}
          type="application/ld+json"
          // Safe: content is JSON-serialised from our own typed builders, with
          // every `<` escaped so a `</script>` in post content cannot terminate
          // the tag early.
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(node).replace(/</g, '\\u003c'),
          }}
        />
      ))}
    </>
  );
}
