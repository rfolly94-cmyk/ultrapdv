BEGIN;

-- ============================================================
-- UltraPDV — Catálogo Online multiempresa
-- Data: 2026-08-16
--
-- O catálogo é um canal de entrada de pedidos.
-- Não cria venda, não baixa estoque, não movimenta caixa,
-- carteira ou fiscal. A venda só nasce no PDV existente.
--
-- Dono do catálogo: public.empresas (CNPJ fiscal).
-- Não existe tabela de filiais nesta arquitetura.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Campos de publicação no produto
-- ------------------------------------------------------------

ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS catalogo_publicado boolean NOT NULL DEFAULT false;

ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS catalogo_descricao text;

ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS catalogo_destaque boolean NOT NULL DEFAULT false;

ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS catalogo_mostrar_preco boolean NOT NULL DEFAULT true;

ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS catalogo_imagem_path text;

COMMENT ON COLUMN public.produtos.catalogo_publicado IS
  'Se true e o produto estiver ativo, pode aparecer no catálogo público da empresa.';

COMMENT ON COLUMN public.produtos.catalogo_descricao IS
  'Texto comercial público. Não substitui a descrição interna.';

COMMENT ON COLUMN public.produtos.catalogo_imagem_path IS
  'Caminho no bucket Storage catalogo. Nunca armazenar base64.';

CREATE INDEX IF NOT EXISTS ix_produtos_catalogo_empresa
  ON public.produtos (empresa_id, catalogo_publicado, ativo)
  WHERE catalogo_publicado = true;

-- ------------------------------------------------------------
-- 2. Configuração do catálogo (1:1 com empresa / CNPJ)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.catalogo_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  ativo boolean NOT NULL DEFAULT false,
  nome_exibido text NOT NULL,
  slug text NOT NULL,
  descricao text,
  logo_path text,
  banner_path text,
  whatsapp_numero text,
  whatsapp_mensagem text,
  permitir_pedido boolean NOT NULL DEFAULT true,
  permitir_whatsapp boolean NOT NULL DEFAULT true,
  produto_sem_estoque text NOT NULL DEFAULT 'mostrar_esgotado',
  permitir_retirada boolean NOT NULL DEFAULT true,
  permitir_entrega boolean NOT NULL DEFAULT false,
  info_entrega text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalogo_config_empresa_unique UNIQUE (empresa_id),
  CONSTRAINT catalogo_config_slug_unique UNIQUE (slug),
  CONSTRAINT catalogo_config_slug_check
    CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' AND char_length(slug) BETWEEN 2 AND 48),
  CONSTRAINT catalogo_config_nome_check
    CHECK (char_length(btrim(nome_exibido)) BETWEEN 2 AND 80),
  CONSTRAINT catalogo_config_whatsapp_formato_check
    CHECK (
      whatsapp_numero IS NULL
      OR whatsapp_numero ~ '^[0-9]{10,15}$'
    ),
  CONSTRAINT catalogo_config_whatsapp_obrigatorio_check
    CHECK (NOT permitir_whatsapp OR whatsapp_numero IS NOT NULL),
  CONSTRAINT catalogo_config_finalizacao_check
    CHECK (NOT ativo OR permitir_pedido OR permitir_whatsapp),
  CONSTRAINT catalogo_config_estoque_check
    CHECK (produto_sem_estoque IN ('mostrar_esgotado', 'ocultar')),
  CONSTRAINT catalogo_config_entrega_check
    CHECK (permitir_retirada OR permitir_entrega)
);

CREATE INDEX IF NOT EXISTS ix_catalogo_config_slug
  ON public.catalogo_config (slug);

COMMENT ON TABLE public.catalogo_config IS
  'Configuração pública do catálogo por empresa (CNPJ). Slug único, nunca CNPJ na URL.';

