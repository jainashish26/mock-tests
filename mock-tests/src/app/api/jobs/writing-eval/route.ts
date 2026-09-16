import { NextResponse } from 'next/server'
import { verifySignatureAppRouter } from '@upstash/qstash/dist/nextjs'
import { createAdminClient } from '@/lib/supabase/admin'
import { scoreAttempt } from '@/lib/scoring/score-attempt'

async function handler(req: Request) {
  try {
    const { attemptId } = await req.json()
    if (!attemptId) throw new Error('Missing attemptId')

    const admin = createAdminClient()

    // 1. Fetch WRITING responses for this attempt
    const { data: responses, error: respErr } = await admin
      .from('responses')
      .select('id, answer, questions(stem, explanation)')
      .eq('attempt_id', attemptId)
    
    if (respErr || !responses) throw new Error('Could not fetch responses')

    const writingResponses = responses.filter(r => r.questions && (r.questions as any).type === 'WRITING')

    if (writingResponses.length === 0) {
      return NextResponse.json({ message: 'No writing responses found' })
    }

    // For simplicity MVP, process the first writing response (usually tests have 1 essay)
    const writingResp = writingResponses[0]
    const studentText = writingResp.answer as string
    const promptRef = (writingResp.questions as any).stem
    const rubric = (writingResp.questions as any).explanation || 'Standard rubric: Evaluate grammar, structure, and coherence.'

    // 2. Call DeepSeek
    const dsRes = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: `You are an expert writing evaluator. Evaluate the student's text based on this rubric: ${rubric}. You must output JSON with these keys: "score_out_of100" (number), "strengths" (array of strings), "improvements" (array of strings), "improved_text" (string).` },
          { role: 'user', content: `Prompt: ${promptRef}\n\nStudent Text:\n${studentText}` }
        ]
      })
    })

    if (!dsRes.ok) {
      const errText = await dsRes.text()
      throw new Error('DeepSeek API error: ' + errText)
    }

    const dsData = await dsRes.json()
    const content = JSON.parse(dsData.choices[0].message.content)

    // 3. Save Evaluation
    const { error: evalErr } = await admin.from('writing_evaluations').insert({
      attempt_id: attemptId,
      provider: 'DeepSeek',
      score_out_of100: content.score_out_of100,
      strengths: content.strengths,
      improvements: content.improvements,
      improved_text: content.improved_text,
      raw_response: dsData
    })

    if (evalErr) throw evalErr

    // 4. Update the attempt to COMPLETE and recalculate (or just aggregate)
    await admin.from('attempts').update({ status: 'COMPLETE' }).eq('id', attemptId)

    // Optionally re-run the score function to aggregate the final score
    await scoreAttempt(attemptId)

    return NextResponse.json({ success: true, score: content.score_out_of100 })

  } catch (err: any) {
    console.error('Job error', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export const POST = verifySignatureAppRouter(handler)
