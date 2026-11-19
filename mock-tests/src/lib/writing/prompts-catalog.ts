/**
 * AI Writing prompt bank (MECE) — Years 2–9.
 * 15 cells per year: 10 narrative territories (N1–N10) + 5 persuasive domains
 * (S1–S5), each appearing exactly once per year. 8 × 15 = 120 prompts. The same
 * territory recurs vertically so difficulty spirals rather than repeats.
 *
 * Also holds the per-year calibration (target length, time, marking focus) used
 * by the student writing experience: prompt choice → briefing → timed focus mode.
 */

export type PromptType = 'narrative' | 'persuasive'

export interface WritingPrompt {
  id: string
  year: number
  territory: string
  type: PromptType
  text: string
}

export interface YearCalibration {
  minWords: number
  maxWords: number
  mins: number
}

/** Target length + time per year (from the calibration guide). */
export const YEAR_CALIBRATION: Record<number, YearCalibration> = {
  2: { minWords: 75, maxWords: 125, mins: 15 },
  3: { minWords: 100, maxWords: 175, mins: 20 },
  4: { minWords: 150, maxWords: 225, mins: 25 },
  5: { minWords: 200, maxWords: 275, mins: 30 },
  6: { minWords: 275, maxWords: 325, mins: 30 },
  7: { minWords: 350, maxWords: 425, mins: 35 },
  8: { minWords: 400, maxWords: 500, mins: 40 },
  9: { minWords: 500, maxWords: 600, mins: 45 },
}

/** Primary marking focus per year, split narrative / persuasive. */
const FOCUS: Record<number, Record<PromptType, string[]>> = {
  2: {
    narrative: ['A clear beginning, middle and end', 'Capital letters and full stops', 'One clear idea'],
    persuasive: ['Say clearly what you think', 'Give a reason', 'Capital letters and full stops'],
  },
  3: {
    narrative: ['Use paragraphs', 'Punctuate dialogue correctly', 'Describe one setting'],
    persuasive: ['Use paragraphs', 'Give reasons for your view', 'Correct punctuation'],
  },
  4: {
    narrative: ['Show, don’t tell', 'Keep the same tense', 'Vary how sentences start'],
    persuasive: ['State your opinion', 'Give reasons and examples', 'Vary your sentences'],
  },
  5: {
    narrative: ['Show feelings through actions', 'Build a problem, then resolve it', 'Describe with the senses'],
    persuasive: ['Use a three-reason structure', 'Support each reason', 'Finish with a strong conclusion'],
  },
  6: {
    narrative: ['Control your pacing', 'Plan a deliberate ending', 'Develop your character'],
    persuasive: ['Know your audience', 'Use evidence', 'Acknowledge the other side'],
  },
  7: {
    narrative: ['Explore inner conflict', 'Use a repeating motif', 'Earn your ending'],
    persuasive: ['Concede a point, then rebut it', 'Use strong evidence', 'Persuasive language'],
  },
  8: {
    narrative: ['Use subtext', 'Restraint — leave some things unsaid', 'Withhold information for effect'],
    persuasive: ['High-quality evidence', 'A sustained argument', 'Sophisticated language'],
  },
  9: {
    narrative: ['A distinct voice', 'Embrace ambiguity', 'Earn your ending'],
    persuasive: ['Sustain one line of argument', 'Nuanced reasoning', 'An authoritative voice'],
  },
}

