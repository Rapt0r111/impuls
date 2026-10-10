-- ADR-0032: pg_cron calls the worker Edge Functions once a minute through pg_net.
-- Run once in the Supabase SQL Editor of the target project after the functions are
-- deployed and the Vault secret `impuls_worker_trigger` exists. Replace <project-ref>.
-- Not a migration: local and CI PostgreSQL have no pg_cron, pg_net or Vault.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'impuls-notifications',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/impuls-notifications',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'impuls_worker_trigger')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

select cron.schedule(
  'impuls-expiry',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/impuls-expiry',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'impuls_worker_trigger')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

-- Stop: select cron.unschedule('impuls-notifications'); select cron.unschedule('impuls-expiry');
