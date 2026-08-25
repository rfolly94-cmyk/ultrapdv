# Mapa de entitlements (plano da empresa)

Este documento descreve o **teto comercial** do UltraPDV: o que o plano contratado pela empresa habilita.

A autorização completa tem duas camadas independentes:

1. **Entitlement da empresa** (este arquivo) — o plano possui o recurso?
2. **Permissão do usuário** — ver `docs/permissoes-usuarios-map.md`

**Enforcement de entitlement:** seletivo.

`RECURSOS_COM_ENFORCEMENT` em `lib/plataforma/entitlements/rollout.ts`.

| Recurso | Enforcement |
|---|---|
| `importador` | **ATIVO** |
| `impressao_automatica` | **ATIVO** |
| `relatorios` | **ATIVO** |
| `contabilidade` | **ATIVO** |
| `pix_integrado` | **ATIVO** |
| `carteira` | **ATIVO** |
| `produtos` | **ATIVO** |
| `clientes` | **ATIVO** |
| `estoque` | **ATIVO** |
| `nfce` | **ATIVO** |
| `nfe` | **ATIVO** |
| `cce` | **ATIVO** |
| `inutilizacao_fiscal` | **ATIVO** |
| `vendas` | **ATIVO** |
| `pdv` | **ATIVO** |
| `catalogo` | **ATIVO** |
| demais do catálogo | DESLIGADO |

`MODO_ENTITLEMENT` global continua `"off"`. O rollout liga `"enforce"` só para as chaves do Set.

Permissões de usuário **já são aplicadas** (`exigirPermissao`, proxy, sidebar).

---

## 1. Catálogo real de recursos

Fonte: `lib/plataforma/recursos/catalogo.ts` e tabela `recursos_plataforma`.

Chaves: `pdv`, `vendas`, `produtos`, `clientes`, `estoque`, `carteira`, `relatorios`, `catalogo`, `nfce`, `nfe`, `cce`, `inutilizacao_fiscal`, `contabilidade`, `importador`, `pix_integrado`, `impressao_automatica`, `suporte_prioritario`.

Limites: `usuarios`, `filiais` (`NULL` = ilimitado). Não existe tabela `filiais` no ERP.

Helpers (reutilizar): `empresaPossuiRecurso`, `obterLimite`, `carregarEntitlementsEmpresa`, `decidirRecursoDoPlano`, `exigirRecursoEmpresa`.  
Resolver: lista vazia ou chave ausente **libera** (compatibilidade). `habilitado: false` explícito **nega** quando o recurso está no rollout. Assinatura de outra empresa nega.

---

## 2. Recursos ausentes (não criar agora)

- Transportadoras
- Início / painel
- Gestão de usuários (é **limite**, não recurso booleano)
- Filiais (limite SaaS sem módulo)
- Configurações gerais da empresa
- Tela `/assinatura`

---

## 3. Camadas

| Tipo | Exemplos | Plano hoje | Usuário hoje |
|---|---|---|---|
| UI_ONLY | sidebar, botão | **importador**, **impressao_automatica**, **relatorios**; demais não | parcial |
| ROUTE_GUARD | proxy `decidirAcessoRota` | importador/impressão/relatórios na **página** (proxy = permissão) | sim |
| SERVER_GUARD | `exigirPermissao` em actions/APIs | importador + conector + relatórios via `exigirRecursoEmpresa` | maioria |
| INTERNAL_OPERATION | baixa de estoque na venda | nunca pelo módulo de tela | não |

Ordem futura: autenticado → vínculo `usuario_id`+`empresa_id` → assinatura operacional → **recurso do plano** → permissão do usuário → executar.

Usuário nunca eleva o plano.

---

## 4. Mapa resumido por recurso

### pdv — ENFORCEMENT ATIVO

**Fronteira:** operações humanas do caixa — acessar `/pdv`, finalizar venda, aplicar desconto, usar fiado e editar venda pelo PDV.

**Não faz parte deste entitlement (INTERNAL_OPERATION da finalização/edição):**

