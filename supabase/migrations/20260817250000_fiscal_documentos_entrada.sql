begin;

-- ============================================================
-- UltraPDV — Notas de Entrada / Compras (fundação)
-- Documento fiscal RECEBIDO + entrada no estoque existente.
-- Sem módulo de compras prévio. Sem tabela de fornecedores.
-- Estoque atual: unique (empresa_id, produto_id) — sem filial.
-- Não altera PDV, venda, PIX nem reconciliação Geranet.
-- ============================================================

create table if not exists public.fornecedores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null
    references public.empresas(id)
    on delete cascade,
  cnpj text not null,
  razao_social text not null,
  nome_fantasia text null,
  inscricao_estadual text null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fornecedores_cnpj_check
    check (cnpj ~ '^[0-9]{14}$'),
  constraint fornecedores_razao_check
    check (char_length(btrim(razao_social)) between 1 and 120)
);

comment on table public.fornecedores is
  'Cadastro de fornecedores por empresa. Identificado pelo CNPJ da NF-e de entrada.';

create unique index if not exists uq_fornecedores_empresa_cnpj
  on public.fornecedores (empresa_id, cnpj);

create index if not exists ix_fornecedores_empresa
  on public.fornecedores (empresa_id, ativo);

drop trigger if exists trg_fornecedores_updated_at
  on public.fornecedores;

create trigger trg_fornecedores_updated_at
before update on public.fornecedores
for each row
execute function public.ultrapdv_set_updated_at();

create table if not exists public.fiscal_documentos_entrada (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null
    references public.empresas(id)
    on delete cascade,
  fornecedor_id uuid null
    references public.fornecedores(id)
    on delete restrict,
  chave_acesso text not null,
  modelo text not null default '55',
  serie text not null,
  numero text not null,
  data_emissao timestamptz null,
  data_entrada timestamptz null,
  cnpj_emitente text not null,
  razao_social_emitente text not null,
  ie_emitente text null,
  cnpj_destinatario text null,
  valor_produtos numeric(14,2) not null default 0,
  valor_total numeric(14,2) not null default 0,
  protocolo text null,
  status text not null default 'aguardando_vinculacao',
  origem text not null default 'xml_upload',
  xml_original text not null,
  importado_por uuid null
    references public.usuarios(id)
    on delete set null,
  entrada_estoque_processada_at timestamptz null,
  entrada_estoque_processada_por uuid null
    references public.usuarios(id)
    on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fiscal_documentos_entrada_chave_check
    check (chave_acesso ~ '^[0-9]{44}$'),
  constraint fiscal_documentos_entrada_cnpj_emitente_check
    check (cnpj_emitente ~ '^[0-9]{14}$'),
  constraint fiscal_documentos_entrada_status_check
    check (status in (
      'importada',
      'aguardando_vinculacao',
      'aguardando_conferencia',
      'pronta_para_entrada',
      'processando_entrada',
      'entrada_concluida',
      'cancelada'
    )),
  constraint fiscal_documentos_entrada_origem_check
    check (origem in ('xml_upload', 'dfe_geranet')),
  constraint fiscal_documentos_entrada_xml_check
    check (char_length(xml_original) > 20)
);

comment on table public.fiscal_documentos_entrada is
  'NF-e recebida de fornecedor. XML original imutável após entrada no estoque. Unique por empresa+chave.';

comment on column public.fiscal_documentos_entrada.xml_original is
  'XML original da NF-e. Não reconstruir. Isolado por RLS da empresa.';

create unique index if not exists uq_fiscal_documentos_entrada_chave
  on public.fiscal_documentos_entrada (empresa_id, chave_acesso);

create index if not exists ix_fiscal_documentos_entrada_empresa
  on public.fiscal_documentos_entrada (empresa_id, created_at desc);

drop trigger if exists trg_fiscal_documentos_entrada_updated_at
  on public.fiscal_documentos_entrada;

create trigger trg_fiscal_documentos_entrada_updated_at
before update on public.fiscal_documentos_entrada
for each row
execute function public.ultrapdv_set_updated_at();

create table if not exists public.fiscal_documentos_entrada_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null
    references public.empresas(id)
    on delete cascade,
  documento_entrada_id uuid not null
    references public.fiscal_documentos_entrada(id)
    on delete cascade,
  numero_item integer not null,
  codigo_fornecedor text null,
  descricao_original text not null,
  ean text null,
  ncm text null,
  cest text null,
  cfop_original text null,
  unidade text null,
  quantidade_xml numeric(14,4) not null,
  quantidade_recebida numeric(14,4) not null,
  quantidade_entrada_efetivada numeric(14,4) null,
  valor_unitario numeric(14,4) not null default 0,
  valor_total numeric(14,2) not null default 0,
  desconto numeric(14,2) not null default 0,
  produto_id uuid null,
  grupo_fiscal_id uuid null,
  dados_fiscais_original jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fiscal_entrada_itens_numero_check
    check (numero_item > 0),
  constraint fiscal_entrada_itens_qtd_xml_check
    check (quantidade_xml >= 0),
  constraint fiscal_entrada_itens_qtd_recebida_check
    check (quantidade_recebida >= 0),
  constraint uq_fiscal_entrada_itens_numero
    unique (documento_entrada_id, numero_item),
  constraint fiscal_entrada_itens_produto_empresa_fkey
    foreign key (empresa_id, produto_id)
    references public.produtos(empresa_id, id)
    on delete restrict,
  constraint fiscal_entrada_itens_grupo_fkey
    foreign key (grupo_fiscal_id)
    references public.grupos_fiscais(id)
    on delete restrict
);