const Y2: WritingPrompt[] = [
  { id: 'y2-n1', year: 2, territory: 'Adversity', type: 'narrative', text: `Title: My Wobbly Bike. Write a story about a child who keeps falling off.` },
  { id: 'y2-n2', year: 2, territory: 'Belonging', type: 'narrative', text: `A new child joins your class and sits alone at lunch. Write a story about what happens next.` },
  { id: 'y2-n3', year: 2, territory: 'Moral choice', type: 'narrative', text: `You pick up a shiny pencil that belongs to your friend. Nobody saw you. Write a story.` },
  { id: 'y2-n4', year: 2, territory: 'Relationship', type: 'narrative', text: `Title: The Fight Over the Swing. Write a story.` },
  { id: 'y2-n5', year: 2, territory: 'Change', type: 'narrative', text: `Title: Goodbye, Old House. Write a story about a child moving away.` },
  { id: 'y2-n6', year: 2, territory: 'Discovery', type: 'narrative', text: `You dig in the sand and find a small locked box. Write what happens.` },
  { id: 'y2-n7', year: 2, territory: 'Courage', type: 'narrative', text: `Write about a child who is scared of the dark but has to go outside at night.` },
  { id: 'y2-n8', year: 2, territory: 'Ambition', type: 'narrative', text: `Title: I Kept Trying. Write a story about learning something hard.` },
  { id: 'y2-n9', year: 2, territory: 'Responsibility', type: 'narrative', text: `You spill paint on your sister's drawing. Write a story about what you do.` },
  { id: 'y2-n10', year: 2, territory: 'Imagination', type: 'narrative', text: `One morning your teddy bear starts talking. Write the story.` },
  { id: 'y2-s1', year: 2, territory: 'School', type: 'persuasive', text: `Should students be allowed to bring toys to school? Write to persuade your teacher.` },
  { id: 'y2-s2', year: 2, territory: 'Technology', type: 'persuasive', text: `Should young children have their own tablet? Persuade your family.` },
  { id: 'y2-s3', year: 2, territory: 'Environment', type: 'persuasive', text: `Persuade your principal to plant a vegetable garden at school.` },
  { id: 'y2-s4', year: 2, territory: 'Fairness', type: 'persuasive', text: `Should everyone get a turn at the game, even if they aren't good at it? Persuade your class.` },
  { id: 'y2-s5', year: 2, territory: 'Health', type: 'persuasive', text: `Should lollies be sold at the school canteen? Write to persuade your principal.` },
]

const Y3: WritingPrompt[] = [
  { id: 'y3-n1', year: 3, territory: 'Adversity', type: 'narrative', text: `Image: a child holding a model plane snapped in half. Write a story.` },
  { id: 'y3-n2', year: 3, territory: 'Belonging', type: 'narrative', text: `Begin with: "Nobody at my new school played the game I knew."` },
  { id: 'y3-n3', year: 3, territory: 'Moral choice', type: 'narrative', text: `Your friend asks you to say you were with them when you weren't. Write a story.` },
  { id: 'y3-n4', year: 3, territory: 'Relationship', type: 'narrative', text: `Title: The Shared Bedroom. Write a story.` },
  { id: 'y3-n5', year: 3, territory: 'Change', type: 'narrative', text: `End with: "I waved until the bus was gone."` },
  { id: 'y3-n6', year: 3, territory: 'Discovery', type: 'narrative', text: `The classroom door that is always locked is open today. Write what happens.` },
  { id: 'y3-n7', year: 3, territory: 'Courage', type: 'narrative', text: `Write about a child who has to sing in front of the whole school.` },
  { id: 'y3-n8', year: 3, territory: 'Ambition', type: 'narrative', text: `Title: Almost. Write a story about coming very close.` },
  { id: 'y3-n9', year: 3, territory: 'Responsibility', type: 'narrative', text: `You were asked to look after the class pet and you forgot. Write a story.` },
  { id: 'y3-n10', year: 3, territory: 'Imagination', type: 'narrative', text: `Every time you sneeze, you swap bodies with your dog. Write the story.` },
  { id: 'y3-s1', year: 3, territory: 'School', type: 'persuasive', text: `Should primary students be given homework? Persuade your teacher.` },
  { id: 'y3-s2', year: 3, territory: 'Technology', type: 'persuasive', text: `Should there be a TV in every child's bedroom? Persuade your parents.` },
  { id: 'y3-s3', year: 3, territory: 'Environment', type: 'persuasive', text: `Persuade your family to stop buying plastic drink bottles.` },
  { id: 'y3-s4', year: 3, territory: 'Fairness', type: 'persuasive', text: `Should boys and girls play on the same teams? Persuade your coach.` },
  { id: 'y3-s5', year: 3, territory: 'Health', type: 'persuasive', text: `Should children have a set bedtime? Persuade your parents.` },
]