- criar venda, baixar/estornar estoque, pagamentos, débito de fiado/carteira, vínculo PIX, recibo
- pesquisa/seleção de produtos e clientes já cadastrados
- NFC-e automática (continua no recurso `nfce`; `nfce=false` não falha a venda)
- PIX Geranet (`pix_integrado`); PIX local/manual independente
- auto-print via Conector (`impressao_automatica`)
- cancelamento comercial (`vendas.cancelar` em `/api/vendas/[id]/cancelar`)
- DANFE / carta de correção / recibo já gerados

- **Rotas humanas:** `/pdv`, `/pdv/editar/[id]`
- **Actions:** `finalizarVendaPdv` → `rpc_finalizar_venda`; `editarVendaPdv` → `rpc_editar_venda_pdv`; `salvarPreferenciasPdvAction`
- **UI:** item do menu some se `pdv=false` e `vendas=false`; com `vendas=true` o item permanece em `/vendas`. Acesso direto a `/pdv` e `/pdv/editar/[id]` mostra `RecursoNaoContratado`
- **Permissão de usuário (já existente):** `pdv.acessar`, `pdv.finalizar_venda`, `pdv.aplicar_desconto`, `pdv.usar_fiado`. Edição pelo caixa reutiliza `vendas.editar` **com plano `pdv`**, sem exigir plano `vendas`. `pdv.cancelar_venda` existe na matriz, mas o cancelamento HTTP continua em `vendas.cancelar`
- **Guards:**
  - UI: sidebar; `/pdv` bloqueia operação se não houver caixa aberto (modal "Caixa fechado"; abertura só com `caixa.abrir` via `rpc_abrir_caixa`, nunca automática)
  - ROUTE_GUARD: proxy exige `pdv.acessar`; páginas consultam o plano antes de carregar produtos/clientes
  - SERVER_GUARD: `exigirOperacaoPdv` / `exigirEdicaoPdv` **antes** das RPCs; `finalizarVendaPdv` também exige sessão de caixa aberta (`exigirCaixaAberto: true`)
- **Mobile:** `POST /api/pdv/finalizar` **não** exige caixa aberto nesta fase. Futura integração Caixa mobile: passar a flag, bloquear o PDV mobile sem sessão, permitir `rpc_abrir_caixa` a quem tiver permissão e vincular a venda à sessão — sem abrir caixa automaticamente.
- **Nova NF-e → Venda:** `prepararVendaParaEmissaoNfe` materializa venda comercial nova com `exigirCaixaAberto: true` (`rpc_finalizar_venda_com_caixa`). Transferência, bonificação, devolução e NF-e sobre venda já existente não exigem caixa. Emissão/reemissão/reconciliação/consulta fiscal não relançam o livro.
- **Interno:** RPCs, Geranet, estoque, carteira, PIX e recibo **não** consultam o plano `pdv`
- **Compatibilidade:** chave ausente libera; só `pdv = false` explícito nega
- **Outros recursos false:** `vendas`/`estoque`/`clientes`/`produtos`/`carteira` não impedem o caixa; fiado continua só com `pdv.usar_fiado`

### vendas — ENFORCEMENT ATIVO

**Fronteira:** operações humanas do módulo Vendas — acessar lista/detalhe, editar venda fora do PDV e cancelar venda comercial.

**Não faz parte deste entitlement (INTERNAL_OPERATION):**

- venda criada/finalizada pelo PDV (`rpc_finalizar_venda`)
- edição no PDV (`rpc_editar_venda_pdv` / `/pdv/editar/[id]`)
- baixa/estorno de estoque interno da venda
- carteira/fiado interno e recebimentos (`carteira`)
- pagamentos e vínculos PIX (`pix_integrado`)
- emissão fiscal NF-e/NFC-e, CC-e, inutilização (`nfe`/`nfce`/`cce`/`inutilizacao_fiscal`)
- recibo / DANFE
- pedidos de catálogo (`/vendas/pedidos`, `catalogo.pedidos`)
- `/vendas/[id]/nfe` e `/vendas/[id]/nfce` (já protegidos pelos recursos fiscais)
- `/api/vendas/[id]/natureza` e `/transporte` (dados fiscais da venda)