-- ------------------------------------------------------------
-- 3. Pedidos online (não são vendas)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.catalogo_pedidos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  codigo integer NOT NULL,
  cliente_nome text NOT NULL,
  cliente_whatsapp text NOT NULL,
  tipo_entrega text NOT NULL,
  cep text,
  rua text,
  numero text,
  bairro text,
  complemento text,
  cidade text,
  referencia text,
  observacao text,
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'NOVO',
  venda_id uuid REFERENCES public.vendas(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalogo_pedidos_empresa_codigo_unique UNIQUE (empresa_id, codigo),
  CONSTRAINT catalogo_pedidos_status_check
    CHECK (status IN ('NOVO', 'EM_ATENDIMENTO', 'ACEITO', 'CONVERTIDO', 'CANCELADO')),
  CONSTRAINT catalogo_pedidos_tipo_check
    CHECK (tipo_entrega IN ('retirada', 'entrega')),
  CONSTRAINT catalogo_pedidos_nome_check
    CHECK (char_length(btrim(cliente_nome)) BETWEEN 2 AND 80),
  CONSTRAINT catalogo_pedidos_whatsapp_check
    CHECK (cliente_whatsapp ~ '^[0-9]{10,15}$'),
  CONSTRAINT catalogo_pedidos_valores_check
    CHECK (subtotal >= 0 AND total >= 0)
);

CREATE INDEX IF NOT EXISTS ix_catalogo_pedidos_empresa_data
  ON public.catalogo_pedidos (empresa_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_catalogo_pedidos_empresa_status
  ON public.catalogo_pedidos (empresa_id, status);

CREATE TABLE IF NOT EXISTS public.catalogo_pedido_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id uuid NOT NULL REFERENCES public.catalogo_pedidos(id) ON DELETE CASCADE,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  produto_id uuid REFERENCES public.produtos(id) ON DELETE SET NULL,
  codigo_produto text NOT NULL,
  nome_produto text NOT NULL,
  quantidade numeric(14,4) NOT NULL,
  preco_unitario numeric(14,2) NOT NULL,
  subtotal numeric(14,2) NOT NULL,
  CONSTRAINT catalogo_pedido_itens_qtd_check
    CHECK (quantidade > 0 AND quantidade <= 99),
  CONSTRAINT catalogo_pedido_itens_preco_check
    CHECK (preco_unitario >= 0 AND subtotal >= 0)
);

CREATE INDEX IF NOT EXISTS ix_catalogo_pedido_itens_pedido
  ON public.catalogo_pedido_itens (pedido_id);

COMMENT ON TABLE public.catalogo_pedidos IS
  'Pedido originado do catálogo público. Não movimenta estoque, caixa, carteira nem fiscal.';

COMMENT ON TABLE public.catalogo_pedido_itens IS
  'Snapshot dos itens no momento do pedido. Preço e nome ficam congelados.';

-- ------------------------------------------------------------
-- 4. RLS administrativo (empresa via usuarios_empresas)
-- ------------------------------------------------------------

ALTER TABLE public.catalogo_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_pedido_itens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS catalogo_config_select_empresa ON public.catalogo_config;
DROP POLICY IF EXISTS catalogo_config_insert_empresa ON public.catalogo_config;
DROP POLICY IF EXISTS catalogo_config_update_empresa ON public.catalogo_config;
DROP POLICY IF EXISTS catalogo_pedidos_select_empresa ON public.catalogo_pedidos;
DROP POLICY IF EXISTS catalogo_pedidos_update_empresa ON public.catalogo_pedidos;
DROP POLICY IF EXISTS catalogo_pedido_itens_select_empresa ON public.catalogo_pedido_itens;

CREATE POLICY catalogo_config_select_empresa
ON public.catalogo_config
FOR SELECT
TO authenticated
USING (public.tem_acesso_empresa(empresa_id));

CREATE POLICY catalogo_config_insert_empresa
ON public.catalogo_config
FOR INSERT
TO authenticated
WITH CHECK (public.tem_acesso_empresa(empresa_id));

CREATE POLICY catalogo_config_update_empresa
ON public.catalogo_config
FOR UPDATE
TO authenticated
USING (public.tem_acesso_empresa(empresa_id))
WITH CHECK (public.tem_acesso_empresa(empresa_id));

CREATE POLICY catalogo_pedidos_select_empresa
ON public.catalogo_pedidos
FOR SELECT
TO authenticated
USING (public.tem_acesso_empresa(empresa_id));

