-- Porta do pinpad deste terminal. 0 é a busca automática de PWINFO_PPCOMMPORT.
-- 1 a 32 é o número da COM (COM1 a COM32). Não copia porta de outro computador.
ALTER TABLE public.tef_terminais
  ADD COLUMN IF NOT EXISTS porta_pinpad smallint NOT NULL DEFAULT 0;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tef_terminais_porta_pinpad_check'
  ) THEN
    ALTER TABLE public.tef_terminais
      ADD CONSTRAINT tef_terminais_porta_pinpad_check
      CHECK (porta_pinpad BETWEEN 0 AND 32);
  END IF;
END $$;
COMMENT ON COLUMN public.tef_terminais.porta_pinpad IS
  '0 busca automática da PGWebLib. 1 a 32 é COM1 a COM32 deste terminal. Não força a porta do Windows no Connector já instalado.';