- **Rotas humanas:** `/vendas`, `/vendas/[id]`
- **APIs humanas:** `/api/vendas/[id]/cancelar`, `/api/vendas/[id]/editar`
- **UI:** item Vendas da sidebar permanece visível se o plano `vendas` permitir; com `vendas=false` o item só aparece se o PDV estiver no plano e aponta para `/pdv`. Lista e detalhe mostram `RecursoNaoContratado` no acesso direto. Histórico existente não é apagado; visualizar no módulo depende de `vendas`.
- **Permissão de usuário (já existente):** `vendas.acessar`, `vendas.criar`, `vendas.editar`, `vendas.cancelar`. Não existe entrypoint humano de criar venda fora do PDV.
- **Guards:**
  - UI: sidebar (não esconde o PDV)
  - ROUTE_GUARD: proxy exige `vendas.acessar` na lista/detalhe e `vendas.cancelar` no cancelamento; páginas consultam o plano antes de carregar
  - SERVER_GUARD: `exigirOperacaoVenda` em cancelar/editar **antes** de `rpc_cancelar_venda_comercial` / `update`
- **Interno:** RPCs e o PDV **não** consultam o plano `vendas`
- **Carteira:** `exigirCancelamentoItensCarteira` continua com recurso `carteira` + permissão `vendas.cancelar` — não ganha entitlement `vendas`
- **Compatibilidade:** chave ausente libera; só `vendas = false` explícito nega
- **PDV:** `vendas = false` não quebra finalização nem edição no PDV

### produtos — ENFORCEMENT ATIVO

**Fronteira:** módulo humano de cadastro — lista, criar/editar/excluir produto, categorias, marcas e grupos fiscais do cadastro.

**Não faz parte deste entitlement:**

- PDV pesquisar/carregar produto
- venda, estoque e fiscal montar item
- recibo / DANFE
- importação de produtos (`importador`)
- criar produto a partir de entrada fiscal

- **Rotas:** `/produtos`, `/produtos/categorias`, `/produtos/marcas`, `/produtos/grupos-fiscais` (aliases `/categorias`, `/marcas`, `/cadastro/categorias`, `/cadastro/marcas`)
- **UI:** item Produtos da sidebar oculto se o plano ou a permissão negar; layout mostra `RecursoNaoContratado` se o plano negar
- **Permissão de usuário (já existente):** `produtos.acessar`, `produtos.criar`, `produtos.editar`, `produtos.excluir`
- **Guards:**
  - UI: sidebar
  - ROUTE_GUARD: proxy exige `produtos.acessar`; página/layout consultam o plano antes de carregar cadastro
  - SERVER_GUARD: `exigirOperacaoProduto` nas actions humanas **antes** de `rpc_cadastrar_produto` / `update` / `delete`
- **Interno:** helpers de consulta, PDV, Geranet, `lib/importacao/executar.ts` **não** consultam o plano `produtos`
- **Compatibilidade:** chave ausente libera; só `produtos = false` explícito nega
- **Catálogo:** publicar/despublicar e campos públicos do produto exigem o recurso `catalogo`. O CRUD de produto continua com `produtos` mesmo se `catalogo=false` (flags já gravadas não são apagadas). `produtos=false` não impede a leitura pública de produtos já publicados quando `catalogo=true`.

### catalogo — ENFORCEMENT ATIVO

**Fronteira:** loja pública, configuração da loja, publicação de produtos no catálogo e administração de pedidos online.

**Não faz parte deste entitlement:**

- CRUD normal de produtos (`produtos`)
- PDV, vendas comerciais, estoque, fiscal, PIX e carteira
- conversão do pedido já aceito no caixa (`carregarPedidoParaPdv`)