comment on table public.fiscal_documentos_entrada_itens is
  'Snapshot dos itens da NF-e recebida. quantidade_entrada_efetivada congela o que entrou no estoque. Saldo devolvível = efetivada - devoluções futuras.';

create index if not exists ix_fiscal_entrada_itens_documento
  on public.fiscal_documentos_entrada_itens (empresa_id, documento_entrada_id);

drop trigger if exists trg_fiscal_entrada_itens_updated_at
  on public.fiscal_documentos_entrada_itens;

create trigger trg_fiscal_entrada_itens_updated_at
before update on public.fiscal_documentos_entrada_itens
for each row
execute function public.ultrapdv_set_updated_at();

alter table public.estoque_movimentacoes
  add column if not exists documento_entrada_id uuid null;

alter table public.estoque_movimentacoes
  add column if not exists documento_entrada_item_id uuid null;

comment on column public.estoque_movimentacoes.documento_entrada_id is
  'NF-e de entrada que originou o movimento. Tipo ENTRADA / origem NFE_ENTRADA.';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'estoque_movimentacoes_documento_entrada_fkey'
  ) then
    alter table public.estoque_movimentacoes
      add constraint estoque_movimentacoes_documento_entrada_fkey
      foreign key (documento_entrada_id)
      references public.fiscal_documentos_entrada(id)
      on delete restrict;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'estoque_movimentacoes_documento_entrada_item_fkey'
  ) then
    alter table public.estoque_movimentacoes
      add constraint estoque_movimentacoes_documento_entrada_item_fkey
      foreign key (documento_entrada_item_id)
      references public.fiscal_documentos_entrada_itens(id)
      on delete restrict;
  end if;
end
$$;

create unique index if not exists uq_estoque_mov_entrada_item
  on public.estoque_movimentacoes (empresa_id, documento_entrada_item_id)
  where documento_entrada_item_id is not null;

create index if not exists ix_estoque_mov_documento_entrada
  on public.estoque_movimentacoes (empresa_id, documento_entrada_id)
  where documento_entrada_id is not null;

create or replace function public.fiscal_entrada_assert_mesma_empresa()
returns trigger
language plpgsql
as $$
declare
  v_empresa uuid;
begin
  if tg_table_name = 'fiscal_documentos_entrada' then
    if new.fornecedor_id is not null then
      select f.empresa_id into v_empresa
      from public.fornecedores f
      where f.id = new.fornecedor_id;
      if v_empresa is distinct from new.empresa_id then
        raise exception 'O fornecedor não pertence à empresa do documento de entrada.';
      end if;
    end if;
  end if;

  if tg_table_name = 'fiscal_documentos_entrada_itens' then
    select d.empresa_id into v_empresa
    from public.fiscal_documentos_entrada d
    where d.id = new.documento_entrada_id;
    if v_empresa is distinct from new.empresa_id then
      raise exception 'O item da NF-e de entrada deve pertencer à mesma empresa do documento.';
    end if;

    if new.grupo_fiscal_id is not null then
      select g.empresa_id into v_empresa
      from public.grupos_fiscais g
      where g.id = new.grupo_fiscal_id;
      if v_empresa is distinct from new.empresa_id then
        raise exception 'O grupo fiscal do item não pertence à empresa da NF-e de entrada.';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_fiscal_entrada_mesma_empresa
  on public.fiscal_documentos_entrada;
create trigger trg_fiscal_entrada_mesma_empresa
before insert or update of empresa_id, fornecedor_id
on public.fiscal_documentos_entrada
for each row
execute function public.fiscal_entrada_assert_mesma_empresa();

drop trigger if exists trg_fiscal_entrada_itens_mesma_empresa
  on public.fiscal_documentos_entrada_itens;
create trigger trg_fiscal_entrada_itens_mesma_empresa
before insert or update of empresa_id, documento_entrada_id, produto_id, grupo_fiscal_id
on public.fiscal_documentos_entrada_itens
for each row
execute function public.fiscal_entrada_assert_mesma_empresa();

