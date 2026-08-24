BEGIN;

-- UltraPDV — Fase 1 do módulo Caixa.
-- Multiempresa: empresa_id em todas as linhas + RLS via tem_acesso_empresa.
-- filial_id reservado (cadastro de filiais ainda não existe neste schema).
-- Saldo atual NÃO é coluna de verdade: deriva de caixa_movimentacoes.
-- Escritas críticas só via RPC atômica (SECURITY DEFINER).

-- ------------------------------------------------------------
-- Recurso do plano
-- ------------------------------------------------------------

INSERT INTO public.recursos_plataforma (
  chave,
  nome,
  descricao,
  categoria,
  ordem,
  ativo
)
VALUES (
  'caixa',
  'Caixa',
  'Abertura, suprimento, sangria e fechamento de caixa.',
  'comercial',
  15,
  true
)
ON CONFLICT (chave) DO UPDATE
SET
  nome = EXCLUDED.nome,
  descricao = EXCLUDED.descricao,
  categoria = EXCLUDED.categoria,
  ordem = EXCLUDED.ordem,
  updated_at = now();

INSERT INTO public.planos_recursos (plano_id, recurso_id, habilitado)
SELECT p.id, r.id, true
FROM public.planos p
INNER JOIN public.recursos_plataforma r ON r.chave = 'caixa'
ON CONFLICT (plano_id, recurso_id) DO UPDATE
SET
  habilitado = EXCLUDED.habilitado,
  updated_at = now();

-- ------------------------------------------------------------
-- Permissão de usuário (módulo caixa)
-- ------------------------------------------------------------

ALTER TABLE public.usuarios_permissoes_empresas
  DROP CONSTRAINT IF EXISTS usuarios_permissoes_empresas_modulo_check;

ALTER TABLE public.usuarios_permissoes_empresas
  ADD CONSTRAINT usuarios_permissoes_empresas_modulo_check
    CHECK (
      modulo = ANY (ARRAY[
        'inicio',
        'vendas',
        'pdv',
        'clientes',
        'produtos',
        'estoque',
        'fiscal',
        'financeiro',
        'contabilidade',
        'configuracoes',
        'usuarios',
        'catalogo',
        'importacao_dados',
        'relatorios',
        'caixa'
      ]::text[])
    );

-- ------------------------------------------------------------
-- Tabelas
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.caixas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  filial_id uuid,
  numero integer NOT NULL,
  usuario_abertura_id uuid NOT NULL REFERENCES public.usuarios (id),
  usuario_fechamento_id uuid REFERENCES public.usuarios (id),
  saldo_inicial numeric(14, 2) NOT NULL DEFAULT 0,
  dinheiro_contado numeric(14, 2),
  diferenca numeric(14, 2),
  aberto_em timestamptz NOT NULL DEFAULT now(),
  fechado_em timestamptz,
  status text NOT NULL DEFAULT 'aberto',
  observacao_abertura text,
  observacao_fechamento text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT caixas_empresa_id_key UNIQUE (empresa_id, id),
  CONSTRAINT caixas_empresa_numero_unico UNIQUE (empresa_id, numero),
  CONSTRAINT caixas_status_check CHECK (
    status = ANY (ARRAY['aberto', 'fechado', 'cancelado']::text[])
  ),
  CONSTRAINT caixas_saldo_inicial_check CHECK (saldo_inicial >= 0),
  CONSTRAINT caixas_dinheiro_contado_check CHECK (
    dinheiro_contado IS NULL OR dinheiro_contado >= 0
  ),
  CONSTRAINT caixas_aberto_consistente CHECK (
    status <> 'aberto'
    OR (
      fechado_em IS NULL
      AND usuario_fechamento_id IS NULL
      AND dinheiro_contado IS NULL
      AND diferenca IS NULL
    )
  ),
  CONSTRAINT caixas_fechado_consistente CHECK (
    status <> 'fechado'
    OR (
      fechado_em IS NOT NULL
      AND usuario_fechamento_id IS NOT NULL
      AND dinheiro_contado IS NOT NULL
      AND diferenca IS NOT NULL
    )
  )
);

COMMENT ON TABLE public.caixas IS
  'Sessão de caixa por empresa. Saldo atual deriva das movimentações; saldo_inicial é snapshot da abertura.';

COMMENT ON COLUMN public.caixas.filial_id IS
  'Reservado. Cadastro de filiais ainda não existe; unicidade de sessão aberta é por empresa enquanto filial_id for nulo.';

