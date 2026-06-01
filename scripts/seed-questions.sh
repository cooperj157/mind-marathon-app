#!/bin/bash
# Seed the question bank with 100 questions per category (600 total).
# Run once: bash scripts/seed-questions.sh
# Requires: supabase CLI installed and logged in, project linked.

set -e

CATEGORIES=("science" "history" "geography" "entertainment" "sports" "art_lit")

echo "🧠 Seeding Mind Marathon question bank..."
echo "   100 questions × 6 categories = 600 total"
echo ""

for CATEGORY in "${CATEGORIES[@]}"; do
  echo "⏳ Generating $CATEGORY questions (5 batches × 20)..."
  npx supabase functions invoke generate-questions \
    --body "{\"category\": \"$CATEGORY\", \"batch_count\": 5, \"replace\": true}" \
    2>&1
  echo "✅ $CATEGORY done"
  echo ""
  # Small pause between categories to avoid rate limiting
  sleep 2
done

echo "🎉 Question bank seeded successfully!"
