import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const VALID_CATEGORIES = [
  'science', 'history', 'geography', 'entertainment', 'sports', 'art_lit',
] as const;
type Category = typeof VALID_CATEGORIES[number];

const CATEGORY_LABELS: Record<Category, string> = {
  science:       'Science',
  history:       'History',
  geography:     'Geography',
  entertainment: 'Entertainment',
  sports:        'Sports',
  art_lit:       'Art & Literature',
};

// Calls Claude Haiku and returns 20 questions for the given category.
async function generateBatch(
  category: Category,
  apiKey: string,
): Promise<Array<{ body: string; correct_answer: string; wrong_answers: string[] }>> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: `Generate exactly 20 unique trivia questions for the category: "${CATEGORY_LABELS[category]}".

Requirements:
- Factually accurate with no ambiguity
- One clearly correct answer
- Exactly 3 plausible but incorrect wrong answers
- Mix of difficulty (roughly: 7 easy, 8 medium, 5 hard)
- No questions about events after 2023

Respond with ONLY a raw JSON array — no markdown, no code fences, no explanation:
[
  {
    "body": "Question ending with a question mark?",
    "correct_answer": "The correct answer",
    "wrong_answers": ["Wrong 1", "Wrong 2", "Wrong 3"]
  }
]`,
      }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic API error: ${await res.text()}`);
  }

  const data = await res.json();
  const raw: string = data.content[0].text.trim()
    .replace(/^```json?\n?/, '')
    .replace(/\n?```$/, '');

  return JSON.parse(raw);
}

serve(async (req: Request) => {
  try {
    const { category, batch_count = 1, replace = false } = await req.json();

    if (!VALID_CATEGORIES.includes(category)) {
      return new Response(
        JSON.stringify({ error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Cap at 5 batches (100 questions) per invocation to stay within timeout
    const batches = Math.min(Math.max(1, batch_count), 5);

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')!;
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Optionally wipe existing questions for this category first
    if (replace) {
      const { error } = await supabase.from('questions').delete().eq('category', category);
      if (error) throw new Error(`Delete failed: ${error.message}`);
    }

    // Generate questions in sequential batches (each = 20 questions)
    let totalInserted = 0;
    for (let i = 0; i < batches; i++) {
      const questions = await generateBatch(category as Category, apiKey);

      const rows = questions.map((q) => ({
        category,
        body: q.body,
        correct_answer: q.correct_answer,
        wrong_answers: q.wrong_answers,
      }));

      const { error } = await supabase.from('questions').insert(rows);
      if (error) throw new Error(`Insert failed (batch ${i + 1}): ${error.message}`);

      totalInserted += rows.length;
    }

    return new Response(
      JSON.stringify({ success: true, category, inserted: totalInserted, replaced: replace }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
});
