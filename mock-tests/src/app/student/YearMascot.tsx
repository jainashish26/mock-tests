// Gender-neutral SVG mascots for each year level
// These are friendly, approachable animals/creatures that appeal to all children

import React from 'react'

type MascotProps = {
  size?: number
  className?: string
  style?: React.CSSProperties
}

// Year 2 - Koala: Friendly, cuddly, approachable
export function KoalaMascot({ size = 120, className, style }: MascotProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} style={style} role="img" aria-label="Friendly koala mascot">
      {/* Ears */}
      <circle cx="30" cy="30" r="20" fill="#a78bfa" />
      <circle cx="30" cy="30" r="12" fill="#ede9fe" />
      <circle cx="90" cy="30" r="20" fill="#a78bfa" />
      <circle cx="90" cy="30" r="12" fill="#ede9fe" />
      {/* Head */}
      <circle cx="60" cy="58" r="35" fill="#c4b5fd" />
      {/* Face */}
      <ellipse cx="60" cy="68" rx="20" ry="16" fill="#ede9fe" />
      {/* Eyes */}
      <circle cx="48" cy="54" r="5" fill="#1e1b4b" />
      <circle cx="72" cy="54" r="5" fill="#1e1b4b" />
      <circle cx="50" cy="52" r="2" fill="white" />
      <circle cx="74" cy="52" r="2" fill="white" />
      {/* Nose */}
      <ellipse cx="60" cy="64" rx="6" ry="4" fill="#7c3aed" />
      {/* Smile */}
      <path d="M52 72 Q60 80 68 72" stroke="#5b21b6" strokeWidth="2" fill="none" strokeLinecap="round" />
      {/* Blush */}
      <circle cx="40" cy="66" r="5" fill="#ddd6fe" opacity="0.7" />
      <circle cx="80" cy="66" r="5" fill="#ddd6fe" opacity="0.7" />
      {/* Star accessory */}
      <path d="M60 95 L62 101 L68 101 L63 105 L65 111 L60 107 L55 111 L57 105 L52 101 L58 101 Z" fill="#f59e0b" />
    </svg>
  )
}

// Year 3 - Fox: Clever, energetic
export function FoxMascot({ size = 120, className, style }: MascotProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} style={style} role="img" aria-label="Clever fox mascot">
      {/* Ears */}
      <polygon points="30,15 20,50 40,45" fill="#f97316" />
      <polygon points="32,22 25,45 38,42" fill="#fff7ed" />
      <polygon points="90,15 80,45 100,50" fill="#f97316" />
      <polygon points="88,22 82,42 95,45" fill="#fff7ed" />
      {/* Head */}
      <ellipse cx="60" cy="58" rx="32" ry="30" fill="#fb923c" />
      {/* Face marking */}
      <ellipse cx="60" cy="65" rx="18" ry="18" fill="#fff7ed" />
      {/* Eyes */}
      <ellipse cx="48" cy="52" rx="4" ry="5" fill="#431407" />
      <ellipse cx="72" cy="52" rx="4" ry="5" fill="#431407" />
      <circle cx="50" cy="50" r="1.5" fill="white" />
      <circle cx="74" cy="50" r="1.5" fill="white" />
      {/* Nose */}
      <ellipse cx="60" cy="62" rx="5" ry="3.5" fill="#ea580c" />
      {/* Smile */}
      <path d="M54 68 Q60 75 66 68" stroke="#c2410c" strokeWidth="2" fill="none" strokeLinecap="round" />
      {/* Whiskers */}
      <line x1="30" y1="62" x2="44" y2="65" stroke="#fdba74" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="30" y1="68" x2="44" y2="68" stroke="#fdba74" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="76" y1="65" x2="90" y2="62" stroke="#fdba74" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="76" y1="68" x2="90" y2="68" stroke="#fdba74" strokeWidth="1.5" strokeLinecap="round" />
      {/* Lightning bolt accessory */}
      <polygon points="58,90 62,98 58,98 64,110 56,100 60,100 56,92" fill="#0891b2" />
    </svg>
  )
}

