-- Keep versioned acceptance evidence for general terms and provider-specific rules.
CREATE TABLE IF NOT EXISTS public.legal_acceptances (
  user_id bigint NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  document_key text NOT NULL CHECK (document_key IN ('terms_of_use', 'professional_rules')),
  document_version varchar(64) NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, document_key, document_version)
);

CREATE INDEX IF NOT EXISTS legal_acceptances_user_accepted_idx
  ON public.legal_acceptances(user_id, accepted_at DESC);

ALTER TABLE public.legal_acceptances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.legal_acceptances FROM anon, authenticated;
GRANT ALL ON TABLE public.legal_acceptances TO service_role;

NOTIFY pgrst, 'reload schema';