const Y4: WritingPrompt[] = [
  { id: 'y4-n1', year: 4, territory: 'Adversity', type: 'narrative', text: `Title: The Wrong Note. Write a story about a performance that goes wrong.` },
  { id: 'y4-n2', year: 4, territory: 'Belonging', type: 'narrative', text: `Begin with: "My lunchbox looked nothing like anyone else's."` },
  { id: 'y4-n3', year: 4, territory: 'Moral choice', type: 'narrative', text: `The shopkeeper gives you too much change. Write a story about what you do.` },
  { id: 'y4-n4', year: 4, territory: 'Relationship', type: 'narrative', text: `Use this line anywhere: "You don't even know me," she said.` },
  { id: 'y4-n5', year: 4, territory: 'Change', type: 'narrative', text: `Image: an empty desk in a classroom, everything else unchanged. Write a story.` },
  { id: 'y4-n6', year: 4, territory: 'Discovery', type: 'narrative', text: `A message in a bottle washes up with your name on it. Write the story.` },
  { id: 'y4-n7', year: 4, territory: 'Courage', type: 'narrative', text: `Write about someone who speaks up when a friend is being teased.` },
  { id: 'y4-n8', year: 4, territory: 'Ambition', type: 'narrative', text: `Your character wants to beat their older sibling at something. Write the story.` },
  { id: 'y4-n9', year: 4, territory: 'Responsibility', type: 'narrative', text: `You lose something you borrowed and try to hide it. Write a story.` },
  { id: 'y4-n10', year: 4, territory: 'Imagination', type: 'narrative', text: `You wake up and everyone in town has forgotten how to read — except you.` },
  { id: 'y4-s1', year: 4, territory: 'School', type: 'persuasive', text: `Should school uniforms be compulsory? Persuade your principal.` },
  { id: 'y4-s2', year: 4, territory: 'Technology', type: 'persuasive', text: `Should children under 11 be allowed on social media? Argue your view.` },
  { id: 'y4-s3', year: 4, territory: 'Environment', type: 'persuasive', text: `Persuade your council to build a skate park instead of another car park.` },
  { id: 'y4-s4', year: 4, territory: 'Fairness', type: 'persuasive', text: `Should everyone get the same help, or the help they need? Persuade your teacher.` },
  { id: 'y4-s5', year: 4, territory: 'Health', type: 'persuasive', text: `Should schools ban birthday cakes and treats? Argue your view.` },
]

const Y5: WritingPrompt[] = [
  { id: 'y5-n1', year: 5, territory: 'Adversity', type: 'narrative', text: `Title: The Storm. Write a story.` },
  { id: 'y5-n2', year: 5, territory: 'Belonging', type: 'narrative', text: `Image: two children talking over a fence, each speaking a different language. Write a story.` },
  { id: 'y5-n3', year: 5, territory: 'Moral choice', type: 'narrative', text: `You see your friend take money from the class fundraiser tin. Write a story.` },
  { id: 'y5-n4', year: 5, territory: 'Relationship', type: 'narrative', text: `End with: "I should have asked her sooner."` },
  { id: 'y5-n5', year: 5, territory: 'Change', type: 'narrative', text: `Begin with: "The house smelled different once the furniture was gone."` },
  { id: 'y5-n6', year: 5, territory: 'Discovery', type: 'narrative', text: `A photo in your grandmother's album shows a child who looks exactly like you, dated 1952.` },
  { id: 'y5-n7', year: 5, territory: 'Courage', type: 'narrative', text: `Use this line anywhere: "Everyone was laughing. I wasn't."` },
  { id: 'y5-n8', year: 5, territory: 'Ambition', type: 'narrative', text: `Title: The Trophy Cabinet. Write a story.` },
  { id: 'y5-n9', year: 5, territory: 'Responsibility', type: 'narrative', text: `Your lie has grown too big to fix. Write the story.` },
  { id: 'y5-n10', year: 5, territory: 'Imagination', type: 'narrative', text: `You can hear what animals are thinking, but only for one day.` },
  { id: 'y5-s1', year: 5, territory: 'School', type: 'persuasive', text: `Should students be allowed to grade their teachers? Argue your view.` },
  { id: 'y5-s2', year: 5, territory: 'Technology', type: 'persuasive', text: `Should AI be allowed to do your homework? Persuade your school.` },
  { id: 'y5-s3', year: 5, territory: 'Environment', type: 'persuasive', text: `Persuade your school to ban single-use plastic in the canteen.` },
  { id: 'y5-s4', year: 5, territory: 'Fairness', type: 'persuasive', text: `Some suburbs have far better parks than others. Persuade your council to fix this.` },
  { id: 'y5-s5', year: 5, territory: 'Health', type: 'persuasive', text: `Should energy drinks be banned for under-16s? Argue your view.` },
]