- **Rotas internas:** `/configuracoes/catalogo`, `/vendas/pedidos`, `/vendas/pedidos-online`
- **Rotas públicas:** `/catalogo/[slug]`, `/catalogo/[slug]/pedido/[codigo]`
- **Actions:** `salvarCatalogoConfig`, `criarPedidoCatalogo`, `aceitarPedidoCatalogo`, `cancelarPedidoCatalogo`, `converterPedidoParaVenda`, `atualizarPublicacaoCatalogo`
- **UI:** aba Configurações “Catálogo Online”; aba “Pedidos Online” em Vendas; campos de catálogo no cadastro de produto
- **Permissão de usuário (já existente):** `catalogo.acessar`, `catalogo.configurar`, `catalogo.pedidos`. Publicar no cadastro de produto reutiliza `produtos.editar` **com plano `catalogo`**
- **Guards:**
  - UI: aba de configurações, aba de pedidos, campos/publicação no cadastro de produto
  - ROUTE_GUARD: proxy exige `catalogo.configurar` / `catalogo.pedidos`; `/catalogo` continua livre de permissão interna
  - SERVER_GUARD: `exigirOperacaoCatalogo` nas actions internas; catálogo público consulta só empresa + plano via admin, sem permissão de usuário
- **Público:** `catalogo=false` mostra “Catálogo temporariamente indisponível” e bloqueia novo pedido. Não expõe plano, UUID nem `RecursoNaoContratado`
- **Dados:** downgrade não apaga produtos publicados, configurações nem pedidos; só impede novo uso
- **Compatibilidade:** chave ausente libera; só `catalogo = false` explícito nega

### clientes — ENFORCEMENT ATIVO

**Fronteira:** módulo humano de cadastro de clientes — listar, visualizar cadastro, criar, editar e excluir/desativar.

**Não faz parte deste entitlement:**

- Carteira (`/clientes/[id]/carteira/**`) — recurso `carteira`
- PDV pesquisar/selecionar cliente existente
- venda carregar cliente
- emissão fiscal usar destinatário
- recibo / DANFE
- importação de clientes (`importador`)

- **Rota:** `/clientes` (cadastro). `/clientes/[id]/carteira` **não** consulta o plano `clientes`
- **UI:** item Clientes da sidebar oculto se o plano `clientes` negar; aba Cadastro some se o plano ou `clientes.acessar` negar; aba Carteira continua no recurso `carteira`
- **Permissão de usuário (já existente):** `clientes.acessar`, `clientes.criar`, `clientes.editar`, `clientes.excluir`
- **Guards:**
  - UI: sidebar + `ClienteNavegacao` (aba Cadastro)
  - ROUTE_GUARD: proxy exige `clientes.acessar` só no cadastro; carteira permanece `acessar_carteira` / `receber_carteira` / `vendas.cancelar`
  - SERVER_GUARD: `exigirOperacaoCliente` em `cadastrarCliente` / `editarCliente` / `excluirCliente` **antes** do insert/update/delete
- **Interno:** PDV, Geranet, `lib/importacao/executar.ts` **não** consultam o plano `clientes`
- **Compatibilidade:** chave ausente libera; só `clientes = false` explícito nega
- **Isolamento:** `clientes = false` + `carteira = true` mantém a Carteira acessível

### carteira — ENFORCEMENT ATIVO

**Fronteira:** módulo humano da carteira do cliente — acessar extrato, imprimir itens em aberto, receber (total/parcial/por itens), estornar/cancelar recebimento e cancelar itens da carteira.

**Não faz parte deste entitlement:**

- venda fiado no PDV (`pdv.usar_fiado`)
- finalização de venda / débito interno gerado pela venda
- estoque, pagamentos e cancelamento comercial da venda
- relatório gerencial de carteira (`relatorios`)

- **Rotas:** `/clientes/[id]/carteira`, `/clientes/[id]/carteira/imprimir-abertos`
- **UI:** aba Carteira e atalho na lista de clientes ocultos se o plano ou `clientes.acessar_carteira` negar; página mostra `RecursoNaoContratado` se o plano negar
- **Permissão de usuário (já existente):** `clientes.acessar_carteira`, `clientes.receber_carteira`; cancelar itens usa `vendas.cancelar`
- **Guards:**
  - UI: lista + `ClienteNavegacao`
  - ROUTE_GUARD: proxy exige `clientes.acessar_carteira` (página/PDF) ou `clientes.receber_carteira` (receber/estornar) ou `vendas.cancelar` (cancelar itens)
  - SERVER_GUARD: `exigirOperacaoCarteira` / `exigirCancelamentoItensCarteira` nas actions e APIs **antes** das RPCs
