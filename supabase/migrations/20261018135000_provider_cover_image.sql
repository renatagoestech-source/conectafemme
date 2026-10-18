ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS cover_image varchar(500) NOT NULL DEFAULT '';