const Y6: WritingPrompt[] = [
  { id: 'y6-n1', year: 6, territory: 'Adversity', type: 'narrative', text: `Write about a character who is injured and must watch others do what they love.` },
  { id: 'y6-n2', year: 6, territory: 'Belonging', type: 'narrative', text: `Use this line anywhere: "Say it properly," he said, laughing at my name.` },
  { id: 'y6-n3', year: 6, territory: 'Moral choice', type: 'narrative', text: `You are the only one who knows who cheated. Telling means your team loses the title.` },
  { id: 'y6-n4', year: 6, territory: 'Relationship', type: 'narrative', text: `Title: Two Chairs at the Table. Write a story.` },
  { id: 'y6-n5', year: 6, territory: 'Change', type: 'narrative', text: `End with: "I was not the youngest anymore."` },
  { id: 'y6-n6', year: 6, territory: 'Discovery', type: 'narrative', text: `You find a diary by the previous owner of your house. The last entry is unfinished.` },
  { id: 'y6-n7', year: 6, territory: 'Courage', type: 'narrative', text: `A child sees smoke from a neighbour's window. No adult is home. Write the story.` },
  { id: 'y6-n8', year: 6, territory: 'Ambition', type: 'narrative', text: `Begin with: "Fourth place. Again."` },
  { id: 'y6-n9', year: 6, territory: 'Responsibility', type: 'narrative', text: `Your joke went too far and someone got hurt. Write the story.` },
  { id: 'y6-n10', year: 6, territory: 'Imagination', type: 'narrative', text: `Everyone is born with a countdown clock on their wrist. Yours says three days.` },
  { id: 'y6-s1', year: 6, territory: 'School', type: 'persuasive', text: `Should Year 6 students have a say in what they learn? Persuade your principal.` },
  { id: 'y6-s2', year: 6, territory: 'Technology', type: 'persuasive', text: `Should the legal minimum age for social media be 16? Argue your view.` },
  { id: 'y6-s3', year: 6, territory: 'Environment', type: 'persuasive', text: `Persuade your council to make public transport free for students.` },
  { id: 'y6-s4', year: 6, territory: 'Fairness', type: 'persuasive', text: `Should scholarships go to the best performers or to those who need most help?` },
  { id: 'y6-s5', year: 6, territory: 'Health', type: 'persuasive', text: `Should sport be compulsory for every student? Argue your view.` },
]

