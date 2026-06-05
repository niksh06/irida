-- Optional SDK/run failure detail for debugging rotation and cron failures.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS error_detail TEXT;