// Year 4 - Owl: Wise, thoughtful
export function OwlMascot({ size = 120, className, style }: MascotProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} style={style} role="img" aria-label="Wise owl mascot">
      {/* Ear tufts */}
      <polygon points="35,18 28,42 42,38" fill="#2dd4bf" />
      <polygon points="85,18 78,38 92,42" fill="#2dd4bf" />
      {/* Body */}
      <ellipse cx="60" cy="65" rx="30" ry="32" fill="#99f6e4" />
      {/* Belly */}
      <ellipse cx="60" cy="75" rx="18" ry="18" fill="#f0fdfa" />
      {/* Eye circles */}
      <circle cx="46" cy="52" r="12" fill="white" stroke="#0d9488" strokeWidth="2" />
      <circle cx="74" cy="52" r="12" fill="white" stroke="#0d9488" strokeWidth="2" />
      {/* Pupils */}
      <circle cx="46" cy="52" r="6" fill="#134e4a" />
      <circle cx="74" cy="52" r="6" fill="#134e4a" />
      <circle cx="48" cy="50" r="2.5" fill="white" />
      <circle cx="76" cy="50" r="2.5" fill="white" />
      {/* Beak */}
      <polygon points="56,58 60,66 64,58" fill="#f59e0b" />
      {/* Wings */}
      <ellipse cx="28" cy="70" rx="10" ry="18" fill="#2dd4bf" opacity="0.6" />
      <ellipse cx="92" cy="70" rx="10" ry="18" fill="#2dd4bf" opacity="0.6" />
      {/* Book accessory */}
      <rect x="48" y="95" width="24" height="16" rx="2" fill="#d946ef" />
      <line x1="60" y1="95" x2="60" y2="111" stroke="white" strokeWidth="1.5" />
    </svg>
  )
}

// Year 5 - Dolphin: Smart, playful
export function DolphinMascot({ size = 120, className, style }: MascotProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} style={style} role="img" aria-label="Playful dolphin mascot">
      {/* Body */}
      <ellipse cx="60" cy="55" rx="35" ry="28" fill="#3b82f6" />
      {/* Belly */}
      <ellipse cx="60" cy="62" rx="24" ry="18" fill="#dbeafe" />
      {/* Head/snout */}
      <ellipse cx="78" cy="48" rx="18" ry="14" fill="#3b82f6" />
      <ellipse cx="82" cy="52" rx="12" ry="8" fill="#dbeafe" />
      {/* Eye */}
      <circle cx="82" cy="44" r="5" fill="#1e3a8a" />
      <circle cx="84" cy="42" r="2" fill="white" />
      {/* Smile */}
      <path d="M86 50 Q92 54 96 50" stroke="#1d4ed8" strokeWidth="2" fill="none" strokeLinecap="round" />
      {/* Dorsal fin */}
      <path d="M50 30 Q58 10 62 30" fill="#2563eb" />
      {/* Tail */}
      <path d="M25 55 Q15 42 20 35 Q22 45 25 48" fill="#2563eb" />
      <path d="M25 55 Q15 68 20 75 Q22 65 25 62" fill="#2563eb" />
      {/* Flipper */}
      <ellipse cx="55" cy="72" rx="12" ry="5" fill="#2563eb" transform="rotate(-15 55 72)" />
      {/* Water splash */}
      <circle cx="45" cy="90" r="3" fill="#93c5fd" opacity="0.7" />
      <circle cx="55" cy="95" r="4" fill="#93c5fd" opacity="0.5" />
      <circle cx="65" cy="92" r="3" fill="#93c5fd" opacity="0.6" />
      <circle cx="75" cy="97" r="2.5" fill="#93c5fd" opacity="0.4" />
      {/* Compass rose accessory */}
      <circle cx="60" cy="105" r="8" fill="#16a34a" opacity="0.9" />
      <polygon points="60,97 62,103 60,101 58,103" fill="white" />
      <polygon points="60,113 62,107 60,109 58,107" fill="white" opacity="0.6" />
    </svg>
  )
}