const Y7: WritingPrompt[] = [
  { id: 'y7-n1', year: 7, territory: 'Adversity', type: 'narrative', text: `Write about a character who returns to something after a humiliating failure.` },
  { id: 'y7-n2', year: 7, territory: 'Belonging', type: 'narrative', text: `Begin with: "At home I was one person; at school I was another."` },
  { id: 'y7-n3', year: 7, territory: 'Moral choice', type: 'narrative', text: `A friend has already photographed tomorrow's exam from the teacher's desk. They send it to you.` },
  { id: 'y7-n4', year: 7, territory: 'Relationship', type: 'narrative', text: `Use this line anywhere: "I forgive you," she said, and it made everything worse.` },
  { id: 'y7-n5', year: 7, territory: 'Change', type: 'narrative', text: `Image: a bedroom half-packed in boxes, one wall still covered in posters. Write a story.` },
  { id: 'y7-n6', year: 7, territory: 'Discovery', type: 'narrative', text: `Every night at 3:07 the streetlight outside flickers in the same pattern.` },
  { id: 'y7-n7', year: 7, territory: 'Courage', type: 'narrative', text: `Your character is offered a dare that could hurt them, and everyone is watching.` },
  { id: 'y7-n8', year: 7, territory: 'Ambition', type: 'narrative', text: `Title: The Practice Diary. Write a story.` },
  { id: 'y7-n9', year: 7, territory: 'Responsibility', type: 'narrative', text: `You were in charge for ten minutes. Something went wrong. Write the story.` },
  { id: 'y7-n10', year: 7, territory: 'Imagination', type: 'narrative', text: `A new app lets you send one message to your ten-year-old self.` },
  { id: 'y7-s1', year: 7, territory: 'School', type: 'persuasive', text: `Should schools rank students publicly by achievement? Argue your view.` },
  { id: 'y7-s2', year: 7, territory: 'Technology', type: 'persuasive', text: `Should AI chatbots be banned for students under 16? Argue your view.` },
  { id: 'y7-s3', year: 7, territory: 'Environment', type: 'persuasive', text: `Should cars be banned from the city centre? Persuade your council.` },
  { id: 'y7-s4', year: 7, territory: 'Fairness', type: 'persuasive', text: `Should people be free to say offensive opinions in public? Argue your view.` },
  { id: 'y7-s5', year: 7, territory: 'Health', type: 'persuasive', text: `Should junk food advertising aimed at children be banned? Argue your view.` },
]

const Y8: WritingPrompt[] = [
  { id: 'y8-n1', year: 8, territory: 'Adversity', type: 'narrative', text: `A flood cuts your town off for a week. Write a narrative.` },
  { id: 'y8-n2', year: 8, territory: 'Belonging', type: 'narrative', text: `Image: a teenager at a family celebration, dressed differently from everyone else. Write a story.` },
  { id: 'y8-n3', year: 8, territory: 'Moral choice', type: 'narrative', text: `Your boss at your weekend job is short-changing customers. You need the job.` },
  { id: 'y8-n4', year: 8, territory: 'Relationship', type: 'narrative', text: `End with: "We never talked about it, and that was the problem."` },
  { id: 'y8-n5', year: 8, territory: 'Change', type: 'narrative', text: `Write a narrative about the day a character realises childhood is over.` },
  { id: 'y8-n6', year: 8, territory: 'Discovery', type: 'narrative', text: `A stranger hands you an unlocked phone and says, "Don't answer it."` },
  { id: 'y8-n7', year: 8, territory: 'Courage', type: 'narrative', text: `You are the strongest swimmer at the beach. Someone is in trouble past the flags.` },
  { id: 'y8-n8', year: 8, territory: 'Ambition', type: 'narrative', text: `Use this line anywhere: "You've improved," the coach said. It wasn't enough.` },
  { id: 'y8-n9', year: 8, territory: 'Responsibility', type: 'narrative', text: `You posted something about someone. It spread further than you meant.` },
  { id: 'y8-n10', year: 8, territory: 'Imagination', type: 'narrative', text: `In your city, memories can be bought and sold. Write a narrative.` },
  { id: 'y8-s1', year: 8, territory: 'School', type: 'persuasive', text: `Should exams be replaced by continuous assessment? Argue your view.` },
  { id: 'y8-s2', year: 8, territory: 'Technology', type: 'persuasive', text: `Should schools use AI to monitor students' online activity? Argue your view.` },
  { id: 'y8-s3', year: 8, territory: 'Environment', type: 'persuasive', text: `Should new housing developments be required to include green space? Persuade your council.` },
  { id: 'y8-s4', year: 8, territory: 'Fairness', type: 'persuasive', text: `Should the voting age be lowered to 16? Argue your view.` },
  { id: 'y8-s5', year: 8, territory: 'Health', type: 'persuasive', text: `Should schools start later so teenagers can sleep? Argue your view.` },
]