- **Interno:** `rpc_receber_carteira_cliente`, `rpc_estornar_recebimento_carteira`, `rpc_cancelar_itens_carteira`, `lib/carteira/cancelar-itens.ts` e `lib/impressao/carregar-carteira.ts` **não** consultam o plano
- **Compatibilidade:** chave ausente libera; só `carteira = false` explícito nega
- **PDV:** débito de fiado na finalização permanece INTERNAL_OPERATION

### estoque — ENFORCEMENT ATIVO

**Fronteira:** módulo humano de estoque — acessar a tela, consultar movimentações/histórico, ajuste manual, entrada/saída manual e limites (`estoque_minimo` / `estoque_maximo`).

**Não faz parte deste entitlement (INTERNAL_OPERATION):**

- baixa de estoque ao finalizar venda (`rpc_finalizar_venda`)
- estorno decorrente de cancelamento de venda (`rpc_cancelar_venda_comercial`)
- movimentação decorrente de edição de venda (`rpc_editar_venda_pdv`)
- importação autorizada pelo recurso `importador` (`lib/importacao/executar.ts`)
- entrada fiscal que movimenta estoque internamente (`rpc_confirmar_entrada_nfe`)
- estoque inicial no cadastro de produto (`rpc_cadastrar_produto`)

- **Rotas:** `/estoque` (alias `/app/estoque` redireciona)
- **UI:** item Estoque da sidebar oculto se o plano negar; layout mostra `RecursoNaoContratado` se o plano negar
- **Permissão de usuário (já existente):** `estoque.acessar`, `estoque.movimentar`, `estoque.ajustar`. `estoque.importar_estoque` permanece no **importador**, não neste recurso
- **Guards:**
  - UI: sidebar
  - ROUTE_GUARD: proxy exige `estoque.acessar` na tela humana; página/layout consultam o plano antes de carregar. `/fiscal/entradas` continua só com a permissão, sem plano `estoque`
  - SERVER_GUARD: `exigirOperacaoEstoque` em `movimentarEstoque` / `atualizarLimitesEstoque` / `listarMovimentacoesEstoque` **antes** das RPCs humanas
- **Interno:** RPCs genéricas (`rpc_movimentar_estoque_produto`, `rpc_atualizar_limites_estoque_produto`) **não** consultam o plano; o guard fica no entrypoint TypeScript humano
- **Compatibilidade:** chave ausente libera; só `estoque = false` explícito nega
- **PDV/vendas/importador/fiscal** continuam movimentando estoque com `estoque = false`

### relatorios — ENFORCEMENT ATIVO

**Fronteira:** tela `/relatorios`, exportação XLSX e geração do PDF gerencial (`/api/impressao/relatorio`).

**Não faz parte deste entitlement:**

- enviar ao UltraPDV Conector (`impressao_automatica`)
- DANFE / recibo / PDF fiscal
- PDV, vendas, estoque, carteira, Geranet

- **Rota:** `/relatorios`
- **UI:** item Relatórios da sidebar oculto se o plano ou a permissão negar
- **Permissão de usuário (nova, mínima):** `relatorios.acessar` e `relatorios.exportar`
- **Guards:**
  - UI: sidebar + botão Exportar (`relatorios.exportar`); Imprimir via Conector continua em `impressao_automatica`
  - ROUTE_GUARD: proxy exige `relatorios.acessar` (página/PDF) ou `relatorios.exportar` (XLSX); página mostra `RecursoNaoContratado` se o plano negar
  - SERVER_GUARD: `exigirOperacaoRelatorio` em `/api/relatorios/exportar` (exportar) e `/api/impressao/relatorio` (acessar) **antes** de `carregarRelatorio`
- **Interno:** `carregarRelatorio` / `calculo.ts` **não** consultam o plano
- **Compatibilidade:** chave ausente libera; só `relatorios = false` explícito nega

### nfce — ENFORCEMENT ATIVO

**Fronteira:** operações humanas do modelo 65 — emitir NFC-e (PDV, venda e teste), cancelar NFC-e, reconciliar NFC-e já concluída e gerar contingência nova.

**Não faz parte deste entitlement:**

