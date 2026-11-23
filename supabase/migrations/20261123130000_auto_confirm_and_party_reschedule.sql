-- Confirma automaticamente novos atendimentos e permite remarcação por ambas as partes.
BEGIN;

-- Pedidos futuros que aguardavam confirmação passam a refletir a nova regra do produto.
UPDATE public.bookings AS b
SET status = 'confirmado'
FROM public.slots AS s
WHERE b.slot_id = s.id
  AND b.status = 'pendente'
  AND (s.day + s.hour::time) > timezone('America/Sao_Paulo', now());

CREATE OR REPLACE FUNCTION public.reschedule_conectafemme_booking_by_party(
  p_booking_id bigint,
  p_actor_id bigint,
  p_actor_role text,
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
  IF p_booking_id IS NULL OR p_actor_id IS NULL OR p_new_slot_id IS NULL
    OR p_booking_id < 1 OR p_actor_id < 1 OR p_new_slot_id < 1
    OR p_actor_role IS NULL OR p_actor_role NOT IN ('client', 'provider') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Selecione um novo horário válido.';
  END IF;

  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
    AND ((p_actor_role = 'client' AND client_id = p_actor_id)
      OR (p_actor_role = 'provider' AND provider_id = p_actor_id))
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

  PERFORM id
  FROM public.slots
  WHERE id IN (v_booking.slot_id, p_new_slot_id)
  ORDER BY id
  FOR UPDATE;

  SELECT * INTO v_old_slot FROM public.slots WHERE id = v_booking.slot_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'O horário atual não está mais disponível.';
  END IF;
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
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'O horário atual não está mais reservado.';
  END IF;
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

REVOKE ALL ON FUNCTION public.reschedule_conectafemme_booking_by_party(bigint, bigint, text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_conectafemme_booking_by_party(bigint, bigint, text, bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.cancel_conectafemme_booking_by_party(
  p_booking_id bigint,
  p_actor_id bigint,
  p_actor_role text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_slot public.slots%ROWTYPE;
BEGIN
  IF p_booking_id IS NULL OR p_actor_id IS NULL OR p_booking_id < 1 OR p_actor_id < 1
    OR p_actor_role IS NULL OR p_actor_role NOT IN ('client', 'provider') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Agendamento inválido.';
  END IF;

  -- A remarcação e o cancelamento travam primeiro o booking, serializando as duas operações.
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
    AND ((p_actor_role = 'client' AND client_id = p_actor_id)
      OR (p_actor_role = 'provider' AND provider_id = p_actor_id))
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Agendamento não encontrado.';
  END IF;
  IF v_booking.status <> 'confirmado' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Somente atendimentos confirmados podem ser cancelados.';
  END IF;

  SELECT * INTO v_slot FROM public.slots WHERE id = v_booking.slot_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'O horário do atendimento não foi encontrado.';
  END IF;
  UPDATE public.bookings SET status = 'cancelado' WHERE id = v_booking.id;
  UPDATE public.slots SET booked = false WHERE id = v_slot.id AND booked = true;

  RETURN jsonb_build_object('booking_id', v_booking.id, 'slot_id', v_slot.id, 'status', 'cancelado');
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_conectafemme_booking_by_party(bigint, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_conectafemme_booking_by_party(bigint, bigint, text) TO service_role;

COMMIT;