const Y9: WritingPrompt[] = [
  { id: 'y9-n1', year: 9, territory: 'Adversity', type: 'narrative', text: `Image: a hospital corridor, a teenager's sports bag on a chair. Write a narrative.` },
  { id: 'y9-n2', year: 9, territory: 'Belonging', type: 'narrative', text: `Begin with: "I had learned to translate my parents before I learned to disagree with them."` },
  { id: 'y9-n3', year: 9, territory: 'Moral choice', type: 'narrative', text: `You can save your family's business by signing a document you know is false.` },
  { id: 'y9-n4', year: 9, territory: 'Relationship', type: 'narrative', text: `Title: The Empty Chair at Dinner. Write a narrative.` },
  { id: 'y9-n5', year: 9, territory: 'Change', type: 'narrative', text: `End with: "I kept the key, even though there was nothing left to lock."` },
  { id: 'y9-n6', year: 9, territory: 'Discovery', type: 'narrative', text: `A letter arrives addressed to you, posted forty years ago.` },
  { id: 'y9-n7', year: 9, territory: 'Courage', type: 'narrative', text: `Use this line anywhere: "If you say something now, you can't take it back."` },
  { id: 'y9-n8', year: 9, territory: 'Ambition', type: 'narrative', text: `Write about a character who achieves exactly what they wanted and finds it hollow.` },
  { id: 'y9-n9', year: 9, territory: 'Responsibility', type: 'narrative', text: `Your silence let someone else take the blame. Write the narrative.` },
  { id: 'y9-n10', year: 9, territory: 'Imagination', type: 'narrative', text: `Every person is allowed to forget one thing. Yours has just been chosen for you.` },
  { id: 'y9-s1', year: 9, territory: 'School', type: 'persuasive', text: `Should schools be allowed to select students by academic ability? Argue your view.` },
  { id: 'y9-s2', year: 9, territory: 'Technology', type: 'persuasive', text: `Should governments require ID verification to use social media? Argue your view.` },
  { id: 'y9-s3', year: 9, territory: 'Environment', type: 'persuasive', text: `Should wealthy countries pay for climate damage in poorer ones? Argue your view.` },
  { id: 'y9-s4', year: 9, territory: 'Fairness', type: 'persuasive', text: `Should unpaid internships be legal? Argue your view.` },
  { id: 'y9-s5', year: 9, territory: 'Health', type: 'persuasive', text: `Should social media companies be legally responsible for young users' mental health?` },
]

export const WRITING_PROMPTS: WritingPrompt[] = [...Y2, ...Y3, ...Y4, ...Y5, ...Y6, ...Y7, ...Y8, ...Y9]

export const AVAILABLE_YEARS = [2, 3, 4, 5, 6, 7, 8, 9] as const

export function writingPromptById(id: string): WritingPrompt | undefined {
  return WRITING_PROMPTS.find((p) => p.id === id)
}

/** Clamp any year to the supported range (student_profiles allows 2–8; bank spans 2–9). */
export function normalizeYear(year: number | null | undefined): number {
  const n = Number(year)
  if (!Number.isFinite(n) || n < 2) return 5
  if (n > 9) return 9
  return Math.round(n)
}

export function promptsFor(year: number, type?: PromptType): WritingPrompt[] {
  return WRITING_PROMPTS.filter((p) => p.year === year && (type ? p.type === type : true))
}

export function calibrationFor(year: number): YearCalibration {
  return YEAR_CALIBRATION[normalizeYear(year)] ?? YEAR_CALIBRATION[5]
}

/**
 * The "top marking criteria" shown to the student before they start: the year's
 * primary focus for the chosen text type, plus a universal mechanics reminder
 * that scales with the year. Capped at five short, student-friendly bullets.
 */
export function markingCriteria(year: number, type: PromptType): string[] {
  const y = normalizeYear(year)
  const focus = FOCUS[y]?.[type] ?? []
  const mechanics =
    y <= 4
      ? ['Correct punctuation and capital letters', 'Clear paragraphs']
      : ['Proofread spelling and punctuation', 'Structure your paragraphs']
  return [...focus, ...mechanics].slice(0, 5)
}

/** Pick a random prompt for the year + type (Fisher-Yates-free; single draw). */
export function randomPrompt(year: number, type?: PromptType): WritingPrompt | undefined {
  const pool = promptsFor(normalizeYear(year), type)
  if (pool.length === 0) return undefined
  return pool[Math.floor(Math.random() * pool.length)]
}