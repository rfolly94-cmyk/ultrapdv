select
  position(
    'v_titulo_id uuid := null'
    in lower(
      pg_get_functiondef(
        'public.rpc_cancelar_venda_comercial(uuid,uuid,uuid,text,text)'::regprocedure
      )
    )
  ) > 0 as usa_titulo_id_nullable,

  position(
    'v_titulo record'
    in lower(
      pg_get_functiondef(
        'public.rpc_cancelar_venda_comercial(uuid,uuid,uuid,text,text)'::regprocedure
      )
    )
  ) = 0 as nao_usa_record_titulo,

  position(
    'v_pagamento_imediato_liquido'
    in lower(
      pg_get_functiondef(
        'public.rpc_cancelar_venda_comercial(uuid,uuid,uuid,text,text)'::regprocedure
      )
    )
  ) > 0 as trata_pagamento_imediato,

  position(
    'pagamento_venda'
    in lower(
      pg_get_functiondef(
        'public.rpc_cancelar_venda_comercial(uuid,uuid,uuid,text,text)'::regprocedure
      )
    )
  ) > 0 as registra_pagamento_venda;