COMMENT ON COLUMN public.caixas.saldo_inicial IS
  'Snapshot da abertura. Não usar como saldo corrente.';

CREATE UNIQUE INDEX IF NOT EXISTS ux_caixas_aberto_empresa_sem_filial
  ON public.caixas (empresa_id)
  WHERE status = 'aberto' AND filial_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_caixas_aberto_empresa_filial
  ON public.caixas (empresa_id, filial_id)
  WHERE status = 'aberto' AND filial_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_caixas_empresa_status_aberto_em
  ON public.caixas (empresa_id, status, aberto_em DESC);

CREATE INDEX IF NOT EXISTS ix_caixas_empresa_usuario_abertura
  ON public.caixas (empresa_id, usuario_abertura_id, aberto_em DESC);

CREATE TABLE IF NOT EXISTS public.caixa_movimentacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  filial_id uuid,
  caixa_id uuid NOT NULL,
  tipo text NOT NULL,
  origem_tipo text,
  origem_id uuid,
  forma_pagamento_id uuid,
  entrada numeric(14, 2) NOT NULL DEFAULT 0,
  saida numeric(14, 2) NOT NULL DEFAULT 0,
  descricao text,
  usuario_id uuid NOT NULL REFERENCES public.usuarios (id),
  estorno_de_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT caixa_movimentacoes_empresa_id_key UNIQUE (empresa_id, id),
  CONSTRAINT caixa_movimentacoes_caixa_fk
    FOREIGN KEY (empresa_id, caixa_id)
    REFERENCES public.caixas (empresa_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT caixa_movimentacoes_forma_fk
    FOREIGN KEY (empresa_id, forma_pagamento_id)
    REFERENCES public.formas_pagamento (empresa_id, id)
    ON DELETE SET NULL,
  CONSTRAINT caixa_movimentacoes_estorno_fk
    FOREIGN KEY (empresa_id, estorno_de_id)
    REFERENCES public.caixa_movimentacoes (empresa_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT caixa_movimentacoes_tipo_check CHECK (
    tipo = ANY (ARRAY['abertura', 'suprimento', 'sangria', 'ajuste']::text[])
  ),
  CONSTRAINT caixa_movimentacoes_valores_check CHECK (
    entrada >= 0
    AND saida >= 0
    AND NOT (entrada > 0 AND saida > 0)
    AND (
      tipo = 'abertura'
      OR entrada > 0
      OR saida > 0
    )
  )
);

COMMENT ON TABLE public.caixa_movimentacoes IS
  'Livro de caixa. Fonte da verdade do saldo. Nunca apagar para corrigir diferença.';

CREATE INDEX IF NOT EXISTS ix_caixa_movimentacoes_caixa
  ON public.caixa_movimentacoes (empresa_id, caixa_id, created_at);

CREATE INDEX IF NOT EXISTS ix_caixa_movimentacoes_tipo
  ON public.caixa_movimentacoes (empresa_id, caixa_id, tipo);

-- ------------------------------------------------------------
-- RLS: leitura da empresa; escrita só via RPC
-- ------------------------------------------------------------

ALTER TABLE public.caixas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.caixa_movimentacoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usuario_visualiza_caixas ON public.caixas;
CREATE POLICY usuario_visualiza_caixas
  ON public.caixas
  FOR SELECT
  TO authenticated
  USING (public.tem_acesso_empresa(empresa_id));

DROP POLICY IF EXISTS usuario_visualiza_caixa_movimentacoes
  ON public.caixa_movimentacoes;
CREATE POLICY usuario_visualiza_caixa_movimentacoes
  ON public.caixa_movimentacoes
  FOR SELECT
  TO authenticated
  USING (public.tem_acesso_empresa(empresa_id));

REVOKE ALL ON TABLE public.caixas FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.caixas FROM authenticated;
GRANT SELECT ON TABLE public.caixas TO authenticated;
GRANT ALL ON TABLE public.caixas TO service_role;

REVOKE ALL ON TABLE public.caixa_movimentacoes FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.caixa_movimentacoes FROM authenticated;
GRANT SELECT ON TABLE public.caixa_movimentacoes TO authenticated;
GRANT ALL ON TABLE public.caixa_movimentacoes TO service_role;

-- ------------------------------------------------------------
-- Helpers internos
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.caixa_empresa_ativa_usuario()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_usuario_id uuid := auth.uid();
  v_empresa_id uuid;
BEGIN
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  SELECT ue.empresa_id
  INTO v_empresa_id
  FROM public.usuarios_empresas AS ue
  WHERE ue.usuario_id = v_usuario_id
    AND ue.principal = true
    AND ue.ativo = true;

  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Empresa ativa não encontrada.';
  END IF;

  IF NOT public.tem_acesso_empresa(v_empresa_id) THEN
    RAISE EXCEPTION 'Usuário sem acesso à empresa.';
  END IF;

  RETURN v_empresa_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.caixa_saldo_dinheiro(
  p_empresa_id uuid,
  p_caixa_id uuid
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(m.entrada) - SUM(m.saida), 0)::numeric(14, 2)
  FROM public.caixa_movimentacoes AS m
  WHERE m.empresa_id = p_empresa_id
    AND m.caixa_id = p_caixa_id;
$function$;

CREATE OR REPLACE FUNCTION public.caixa_forma_dinheiro_id(p_empresa_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT fp.id
  FROM public.formas_pagamento AS fp
  WHERE fp.empresa_id = p_empresa_id
    AND fp.ativo = true
    AND (
      upper(btrim(COALESCE(fp.tipo, ''))) = 'DINHEIRO'
      OR upper(btrim(COALESCE(fp.codigo, ''))) IN ('DINHEIRO', '01')
    )
  ORDER BY fp.ordem NULLS LAST, fp.id
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.caixa_empresa_ativa_usuario() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.caixa_saldo_dinheiro(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.caixa_forma_dinheiro_id(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.caixa_empresa_ativa_usuario() TO service_role;
GRANT EXECUTE ON FUNCTION public.caixa_saldo_dinheiro(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.caixa_forma_dinheiro_id(uuid) TO service_role;

-- ------------------------------------------------------------
-- RPC: abrir
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_abrir_caixa(
  p_saldo_inicial numeric,
  p_observacao text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_usuario_id uuid := auth.uid();
  v_empresa_id uuid;
  v_saldo numeric(14, 2);
  v_observacao text := NULLIF(btrim(p_observacao), '');
  v_numero integer;
  v_caixa_id uuid;
  v_aberto_em timestamptz := now();
  v_forma_id uuid;
BEGIN
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  v_empresa_id := public.caixa_empresa_ativa_usuario();

  IF p_saldo_inicial IS NULL THEN
    RAISE EXCEPTION 'Informe o saldo inicial em dinheiro.';
  END IF;

  v_saldo := round(p_saldo_inicial, 2);

  IF v_saldo < 0 THEN
    RAISE EXCEPTION 'O saldo inicial não pode ser negativo.';
  END IF;

  IF v_observacao IS NOT NULL AND char_length(v_observacao) > 500 THEN
    RAISE EXCEPTION 'A observação da abertura deve ter no máximo 500 caracteres.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('caixa-abrir:' || v_empresa_id::text));

  IF EXISTS (
    SELECT 1
    FROM public.caixas AS c
    WHERE c.empresa_id = v_empresa_id
      AND c.status = 'aberto'
      AND c.filial_id IS NULL
    FOR UPDATE
  ) THEN
    RAISE EXCEPTION 'Já existe um caixa aberto para esta empresa.';
  END IF;

  SELECT COALESCE(MAX(c.numero), 0) + 1
  INTO v_numero
  FROM public.caixas AS c
  WHERE c.empresa_id = v_empresa_id;

  v_forma_id := public.caixa_forma_dinheiro_id(v_empresa_id);

  INSERT INTO public.caixas (
    empresa_id,
    filial_id,
    numero,
    usuario_abertura_id,
    saldo_inicial,
    aberto_em,
    status,
    observacao_abertura
  )
  VALUES (
    v_empresa_id,
    NULL,
    v_numero,
    v_usuario_id,
    v_saldo,
    v_aberto_em,
    'aberto',
    v_observacao
  )
  RETURNING id INTO v_caixa_id;

  INSERT INTO public.caixa_movimentacoes (
    empresa_id,
    filial_id,
    caixa_id,
    tipo,
    origem_tipo,
    origem_id,
    forma_pagamento_id,
    entrada,
    saida,
    descricao,
    usuario_id
  )
  VALUES (
    v_empresa_id,
    NULL,
    v_caixa_id,
    'abertura',
    'sessao',
    v_caixa_id,
    v_forma_id,
    v_saldo,
    0,
    CASE
      WHEN v_observacao IS NULL THEN 'Abertura de caixa'
      ELSE 'Abertura de caixa — ' || v_observacao
    END,
    v_usuario_id
  );

  RETURN jsonb_build_object(
    'ok', true,
    'caixa_id', v_caixa_id,
    'numero', v_numero,
    'saldo_inicial', v_saldo,
    'saldo_atual', v_saldo,
    'aberto_em', v_aberto_em
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Já existe um caixa aberto para esta empresa.';
END;
$function$;

-- ------------------------------------------------------------
-- RPC: suprimento / sangria
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_movimentar_caixa(
  p_caixa_id uuid,
  p_tipo text,
  p_valor numeric,
  p_motivo text,
  p_observacao text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_usuario_id uuid := auth.uid();
  v_empresa_id uuid;
  v_tipo text := lower(btrim(COALESCE(p_tipo, '')));
  v_valor numeric(14, 2);
  v_motivo text := NULLIF(btrim(p_motivo), '');
  v_observacao text := NULLIF(btrim(p_observacao), '');
  v_descricao text;
  v_caixa public.caixas%ROWTYPE;
  v_saldo numeric(14, 2);
  v_entrada numeric(14, 2) := 0;
  v_saida numeric(14, 2) := 0;
  v_forma_id uuid;
  v_mov_id uuid;
BEGIN
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  v_empresa_id := public.caixa_empresa_ativa_usuario();

  IF p_caixa_id IS NULL THEN
    RAISE EXCEPTION 'Caixa é obrigatório.';
  END IF;

  IF v_tipo NOT IN ('suprimento', 'sangria') THEN
    RAISE EXCEPTION 'Tipo de movimentação inválido nesta fase.';
  END IF;

  IF p_valor IS NULL THEN
    RAISE EXCEPTION 'Informe o valor.';
  END IF;

  v_valor := round(p_valor, 2);

  IF v_valor <= 0 THEN
    RAISE EXCEPTION 'O valor deve ser maior que zero.';
  END IF;

  IF v_motivo IS NULL OR char_length(v_motivo) < 3 THEN
    RAISE EXCEPTION 'Informe o motivo com pelo menos 3 caracteres.';
  END IF;

  IF v_observacao IS NOT NULL AND char_length(v_observacao) > 500 THEN
    RAISE EXCEPTION 'A observação deve ter no máximo 500 caracteres.';
  END IF;

  v_descricao := v_motivo;
  IF v_observacao IS NOT NULL THEN
    v_descricao := v_motivo || ' — ' || v_observacao;
  END IF;

  SELECT c.*
  INTO v_caixa
  FROM public.caixas AS c
  WHERE c.empresa_id = v_empresa_id
    AND c.id = p_caixa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caixa não encontrado.';
  END IF;

  IF v_caixa.status IS DISTINCT FROM 'aberto' THEN
    RAISE EXCEPTION 'Só é possível movimentar um caixa aberto.';
  END IF;

  v_saldo := public.caixa_saldo_dinheiro(v_empresa_id, v_caixa.id);

  IF v_tipo = 'sangria' AND v_valor > v_saldo THEN
    RAISE EXCEPTION
      'Sangria maior que o saldo atual em dinheiro (%).',
      to_char(v_saldo, 'FM999999990.00');
  END IF;

  IF v_tipo = 'suprimento' THEN
    v_entrada := v_valor;
    v_saldo := v_saldo + v_valor;
  ELSE
    v_saida := v_valor;
    v_saldo := v_saldo - v_valor;
  END IF;

  v_forma_id := public.caixa_forma_dinheiro_id(v_empresa_id);

  INSERT INTO public.caixa_movimentacoes (
    empresa_id,
    filial_id,
    caixa_id,
    tipo,
    origem_tipo,
    origem_id,
    forma_pagamento_id,
    entrada,
    saida,
    descricao,
    usuario_id
  )
  VALUES (
    v_empresa_id,
    v_caixa.filial_id,
    v_caixa.id,
    v_tipo,
    'operador',
    v_caixa.id,
    v_forma_id,
    v_entrada,
    v_saida,
    v_descricao,
    v_usuario_id
  )
  RETURNING id INTO v_mov_id;

  UPDATE public.caixas
  SET updated_at = now()
  WHERE empresa_id = v_empresa_id
    AND id = v_caixa.id;

  RETURN jsonb_build_object(
    'ok', true,
    'caixa_id', v_caixa.id,
    'movimento_id', v_mov_id,
    'tipo', v_tipo,
    'valor', v_valor,
    'saldo_atual', v_saldo
  );
END;
$function$;

-- ------------------------------------------------------------
-- RPC: fechar
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_fechar_caixa(
  p_caixa_id uuid,
  p_dinheiro_contado numeric,
  p_observacao text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_usuario_id uuid := auth.uid();
  v_empresa_id uuid;
  v_contado numeric(14, 2);
  v_observacao text := NULLIF(btrim(p_observacao), '');
  v_caixa public.caixas%ROWTYPE;
  v_esperado numeric(14, 2);
  v_diferenca numeric(14, 2);
  v_fechado_em timestamptz := now();
  v_suprimentos numeric(14, 2);
  v_sangrias numeric(14, 2);
BEGIN
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  v_empresa_id := public.caixa_empresa_ativa_usuario();

  IF p_caixa_id IS NULL THEN
    RAISE EXCEPTION 'Caixa é obrigatório.';
  END IF;

  IF p_dinheiro_contado IS NULL THEN
    RAISE EXCEPTION 'Informe o dinheiro contado.';
  END IF;

  v_contado := round(p_dinheiro_contado, 2);

  IF v_contado < 0 THEN
    RAISE EXCEPTION 'O dinheiro contado não pode ser negativo.';
  END IF;

  IF v_observacao IS NOT NULL AND char_length(v_observacao) > 500 THEN
    RAISE EXCEPTION 'A observação do fechamento deve ter no máximo 500 caracteres.';
  END IF;

  SELECT c.*
  INTO v_caixa
  FROM public.caixas AS c
  WHERE c.empresa_id = v_empresa_id
    AND c.id = p_caixa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caixa não encontrado.';
  END IF;

  IF v_caixa.status IS DISTINCT FROM 'aberto' THEN
    RAISE EXCEPTION 'Este caixa já está fechado.';
  END IF;

  SELECT
    COALESCE(SUM(m.entrada) FILTER (WHERE m.tipo = 'suprimento'), 0),
    COALESCE(SUM(m.saida) FILTER (WHERE m.tipo = 'sangria'), 0)
  INTO v_suprimentos, v_sangrias
  FROM public.caixa_movimentacoes AS m
  WHERE m.empresa_id = v_empresa_id
    AND m.caixa_id = v_caixa.id;

  v_esperado := public.caixa_saldo_dinheiro(v_empresa_id, v_caixa.id);
  v_diferenca := round(v_contado - v_esperado, 2);

  UPDATE public.caixas
  SET
    status = 'fechado',
    usuario_fechamento_id = v_usuario_id,
    fechado_em = v_fechado_em,
    dinheiro_contado = v_contado,
    diferenca = v_diferenca,
    observacao_fechamento = v_observacao,
    updated_at = now()
  WHERE empresa_id = v_empresa_id
    AND id = v_caixa.id
    AND status = 'aberto';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Não foi possível fechar o caixa.';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'caixa_id', v_caixa.id,
    'saldo_inicial', v_caixa.saldo_inicial,
    'suprimentos', v_suprimentos,
    'sangrias', v_sangrias,
    'saldo_esperado', v_esperado,
    'dinheiro_contado', v_contado,
    'diferenca', v_diferenca,
    'fechado_em', v_fechado_em
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_abrir_caixa(numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_movimentar_caixa(uuid, text, numeric, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_fechar_caixa(uuid, numeric, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.rpc_abrir_caixa(numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_abrir_caixa(numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rpc_movimentar_caixa(uuid, text, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_movimentar_caixa(uuid, text, numeric, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rpc_fechar_caixa(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_fechar_caixa(uuid, numeric, text) TO service_role;

COMMENT ON FUNCTION public.rpc_abrir_caixa(numeric, text) IS
  'Abre sessão de caixa da empresa ativa do usuário. Não confia em empresa_id do cliente.';
COMMENT ON FUNCTION public.rpc_movimentar_caixa(uuid, text, numeric, text, text) IS
  'Registra suprimento ou sangria de forma atômica. Sangria não pode exceder o saldo derivado.';
COMMENT ON FUNCTION public.rpc_fechar_caixa(uuid, numeric, text) IS
  'Fecha a sessão preservando movimentações. Diferença é snapshot, não corrige o livro.';

NOTIFY pgrst, 'reload schema';

COMMIT;