- finalizar venda no PDV, receber pagamento, baixar estoque, gerar recibo
- XML / DANFE / PDF / protocolo de NFC-e já emitida
- cron de reconciliação
- helpers Geranet, montar-item, tributação
- configuração fiscal compartilhada (`/configuracoes/fiscal/**`)

- **Guards:** `exigirEmissaoNfce` nas rotas `nfce-emitir-venda`, `nfce-emitir` (corrigida: agora tem plano + `fiscal.emitir_nfce`), `nfce-contingencia-venda`; cancelamento usa `nfce` + `fiscal.cancelar_nota` quando o modelo é 65
- **PDV:** `nfce = false` não quebra a venda; a flag automática é AND com o plano; tentativa direta na API → `RECURSO_NAO_CONTRATADO`
- **Compatibilidade:** chave ausente libera

### nfe — ENFORCEMENT ATIVO

**Fronteira:** operações humanas do modelo 55 — emitir NF-e (venda, avulsa, operação, devolução e teste), cancelar NF-e e reconciliar NF-e já concluída.

**Não faz parte deste entitlement:**

- existência da venda comercial
- estoque, pagamento, recibo
- XML / DANFE / PDF / protocolo já emitidos
- cron de reconciliação
- `/configuracoes/fiscal/**` compartilhado

- **Rotas de emissão nova:** `/fiscal/nfe/**` mostra `RecursoNaoContratado` se o plano negar
- **Guards:** `exigirEmissaoNfe` em `nfe-emitir-venda`, `nfe-emitir`, `nfe55-emitir`, `nfe-emitir-operacao`, `nfe-emitir-devolucao-fornecedor`
- **Compatibilidade:** chave ausente libera

### cce — ENFORCEMENT ATIVO

**Fronteira:** emitir nova Carta de Correção.

**Não faz parte deste entitlement:** visualizar/imprimir CC-e já existente; impressão pelo Conector continua em `impressao_automatica`.

- **Guard:** `exigirCartaCorrecaoFiscal` em `/api/fiscal/emissoes/[id]/carta-correcao` **antes** da Geranet
- UI de nova CC-e some se o plano negar; histórico permanece

### inutilizacao_fiscal — ENFORCEMENT ATIVO

**Fronteira:** nova inutilização de numeração (chamada Geranet).

**Não faz parte deste entitlement:** histórico de inutilizações já homologadas; consulta/reconciliação de inutilização já enviada em estado pendente.

- **Guard:** `exigirInutilizacaoFiscal` em `/api/fiscal/emissoes/[id]/inutilizar` **antes** de `inutilizarNumeracaoFiscal`

### Reconciliação (decisão de segurança)

Downgrade do plano **não** pode prender documento fiscal já iniciado.

`exigirReconciliacaoDocumentoFiscal` **dispensa o plano** (mantém `fiscal.reconciliar`) quando o status é ambíguo/em trânsito:

`aguardando_reconciliacao`, `enviando`, `erro_comunicacao`, `transmitindo_contingencia`, `aguardando_transmissao_contingencia`, `aguardando_inutilizacao`, ou `documentoFiscalAmbiguo`.

Documento já `autorizada` / `cancelada`: reconciliação humana consulta o plano `nfe` ou `nfce`.

Cron `/api/cron/fiscal/reconciliar` permanece INTERNAL_OPERATION.

Transmitir contingência já gerada (`/api/fiscal/contingencia/[id]/transmitir`) exige só `fiscal.emitir_nfce` (permissão), sem o plano `nfce`, para não deixar NFC-e de contingência presa.

### contabilidade — ENFORCEMENT ATIVO

**Fronteira:** Área da Contadora — `/contabilidade/**`, download ZIP/XML da área, relatório CSV, fechamento de competência e inventário fiscal.

**Não faz parte deste entitlement:**

- emissão NF-e/NFC-e
- Geranet
- XML fiscal na origem (`/api/fiscal/emissoes/**/arquivo`, armazenamento interno)
- numeração, reconciliação, cancelamento, CC-e
- aba Configurações → Contabilidade (`/configuracoes/contabilidade`)