CREATE POLICY catalogo_pedidos_update_empresa
ON public.catalogo_pedidos
FOR UPDATE
TO authenticated
USING (public.tem_acesso_empresa(empresa_id))
WITH CHECK (public.tem_acesso_empresa(empresa_id));

CREATE POLICY catalogo_pedido_itens_select_empresa
ON public.catalogo_pedido_itens
FOR SELECT
TO authenticated
USING (public.tem_acesso_empresa(empresa_id));

REVOKE INSERT, UPDATE, DELETE
ON public.catalogo_pedidos
FROM anon;

REVOKE INSERT, UPDATE, DELETE
ON public.catalogo_pedido_itens
FROM anon;

REVOKE ALL
ON public.catalogo_config
FROM anon;

GRANT SELECT, INSERT, UPDATE
ON public.catalogo_config
TO authenticated;

GRANT SELECT, UPDATE
ON public.catalogo_pedidos
TO authenticated;

GRANT SELECT
ON public.catalogo_pedido_itens
TO authenticated;

-- Inserção pública de pedido somente via RPC SECURITY DEFINER.
REVOKE INSERT
ON public.catalogo_pedidos
FROM authenticated;

REVOKE INSERT
ON public.catalogo_pedido_itens
FROM authenticated;

-- ------------------------------------------------------------
-- 5. RPC pública: ler catálogo (sem custo, fiscal ou empresa_id)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_catalogo_publico(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_config public.catalogo_config%ROWTYPE;
  v_produtos jsonb;
  v_categorias jsonb;
BEGIN
  IF v_slug = '' OR v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' THEN
    RETURN jsonb_build_object('status', 'nao_encontrado');
  END IF;

  SELECT *
  INTO v_config
  FROM public.catalogo_config AS c
  WHERE c.slug = v_slug;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'nao_encontrado');
  END IF;

  IF NOT v_config.ativo THEN
    RETURN jsonb_build_object(
      'status', 'inativo',
      'loja', jsonb_build_object(
        'nome_exibido', v_config.nome_exibido,
        'slug', v_config.slug
      )
    );
  END IF;

  SELECT coalesce(jsonb_agg(item ORDER BY item->>'destaque' DESC, item->>'nome'), '[]'::jsonb)
  INTO v_produtos
  FROM (
    SELECT jsonb_build_object(
      'id', p.id,
      'codigo', p.codigo,
      'nome', p.nome,
      'descricao_catalogo', p.catalogo_descricao,
      'imagem', p.catalogo_imagem_path,
      'categoria', cat.nome,
      'categoria_id', p.categoria_id,
      'marca', mar.nome,
      'preco', CASE
        WHEN p.catalogo_mostrar_preco THEN round(coalesce(p.preco_venda, 0), 2)
        ELSE NULL
      END,
      'mostrar_preco', p.catalogo_mostrar_preco,
      'disponibilidade', CASE
        WHEN coalesce(ea.quantidade, 0) > 0
          AND coalesce(ea.quantidade, 0) <= 3 THEN 'ultimas'
        WHEN coalesce(ea.quantidade, 0) > 0 THEN 'disponivel'
        ELSE 'esgotado'
      END,
      'destaque', p.catalogo_destaque
    ) AS item
    FROM public.produtos AS p
    LEFT JOIN public.categorias AS cat
      ON cat.id = p.categoria_id
     AND cat.empresa_id = p.empresa_id
    LEFT JOIN public.marcas AS mar
      ON mar.id = p.marca_id
     AND mar.empresa_id = p.empresa_id
    LEFT JOIN public.estoque_atual AS ea
      ON ea.produto_id = p.id
     AND ea.empresa_id = p.empresa_id
    WHERE p.empresa_id = v_config.empresa_id
      AND p.ativo = true
      AND p.catalogo_publicado = true
      AND (
        v_config.produto_sem_estoque = 'mostrar_esgotado'
        OR coalesce(ea.quantidade, 0) > 0
      )
    ORDER BY p.catalogo_destaque DESC, p.nome
    LIMIT 500
  ) AS produtos_visiveis;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', categoria_id,
    'nome', categoria
  ) ORDER BY categoria), '[]'::jsonb)
  INTO v_categorias
  FROM (
    SELECT DISTINCT
      (item->>'categoria_id')::uuid AS categoria_id,
      item->>'categoria' AS categoria
    FROM jsonb_array_elements(v_produtos) AS item
    WHERE item->>'categoria_id' IS NOT NULL
      AND item->>'categoria' IS NOT NULL
  ) AS cats;

  RETURN jsonb_build_object(
    'status', 'ok',
    'loja', jsonb_build_object(
      'nome_exibido', v_config.nome_exibido,
      'slug', v_config.slug,
      'descricao', v_config.descricao,
      'logo', v_config.logo_path,
      'banner', v_config.banner_path,
      'whatsapp_numero', v_config.whatsapp_numero,
      'whatsapp_mensagem', v_config.whatsapp_mensagem,
      'permitir_pedido', v_config.permitir_pedido,
      'permitir_whatsapp', v_config.permitir_whatsapp,
      'produto_sem_estoque', v_config.produto_sem_estoque,
      'permitir_retirada', v_config.permitir_retirada,
      'permitir_entrega', v_config.permitir_entrega,
      'info_entrega', v_config.info_entrega
    ),
    'produtos', v_produtos,
    'categorias', v_categorias
  );