create or replace function public.fiscal_entrada_impedir_edicao_concluida()
returns trigger
language plpgsql
as $$
begin
  if tg_table_name = 'fiscal_documentos_entrada' then
    if old.status = 'entrada_concluida'
       and (
         new.chave_acesso is distinct from old.chave_acesso
         or new.fornecedor_id is distinct from old.fornecedor_id
         or new.valor_total is distinct from old.valor_total
         or new.xml_original is distinct from old.xml_original
         or new.cnpj_emitente is distinct from old.cnpj_emitente
       ) then
      raise exception 'Documento de entrada já processado não pode ser alterado.';
    end if;
  end if;

  if tg_table_name = 'fiscal_documentos_entrada_itens' then
    if exists (
      select 1
      from public.fiscal_documentos_entrada d
      where d.id = old.documento_entrada_id
        and d.empresa_id = old.empresa_id
        and d.status in ('entrada_concluida', 'processando_entrada')
    ) then
      if new.produto_id is distinct from old.produto_id
         or new.quantidade_recebida is distinct from old.quantidade_recebida
         or new.quantidade_xml is distinct from old.quantidade_xml
         or new.valor_total is distinct from old.valor_total then
        raise exception 'Itens de entrada já processada não podem ser alterados.';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_fiscal_entrada_imovel
  on public.fiscal_documentos_entrada;
create trigger trg_fiscal_entrada_imovel
before update on public.fiscal_documentos_entrada
for each row
execute function public.fiscal_entrada_impedir_edicao_concluida();

drop trigger if exists trg_fiscal_entrada_itens_imovel
  on public.fiscal_documentos_entrada_itens;
create trigger trg_fiscal_entrada_itens_imovel
before update on public.fiscal_documentos_entrada_itens
for each row
execute function public.fiscal_entrada_impedir_edicao_concluida();

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

comment on function public.rpc_confirmar_entrada_nfe(uuid, uuid) is
  'Confirma entrada de estoque da NF-e recebida de forma atômica. Idempotente: uma NF-e gera uma entrada.';

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

comment on function public.rpc_importar_documento_entrada(uuid, text, jsonb) is
  'Importa XML de NF-e recebida na empresa ativa. Idempotente por (empresa_id, chave_acesso). Não movimenta estoque.';

revoke all on function public.rpc_confirmar_entrada_nfe(uuid, uuid) from public;
grant execute on function public.rpc_confirmar_entrada_nfe(uuid, uuid) to authenticated;

revoke all on function public.rpc_importar_documento_entrada(uuid, text, jsonb) from public;
grant execute on function public.rpc_importar_documento_entrada(uuid, text, jsonb) to authenticated;

alter table public.fornecedores enable row level security;
alter table public.fiscal_documentos_entrada enable row level security;
alter table public.fiscal_documentos_entrada_itens enable row level security;

drop policy if exists fornecedores_select_empresa on public.fornecedores;
drop policy if exists fornecedores_insert_empresa on public.fornecedores;
drop policy if exists fornecedores_update_empresa on public.fornecedores;
drop policy if exists fiscal_entrada_select_empresa on public.fiscal_documentos_entrada;
drop policy if exists fiscal_entrada_insert_empresa on public.fiscal_documentos_entrada;
drop policy if exists fiscal_entrada_update_empresa on public.fiscal_documentos_entrada;
drop policy if exists fiscal_entrada_itens_select_empresa on public.fiscal_documentos_entrada_itens;
drop policy if exists fiscal_entrada_itens_insert_empresa on public.fiscal_documentos_entrada_itens;
drop policy if exists fiscal_entrada_itens_update_empresa on public.fiscal_documentos_entrada_itens;

create policy fornecedores_select_empresa
on public.fornecedores for select to authenticated
using (public.tem_acesso_empresa(empresa_id));
create policy fornecedores_insert_empresa
on public.fornecedores for insert to authenticated
with check (public.tem_acesso_empresa(empresa_id));
create policy fornecedores_update_empresa
on public.fornecedores for update to authenticated
using (public.tem_acesso_empresa(empresa_id))
with check (public.tem_acesso_empresa(empresa_id));

create policy fiscal_entrada_select_empresa
on public.fiscal_documentos_entrada for select to authenticated
using (public.tem_acesso_empresa(empresa_id));
create policy fiscal_entrada_insert_empresa
on public.fiscal_documentos_entrada for insert to authenticated
with check (public.tem_acesso_empresa(empresa_id));
create policy fiscal_entrada_update_empresa
on public.fiscal_documentos_entrada for update to authenticated
using (public.tem_acesso_empresa(empresa_id))
with check (public.tem_acesso_empresa(empresa_id));

create policy fiscal_entrada_itens_select_empresa
on public.fiscal_documentos_entrada_itens for select to authenticated
using (public.tem_acesso_empresa(empresa_id));
create policy fiscal_entrada_itens_insert_empresa
on public.fiscal_documentos_entrada_itens for insert to authenticated
with check (public.tem_acesso_empresa(empresa_id));
create policy fiscal_entrada_itens_update_empresa
on public.fiscal_documentos_entrada_itens for update to authenticated
using (public.tem_acesso_empresa(empresa_id))
with check (public.tem_acesso_empresa(empresa_id));

grant select, insert, update on public.fornecedores to authenticated;
grant select, insert, update on public.fiscal_documentos_entrada to authenticated;
grant select, insert, update on public.fiscal_documentos_entrada_itens to authenticated;

revoke all on public.fornecedores from anon;
revoke all on public.fiscal_documentos_entrada from anon;
revoke all on public.fiscal_documentos_entrada_itens from anon;

commit;
