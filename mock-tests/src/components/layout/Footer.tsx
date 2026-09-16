import Link from "next/link";
import { BookOpen, Facebook, Twitter, Instagram, Youtube } from "lucide-react";
import styles from "./Layout.module.css";

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerMain}>
        <div className={styles.footerBrand}>
          <div className={styles.footerLogoContainer}>
            <div className={styles.footerLogoIcon}><BookOpen size={20} /></div>
            <h3 className={styles.footerLogoText}>MockTests Pro</h3>
          </div>
          <p className={styles.footerDesc}>Premium EdTech platform providing adaptive testing and AI-powered learning for Years 3-8 students across Australia.</p>
          <div className={styles.socialLinks}>
            <a href="#" className={styles.socialIcon}><Facebook size={18} /></a>
            <a href="#" className={styles.socialIcon}><Twitter size={18} /></a>
            <a href="#" className={styles.socialIcon}><Instagram size={18} /></a>
            <a href="#" className={styles.socialIcon}><Youtube size={18} /></a>
          </div>
        </div>
        <div className={styles.footerLinksGrid}>
          <div className={styles.footerCol}>
            <h4>Exam Types</h4>
            <ul>
              <li><Link href="/tests?type=NAPLAN_STYLE_READING">NAPLAN Style Reading</Link></li>
              <li><Link href="/tests?type=NAPLAN_STYLE_NUMERACY">NAPLAN Style Numeracy</Link></li>
              <li><Link href="/tests?type=NAPLAN_STYLE_LANGUAGE_CONVENTION">NAPLAN Style Language Convention</Link></li>
              <li><Link href="/tests?type=SELECTIVE">Selective School Tests</Link></li>
              <li><Link href="/tests?type=MATHS_OLYMPIAD">Maths Olympiad</Link></li>
              <li><Link href="/tests?type=ENGLISH_OLYMPIAD">English Olympiad</Link></li>
              <li><Link href="/blog/ai-writing">AI Writing Assessment</Link></li>
            </ul>
          </div>
          <div className={styles.footerCol}>
            <h4>Resources</h4>
            <ul>
              <li><Link href="/blog">Study Tips & Strategies</Link></li>
              <li><Link href="/about">Exam Prep Guides</Link></li>
              <li><Link href="/blog">Success Stories</Link></li>
              <li><Link href="/about">Parent Resources</Link></li>
              <li><Link href="/blog">Latest News</Link></li>
            </ul>
          </div>
          <div className={styles.footerCol}>
            <h4>Support</h4>
            <ul>
              <li><Link href="/about">About Us</Link></li>
              <li><Link href="/about">Contact Us</Link></li>
              <li><Link href="/about">FAQ</Link></li>
              <li><Link href="/about">Privacy Policy</Link></li>
              <li><Link href="/about">Terms of Service</Link></li>
            </ul>
          </div>
        </div>
      </div>
      <div className={styles.footerBottom}>
        <div className={styles.footerBottomContent}>
          <span>© {new Date().getFullYear()} Mock Tests Pro. All rights reserved.</span>
          <div className={styles.footerLegal}>
            <Link href="/about">Legal</Link>
            <Link href="/about">Sitemap</Link>
            <Link href="/about">Accessibility</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
