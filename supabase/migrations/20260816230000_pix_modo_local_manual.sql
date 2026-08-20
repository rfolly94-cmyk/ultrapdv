BEGIN;

-- UltraPDV PIX — segunda modalidade: local/manual.
-- Aditivo. Não apaga configuração Geranet nem secrets do cofre.

ALTER TABLE public.integracoes_pix
  ADD COLUMN IF NOT EXISTS modo text NOT NULL DEFAULT 'geranet';

ALTER TABLE public.integracoes_pix
  DROP CONSTRAINT IF EXISTS integracoes_pix_modo_check;

ALTER TABLE public.integracoes_pix
  ADD CONSTRAINT integracoes_pix_modo_check
  CHECK (modo IN ('local_manual', 'geranet'));

ALTER TABLE public.integracoes_pix
  DROP CONSTRAINT IF EXISTS integracoes_pix_gateway_check;

ALTER TABLE public.integracoes_pix
  ADD CONSTRAINT integracoes_pix_gateway_check
  CHECK (gateway IN ('geranet', 'local'));

ALTER TABLE public.integracoes_pix
  ALTER COLUMN provedor DROP NOT NULL;

COMMENT ON COLUMN public.integracoes_pix.modo IS
  'local_manual: QR BR Code gerado no UltraPDV, confirmação manual. geranet: integração bancária.';

COMMIT;