END;
$$;

-- ------------------------------------------------------------
-- 6. RPC pública: criar pedido (preço e estoque no servidor)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_catalogo_criar_pedido(
  p_slug text,
  p_cliente_nome text,
  p_cliente_whatsapp text,
  p_tipo_entrega text,
  p_cep text DEFAULT NULL,
  p_rua text DEFAULT NULL,
  p_numero text DEFAULT NULL,
  p_bairro text DEFAULT NULL,
  p_complemento text DEFAULT NULL,
  p_cidade text DEFAULT NULL,
  p_referencia text DEFAULT NULL,
  p_observacao text DEFAULT NULL,
  p_itens jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_config public.catalogo_config%ROWTYPE;
  v_nome text := btrim(coalesce(p_cliente_nome, ''));
  v_whatsapp text := regexp_replace(coalesce(p_cliente_whatsapp, ''), '[^0-9]', '', 'g');
  v_tipo text := lower(btrim(coalesce(p_tipo_entrega, '')));
  v_obs text := nullif(btrim(coalesce(p_observacao, '')), '');
  v_item jsonb;
  v_produto_id uuid;
  v_quantidade numeric(14,4);
  v_produto record;
  v_estoque numeric(14,4);
  v_preco numeric(14,2);
  v_subtotal_item numeric(14,2);
  v_subtotal numeric(14,2) := 0;
  v_codigo integer;
  v_pedido_id uuid;
  v_itens_count integer := 0;
BEGIN
  IF v_slug = '' OR v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'Catálogo não encontrado.';
  END IF;

  SELECT *
  INTO v_config
  FROM public.catalogo_config AS c
  WHERE c.slug = v_slug
  FOR UPDATE;

  IF NOT FOUND OR NOT v_config.ativo THEN
    RAISE EXCEPTION 'Catálogo indisponível.';
  END IF;

  IF NOT v_config.permitir_pedido THEN
    RAISE EXCEPTION 'Esta loja não aceita pedido pelo catálogo.';
  END IF;

  IF char_length(v_nome) < 2 OR char_length(v_nome) > 80 THEN
    RAISE EXCEPTION 'Informe o nome do cliente.';
  END IF;

  IF v_whatsapp !~ '^[0-9]{10,15}$' THEN
    RAISE EXCEPTION 'Informe um WhatsApp válido.';
  END IF;

  IF v_tipo NOT IN ('retirada', 'entrega') THEN
    RAISE EXCEPTION 'Informe o tipo de entrega.';
  END IF;

  IF v_tipo = 'retirada' AND NOT v_config.permitir_retirada THEN
    RAISE EXCEPTION 'Retirada não está disponível.';
  END IF;

  IF v_tipo = 'entrega' AND NOT v_config.permitir_entrega THEN
    RAISE EXCEPTION 'Entrega não está disponível.';
  END IF;

  IF v_obs IS NOT NULL AND char_length(v_obs) > 500 THEN
    RAISE EXCEPTION 'A observação deve ter no máximo 500 caracteres.';
  END IF;

  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' THEN
    RAISE EXCEPTION 'Informe os itens do pedido.';
  END IF;

  IF jsonb_array_length(p_itens) < 1 THEN
    RAISE EXCEPTION 'O pedido precisa ter pelo menos um item.';
  END IF;

  IF jsonb_array_length(p_itens) > 30 THEN
    RAISE EXCEPTION 'O pedido ultrapassou o limite de itens.';
  END IF;

  IF (
    SELECT count(*)
    FROM public.catalogo_pedidos AS cp
    WHERE cp.empresa_id = v_config.empresa_id
      AND cp.cliente_whatsapp = v_whatsapp
      AND cp.created_at > now() - interval '2 minutes'
  ) >= 3 THEN
    RAISE EXCEPTION 'Aguarde alguns minutos antes de enviar outro pedido.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('ultrapdv:catalogo:pedido:' || v_config.empresa_id::text)::bigint
  );

  -- Valida itens e recalcula preços no servidor.
  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_itens)
  LOOP
    v_itens_count := v_itens_count + 1;

    BEGIN
      v_produto_id := (v_item->>'produto_id')::uuid;
    EXCEPTION
      WHEN others THEN
        RAISE EXCEPTION 'Item inválido.';
    END;

    BEGIN
      v_quantidade := (v_item->>'quantidade')::numeric;
    EXCEPTION
      WHEN others THEN
        RAISE EXCEPTION 'Quantidade inválida.';
    END;

    IF v_produto_id IS NULL THEN
      RAISE EXCEPTION 'Item inválido.';
    END IF;

    IF v_quantidade IS NULL OR v_quantidade <= 0 OR v_quantidade > 99 THEN
      RAISE EXCEPTION 'Quantidade inválida.';
    END IF;

    SELECT
      p.id,
      p.codigo,
      p.nome,
      p.preco_venda,
      p.catalogo_mostrar_preco,
      p.catalogo_publicado,
      p.ativo
    INTO v_produto
    FROM public.produtos AS p
    WHERE p.id = v_produto_id
      AND p.empresa_id = v_config.empresa_id;

    IF NOT FOUND OR NOT v_produto.ativo OR NOT v_produto.catalogo_publicado THEN
      RAISE EXCEPTION 'Um ou mais produtos não estão disponíveis.';
    END IF;

    IF NOT v_produto.catalogo_mostrar_preco THEN
      RAISE EXCEPTION
        'O produto % precisa ser consultado pelo WhatsApp.',
        v_produto.nome;
    END IF;

    SELECT coalesce(ea.quantidade, 0)
    INTO v_estoque
    FROM public.estoque_atual AS ea
    WHERE ea.empresa_id = v_config.empresa_id
      AND ea.produto_id = v_produto.id;

    IF coalesce(v_estoque, 0) < v_quantidade THEN
      RAISE EXCEPTION
        'Estoque insuficiente para %.',
        v_produto.nome;
    END IF;

    -- Ignora qualquer preço enviado pelo navegador.
    v_preco := round(coalesce(v_produto.preco_venda, 0), 2);
    v_subtotal_item := round(v_preco * v_quantidade, 2);
    v_subtotal := v_subtotal + v_subtotal_item;
  END LOOP;

  SELECT coalesce(max(cp.codigo), 0) + 1
  INTO v_codigo
  FROM public.catalogo_pedidos AS cp
  WHERE cp.empresa_id = v_config.empresa_id;

  INSERT INTO public.catalogo_pedidos (
    empresa_id,
    codigo,
    cliente_nome,
    cliente_whatsapp,
    tipo_entrega,
    cep,
    rua,
    numero,
    bairro,
    complemento,
    cidade,
    referencia,
    observacao,
    subtotal,
    total,
    status
  )
  VALUES (
    v_config.empresa_id,
    v_codigo,
    v_nome,
    v_whatsapp,
    v_tipo,
    nullif(btrim(coalesce(p_cep, '')), ''),
    nullif(btrim(coalesce(p_rua, '')), ''),
    nullif(btrim(coalesce(p_numero, '')), ''),
    nullif(btrim(coalesce(p_bairro, '')), ''),
    nullif(btrim(coalesce(p_complemento, '')), ''),
    nullif(btrim(coalesce(p_cidade, '')), ''),
    nullif(btrim(coalesce(p_referencia, '')), ''),
    v_obs,
    v_subtotal,
    v_subtotal,
    'NOVO'
  )
  RETURNING id INTO v_pedido_id;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_itens)
  LOOP
    v_produto_id := (v_item->>'produto_id')::uuid;
    v_quantidade := (v_item->>'quantidade')::numeric;

    SELECT
      p.id,
      p.codigo,
      p.nome,
      p.preco_venda
    INTO v_produto
    FROM public.produtos AS p
    WHERE p.id = v_produto_id
      AND p.empresa_id = v_config.empresa_id;

    v_preco := round(coalesce(v_produto.preco_venda, 0), 2);
    v_subtotal_item := round(v_preco * v_quantidade, 2);

    INSERT INTO public.catalogo_pedido_itens (
      pedido_id,
      empresa_id,
      produto_id,
      codigo_produto,
      nome_produto,
      quantidade,
      preco_unitario,
      subtotal
    )
    VALUES (
      v_pedido_id,
      v_config.empresa_id,
      v_produto.id,
      v_produto.codigo,
      v_produto.nome,
      v_quantidade,
      v_preco,
      v_subtotal_item
    );
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'pedido_id', v_pedido_id,
    'codigo', v_codigo,
    'total', v_subtotal
  );
