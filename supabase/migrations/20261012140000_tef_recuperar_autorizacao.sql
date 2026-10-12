-- Recuperação da autorização TEF no mesmo terminal.
-- Este arquivo não revoga chaves e não altera terminais ao ser aplicado.
-- A troca só ocorre quando a função é chamada pelo servidor.
-- Não guarda chave privada, PAN, PIN nem credencial.

BEGIN;

CREATE TABLE IF NOT EXISTS public.tef_auditoria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id),
  terminal_id uuid REFERENCES public.tef_terminais (id),
  usuario_id uuid,
  acao text NOT NULL,
  efeito text NOT NULL,
  dispositivo_id uuid,
  chave_id_anterior uuid,
  chave_id_atual uuid,
  fingerprint_anterior text NOT NULL DEFAULT '',
  fingerprint_atual text NOT NULL DEFAULT '',
  motivo text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tef_auditoria_acao_check CHECK (acao = 'recuperacao_autorizacao'),
  CONSTRAINT tef_auditoria_efeito_check CHECK (
    efeito IN ('autorizada', 'ja_autorizada', 'recusar')
  ),
  CONSTRAINT tef_auditoria_fingerprint_check CHECK (
    fingerprint_anterior ~ '^[0-9a-f]{0,64}$'
    AND fingerprint_atual ~ '^[0-9a-f]{0,64}$'
  )
);

COMMENT ON TABLE public.tef_auditoria IS
  'Auditoria da recuperação de autorização TEF. Guarda identificadores e fingerprints da chave pública. Não guarda chave privada.';

ALTER TABLE public.tef_auditoria ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tef_auditoria_select_empresa ON public.tef_auditoria;
CREATE POLICY tef_auditoria_select_empresa
  ON public.tef_auditoria
  FOR SELECT
  TO authenticated
  USING (public.tem_acesso_empresa(empresa_id));

REVOKE ALL ON public.tef_auditoria FROM anon, authenticated;
GRANT SELECT ON public.tef_auditoria TO authenticated;
GRANT SELECT, INSERT ON public.tef_auditoria TO service_role;

