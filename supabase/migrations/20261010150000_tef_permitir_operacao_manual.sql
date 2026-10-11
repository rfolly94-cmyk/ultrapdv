-- Autorização da empresa para cartão manual enquanto o TEF não puder ser usado.
-- Não habilita a plataforma. O padrão permanece falso.
-- Não aplicar automaticamente neste fluxo.

ALTER TABLE public.tef_configuracoes
  ADD COLUMN IF NOT EXISTS permitir_operacao_manual boolean NOT NULL DEFAULT false;
