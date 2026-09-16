# Figma UI Prompts for Mock Tests Platform (Updated: Spatial UI + Progressive Blur + Holographic)

This document contains detailed, copy‑pasteable prompts to feed into **Figma AI** (or any other UI generation/design tool) to generate layouts adhering to this platform’s **privacy-first** workflows and premium academic standards.

> **Update highlights (new requirements)**
> 1) **Spatial UI & 3D Integration**: interactive 3D objects, depth-based interactions, parallax, and advanced gradients for immersive experiences.
> 2) **Progressive Blur & Holographic Effects**: evolved glassmorphism with intelligent blur that changes on scroll, holographic gradient sheens for badges/cards, and dynamic blending in nav/toolbars.
>
> **Privacy rule (non-negotiable)**: **Do not collect or display student real names**. Use **system-generated usernames** (e.g., `RoseApple1234`) and year level only.

---

## 🎨 Global Design System & Vibe Check (Input this to AI first)

**Goal:** Establish a consistent, premium academic aesthetic across all screens, while adding a modern spatial/3D layer and progressive blur/holographic polish.

**Figma Prompt (paste as-is):**

> "I am building a premium, modern 'Mock Tests' EdTech platform tailored for parents and school-aged students (Years 2–8). Create a complete Design System and apply it consistently across all screens.
>
> **Brand Vibe:** Trustworthy, premium academic for parents; friendly, low-friction for children.
>
> **Colors:** Primary brand color is deep academic blue (#194bfb). Backgrounds are clean off-white (#f8fafc) and dark navy (#0f172a) for footers/dark surfaces. Accents in success green, warning orange, and vibrant highlights (gold/purple) used sparingly.
>
> **Spatial UI & 3D Integration:**
> - Use interactive 3D objects (e.g., floating icons, subtle 3D characters, 3D badges) in hero sections and success states.
> - Apply depth-based interactions: parallax on scroll, layered cards with Z-depth, and subtle perspective transforms on hover.
> - Add advanced gradients and depth lighting (soft rim light, gentle shadow falloff) to create an immersive, high-quality feel.
>
> **Progressive Blur & Holographic Effects (evolved glassmorphism):**
> - Navigation bars and sticky toolbars use progressive blur that changes dynamically with scroll: stronger blur over busy content, lighter blur over plain sections.
> - Add holographic gradient sheens on premium badges and key CTAs (subtle, not tacky). Use gradient borders and iridescent overlays for 'Premium' elements.
> - Use intelligent background blending: gradient + blur + translucency that harmonizes with underlying content.
>
> **Styling:** High contrast text, minimal borders, subtle shadows (0 4px 6px -1px rgb(0 0 0 / 0.1)). Rounded corners (8px–12px) on cards.
>
> **Typography:** Inter or system-ui. Use strong hierarchy: large headings, readable body text, and generous line height.
>
> **Accessibility:** Maintain contrast, clear focus states, large touch targets (≥44px on mobile), and avoid motion that could cause discomfort (use reduced-motion variants).
>
> Ensure the design feels premium and immersive but remains calm and distraction-free during tests."

---

## 1) Landing Page (Public Storefront)

**Goal:** Convert parents into sign-ups and purchases with a premium, immersive first impression.

**Figma Prompt:**

> "Design a responsive Landing Page for a Mock Tests platform using the academic blue style guide + spatial 3D + progressive blur.
>
> **Top Nav:** Sticky navigation bar with **progressive blur** and subtle holographic gradient edge. Include logo, links (Features, Tests, About), and Log In/Sign Up buttons.
>
> **Hero Section:** Split layout.
> - Left: Bold headline ('Master Your Exams with Confidence'), subheadline about adaptive testing and AI writing feedback, and a primary CTA.
> - Right: A **3D scene** showing a happy student celebrating with floating math/English symbols. Add depth and parallax layers. Include a holographic glass badge: 'Top 5% Maths & English'.
>
> **Body:** Multi-column 'Featured Practice Tests' grid.
> - Each card: badge (NAPLAN Style / Olympiad / Selective), title, short description, time limit, 'Free' or 'Premium' tag.
> - Premium cards have subtle iridescent gradient borders and a soft sheen.
>
> **Social Proof:** A section with parent testimonials and a small trust bar (privacy-first, no ads, secure payments).
>
> **Footer:** Dark navy footer with 4 columns of links and a copyright bar."

---

## 2) Parent Dashboard & Child Management

**Goal:** The hub where parents manage children and assign tests, with premium analytics that feel effortless.

**Figma Prompt:**

> "Design a Parent Dashboard following a modern B2C SaaS layout with progressive blur toolbars.
>
> **Navigation:** Sidebar or top subnav with 'Dashboard', 'My Children', 'Test Store', 'Billing', 'Notifications'. Use a subtle **progressive blur** header on scroll.
>
> **Main Content:** Welcome header ('Welcome back').
> - 'My Children' section shows cards per child.
> - Each card shows: abstract avatar/icon, **year level**, **generated username** (not real name), and a sparkline of recent scores.
>
> **Primary Action:** 'Add Child' button opens a modal.
> - Modal fields: Year level selector.
> - Show a list of system-generated usernames (e.g., RoseApple1234) to pick from.
> - Set/Reset password action.
> - Add helper text: 'For privacy, do not use real names.'
>
> **Recent Activity:** A clean list of recently completed tests across children.
>
> **Micro-interactions:** Cards lift slightly on hover with subtle 3D depth; keep motion gentle."

---

## 3) Child Detail & Assign Test Flow

**Goal:** Drill-down analytics + simple test assignment, with clear gating rules.

**Figma Prompt:**

> "Design a Child Profile & Analytics page.
>
> **Header:** Display the child's **generated username** and Year level. Provide a 'Copy Login Details' action for parent convenience.
>
> **Overview Cards:** Average Score, Tests Completed, Strength Areas / Focus Areas.
>
> **Tabs:** 'Detailed Reports' and 'Assigned Tests'.
> - Assigned Tests includes segmented states: Pending / In Progress / Completed.
>
> **Assign Test Modal:** Title 'Assign New Test'.
> - Searchable dropdown shows only tests that are **Free** or **Owned (Purchased)**.
> - Locked tests show as disabled with a 'Buy in Store' link.
> - Include Start date and optional due date.
>
> **Polish:** Use holographic highlight on Owned tests. Keep layout clean and parent-friendly."

---

## 4) Test Store (Premium Checkout)

**Goal:** A premium marketplace experience that clearly separates Free, Owned, and Locked tests.

**Figma Prompt:**

> "Design a Premium Test Store with a marketplace layout.
>
> **Left Filter Sidebar:** Filter by Subject, Exam Type, Year Level, Difficulty.
>
> **Product Grid:** Each test card shows:
> - Title, exam tag, year band, time limit, and price.
> - State badge: Free / Owned / Premium.
> - CTA:
>   - Free: 'Assign to Child'
>   - Owned: 'Assign to Child' (green)
>   - Premium: 'Purchase (One-time)'
>
> **Progressive Blur:** Use a sticky top toolbar with progressive blur that blends as the user scrolls.
>
> **Holographic Premium Styling:** Premium cards get a subtle iridescent gradient border and sheen; keep it tasteful.
>
> **Checkout Preview Drawer:** When adding to cart, open a right-side drawer (glass + progressive blur) summarizing items and total."

---

## 5) Student Dashboard (Launchpad)

**Goal:** Extremely low-friction UI for kids; large buttons, minimal analytics.

**Figma Prompt:**

> "Design a Student Dashboard that is friendly, calm, and easy.
>
> **Header:** Friendly greeting using the student's **generated username** (not real name), e.g., 'Hi, RoseApple1234! Ready to practice?'
>
> **Assigned Tests:** Large, highly clickable cards with:
> - Test name
> - Sections summary
> - Time limit
> - Big primary button: 'Start Test'
>
> **Completed Row:** A row of completed tests with trophy-style badges. Keep it encouraging.
>
> **Visual Tone:** Slightly softer shapes, bigger fonts; avoid complex charts.
>
> **Optional 3D:** A small 3D mascot/icon in the corner that reacts subtly to achievements (reduced motion friendly)."

---

## 6) Test Runner Interface (The Exam Room)

**Goal:** Distraction-free exam room with precise controls and minimal cognitive load.

**Figma Prompt:**

> "Design the core Test Runner application (timed exam UI) with a calm, distraction-free layout.
>
> **Top Bar:** Fixed with progressive blur.
> - Left: 'Section: Numeracy' and 'Question 4 of 40'
> - Center: large Countdown Timer
> - Right: 'Flag for Review' toggle
>
> **Section Intro Screen:** Before each section starts, show a short intro and 'Start Section' button.
>
> **Main Content:** Clean container.
> - Top: passage/problem stem (supports images)
> - Bottom: answer area
>   - MCQ: 4 large options with strong selected state
>   - Short answer: input with helper text
>
> **Autosave Indicator:** Small status text 'Saved' after changes.
> **Connectivity Banner:** If offline, show 'Offline — answers will sync when back online.'
>
> **Bottom Nav:** Previous on left, Next on right; show a 'Review' button near end.
>
> **Review Screen:** Show grid of question numbers with states: answered, unanswered, flagged.
> Include time remaining and a final 'Submit Test' CTA.
>
> **Submit Confirmation Modal:** Warn that submission is final.
>
> Keep motion subtle; reduce distractions."

---

## 7) Post‑Test Student Report (Immediate Results)

**Goal:** Encourage students immediately after submission; show pending writing state.

**Figma Prompt:**

> "Design a Post-Test Student Report screen.
>
> **Hero Result:** Large gauge or ring showing score out of 100 with a friendly message.
>
> **Writing Pending Banner:** If writing exists, show a tasteful yellow/amber banner: 'Writing report is being prepared. It will appear shortly.'
>
> **Section Breakdown:** Cards for each section score.
>
> **Review Incorrect:** Scrollable list of incorrect questions with simple explanations.
>
> **Optional 3D celebration:** A subtle 3D confetti/mascot animation that respects reduced motion settings."

---

## 8) Content Creator / Admin (CMS)

**Goal:** Efficient authoring and approval workflow with clear status and previews.

**Figma Prompt:**

> "Design a Question Builder CMS for Test Creators and Admins.
>
> **Layout:** Enterprise side-nav.
>
> **Editor:**
> - Question Type dropdown (MCQ, Short Answer, Writing)
> - Rich-text editor for stem + passage
> - Image upload
> - Options builder for MCQ with correct toggle
> - Short answer regex configuration block
> - Explanation fields: short explanation + step-by-step for numeracy
>
> **Tagging Panel:** Mandatory tags: year, subject, topic, skill, difficulty, reasoning type, exam type.
>
> **Status & Actions:**
> - Draft / Pending Approval status
> - 'Submit to Admin' sticky action bar (progressive blur)
>
> **Admin Review Queue:**
> - List of pending items with preview and diff-like summary
> - Approve / Reject with comment
>
> **Polish:** Use subtle holographic highlights for status chips and primary actions."

---

## 9) Design Prompt Addendum — Do/Don’t

### Do
- Use progressive blur on sticky nav/toolbars.
- Use holographic effects sparingly for premium tags and key CTAs.
- Use 3D elements mainly on marketing/success states, not during the exam.

### Don’t
- Don’t collect or display real student names.
- Don’t overuse 3D motion in the test runner.
- Don’t allow bright, distracting gradients behind questions.
