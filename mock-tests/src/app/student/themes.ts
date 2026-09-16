// Year-level theme configuration
// Each year level gets a unique color palette, mascot, and motivational message
// Colors are chosen for WCAG AA contrast on white backgrounds

export type YearTheme = {
  yearLevel: number
  name: string
  mascot: string
  tagline: string
  encouragement: string
  colors: {
    primary: string       // Main accent - must be AA contrast on white
    primaryLight: string  // Soft tint for backgrounds
    primaryDark: string   // Darker shade for text on light bg
    secondary: string     // Complementary accent
    secondaryLight: string
    gradient: string      // CSS gradient for hero areas
    cardGlow: string      // Subtle glow for cards
    streakColor: string   // Color for streak indicators
  }
  emoji: string           // Fallback if SVG fails
}

export const YEAR_THEMES: Record<number, YearTheme> = {
  2: {
    yearLevel: 2,
    name: 'Explorer',
    mascot: 'koala',
    tagline: 'Every big journey starts with a curious step!',
    encouragement: 'You are doing amazing!',
    colors: {
      primary: '#7c3aed',
      primaryLight: '#ede9fe',
      primaryDark: '#5b21b6',
      secondary: '#f59e0b',
      secondaryLight: '#fef3c7',
      gradient: 'linear-gradient(135deg, #7c3aed 0%, #a78bfa 50%, #c4b5fd 100%)',
      cardGlow: '0 4px 24px rgba(124, 58, 237, 0.12)',
      streakColor: '#f59e0b',
    },
    emoji: '🐨',
  },
  3: {
    yearLevel: 3,
    name: 'Adventurer',
    mascot: 'fox',
    tagline: 'Clever minds solve the trickiest puzzles!',
    encouragement: 'Keep going, superstar!',
    colors: {
      primary: '#ea580c',
      primaryLight: '#fff7ed',
      primaryDark: '#c2410c',
      secondary: '#0891b2',
      secondaryLight: '#ecfeff',
      gradient: 'linear-gradient(135deg, #ea580c 0%, #f97316 50%, #fdba74 100%)',
      cardGlow: '0 4px 24px rgba(234, 88, 12, 0.12)',
      streakColor: '#0891b2',
    },
    emoji: '🦊',
  },
  4: {
    yearLevel: 4,
    name: 'Thinker',
    mascot: 'owl',
    tagline: 'Wisdom grows with every question you answer!',
    encouragement: 'Your brain is growing stronger!',
    colors: {
      primary: '#0d9488',
      primaryLight: '#f0fdfa',
      primaryDark: '#0f766e',
      secondary: '#d946ef',
      secondaryLight: '#fdf4ff',
      gradient: 'linear-gradient(135deg, #0d9488 0%, #2dd4bf 50%, #99f6e4 100%)',
      cardGlow: '0 4px 24px rgba(13, 148, 136, 0.12)',
      streakColor: '#d946ef',
    },
    emoji: '🦉',
  },
  5: {
    yearLevel: 5,
    name: 'Navigator',
    mascot: 'dolphin',
    tagline: 'Dive deep into learning - you can do anything!',
    encouragement: 'Brilliant work, keep it up!',
    colors: {
      primary: '#2563eb',
      primaryLight: '#eff6ff',
      primaryDark: '#1d4ed8',
      secondary: '#16a34a',
      secondaryLight: '#f0fdf4',
      gradient: 'linear-gradient(135deg, #2563eb 0%, #3b82f6 50%, #93c5fd 100%)',
      cardGlow: '0 4px 24px rgba(37, 99, 235, 0.12)',
      streakColor: '#16a34a',
    },
    emoji: '🐬',
  },
  6: {
    yearLevel: 6,
    name: 'Champion',
    mascot: 'eagle',
    tagline: 'Soar above challenges with confidence!',
    encouragement: 'You are unstoppable!',
    colors: {
      primary: '#dc2626',
      primaryLight: '#fef2f2',
      primaryDark: '#b91c1c',
      secondary: '#7c3aed',
      secondaryLight: '#ede9fe',
      gradient: 'linear-gradient(135deg, #dc2626 0%, #ef4444 50%, #fca5a5 100%)',
      cardGlow: '0 4px 24px rgba(220, 38, 38, 0.12)',
      streakColor: '#7c3aed',
    },
    emoji: '🦅',
  },
  7: {
    yearLevel: 7,
    name: 'Strategist',
    mascot: 'dragon',
    tagline: 'Master every challenge with focus and fire!',
    encouragement: 'Nothing can stop you!',
    colors: {
      primary: '#0891b2',
      primaryLight: '#ecfeff',
      primaryDark: '#0e7490',
      secondary: '#e11d48',
      secondaryLight: '#fff1f2',
      gradient: 'linear-gradient(135deg, #0891b2 0%, #22d3ee 50%, #a5f3fc 100%)',
      cardGlow: '0 4px 24px rgba(8, 145, 178, 0.12)',
      streakColor: '#e11d48',
    },
    emoji: '🐉',
  },
  8: {
    yearLevel: 8,
    name: 'Visionary',
    mascot: 'phoenix',
    tagline: 'Rise to greatness - the sky is just the beginning!',
    encouragement: 'You are a legend!',
    colors: {
      primary: '#9333ea',
      primaryLight: '#faf5ff',
      primaryDark: '#7e22ce',
      secondary: '#ea580c',
      secondaryLight: '#fff7ed',
      gradient: 'linear-gradient(135deg, #9333ea 0%, #a855f7 50%, #d8b4fe 100%)',
      cardGlow: '0 4px 24px rgba(147, 51, 234, 0.12)',
      streakColor: '#ea580c',
    },
    emoji: '🔥',
  },
}

export function getThemeForYear(yearLevel: number): YearTheme {
  return YEAR_THEMES[yearLevel] || YEAR_THEMES[4] // fallback to Year 4
}
