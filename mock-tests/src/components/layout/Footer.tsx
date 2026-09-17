import Link from "next/link";
import { BookOpen, Facebook, Twitter, Instagram, Youtube } from "lucide-react";

export function Footer() {
  return (
    <footer className="bg-[#0f172a] text-white px-6 lg:px-16 pt-16 pb-6 mt-16 relative z-10">
      <div className="max-w-[1400px] mx-auto grid grid-cols-1 lg:grid-cols-[1.5fr_3fr] gap-16 mb-16">
        <div>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-primary rounded-md flex items-center justify-center"><BookOpen size={20} /></div>
            <h3 className="text-xl font-extrabold m-0">MockTests Pro</h3>
          </div>
          <p className="text-[#94a3b8] max-w-96 text-sm leading-relaxed">Premium EdTech platform providing adaptive testing and AI-powered learning for Years 3-8 students across Australia.</p>
          <div className="flex gap-3 mt-6">
            <a href="#" className="w-9 h-9 bg-white/5 rounded-md flex items-center justify-center text-[#94a3b8] transition-all duration-150 no-underline hover:bg-white/10 hover:text-white"><Facebook size={18} /></a>
            <a href="#" className="w-9 h-9 bg-white/5 rounded-md flex items-center justify-center text-[#94a3b8] transition-all duration-150 no-underline hover:bg-white/10 hover:text-white"><Twitter size={18} /></a>
            <a href="#" className="w-9 h-9 bg-white/5 rounded-md flex items-center justify-center text-[#94a3b8] transition-all duration-150 no-underline hover:bg-white/10 hover:text-white"><Instagram size={18} /></a>
            <a href="#" className="w-9 h-9 bg-white/5 rounded-md flex items-center justify-center text-[#94a3b8] transition-all duration-150 no-underline hover:bg-white/10 hover:text-white"><Youtube size={18} /></a>
          </div>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-12">
          <div>
            <h4 className="font-extrabold mb-4 text-base">Exam Types</h4>
            <ul className="list-none p-0 m-0 flex flex-col gap-2">
              <li><Link href="/tests?type=NAPLAN_STYLE_READING" className="text-[#94a3b8] text-sm no-underline hover:text-white">NAPLAN Style Reading</Link></li>
              <li><Link href="/tests?type=NAPLAN_STYLE_NUMERACY" className="text-[#94a3b8] text-sm no-underline hover:text-white">NAPLAN Style Numeracy</Link></li>
              <li><Link href="/tests?type=NAPLAN_STYLE_LANGUAGE_CONVENTION" className="text-[#94a3b8] text-sm no-underline hover:text-white">NAPLAN Style Language Convention</Link></li>
              <li><Link href="/tests?type=SELECTIVE" className="text-[#94a3b8] text-sm no-underline hover:text-white">Selective School Tests</Link></li>
              <li><Link href="/tests?type=MATHS_OLYMPIAD" className="text-[#94a3b8] text-sm no-underline hover:text-white">Maths Olympiad</Link></li>
              <li><Link href="/tests?type=ENGLISH_OLYMPIAD" className="text-[#94a3b8] text-sm no-underline hover:text-white">English Olympiad</Link></li>
              <li><Link href="/blog/ai-writing" className="text-[#94a3b8] text-sm no-underline hover:text-white">AI Writing Assessment</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-extrabold mb-4 text-base">Resources</h4>
            <ul className="list-none p-0 m-0 flex flex-col gap-2">
              <li><Link href="/blog" className="text-[#94a3b8] text-sm no-underline hover:text-white">Study Tips & Strategies</Link></li>
              <li><Link href="/about" className="text-[#94a3b8] text-sm no-underline hover:text-white">Exam Prep Guides</Link></li>
              <li><Link href="/blog" className="text-[#94a3b8] text-sm no-underline hover:text-white">Success Stories</Link></li>
              <li><Link href="/about" className="text-[#94a3b8] text-sm no-underline hover:text-white">Parent Resources</Link></li>
              <li><Link href="/blog" className="text-[#94a3b8] text-sm no-underline hover:text-white">Latest News</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-extrabold mb-4 text-base">Support</h4>
            <ul className="list-none p-0 m-0 flex flex-col gap-2">
              <li><Link href="/about" className="text-[#94a3b8] text-sm no-underline hover:text-white">About Us</Link></li>
              <li><Link href="/about" className="text-[#94a3b8] text-sm no-underline hover:text-white">Contact Us</Link></li>
              <li><Link href="/about" className="text-[#94a3b8] text-sm no-underline hover:text-white">FAQ</Link></li>
              <li><Link href="/about" className="text-[#94a3b8] text-sm no-underline hover:text-white">Privacy Policy</Link></li>
              <li><Link href="/about" className="text-[#94a3b8] text-sm no-underline hover:text-white">Terms of Service</Link></li>
            </ul>
          </div>
        </div>
      </div>
      <div className="border-t border-white/5 pt-6">
        <div className="max-w-[1400px] mx-auto flex flex-col sm:flex-row justify-between items-center text-[#64748b] text-[0.8125rem] gap-4">
          <span>© {new Date().getFullYear()} Mock Tests Pro. All rights reserved.</span>
          <div className="flex gap-6">
            <Link href="/about" className="text-inherit no-underline hover:text-white">Legal</Link>
            <Link href="/about" className="text-inherit no-underline hover:text-white">Sitemap</Link>
            <Link href="/about" className="text-inherit no-underline hover:text-white">Accessibility</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
