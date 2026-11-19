import Link from "next/link";
import { BookOpen, type LucideIcon } from "lucide-react";
import { BLOG_CATEGORIES } from "@/lib/seo/categories";
import { getPostsByCategory } from "@/data/blog-posts";
import { ORGANISATION_NAME, LEGAL_ROUTES, CONTACT } from "@/lib/seo/site-config";

/**
 * Social profiles for the footer and schema.org `sameAs`.
 *
 * Previously these were hardcoded to href="#", which ships dead links: bad for
 * crawl efficiency, bad for users, and a missed entity-validation signal.
 * Populate this array with real profile URLs (importing the matching icon from
 * lucide-react) and they render automatically; left empty, no broken links ship.
 */
const SOCIAL_LINKS: { name: string; url: string; Icon: LucideIcon }[] = [
  // { name: "Facebook",  url: "https://www.facebook.com/...",  Icon: Facebook },
  // { name: "X",         url: "https://x.com/...",             Icon: Twitter },
  // { name: "Instagram", url: "https://www.instagram.com/...", Icon: Instagram },
  // { name: "YouTube",   url: "https://www.youtube.com/@...",  Icon: Youtube },
];

const EXAM_TYPE_LINKS = [
  { label: "NAPLAN Style Reading", href: "/tests?type=NAPLAN_STYLE_READING" },
  { label: "NAPLAN Style Numeracy", href: "/tests?type=NAPLAN_STYLE_NUMERACY" },
  { label: "NAPLAN Style Language Convention", href: "/tests?type=NAPLAN_STYLE_LANGUAGE_CONVENTION" },
  { label: "Selective School Tests", href: "/tests?type=SELECTIVE" },
  { label: "Maths Olympiad", href: "/tests?type=MATHS_OLYMPIAD" },
  { label: "English Olympiad", href: "/tests?type=ENGLISH_OLYMPIAD" },
  // Was /blog/ai-writing, a slug that does not exist (404). AI writing
  // assessment is described on /features.
  { label: "AI Writing Assessment", href: "/features" },
];

const SUPPORT_LINKS = [
  { label: "About Us", href: "/about" },
  { label: "Free Practice Tests", href: "/free" },
  { label: "Platform Features", href: "/features" },
  { label: "Frequently Asked Questions", href: "/free#free-faq-heading" },
  { label: "Editorial Standards", href: "/about" },
  { label: "Contact Us", href: LEGAL_ROUTES.contact },
];

/**
 * Legal links. These previously all pointed at /about, which is both misleading
 * and a trust problem: Google treats a reachable privacy policy and terms page as
 * an E-E-A-T signal, and a dead "Privacy Policy" link is worse than none.
 */
const LEGAL_LINKS = [
  { label: "Privacy Policy", href: LEGAL_ROUTES.privacy },
  { label: "Terms & Conditions", href: LEGAL_ROUTES.terms },
  { label: "Contact Us", href: LEGAL_ROUTES.contact },
];

const linkClass =
  "text-[#94a3b8] text-sm no-underline hover:text-white transition-colors duration-150";

