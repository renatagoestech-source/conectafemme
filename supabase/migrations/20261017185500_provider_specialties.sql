-- Permite uma especialidade principal e uma segunda opcional no perfil profissional.
BEGIN;

ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS specialties text[] NOT NULL DEFAULT '{}'::text[]
  CHECK (cardinality(specialties) <= 2);

UPDATE public.providers
SET specialties = ARRAY[category]::text[]
WHERE cardinality(specialties) = 0
  AND NULLIF(BTRIM(category), '') IS NOT NULL;

COMMIT;
