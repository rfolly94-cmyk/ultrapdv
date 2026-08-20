BEGIN;

-- NFC-e automática no PDV: flag por empresa em fiscal_nfce_config.
-- Sem hardcode global. Padrão desligado (comportamento atual).

ALTER TABLE public.fiscal_nfce_config
  ADD COLUMN IF NOT EXISTS emitir_nfce_automatico_pdv boolean NOT NULL DEFAULT false;

COMMIT;
