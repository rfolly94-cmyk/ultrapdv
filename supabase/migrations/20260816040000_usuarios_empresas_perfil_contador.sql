BEGIN;

-- ============================================================
-- UltraPDV — inclui perfil contador em usuarios_empresas
-- Data: 2026-08-16
--
-- Definição anterior (produção):
--   CHECK ((perfil = ANY (ARRAY[
--     'administrador'::text,
--     'gerente'::text,
--     'vendedor'::text,
--     'caixa'::text,
--     'operador'::text
--   ])))
--
-- Preserva todos os valores atuais e adiciona 'contador'.
-- Não executa fechamento fiscal nem altera motores operacionais.
-- ============================================================

ALTER TABLE public.usuarios_empresas
  DROP CONSTRAINT IF EXISTS usuarios_empresas_perfil_valido;

ALTER TABLE public.usuarios_empresas
  ADD CONSTRAINT usuarios_empresas_perfil_valido
  CHECK (
    perfil = ANY (
      ARRAY[
        'administrador'::text,
        'gerente'::text,
        'vendedor'::text,
        'caixa'::text,
        'operador'::text,
        'contador'::text
      ]
    )
  );

COMMENT ON CONSTRAINT usuarios_empresas_perfil_valido
  ON public.usuarios_empresas IS
  'Perfis de vínculo usuário-empresa. lowercase. Contador é somente leitura operacional.';

CREATE OR REPLACE FUNCTION public.eh_contador_da_empresa(p_empresa_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.usuarios_empresas ue
    WHERE ue.usuario_id = (SELECT auth.uid())
      AND ue.empresa_id = p_empresa_id
      AND ue.ativo = true
      AND ue.perfil = 'contador'
  );
$function$;

REVOKE ALL ON FUNCTION public.eh_contador_da_empresa(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eh_contador_da_empresa(uuid) TO authenticated;

COMMENT ON FUNCTION public.eh_contador_da_empresa(uuid) IS
  'True somente quando o usuário autenticado é contador ativo da empresa. Não implica admin.';

-- Contador lê via tem_acesso_empresa (SELECT).
-- Estas policies RESTRICTIVE bloqueiam escrita operacional
-- sem alterar as policies permissivas de admin/vendedor/caixa.

DROP POLICY IF EXISTS vendas_contador_sem_insert ON public.vendas;
DROP POLICY IF EXISTS vendas_contador_sem_update ON public.vendas;
DROP POLICY IF EXISTS vendas_itens_contador_sem_insert ON public.vendas_itens;
DROP POLICY IF EXISTS vendas_itens_contador_sem_update ON public.vendas_itens;
DROP POLICY IF EXISTS produtos_contador_sem_insert ON public.produtos;
DROP POLICY IF EXISTS produtos_contador_sem_update ON public.produtos;
DROP POLICY IF EXISTS produtos_fiscal_contador_sem_update ON public.produtos_fiscal;

CREATE POLICY vendas_contador_sem_insert
ON public.vendas
AS RESTRICTIVE
FOR INSERT
TO authenticated
WITH CHECK (NOT public.eh_contador_da_empresa(empresa_id));

CREATE POLICY vendas_contador_sem_update
ON public.vendas
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (NOT public.eh_contador_da_empresa(empresa_id))
WITH CHECK (NOT public.eh_contador_da_empresa(empresa_id));

CREATE POLICY vendas_itens_contador_sem_insert
ON public.vendas_itens
AS RESTRICTIVE
FOR INSERT
TO authenticated
WITH CHECK (NOT public.eh_contador_da_empresa(empresa_id));

CREATE POLICY vendas_itens_contador_sem_update
ON public.vendas_itens
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (NOT public.eh_contador_da_empresa(empresa_id))
WITH CHECK (NOT public.eh_contador_da_empresa(empresa_id));

CREATE POLICY produtos_contador_sem_insert
ON public.produtos
AS RESTRICTIVE
FOR INSERT
TO authenticated
WITH CHECK (NOT public.eh_contador_da_empresa(empresa_id));

CREATE POLICY produtos_contador_sem_update
ON public.produtos
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (NOT public.eh_contador_da_empresa(empresa_id))
WITH CHECK (NOT public.eh_contador_da_empresa(empresa_id));

CREATE POLICY produtos_fiscal_contador_sem_update
ON public.produtos_fiscal
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (NOT public.eh_contador_da_empresa(empresa_id))
WITH CHECK (NOT public.eh_contador_da_empresa(empresa_id));

NOTIFY pgrst, 'reload schema';

COMMIT;