CREATE OR REPLACE FUNCTION public.tef_recuperar_autorizacao_terminal(
  p_empresa_id uuid,
  p_dispositivo_id uuid,
  p_usuario_id uuid,
  p_chave_publica text,
  p_chave_id uuid,
  p_chave_anterior text,
  p_fingerprint_anterior text,
  p_fingerprint_atual text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_terminal public.tef_terminais%ROWTYPE;
  v_terminal_id uuid;
  v_codigo text := '';
  v_chave_id_anterior uuid;
  v_outra integer;
  v_pendente integer;
  v_efeito text;
  v_motivo text := '';
BEGIN
  IF p_chave_publica IS NULL
     OR length(btrim(p_chave_publica)) = 0
     OR p_chave_publica ILIKE '%PRIVATE%'
     OR p_chave_anterior ILIKE '%PRIVATE%'
     OR length(p_chave_publica) > 2000
     OR p_fingerprint_anterior !~ '^[0-9a-f]{64}$'
     OR p_fingerprint_atual !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('efeito', 'recusar', 'motivo', 'chave_invalida');
  END IF;

  PERFORM 1
  FROM public.tef_terminais
  WHERE dispositivo_id = p_dispositivo_id
    AND ativo
    AND revogada_em IS NULL
  FOR UPDATE;

  SELECT count(*) INTO v_outra
  FROM public.tef_terminais
  WHERE dispositivo_id = p_dispositivo_id
    AND ativo
    AND revogada_em IS NULL
    AND empresa_id IS DISTINCT FROM p_empresa_id;

  IF v_outra > 0 THEN
    v_efeito := 'recusar';
    v_motivo := 'outra_empresa';
  ELSE
    SELECT * INTO v_terminal
    FROM public.tef_terminais
    WHERE dispositivo_id = p_dispositivo_id
      AND empresa_id = p_empresa_id
      AND ativo
      AND revogada_em IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
      v_efeito := 'recusar';
      v_motivo := 'sem_terminal';
    ELSE
      v_terminal_id := v_terminal.id;
      v_codigo := v_terminal.codigo;
      v_chave_id_anterior := v_terminal.chave_id;

      SELECT count(*) INTO v_pendente
      FROM public.tef_operacoes
      WHERE empresa_id = p_empresa_id
        AND terminal_id = v_terminal.id
        AND status IN (
          'iniciada',
          'autorizada',
          'vinculada',
          'desconhecida',
          'desfazimento_pendente',
          'reconciliacao'
        );

      IF v_pendente > 0 THEN
        v_efeito := 'recusar';
        v_motivo := 'pendente';
      ELSIF EXISTS (
        SELECT 1 FROM public.tef_chaves_revogadas
        WHERE chave_publica = p_chave_publica
      ) THEN
        v_efeito := 'recusar';
        v_motivo := 'chave_revogada';
      ELSIF EXISTS (
        SELECT 1 FROM public.tef_terminais
        WHERE chave_publica = p_chave_publica
          AND id IS DISTINCT FROM v_terminal.id
      ) THEN
        v_efeito := 'recusar';
        v_motivo := 'chave_outro_terminal';
      ELSIF v_terminal.chave_publica = p_chave_publica THEN
        v_efeito := 'ja_autorizada';
      ELSIF v_terminal.chave_publica IS DISTINCT FROM p_chave_anterior THEN
        v_efeito := 'recusar';
        v_motivo := 'substituida';
      ELSE
        INSERT INTO public.tef_chaves_revogadas (
          empresa_id,
          dispositivo_id,
          chave_publica,
          chave_id
        )
        VALUES (
          p_empresa_id,
          v_terminal.dispositivo_id,
          v_terminal.chave_publica,
          v_terminal.chave_id
        )
        ON CONFLICT ON CONSTRAINT tef_chaves_revogadas_chave_key DO NOTHING;

        UPDATE public.tef_terminais
        SET chave_publica = p_chave_publica,
            chave_id = p_chave_id
        WHERE id = v_terminal.id
          AND empresa_id = p_empresa_id
          AND dispositivo_id = p_dispositivo_id
          AND codigo = v_terminal.codigo
          AND chave_publica = p_chave_anterior
          AND ativo
          AND revogada_em IS NULL;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'recuperacao concorrente do terminal TEF';
        END IF;

        v_efeito := 'autorizada';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.tef_auditoria (
    empresa_id,
    terminal_id,
    usuario_id,
    acao,
    efeito,
    dispositivo_id,
    chave_id_anterior,
    chave_id_atual,
    fingerprint_anterior,
    fingerprint_atual,
    motivo
  )
  VALUES (
    p_empresa_id,
    v_terminal_id,
    p_usuario_id,
    'recuperacao_autorizacao',
    v_efeito,
    p_dispositivo_id,
    CASE WHEN v_efeito = 'autorizada' THEN v_chave_id_anterior ELSE NULL END,
    CASE WHEN v_efeito IN ('autorizada', 'ja_autorizada') THEN p_chave_id ELSE NULL END,
    CASE WHEN v_efeito = 'autorizada' THEN p_fingerprint_anterior ELSE '' END,
    p_fingerprint_atual,
    v_motivo
  );

  RETURN jsonb_build_object(
    'efeito', v_efeito,
    'motivo', v_motivo,
    'terminal_id', v_terminal_id,
    'codigo', v_codigo
  );
END;
$$;

COMMENT ON FUNCTION public.tef_recuperar_autorizacao_terminal(uuid, uuid, uuid, text, uuid, text, text, text) IS
  'Revoga a chave pública anterior e autoriza a chave comprovada no mesmo terminal. Não altera código, dispositivo nem histórico. Não gera chave.';

REVOKE ALL ON FUNCTION public.tef_recuperar_autorizacao_terminal(uuid, uuid, uuid, text, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tef_recuperar_autorizacao_terminal(uuid, uuid, uuid, text, uuid, text, text, text)
  TO service_role;

COMMIT;