// Year 6 - Eagle: Strong, confident
export function EagleMascot({ size = 120, className, style }: MascotProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} style={style} role="img" aria-label="Confident eagle mascot">
      {/* Head crest */}
      <path d="M56 18 Q60 8 64 18 Q62 14 60 12 Q58 14 56 18" fill="#fca5a5" />
      <path d="M50 22 Q56 12 60 16" fill="#ef4444" opacity="0.5" />
      <path d="M70 22 Q64 12 60 16" fill="#ef4444" opacity="0.5" />
      {/* Head */}
      <circle cx="60" cy="42" r="24" fill="#fecaca" />
      {/* Face */}
      <ellipse cx="60" cy="46" rx="16" ry="14" fill="white" />
      {/* Eyes - determined */}
      <ellipse cx="50" cy="40" rx="4" ry="5" fill="#450a0a" />
      <ellipse cx="70" cy="40" rx="4" ry="5" fill="#450a0a" />
      <circle cx="52" cy="38" r="1.5" fill="white" />
      <circle cx="72" cy="38" r="1.5" fill="white" />
      {/* Eyebrows - confident */}
      <line x1="44" y1="33" x2="54" y2="34" stroke="#991b1b" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="66" y1="34" x2="76" y2="33" stroke="#991b1b" strokeWidth="2.5" strokeLinecap="round" />
      {/* Beak */}
      <polygon points="56,46 60,54 64,46" fill="#f59e0b" />
      <line x1="60" y1="46" x2="60" y2="52" stroke="#d97706" strokeWidth="0.5" />
      {/* Wings spread */}
      <path d="M36 55 Q20 40 10 50 Q22 48 32 58" fill="#dc2626" />
      <path d="M84 55 Q100 40 110 50 Q98 48 88 58" fill="#dc2626" />
      {/* Body */}
      <ellipse cx="60" cy="75" rx="20" ry="22" fill="#fecaca" />
      <ellipse cx="60" cy="80" rx="14" ry="14" fill="white" />
      {/* Medal */}
      <circle cx="60" cy="100" r="7" fill="#f59e0b" />
      <circle cx="60" cy="100" r="5" fill="#fbbf24" />
      <text x="57" y="103" fontSize="8" fill="#92400e" fontWeight="bold">★</text>
    </svg>
  )
}

// Year 7 - Dragon: Powerful, strategic
export function DragonMascot({ size = 120, className, style }: MascotProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} style={style} role="img" aria-label="Friendly dragon mascot">
      {/* Horns */}
      <path d="M38 20 Q35 8 42 14 Q40 18 38 20" fill="#22d3ee" />
      <path d="M82 20 Q85 8 78 14 Q80 18 82 20" fill="#22d3ee" />
      {/* Head */}
      <ellipse cx="60" cy="45" rx="28" ry="25" fill="#67e8f9" />
      {/* Snout */}
      <ellipse cx="60" cy="56" rx="14" ry="10" fill="#a5f3fc" />
      {/* Eyes */}
      <ellipse cx="48" cy="42" rx="5" ry="6" fill="#164e63" />
      <ellipse cx="72" cy="42" rx="5" ry="6" fill="#164e63" />
      <circle cx="50" cy="40" r="2" fill="#67e8f9" />
      <circle cx="74" cy="40" r="2" fill="#67e8f9" />
      {/* Nostrils */}
      <circle cx="55" cy="54" r="2" fill="#0891b2" />
      <circle cx="65" cy="54" r="2" fill="#0891b2" />
      {/* Smile with teeth */}
      <path d="M50 60 Q60 68 70 60" stroke="#0e7490" strokeWidth="2" fill="none" strokeLinecap="round" />
      {/* Small wings */}
      <path d="M30 55 Q18 40 22 55 Q24 48 30 55" fill="#22d3ee" opacity="0.7" />
      <path d="M90 55 Q102 40 98 55 Q96 48 90 55" fill="#22d3ee" opacity="0.7" />
      {/* Body */}
      <ellipse cx="60" cy="80" rx="22" ry="20" fill="#67e8f9" />
      <ellipse cx="60" cy="85" rx="14" ry="12" fill="#cffafe" />
      {/* Spikes down back */}
      <polygon points="58,23 60,17 62,23" fill="#06b6d4" />
      {/* Tail flame accessory */}
      <circle cx="60" cy="108" r="6" fill="#e11d48" />
      <circle cx="60" cy="108" r="3" fill="#fb7185" />
    </svg>
  )
}

