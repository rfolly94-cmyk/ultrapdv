begin;

-- A RPC de confirmação marca a nota como processando_entrada e
-- depois grava quantidade_entrada_efetivada. O trigger não pode
-- tratar isso como edição de nota já concluída.

create or replace function public.fiscal_entrada_impedir_edicao_concluida()
returns trigger
language plpgsql
as $$
declare
  v_status text;
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
    select d.status
      into v_status
    from public.fiscal_documentos_entrada d
    where d.id = old.documento_entrada_id
      and d.empresa_id = old.empresa_id;

    if v_status = 'entrada_concluida' then
      if new.produto_id is distinct from old.produto_id
         or new.quantidade_recebida is distinct from old.quantidade_recebida
         or new.quantidade_xml is distinct from old.quantidade_xml
         or new.valor_total is distinct from old.valor_total
         or new.fator_conversao is distinct from old.fator_conversao
         or new.fator_conversao_confirmado is distinct from old.fator_conversao_confirmado
         or new.quantidade_entrada_efetivada is distinct from old.quantidade_entrada_efetivada then
        raise exception 'Itens de entrada já processada não podem ser alterados.';
      end if;
    elsif v_status = 'processando_entrada' then
      if new.produto_id is distinct from old.produto_id
         or new.quantidade_recebida is distinct from old.quantidade_recebida
         or new.quantidade_xml is distinct from old.quantidade_xml
         or new.valor_total is distinct from old.valor_total
         or new.fator_conversao is distinct from old.fator_conversao
         or new.fator_conversao_confirmado is distinct from old.fator_conversao_confirmado then
        raise exception 'Itens de entrada já processada não podem ser alterados.';
      end if;
    end if;
  end if;

  return new;
end;
$$;

notify pgrst, 'reload schema';

commit;