export function Footer() {
  // Only surface topic hubs that actually contain articles.
  const topics = BLOG_CATEGORIES.map((category) => ({
    ...category,
    count: getPostsByCategory(category.slug).length,
  })).filter((category) => category.count > 0);

  return (
    <footer className="bg-[#0f172a] text-white px-6 lg:px-16 pt-16 pb-6 mt-16 relative z-100">
      <div className="max-w-[1400px] mx-auto grid grid-cols-1 lg:grid-cols-[1.5fr_3fr] gap-16 mb-16">
        <div>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-primary rounded-md flex items-center justify-center" aria-hidden="true">
              <BookOpen size={20} />
            </div>
            <h2 className="text-xl font-extrabold m-0">{ORGANISATION_NAME}</h2>
          </div>
          <p className="text-[#94a3b8] max-w-96 text-sm leading-relaxed">
            Premium EdTech platform providing adaptive testing and AI-powered
            learning for Years 3-8 students across Australia, covering NAPLAN,
            Selective School and Scholarship exams.
          </p>

          {SOCIAL_LINKS.length > 0 && (
            <div className="flex gap-3 mt-6">
              {SOCIAL_LINKS.map(({ name, url, Icon }) => (
                <a
                  key={name}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer me"
                  aria-label={ORGANISATION_NAME + " on " + name}
                  className="w-9 h-9 bg-white/5 rounded-md flex items-center justify-center text-[#94a3b8] transition-all duration-150 no-underline hover:bg-white/10 hover:text-white"
                >
                  <Icon size={18} />
                </a>
              ))}
            </div>
          )}
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-12">
          <div>
            <h3 className="font-extrabold mb-4 text-base">Exam Types</h3>
            <ul className="list-none p-0 m-0 flex flex-col gap-2">
              {EXAM_TYPE_LINKS.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className={linkClass}>{link.label}</Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Topic hubs: real internal links into the blog taxonomy. Previously
              five separate labels all pointed at /blog or /about, which wasted
              crawl equity and gave no topical signal. */}
          <div>
            <h3 className="font-extrabold mb-4 text-base">Guide Topics</h3>
            <ul className="list-none p-0 m-0 flex flex-col gap-2">
              <li>
                <Link href="/blog" className={linkClass}>All Guides</Link>
              </li>
              {topics.map((topic) => (
                <li key={topic.slug}>
                  <Link href={'/blog/category/' + topic.slug} className={linkClass}>
                    {topic.name}
                    <span className="text-[#64748b] text-xs ml-1">({topic.count})</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="font-extrabold mb-4 text-base">Support</h3>
            <ul className="list-none p-0 m-0 flex flex-col gap-2">
              {SUPPORT_LINKS.map((link) => (
                <li key={link.href + link.label}>
                  <Link href={link.href} className={linkClass}>{link.label}</Link>
                </li>
              ))}
              <li>
                <Link href="/auth/login" className={linkClass}>Parent / Student Login</Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="font-extrabold mb-4 text-base">Legal</h3>
            <ul className="list-none p-0 m-0 flex flex-col gap-2">
              {LEGAL_LINKS.map((link) => (
                <li key={link.href + link.label}>
                  <Link href={link.href} className={linkClass}>{link.label}</Link>
                </li>
              ))}
              {/*
                Only the address, never a second "Contact Us" entry — that link is
                already in LEGAL_LINKS above, and until a mailbox is configured the
                address is not something that can be advertised. The previous version
                rendered a mailto: for a domain nobody owns in the one place every
                page of the site shows it.
              */}
              {CONTACT.supportEmail && (
                <li>
                  <a href={'mailto:' + CONTACT.supportEmail} className={linkClass}>
                    {CONTACT.supportEmail}
                  </a>
                </li>
              )}
            </ul>
          </div>
        </div>
      </div>

      <div className="border-t border-white/5 pt-6">
        <div className="max-w-[1400px] mx-auto flex flex-col sm:flex-row justify-between items-center text-[#64748b] text-[0.8125rem] gap-4">
          <span>
            {String.fromCharCode(169)} {new Date().getFullYear()} {ORGANISATION_NAME}. All rights reserved.
          </span>
          <nav aria-label="Footer" className="flex flex-wrap justify-center gap-6">
            {/* /sitemap.xml is a real, generated route - it previously pointed at
                /about, which is both misleading and a lost crawl path. */}
            <Link href={LEGAL_ROUTES.privacy} className="text-inherit no-underline hover:text-white">Privacy Policy</Link>
            <Link href={LEGAL_ROUTES.terms} className="text-inherit no-underline hover:text-white">Terms</Link>
            <Link href={LEGAL_ROUTES.contact} className="text-inherit no-underline hover:text-white">Contact</Link>
            <Link href="/sitemap.xml" className="text-inherit no-underline hover:text-white">Sitemap</Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}