END;
$$;

REVOKE ALL
ON FUNCTION public.rpc_catalogo_publico(text)
FROM PUBLIC;

REVOKE ALL
ON FUNCTION public.rpc_catalogo_criar_pedido(
  text, text, text, text, text, text, text, text, text, text, text, text, jsonb
)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.rpc_catalogo_publico(text)
TO anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.rpc_catalogo_criar_pedido(
  text, text, text, text, text, text, text, text, text, text, text, text, jsonb
)
TO anon, authenticated;

-- ------------------------------------------------------------
-- 7. Storage — bucket público de imagens do catálogo
-- ------------------------------------------------------------

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'catalogo',
  'catalogo',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

DROP POLICY IF EXISTS catalogo_imagens_select_publico ON storage.objects;
DROP POLICY IF EXISTS catalogo_imagens_insert_empresa ON storage.objects;
DROP POLICY IF EXISTS catalogo_imagens_update_empresa ON storage.objects;
DROP POLICY IF EXISTS catalogo_imagens_delete_empresa ON storage.objects;

CREATE POLICY catalogo_imagens_select_publico
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'catalogo');

CREATE POLICY catalogo_imagens_insert_empresa
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'catalogo'
  AND EXISTS (
    SELECT 1
    FROM public.usuarios_empresas AS ue
    WHERE ue.usuario_id = auth.uid()
      AND ue.ativo = true
      AND ue.empresa_id::text = (storage.foldername(name))[1]
  )
);

CREATE POLICY catalogo_imagens_update_empresa
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'catalogo'
  AND EXISTS (
    SELECT 1
    FROM public.usuarios_empresas AS ue
    WHERE ue.usuario_id = auth.uid()
      AND ue.ativo = true
      AND ue.empresa_id::text = (storage.foldername(name))[1]
  )
)
WITH CHECK (
  bucket_id = 'catalogo'
  AND EXISTS (
    SELECT 1
    FROM public.usuarios_empresas AS ue
    WHERE ue.usuario_id = auth.uid()
      AND ue.ativo = true
      AND ue.empresa_id::text = (storage.foldername(name))[1]
  )
);

CREATE POLICY catalogo_imagens_delete_empresa
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'catalogo'
  AND EXISTS (
    SELECT 1
    FROM public.usuarios_empresas AS ue
    WHERE ue.usuario_id = auth.uid()
      AND ue.ativo = true
      AND ue.empresa_id::text = (storage.foldername(name))[1]
  )
);

NOTIFY pgrst, 'reload schema';

COMMIT;
