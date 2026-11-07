ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmation_required boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.users.email_confirmed_at IS
  'Timestamp de confirmação do endereço de e-mail via Supabase Auth.';
COMMENT ON COLUMN public.users.confirmation_required IS
  'Se true, exige confirmação de e-mail antes de permitir login; permanece false para contas legadas.';
