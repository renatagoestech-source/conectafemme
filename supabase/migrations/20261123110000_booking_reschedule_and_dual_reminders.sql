-- Remarcação atômica e dois lembretes para agendamentos confirmados.
BEGIN;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS reschedule_version integer NOT NULL DEFAULT 0
  CHECK (reschedule_version >= 0);

CREATE OR REPLACE FUNCTION public.reschedule_conectafemme_booking(
  p_booking_id bigint,
  p_client_id bigint,
  p_new_slot_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_old_slot public.slots%ROWTYPE;
  v_new_slot public.slots%ROWTYPE;
  v_local_now timestamp without time zone := timezone('America/Sao_Paulo', now());
BEGIN
  IF p_booking_id IS NULL OR p_client_id IS NULL OR p_new_slot_id IS NULL
    OR p_booking_id < 1 OR p_client_id < 1 OR p_new_slot_id < 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Selecione um novo horário válido.';
  END IF;

  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id AND client_id = p_client_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Agendamento não encontrado.';
  END IF;
  IF v_booking.status <> 'confirmado' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Somente atendimentos confirmados podem ser remarcados.';
  END IF;
  IF v_booking.slot_id = p_new_slot_id THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Escolha um horário diferente do atual.';
  END IF;

  -- Trava ambos os horários em ordem estável para impedir dupla reserva e reduzir deadlocks.
  PERFORM id
  FROM public.slots
  WHERE id IN (v_booking.slot_id, p_new_slot_id)
  ORDER BY id
  FOR UPDATE;

  SELECT * INTO v_old_slot FROM public.slots WHERE id = v_booking.slot_id;
  SELECT * INTO v_new_slot FROM public.slots WHERE id = p_new_slot_id;
  IF NOT FOUND OR v_new_slot.provider_id <> v_booking.provider_id
    OR v_new_slot.booked OR NOT v_new_slot.available THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Esse horário não está mais disponível para este profissional.';
  END IF;
  IF (v_old_slot.day + v_old_slot.hour::time) <= v_local_now THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Atendimentos passados não podem ser remarcados.';
  END IF;
  IF (v_new_slot.day + v_new_slot.hour::time) <= v_local_now THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Escolha um horário futuro.';
  END IF;

  UPDATE public.slots SET booked = false WHERE id = v_old_slot.id AND booked = true;
  UPDATE public.slots SET booked = true WHERE id = v_new_slot.id AND booked = false AND available = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Esse horário acabou de ser reservado. Escolha outro.';
  END IF;

  UPDATE public.bookings
  SET slot_id = v_new_slot.id, reschedule_version = reschedule_version + 1
  WHERE id = v_booking.id
  RETURNING * INTO v_booking;

  RETURN jsonb_build_object(
    'booking_id', v_booking.id,
    'provider_id', v_booking.provider_id,
    'service_id', v_booking.service_id,
    'old_slot_id', v_old_slot.id,
    'slot_id', v_new_slot.id,
    'day', v_new_slot.day,
    'hour', v_new_slot.hour,
    'reschedule_version', v_booking.reschedule_version
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reschedule_conectafemme_booking(bigint, bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_conectafemme_booking(bigint, bigint, bigint) TO service_role;

DO $$
DECLARE
  existing_job record;
BEGIN
  FOR existing_job IN
    SELECT jobid FROM cron.job
    WHERE jobname IN ('conectafemme-day-reminders', 'conectafemme-30m-reminders')
  LOOP
    PERFORM cron.unschedule(existing_job.jobid);
  END LOOP;

  -- pg_cron usa UTC neste projeto: 11:00 UTC equivale a 08:00 em America/Sao_Paulo.
  PERFORM cron.schedule(
    'conectafemme-day-reminders',
    '0 11 * * *',
    $job$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'conectafemme_reminder_project_url')
          || '/functions/v1/conectafemme-reminders',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'conectafemme_reminder_publishable_key'),
          'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'conectafemme_reminder_cron_secret')
        ),
        body := '{"kind":"day"}'::jsonb
      ) AS request_id;
    $job$
  );

  PERFORM cron.schedule(
    'conectafemme-30m-reminders',
    '* * * * *',
    $job$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'conectafemme_reminder_project_url')
          || '/functions/v1/conectafemme-reminders',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'conectafemme_reminder_publishable_key'),
          'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'conectafemme_reminder_cron_secret')
        ),
        body := '{"kind":"30m"}'::jsonb
      ) AS request_id;
    $job$
  );
END $$;

COMMIT;
