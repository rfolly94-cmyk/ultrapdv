begin;

-- ============================================================
-- UltraPDV — Corrigir ambiguidade de status nas RPCs de entrada
-- Data: 2026-08-17
--
-- Erro:
--   column reference "status" is ambiguous
--
-- Causa:
--   RETURNS TABLE declara status como variável PL/pgSQL.
--   UPDATE/INSERT sem alias colidem com esse nome ao
--   vincular produto, atualizar o documento e confirmar
--   a entrada.
-- ============================================================

create or replace function public.rpc_confirmar_entrada_nfe(
  p_empresa_id uuid,
  p_documento_id uuid
)
returns table (
  documento_id uuid,
  status text,
  itens_movimentados integer,
  quantidade_total numeric
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_usuario uuid;
  v_doc public.fiscal_documentos_entrada%rowtype;
  v_item record;
  v_anterior numeric(14,4);
  v_atual numeric(14,4);
  v_movimentados integer := 0;
  v_quantidade numeric(14,4) := 0;
  v_pendente integer;
begin
  v_usuario := auth.uid();
  if v_usuario is null then
    raise exception 'Usuário não autenticado.';
  end if;

  if not public.tem_acesso_empresa(p_empresa_id) then
    raise exception 'Usuário sem acesso à empresa.';
  end if;

  select d.*
    into v_doc
  from public.fiscal_documentos_entrada d
  where d.id = p_documento_id
    and d.empresa_id = p_empresa_id
  for update;

  if not found then
    raise exception 'Documento de entrada não encontrado nesta empresa.';
  end if;

  if v_doc.status = 'entrada_concluida' then
    raise exception 'Esta NF-e já teve a entrada de estoque processada.';
  end if;

  if v_doc.status = 'cancelada' then
    raise exception 'Documento de entrada cancelado.';
  end if;

  if v_doc.status = 'processando_entrada' then
    if exists (
      select 1
      from public.estoque_movimentacoes em
      where em.empresa_id = p_empresa_id
        and em.documento_entrada_id = p_documento_id
    ) then
      raise exception 'Esta NF-e já teve a entrada de estoque processada.';
    end if;
  end if;

  select count(*)
    into v_pendente
  from public.fiscal_documentos_entrada_itens i
  where i.empresa_id = p_empresa_id
    and i.documento_entrada_id = p_documento_id
    and i.quantidade_recebida > 0
    and i.produto_id is null;

  if coalesce(v_pendente, 0) > 0 then
    raise exception 'Vincule todos os itens com quantidade recebida a um produto da empresa ativa.';
  end if;

  if not exists (
    select 1
    from public.fiscal_documentos_entrada_itens i
    where i.empresa_id = p_empresa_id
      and i.documento_entrada_id = p_documento_id
      and i.quantidade_recebida > 0
      and i.produto_id is not null
  ) then
    raise exception 'Nenhum item com quantidade recebida para entrar no estoque.';
  end if;

  update public.fiscal_documentos_entrada as d
  set status = 'processando_entrada'
  where d.id = p_documento_id
    and d.empresa_id = p_empresa_id
    and d.status is distinct from 'entrada_concluida';

  for v_item in
    select i.*
    from public.fiscal_documentos_entrada_itens i
    where i.empresa_id = p_empresa_id
      and i.documento_entrada_id = p_documento_id
      and i.quantidade_recebida > 0
    order by i.numero_item
    for update
  loop
    if v_item.produto_id is null then
      raise exception 'Item % sem produto vinculado.', v_item.numero_item;
    end if;

    if not exists (
      select 1
      from public.produtos p
      where p.id = v_item.produto_id
        and p.empresa_id = p_empresa_id
    ) then
      raise exception 'Produto do item % não pertence à empresa ativa.', v_item.numero_item;
    end if;

    if exists (
      select 1
      from public.estoque_movimentacoes em
      where em.empresa_id = p_empresa_id
        and em.documento_entrada_item_id = v_item.id
    ) then
      raise exception 'Esta NF-e já teve a entrada de estoque processada.';
    end if;

    insert into public.estoque_atual (
      empresa_id,
      produto_id,
      quantidade,
      estoque_minimo
    )
    values (
      p_empresa_id,
      v_item.produto_id,
      0,
      0
    )
    on conflict (empresa_id, produto_id)
    do nothing;

    select ea.quantidade
      into v_anterior
    from public.estoque_atual ea
    where ea.empresa_id = p_empresa_id
      and ea.produto_id = v_item.produto_id
    for update;

    v_atual := v_anterior + v_item.quantidade_recebida;

    update public.estoque_atual
    set quantidade = v_atual
    where empresa_id = p_empresa_id
      and produto_id = v_item.produto_id;

    insert into public.estoque_movimentacoes (
      empresa_id,
      produto_id,
      usuario_id,
      tipo,
      origem,
      quantidade,
      saldo_anterior,
      saldo_posterior,
      observacao,
      documento_entrada_id,
      documento_entrada_item_id
    )
    values (
      p_empresa_id,
      v_item.produto_id,
      v_usuario,
      'ENTRADA',
      'NFE_ENTRADA',
      v_item.quantidade_recebida,
      v_anterior,
      v_atual,
      'Entrada pela NF-e ' || v_doc.numero,
      p_documento_id,
      v_item.id
    );

    update public.fiscal_documentos_entrada_itens
    set quantidade_entrada_efetivada = v_item.quantidade_recebida
    where id = v_item.id
      and empresa_id = p_empresa_id;

    v_movimentados := v_movimentados + 1;
    v_quantidade := v_quantidade + v_item.quantidade_recebida;
  end loop;

  update public.fiscal_documentos_entrada as d
  set
    status = 'entrada_concluida',
    data_entrada = now(),
    entrada_estoque_processada_at = now(),
    entrada_estoque_processada_por = v_usuario
  where d.id = p_documento_id
    and d.empresa_id = p_empresa_id;

  return query
  select
    p_documento_id,
    'entrada_concluida'::text,
    v_movimentados,
    v_quantidade;
end;
$$;

create or replace function public.rpc_importar_documento_entrada(
  p_empresa_id uuid,
  p_xml text,
  p_payload jsonb
)
returns table (
  documento_id uuid,
  ja_existia boolean,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_usuario uuid;
  v_chave text;
  v_chave_payload text;
  v_doc_id uuid;
  v_status text;
  v_fornecedor uuid;
  v_cnpj_emitente text;
  v_item jsonb;
  v_qtd numeric(14,4);
begin
  v_usuario := auth.uid();
  if v_usuario is null then
    raise exception 'Usuário não autenticado.';
  end if;

  if not public.tem_acesso_empresa(p_empresa_id) then
    raise exception 'Usuário sem acesso à empresa.';
  end if;

  if p_xml is null or char_length(p_xml) < 20 then
    raise exception 'O arquivo não é um XML de NF-e válido.';
  end if;

  if char_length(p_xml) > 5000000 then
    raise exception 'O XML da NF-e excede o tamanho máximo permitido.';
  end if;

  v_chave := substring(p_xml from 'Id[[:space:]]*=[[:space:]]*"NFe([0-9]{44})"');
  if v_chave is null or length(v_chave) <> 44 then
    v_chave := substring(p_xml from 'chNFe>([0-9]{44})</');
  end if;

  v_chave_payload := regexp_replace(coalesce(p_payload->>'chaveAcesso', ''), '\D', '', 'g');
  if v_chave is null or length(v_chave) <> 44 then
    v_chave := v_chave_payload;
  end if;

  if v_chave is null or length(v_chave) <> 44 then
    raise exception 'A NF-e não possui chave de acesso de 44 dígitos.';
  end if;

  if v_chave_payload <> '' and v_chave_payload is distinct from v_chave then
    raise exception 'A chave da NF-e não confere com o XML.';
  end if;

  select d.id, d.status
    into v_doc_id, v_status
  from public.fiscal_documentos_entrada d
  where d.empresa_id = p_empresa_id
    and d.chave_acesso = v_chave;

  if found then
    return query select v_doc_id, true, v_status;
    return;
  end if;

  v_cnpj_emitente := regexp_replace(coalesce(p_payload->>'cnpjEmitente', ''), '\D', '', 'g');
  if length(v_cnpj_emitente) <> 14 then
    raise exception 'A NF-e não possui CNPJ do emitente.';
  end if;

  if coalesce(p_payload->>'modelo', '55') is distinct from '55' then
    raise exception 'Somente NF-e modelo 55 pode ser importada como nota de entrada nesta etapa.';
  end if;

  if jsonb_typeof(p_payload->'itens') is distinct from 'array'
     or jsonb_array_length(p_payload->'itens') < 1 then
    raise exception 'A NF-e não possui itens.';
  end if;

  insert into public.fornecedores (
    empresa_id,
    cnpj,
    razao_social,
    inscricao_estadual
  )
  values (
    p_empresa_id,
    v_cnpj_emitente,
    left(btrim(coalesce(p_payload->>'razaoSocialEmitente', 'Fornecedor')), 120),
    nullif(btrim(coalesce(p_payload->>'ieEmitente', '')), '')
  )
  on conflict (empresa_id, cnpj)
  do update set updated_at = now()
  returning id into v_fornecedor;

  insert into public.fiscal_documentos_entrada (
    empresa_id,
    fornecedor_id,
    chave_acesso,
    modelo,
    serie,
    numero,
    data_emissao,
    cnpj_emitente,
    razao_social_emitente,
    ie_emitente,
    cnpj_destinatario,
    valor_produtos,
    valor_total,
    protocolo,
    status,
    origem,
    xml_original,
    importado_por
  )
  values (
    p_empresa_id,
    v_fornecedor,
    v_chave,
    coalesce(nullif(btrim(p_payload->>'modelo'), ''), '55'),
    coalesce(nullif(btrim(p_payload->>'serie'), ''), '1'),
    coalesce(nullif(btrim(p_payload->>'numero'), ''), '0'),
    nullif(p_payload->>'dataEmissao', '')::timestamptz,
    v_cnpj_emitente,
    left(btrim(coalesce(p_payload->>'razaoSocialEmitente', 'Fornecedor')), 120),
    nullif(btrim(coalesce(p_payload->>'ieEmitente', '')), ''),
    nullif(regexp_replace(coalesce(p_payload->>'cnpjDestinatario', ''), '\D', '', 'g'), ''),
    coalesce((p_payload->>'valorProdutos')::numeric, 0),
    coalesce((p_payload->>'valorTotal')::numeric, 0),
    nullif(btrim(coalesce(p_payload->>'protocolo', '')), ''),
    'aguardando_vinculacao',
    'xml_upload',
    p_xml,
    v_usuario
  )
  on conflict (empresa_id, chave_acesso)
  do nothing
  returning id into v_doc_id;

  if v_doc_id is null then
    select d.id, d.status
      into v_doc_id, v_status
    from public.fiscal_documentos_entrada d
    where d.empresa_id = p_empresa_id
      and d.chave_acesso = v_chave;
    return query select v_doc_id, true, coalesce(v_status, 'aguardando_vinculacao');
    return;
  end if;

  for v_item in
    select * from jsonb_array_elements(p_payload->'itens')
  loop
    v_qtd := coalesce((v_item->>'quantidade')::numeric, 0);
    if v_qtd < 0 then
      raise exception 'Quantidade do item não pode ser negativa.';
    end if;

    insert into public.fiscal_documentos_entrada_itens (
      empresa_id,
      documento_entrada_id,
      numero_item,
      codigo_fornecedor,
      descricao_original,
      ean,
      ncm,
      cest,
      cfop_original,
      unidade,
      quantidade_xml,
      quantidade_recebida,
      valor_unitario,
      valor_total,
      desconto,
      dados_fiscais_original
    )
    values (
      p_empresa_id,
      v_doc_id,
      coalesce((v_item->>'numeroItem')::integer, 0),
      nullif(btrim(coalesce(v_item->>'codigoFornecedor', '')), ''),
      left(btrim(coalesce(v_item->>'descricao', 'Item sem descrição')), 500),
      nullif(regexp_replace(coalesce(v_item->>'ean', ''), '\D', '', 'g'), ''),
      nullif(regexp_replace(coalesce(v_item->>'ncm', ''), '\D', '', 'g'), ''),
      nullif(regexp_replace(coalesce(v_item->>'cest', ''), '\D', '', 'g'), ''),
      nullif(regexp_replace(coalesce(v_item->>'cfop', ''), '\D', '', 'g'), ''),
      nullif(upper(btrim(coalesce(v_item->>'unidade', ''))), ''),
      v_qtd,
      v_qtd,
      coalesce((v_item->>'valorUnitario')::numeric, 0),
      coalesce((v_item->>'valorTotal')::numeric, 0),
      coalesce((v_item->>'desconto')::numeric, 0),
      coalesce(v_item->'dadosFiscais', '{}'::jsonb)
    );
  end loop;

  return query
  select v_doc_id, false, 'aguardando_vinculacao'::text;
end;
$$;

create or replace function public.rpc_confirmar_saida_devolucao_fornecedor(
  p_empresa_id uuid,
  p_devolucao_id uuid
)
returns table (
  devolucao_id uuid,
  status text,
  itens_movimentados integer,
  quantidade_total numeric
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_usuario uuid;
  v_dev public.fiscal_devolucoes_fornecedor%rowtype;
  v_emissao_status text;
  v_item record;
  v_anterior numeric(14,4);
  v_atual numeric(14,4);
  v_movimentados integer := 0;
  v_quantidade numeric(14,4) := 0;
begin
  v_usuario := auth.uid();
  if v_usuario is null then
    raise exception 'Usuário não autenticado.';
  end if;

  if not public.tem_acesso_empresa(p_empresa_id) then
    raise exception 'Usuário sem acesso à empresa.';
  end if;

  select d.*
    into v_dev
  from public.fiscal_devolucoes_fornecedor d
  where d.id = p_devolucao_id
    and d.empresa_id = p_empresa_id
  for update;

  if not found then
    raise exception 'Devolução não encontrada nesta empresa.';
  end if;

  if v_dev.saida_estoque_processada_at is not null
     or v_dev.status = 'concluida' then
    raise exception 'A saída desta devolução já foi processada.';
  end if;

  if v_dev.status = 'cancelada' then
    raise exception 'Devolução cancelada.';
  end if;

  if v_dev.emissao_fiscal_id is null then
    raise exception 'A NF-e de devolução ainda não foi emitida.';
  end if;

  select e.status
    into v_emissao_status
  from public.fiscal_emissoes e
  where e.id = v_dev.emissao_fiscal_id
    and e.empresa_id = p_empresa_id;

  if v_emissao_status is distinct from 'autorizada' then
    raise exception 'A saída só pode ser confirmada depois que a NF-e de devolução estiver autorizada.';
  end if;

  if exists (
    select 1
    from public.estoque_movimentacoes em
    where em.empresa_id = p_empresa_id
      and em.devolucao_fornecedor_id = p_devolucao_id
  ) then
    raise exception 'A saída desta devolução já foi processada.';
  end if;

  for v_item in
    select i.*
    from public.fiscal_devolucoes_fornecedor_itens i
    where i.empresa_id = p_empresa_id
      and i.devolucao_id = p_devolucao_id
    order by i.created_at
    for update
  loop
    if v_item.produto_id is null then
      raise exception 'Item da devolução sem produto vinculado.';
    end if;

    if not exists (
      select 1
      from public.produtos p
      where p.id = v_item.produto_id
        and p.empresa_id = p_empresa_id
    ) then
      raise exception 'Produto da devolução não pertence à empresa ativa.';
    end if;

    if exists (
      select 1
      from public.estoque_movimentacoes em
      where em.empresa_id = p_empresa_id
        and em.devolucao_fornecedor_item_id = v_item.id
    ) then
      raise exception 'A saída desta devolução já foi processada.';
    end if;

    insert into public.estoque_atual (
      empresa_id,
      produto_id,
      quantidade,
      estoque_minimo
    )
    values (
      p_empresa_id,
      v_item.produto_id,
      0,
      0
    )
    on conflict (empresa_id, produto_id)
    do nothing;

    select ea.quantidade
      into v_anterior
    from public.estoque_atual ea
    where ea.empresa_id = p_empresa_id
      and ea.produto_id = v_item.produto_id
    for update;

    if v_anterior is null then
      raise exception 'Estoque do produto não encontrado.';
    end if;

    if v_anterior < v_item.quantidade then
      raise exception 'Estoque insuficiente para confirmar a saída da devolução.';
    end if;

    v_atual := v_anterior - v_item.quantidade;

    update public.estoque_atual
    set quantidade = v_atual
    where empresa_id = p_empresa_id
      and produto_id = v_item.produto_id;

    insert into public.estoque_movimentacoes (
      empresa_id,
      produto_id,
      usuario_id,
      tipo,
      origem,
      quantidade,
      saldo_anterior,
      saldo_posterior,
      observacao,
      documento_entrada_id,
      devolucao_fornecedor_id,
      devolucao_fornecedor_item_id
    )
    values (
      p_empresa_id,
      v_item.produto_id,
      v_usuario,
      'DEVOLUCAO_FORNECEDOR',
      'NFE_DEVOLUCAO_FORNECEDOR',
      v_item.quantidade,
      v_anterior,
      v_atual,
      'Saída pela devolução ao fornecedor',
      v_dev.documento_entrada_id,
      p_devolucao_id,
      v_item.id
    );

    v_movimentados := v_movimentados + 1;
    v_quantidade := v_quantidade + v_item.quantidade;
  end loop;

  if v_movimentados = 0 then
    raise exception 'A devolução não possui itens para saída de estoque.';
  end if;

  update public.fiscal_devolucoes_fornecedor as d
  set
    status = 'concluida',
    saida_estoque_processada_at = now(),
    saida_estoque_processada_por = v_usuario
  where d.id = p_devolucao_id
    and d.empresa_id = p_empresa_id;

  return query
  select
    p_devolucao_id,
    'concluida'::text,
    v_movimentados,
    v_quantidade;
end;
$$;

notify pgrst, 'reload schema';

commit;