- **Rota:** `/contabilidade`
- **UI:** item Contabilidade da sidebar oculto se o plano ou a permissão negar; botões ZIP/XML exigem `contabilidade.baixar_xml`; CSV exige `contabilidade.relatorios`
- **Permissão de usuário (já existente):** `contabilidade.acessar` / `baixar_xml` / `relatorios` / `fechamento` / `inventario`
- **Guards:**
  - UI: sidebar + atalhos de download
  - ROUTE_GUARD: proxy exige `contabilidade.acessar` (área), `baixar_xml` (ZIP) ou `relatorios` (CSV); layout mostra `RecursoNaoContratado` se o plano negar; sem permissão → `/acesso-negado`
  - SERVER_GUARD: `exigirOperacaoContabilidade` em ZIP, CSV, `liberarCompetenciaAction` e `gerarInventarioAction`
- **Acesso legado:** `lib/contabilidade/acesso.ts` passou a usar `temPermissao` / `temAcessoModulo`. `ehContador` permanece só para UX do perfil contador (sandbox do ERP), não como teto de acesso
- **Interno:** `documentos.ts`, `visao.ts`, `inventario.ts`, ZIP helper **não** consultam o plano
- **Compatibilidade:** chave ausente libera; só `contabilidade = false` explícito nega
- **Não impede** o módulo fiscal de armazenar/usar XML internamente

### importador — ENFORCEMENT ATIVO

- **Rota:** `/configuracoes/importar-dados`
- **UI:** aba Configurações “Importar dados”; atalhos em Produtos, Clientes e Estoque
- **Actions:** `previaImportacaoAction`, `confirmarImportacaoAction`, `errosImportacaoAction`
- **APIs HTTP:** nenhuma (`app/api` não importa dados)
- **Permissão de usuário (inalterada):** `importacao_dados.acessar` / `importar_produtos` / `importar_clientes`
- **Guards aplicados:**
  - UI: aba e atalhos ocultos se o plano negar (decisão desta fase: ocultar, sem cadeado)
  - ROUTE_GUARD: a página renderiza `RecursoNaoContratado` se o plano negar; sem permissão o proxy continua mandando para `/acesso-negado`
  - SERVER_GUARD: `exigirRecursoEmpresa("importador")` nas três actions; `exigirAcessoOperacao` em `confirmarImportacaoAction` (plano + permissão) **antes** do `insert` em `importacoes_dados`
- **Interno:** `executarLinhasProdutos` / `rpc_movimentar_estoque_produto` **não** exigem recurso `estoque`
- **Compatibilidade:** lista vazia ou chave `importador` ausente em `planos_recursos` **libera**. Só `importador = false` explícito nega.
- **Não impede** ajuste manual de estoque nem baixa de venda

### pix_integrado — ENFORCEMENT ATIVO

**Fronteira:** PIX por integração/provedor (Geranet banking) — configurar provedor, testar, emitir/consultar/cancelar cobrança integrada e oferecer essa modalidade no PDV.

**Não faz parte deste entitlement:**

- PIX Local / Manual (`/api/pagamentos/pix/local/**`, `salvarConfiguracaoPixLocal`, QR estático)
- outras formas de pagamento
- Geranet fiscal / NF-e / NFC-e
- cofre/credenciais em si (helpers de vault não consultam o plano)

- **Rota de config:** `/configuracoes/financeiro/pix` permanece visível (PIX Local). A opção Integrado/Geranet some se o plano negar.
- **UI PDV:** `pixGeranetAtivo` exige o recurso; o caixa não quebra — só não oferece a modalidade integrada
- **Permissão de usuário (já existente):** `financeiro.configurar_pix` na configuração
- **Guards:**
  - UI: modo Geranet oculto/desabilitado; PDV não monta `PixGeranetCheckout` sem o plano
  - ROUTE_GUARD: a página de PIX não é bloqueada por este recurso (PIX Local precisa dela)
  - SERVER_GUARD: `exigirPixIntegradoEmpresa` em `salvarConfiguracaoPix` (modo geranet), `/api/pagamentos/pix/geranet/testar`, `emitir`, `consultar`, `cancelar` e `pdv/emitir` **antes** dos helpers Geranet
