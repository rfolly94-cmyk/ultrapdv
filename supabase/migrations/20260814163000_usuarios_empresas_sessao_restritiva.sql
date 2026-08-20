-- UltraPDV
-- Corrige contexto de sessão multiusuário em public.usuarios_empresas.
--
-- Problema:
-- Várias páginas existentes usam:
--   .eq('principal', true)
--   .eq('ativo', true)
--   .maybeSingle()
--
-- Se uma policy permissiva de SELECT deixa a sessão visualizar vínculos
-- de outros usuários, a consulta recebe mais de uma linha e o PostgREST
-- retorna:
--   "JSON object requested, multiple (or no) rows returned"
--
-- A policy abaixo é RESTRICTIVE:
-- ela NÃO substitui nem apaga policies permissivas existentes.
-- Para SELECT autenticado, além das policies atuais, passa a ser
-- obrigatório que a linha pertença ao próprio auth.uid().
--
-- service_role continua ignorando RLS, portanto a tela administrativa
-- de Usuários consegue listar os vínculos da empresa pelo backend.

ALTER TABLE public.usuarios_empresas
  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usuarios_empresas_somente_sessao
  ON public.usuarios_empresas;

CREATE POLICY usuarios_empresas_somente_sessao
  ON public.usuarios_empresas
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (
    usuario_id = auth.uid()
  );

COMMENT ON POLICY usuarios_empresas_somente_sessao
  ON public.usuarios_empresas
  IS 'Policy restritiva: sessões authenticated só enxergam seus próprios vínculos; service_role permanece disponível para administração server-side.';

NOTIFY pgrst, 'reload schema';
