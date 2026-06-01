-- Weekly Question Bank Refresh
-- Run this once in the Supabase SQL Editor.
--
-- Before running:
--   1. Enable pg_cron and pg_net extensions:
--      Dashboard → Database → Extensions → search "cron" and "net" → enable both
--   2. Replace <SERVICE_ROLE_KEY> below with your service role key:
--      Dashboard → Project Settings → API → service_role (secret) key
--      ⚠️  Never commit the actual key to git — only paste it here in the SQL editor.
--
-- This schedules the question bank to refresh every Sunday at 3:00 AM UTC.
-- Each category is staggered by 5 minutes so they don't overlap.
-- 100 questions per category (5 batches × 20) = 600 total, refreshed weekly.

select cron.schedule(
  'refresh-science',
  '0 3 * * 0',
  $$
  select net.http_post(
    url     := 'https://cwmacxbjptrctetwwmgv.supabase.co/functions/v1/generate-questions',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
    body    := '{"category": "science", "batch_count": 5, "replace": true}'::jsonb
  );
  $$
);

select cron.schedule(
  'refresh-history',
  '5 3 * * 0',
  $$
  select net.http_post(
    url     := 'https://cwmacxbjptrctetwwmgv.supabase.co/functions/v1/generate-questions',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
    body    := '{"category": "history", "batch_count": 5, "replace": true}'::jsonb
  );
  $$
);

select cron.schedule(
  'refresh-geography',
  '10 3 * * 0',
  $$
  select net.http_post(
    url     := 'https://cwmacxbjptrctetwwmgv.supabase.co/functions/v1/generate-questions',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
    body    := '{"category": "geography", "batch_count": 5, "replace": true}'::jsonb
  );
  $$
);

select cron.schedule(
  'refresh-entertainment',
  '15 3 * * 0',
  $$
  select net.http_post(
    url     := 'https://cwmacxbjptrctetwwmgv.supabase.co/functions/v1/generate-questions',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
    body    := '{"category": "entertainment", "batch_count": 5, "replace": true}'::jsonb
  );
  $$
);

select cron.schedule(
  'refresh-sports',
  '20 3 * * 0',
  $$
  select net.http_post(
    url     := 'https://cwmacxbjptrctetwwmgv.supabase.co/functions/v1/generate-questions',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
    body    := '{"category": "sports", "batch_count": 5, "replace": true}'::jsonb
  );
  $$
);

select cron.schedule(
  'refresh-art-lit',
  '25 3 * * 0',
  $$
  select net.http_post(
    url     := 'https://cwmacxbjptrctetwwmgv.supabase.co/functions/v1/generate-questions',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
    body    := '{"category": "art_lit", "batch_count": 5, "replace": true}'::jsonb
  );
  $$
);

-- To verify cron jobs are registered:
-- select * from cron.job;

-- To remove a job if needed:
-- select cron.unschedule('refresh-science');
