#!/bin/bash
# Seed the question bank with 100 questions per category (600 total).
# Run from the project root: bash scripts/seed-questions.sh

set -e

FUNCTION_URL="https://cwmacxbjptrctetwwmgv.supabase.co/functions/v1/generate-questions"
CATEGORIES=("science" "history" "geography" "entertainment" "sports" "art_lit")

echo "🧠 Seeding Mind Marathon question bank..."
echo "   100 questions × 6 categories = 600 total"
echo ""

for CATEGORY in "${CATEGORIES[@]}"; do
  echo "⏳ Generating $CATEGORY questions (5 batches × 20)..."
  RESPONSE=$(curl -s -X POST "$FUNCTION_URL" \
    -H "Content-Type: application/json" \
    -d "{\"category\": \"$CATEGORY\", \"batch_count\": 5, \"replace\": true}")
  echo "   $RESPONSE"
  echo "✅ $CATEGORY done"
  echo ""
  sleep 2
done

echo "🎉 Question bank seeded successfully!"
