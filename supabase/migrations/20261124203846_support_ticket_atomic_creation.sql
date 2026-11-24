-- Evita chamados sem mensagem inicial se uma das gravações falhar.
CREATE OR REPLACE FUNCTION public.create_conecta_support_ticket(
  p_professional_id bigint,
  p_admin_id bigint,
  p_subject text,
  p_body text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  saved_ticket public.support_tickets%ROWTYPE;
  saved_message public.support_messages%ROWTYPE;
BEGIN
  IF length(btrim(coalesce(p_subject, ''))) NOT BETWEEN 1 AND 150 THEN
    RAISE EXCEPTION 'Assunto inválido';
  END IF;
  IF length(btrim(coalesce(p_body, ''))) NOT BETWEEN 1 AND 5000 THEN
    RAISE EXCEPTION 'Mensagem inválida';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_professional_id AND role = 'provider') THEN
    RAISE EXCEPTION 'Profissional indisponível';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_admin_id AND role = 'admin') THEN
    RAISE EXCEPTION 'Administrador indisponível';
  END IF;

  INSERT INTO public.support_tickets (professional_id, admin_id, subject, status)
  VALUES (p_professional_id, p_admin_id, btrim(p_subject), 'aberto')
  RETURNING * INTO saved_ticket;

  INSERT INTO public.support_messages (ticket_id, sender_id, recipient_id, body)
  VALUES (saved_ticket.id, p_professional_id, p_admin_id, btrim(p_body))
  RETURNING * INTO saved_message;

  RETURN jsonb_build_object('ticket', to_jsonb(saved_ticket), 'message', to_jsonb(saved_message));
END;
$$;

REVOKE ALL ON FUNCTION public.create_conecta_support_ticket(bigint, bigint, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_conecta_support_ticket(bigint, bigint, text, text) TO service_role;