// Year 8 - Phoenix: Legendary, rising
export function PhoenixMascot({ size = 120, className, style }: MascotProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} style={style} role="img" aria-label="Majestic phoenix mascot">
      {/* Head plume */}
      <path d="M55 12 Q58 2 60 10 Q62 2 65 12 Q60 8 55 12" fill="#c084fc" />
      <path d="M50 18 Q54 6 58 15" fill="#a855f7" opacity="0.6" />
      <path d="M70 18 Q66 6 62 15" fill="#a855f7" opacity="0.6" />
      {/* Head */}
      <circle cx="60" cy="38" r="22" fill="#d8b4fe" />
      {/* Face */}
      <ellipse cx="60" cy="42" rx="14" ry="12" fill="#faf5ff" />
      {/* Eyes - wise */}
      <ellipse cx="52" cy="36" rx="4" ry="5" fill="#3b0764" />
      <ellipse cx="68" cy="36" rx="4" ry="5" fill="#3b0764" />
      <circle cx="54" cy="34" r="2" fill="white" />
      <circle cx="70" cy="34" r="2" fill="white" />
      {/* Beak */}
      <polygon points="56,42 60,50 64,42" fill="#f97316" />
      {/* Wings - majestic spread */}
      <path d="M38 52 Q15 35 8 48 Q18 44 28 52 Q20 48 15 55 Q25 50 34 58" fill="#a855f7" />
      <path d="M82 52 Q105 35 112 48 Q102 44 92 52 Q100 48 105 55 Q95 50 86 58" fill="#a855f7" />
      {/* Body */}
      <ellipse cx="60" cy="72" rx="22" ry="22" fill="#d8b4fe" />
      <ellipse cx="60" cy="76" rx="14" ry="14" fill="#faf5ff" />
      {/* Tail feathers */}
      <path d="M45 90 Q38 108 42 105 Q40 98 46 92" fill="#c084fc" />
      <path d="M60 92 Q58 112 60 110 Q62 112 60 92" fill="#a855f7" />
      <path d="M75 90 Q82 108 78 105 Q80 98 74 92" fill="#c084fc" />
      {/* Crown */}
      <circle cx="60" cy="106" r="6" fill="#ea580c" />
      <polygon points="56,102 60,96 64,102" fill="#f97316" />
    </svg>
  )
}

// Year 9 - Wolf: Independent, sharp, a pathfinder
export function WolfMascot({ size = 120, className, style }: MascotProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} style={style} role="img" aria-label="Friendly wolf mascot">
      {/* Ears */}
      <polygon points="28,16 24,52 47,42" fill="#6366f1" />
      <polygon points="31,25 28,46 43,40" fill="#c7d2fe" />
      <polygon points="92,16 96,52 73,42" fill="#6366f1" />
      <polygon points="89,25 92,46 77,40" fill="#c7d2fe" />
      {/* Head */}
      <ellipse cx="60" cy="56" rx="33" ry="30" fill="#818cf8" />
      {/* Muzzle */}
      <ellipse cx="60" cy="70" rx="18" ry="16" fill="#e0e7ff" />
      {/* Cheek fur */}
      <path d="M30 58 Q21 65 30 73" fill="#c7d2fe" opacity="0.7" />
      <path d="M90 58 Q99 65 90 73" fill="#c7d2fe" opacity="0.7" />
      {/* Eyes */}
      <ellipse cx="48" cy="50" rx="4.5" ry="5.5" fill="#1e1b4b" />
      <ellipse cx="72" cy="50" rx="4.5" ry="5.5" fill="#1e1b4b" />
      <circle cx="49.5" cy="48" r="1.6" fill="white" />
      <circle cx="73.5" cy="48" r="1.6" fill="white" />
      {/* Nose + mouth */}
      <ellipse cx="60" cy="64" rx="6" ry="4.5" fill="#312e81" />
      <path d="M60 68 L60 73" stroke="#312e81" strokeWidth="2" strokeLinecap="round" />
      <path d="M52 75 Q60 81 68 75" stroke="#312e81" strokeWidth="2" fill="none" strokeLinecap="round" />
      {/* Star accessory */}
      <path d="M60 95 L62 101 L68 101 L63 105 L65 111 L60 107 L55 111 L57 105 L52 101 L58 101 Z" fill="#0d9488" />
    </svg>
  )
}

// Mascot selector
export function YearMascot({ mascot, size = 120, className, style }: MascotProps & { mascot: string }) {
  switch (mascot) {
    case 'koala': return <KoalaMascot size={size} className={className} style={style} />
    case 'fox': return <FoxMascot size={size} className={className} style={style} />
    case 'owl': return <OwlMascot size={size} className={className} style={style} />
    case 'dolphin': return <DolphinMascot size={size} className={className} style={style} />
    case 'eagle': return <EagleMascot size={size} className={className} style={style} />
    case 'dragon': return <DragonMascot size={size} className={className} style={style} />
    case 'phoenix': return <PhoenixMascot size={size} className={className} style={style} />
    case 'wolf': return <WolfMascot size={size} className={className} style={style} />
    default: return <OwlMascot size={size} className={className} style={style} />
  }
}