- **Interno:** `geranet.ts`, `geranet-pdv.ts`, `contexto.ts`, `chamarGeranetBanking` **não** consultam o plano
- **Compatibilidade:** chave ausente libera; só `pix_integrado = false` explícito nega
- Configuração persistida **não é apagada** se o Master desligar o recurso

### impressao_automatica — ENFORCEMENT ATIVO

**Fronteira:** o recurso é o **UltraPDV Conector** (agente local, impressora, auto-print, botão Imprimir que envia ao agente).

**Não faz parte deste entitlement:**

- visualizar recibo / DANFE / CC-e
- baixar PDF
- gerar PDF (`/api/impressao/**`, `gerarPdfSimples`)
- emitir NF-e/NFC-e
- finalizar venda

- **Rota de config:** `/configuracoes/impressao`
- **UI:** aba Configurações “Impressão” (oculta se o plano negar, mesmo padrão do Importador); botões `BotaoImprimirConector` e `ControlesImpressao`
- **Auto-print:** PDV (`tentarImpressaoPosVenda`) e NF-e (`EmitirNfeVendaButton`) — só o envio ao agente; venda/fiscal já concluídos permanecem
- **Actions:** `salvarConfiguracaoImpressaoAction` e `gerarPdfTesteImpressaoAction` exigem o recurso; `autorizarUsoConectorImpressaoAction` é o SERVER_GUARD chamado **antes** de `enviarImpressaoAgente`
- **Leitura de config:** `buscarConfiguracoesImpressaoAction` **não** exige o recurso (preserva dados; devolve `conectorLiberado`)
- **APIs PDF:** `/api/impressao/recibo`, `danfe`, `carta-correcao`, `carteira-abertos` **não** consultam o plano de impressão; `/api/impressao/relatorio` é o PDF **gerencial** e pertence a `relatorios`, não ao Conector; `/api/impressao/caixa/[id]` é o relatório de Caixa (`caixa.acessar` + plano `caixa`) e a impressão no Conector reutiliza a impressora selecionada (`danfe_nfe`/A4)
- **print-agent:** não alterado
- **Compatibilidade:** chave ausente libera; só `impressao_automatica = false` explícito nega
- Configuração persistida **não é apagada** se o Master desligar o recurso

### suporte_prioritario
- SLA do plano, não tela tenant

---

## 5. Sidebar

| Item | Recurso de plano | Permissão hoje |
|---|---|---|
| Início | (ausente) | `inicio.acessar` |
| Vendas | `vendas` + `pdv` | vendas **ou** pdv |
| Clientes | `clientes` | `clientes.acessar` |
| Produtos | `produtos` | `produtos.acessar` |
| Estoque | `estoque` | `estoque.acessar` |
| Relatórios | `relatorios` | `relatorios.acessar` |
| Contabilidade | `contabilidade` | `contabilidade.acessar` |
| Configurações | vários | `configuracoes.acessar` |

---

## 6. Empresa_id

Empresa ativa: `usuarios_empresas.principal = true` e `ativo = true` para `auth.uid()`.  
Entitlement futuro deve usar o `empresa_id` da operação.  
Trial usa o plano da assinatura. Plano desativado no catálogo não corta contrato existente.

---

## 7. Ordem para ligar o plano (não o usuário)

1. **importador — ATIVO**
2. **impressao_automatica — ATIVO**
3. **relatorios — ATIVO**
4. **contabilidade — ATIVO**
5. **pix_integrado — ATIVO** (sem PIX local)
6. **carteira — ATIVO** (sem fiado do PDV)
7. **produtos — ATIVO** (sem consultas internas)
8. **clientes — ATIVO** (sem carteira / PDV / importador)
9. **estoque — ATIVO** (sem PDV / vendas / importador / fiscal)
10. **nfce / nfe / cce / inutilizacao_fiscal — ATIVO** (sem PDV comercial; histórico preservado)
11. **vendas — ATIVO** (sem PDV / fiscal / carteira / estoque interno)
12. **pdv — ATIVO** (sem exigir vendas/estoque/clientes/produtos/carteira na finalização)
13. **catalogo — ATIVO** (sem CRUD de produtos, PDV, vendas, estoque, fiscal, PIX ou carteira)
