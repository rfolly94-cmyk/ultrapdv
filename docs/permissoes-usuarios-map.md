# Permissões por usuário

Camada 2 da autorização. Independente do plano.

```text
ENTITLEMENT = o plano da EMPRESA possui o recurso?
PERMISSÃO   = este USUÁRIO, nesta EMPRESA, pode executar a operação?
```

Precedência:

```text
PLANO NEGOU → NEGADO
PLANO PERMITIU + USUÁRIO NEGOU → NEGADO
PLANO PERMITIU + USUÁRIO PERMITIU → PERMITIDO
```

O usuário **nunca** eleva o plano.

**Esta camada JÁ está ligada** no UltraPDV. Não recriar. Não expandir a matriz neste ciclo.

Enforcement de **plano**: seletivo. Hoje `importador`, `impressao_automatica`, `relatorios`, `contabilidade`, `pix_integrado`, `carteira`, `produtos`, `clientes`, `estoque`, `nfce`, `nfe`, `cce`, `inutilizacao_fiscal`, `vendas`, `pdv` e `catalogo` (`RECURSOS_COM_ENFORCEMENT`). Demais recursos do plano continuam off.

---

## 1. Relação usuário ↔ empresa

Tabelas reais:

- `usuarios` — pessoa (nome, e-mail, ativo)
- `usuarios_empresas` — vínculo: `usuario_id`, `empresa_id`, `perfil`, `principal`, `ativo`
- `usuarios_permissoes_empresas` — override por `(usuario_id, empresa_id, modulo)` JSONB

Um usuário pode ter vários vínculos. A sessão operacional usa **um** vínculo:

```text
usuario_id = auth.uid()
principal = true
ativo = true
```

`lib/empresa/empresa-ativa.ts` e `obterPermissoesSessao()`.

Ao “trocar empresa” no futuro, mudam juntos: plano daquela empresa **e** permissões daquele vínculo.

Master (`administradores_plataforma`) **não** usa `usuarios_empresas.perfil`. Administrador de empresa ≠ Master.

---

## 2. Valores reais de `usuarios_empresas.perfil`

Constraint `usuarios_empresas_perfil_valido` e `lib/usuarios/perfis.ts`:

| Valor | Rótulo |
|---|---|
| `administrador` | Administrador |
| `gerente` | Gerente |
| `vendedor` | Vendedor |
| `caixa` | Caixa |
| `operador` | Operador |
| `contador` | Contador |

Onde é criado/alterado: UI `components/usuarios/usuarios-workspace.tsx`, APIs `app/api/configuracoes/usuarios/route.ts` (POST cria login via `auth.admin.createUser` + vínculo) e `[id]/route.ts` (PATCH perfil/ativo/matriz).  
Onboarding também insere o primeiro administrador.

Onde é lido: sessão de permissões, sidebar (rótulo), Master (consulta), contabilidade (`eq("perfil","contador")`), presets.

**Perfil já concede autorização real**, via template:

- `PRESETS_PERFIL` em `lib/permissoes/presets.ts`
- `resolverPermissoesEfetivas`: administrador = matriz total **sem** linhas; demais = preset + override da tabela
- `origemDasPermissoes`: `administrador` | `perfil_padrao` | `personalizada`

Não espalhar `if (perfil === "caixa")` em módulo novo. O caminho central é `temPermissao` / `exigirPermissao`.

Exceção existente (documentar, não expandir): `lib/contabilidade/acesso.ts` ainda testa perfil para contador/gerente (duplica a matriz).

---

## 3. Matriz já persistida

Tabela `usuarios_permissoes_empresas`:

- UNIQUE `(usuario_id, empresa_id, modulo)`
- `permissoes jsonb` por módulo
- RLS: o próprio usuário lê as suas linhas da empresa (`tem_acesso_empresa`)
- Escrita administrativa via service role nas APIs de usuários
- Administrador: **não materializa** linhas (`substituirPermissoesUsuarioEmpresa` apaga e retorna)

Módulos da constraint SQL = `MODULOS_PERMISSAO` em `lib/permissoes/tipos.ts`.

---

## 4. Módulos e ações REAIS (não inventar outras)

Há **57** ações. Granularidade já é empresarial (não por campo de formulário).

| Módulo | Recurso do plano | Ações |
|---|---|---|
| `inicio` | (ausente) | acessar |
| `pdv` | `pdv` | acessar, finalizar_venda, aplicar_desconto, usar_fiado, cancelar_venda |
| `vendas` | `vendas` | acessar, criar, editar, cancelar |
| `clientes` | `clientes` + parte de `carteira` | acessar, criar, editar, excluir, acessar_carteira, receber_carteira |
| `produtos` | `produtos` | acessar, criar, editar, excluir, importar |
| `estoque` | `estoque` | acessar, movimentar, ajustar, importar_estoque |
| `fiscal` | `nfce` `nfe` `cce` `inutilizacao_fiscal` | acessar, emitir_nfe, emitir_nfce, cancelar_nota, carta_correcao, inutilizar, reconciliar, configurar_fiscal |
| `financeiro` | `pix_integrado` (config) | acessar, criar, editar, excluir, configurar_pix |
| `contabilidade` | `contabilidade` | acessar, baixar_xml, relatorios, fechamento, inventario |
| `configuracoes` | (ausente no plano) | acessar, editar_empresa, configuracoes_gerais |
| `usuarios` | limite `usuarios` | acessar, criar, editar, desativar, alterar_permissoes |
| `catalogo` | (ausente no plano) | acessar, configurar, pedidos |
| `importacao_dados` | `importador` | acessar, importar_produtos, importar_clientes |
| `relatorios` | `relatorios` | acessar, exportar |

Não criar registry paralelo. Este **é** o registry.

Lacunas vs. plano:

- `impressao_automatica` — cai em `configuracoes.acessar` (fraco)
- `carteira` — não é módulo; está em `clientes`
- `nfce`/`nfe`/`cce`/`inutilizacao` — um único módulo `fiscal`
- `pdv.cancelar_venda` existe no preset, mas o cancelamento HTTP usa `vendas.cancelar`

Visualizar ≠ escrever: `produtos.acessar` não implica `editar`; `vendas.acessar` não implica `cancelar`. Já modelado.

---

## 5. Templates (presets) atuais

| Perfil | Resumo |
|---|---|
| administrador | tudo |
| gerente | quase tudo; sem `usuarios.*` e sem `configurar_fiscal` / `configurar_pix` / `configuracoes_gerais` |
| vendedor | PDV (acessar, finalizar, fiado), vendas ver, clientes criar/editar, produtos ver, relatórios ver |
| caixa | PDV acessar/finalizar, vendas ver, carteira acessar/receber |
| operador | PDV + desconto, vendas criar/editar, produtos criar/editar, estoque movimentar, catálogo pedidos, relatórios ver |
| contador | produtos/estoque ver, fiscal acessar/reconciliar, contabilidade total, relatórios acessar/exportar |

Override: ao salvar usuário não-admin, a API grava a matriz inteira. UI: `editar-acesso-form.tsx` (admin trava a matriz).

Arquitetura futura recomendada (já é esta): preset do perfil + override por vínculo. Não criar terceira tabela agora.

---

## 6. Onde a permissão é aplicada hoje

### Proxy (ROUTE_GUARD)
`lib/supabase/proxy.ts` → `decidirAcessoRota`. Também bloqueia empresa **suspensa** (camada de assinatura, não plano).

### Server / API (SERVER_GUARD) — exemplos

| Entrypoint | Permissão |
|---|---|
| `finalizarVendaPdv` | `pdv.finalizar_venda` (+ desconto/fiado se usados) e sessão de caixa aberta |
| `prepararVendaParaEmissaoNfe` (venda comercial nova) | mesmas permissões do PDV + sessão de caixa aberta; abertura na tela com `caixa.abrir` |
| `POST /api/pdv/finalizar` | mesmas permissões do PDV; **não** exige caixa aberto nesta fase (Caixa mobile futuro) |
| `abrirCaixa` | `caixa.abrir` + plano `caixa` |
| `iniciarFechamentoCaixa` / `confirmarFechamentoCaixa` | `caixa.fechar` + plano `caixa` |
| `reabrirCaixa` | `caixa.reabrir` + plano `caixa` (preset: administrador/gerente; não entra no perfil caixa/operador) |
| `GET /api/impressao/caixa/[id]` | `caixa.acessar` + plano `caixa` |
| `definirFechamentoCaixaCego` | `caixa.acessar` + `configuracoes.editar_empresa` |
| ver esperado no caixa aberto com fechamento cego | `configuracoes.editar_empresa` (sem permissão nova; operador com só `caixa.fechar` não vê) |
| `editarVendaPdv` | `vendas.editar` |
| `POST /api/vendas/[id]/cancelar` | `vendas.cancelar` |
| `cadastrarProduto` / editar / excluir | `produtos.*` |
| `movimentarEstoque` | `estoque.movimentar` ou `ajustar` |
| carteira receber/estornar | `clientes.receber_carteira` |
| carteira cancelar itens | `vendas.cancelar` |
| `nfe-emitir-venda` / operação | `fiscal.emitir_nfe` |
| `nfce-emitir-venda` | `fiscal.emitir_nfce` |
| cancelar nota / CC-e / inutilizar / reconciliar | `fiscal.*` |
| importar | `importacao_dados` + `estoque.importar_estoque` se mexer saldo |
| `GET /api/relatorios/exportar` | `relatorios.exportar` + plano `relatorios` |
| `GET /api/impressao/relatorio` | `relatorios.acessar` + plano `relatorios` (não é Conector) |
| usuários POST/PATCH | `usuarios.criar` / `editar` |
| fiscal config / naturezas / Geranet | `fiscal.configurar_fiscal` |

### UI
Sidebar filtra por `hrefsMenuPermitidos`. PDV esconde desconto com `useTemPermissao("pdv","aplicar_desconto")`. Abas de configurações usam a mesma matriz.

---

## 7. Sensibilidade

| Operação | Sensibilidade | Permissão atual |
|---|---|---|
| Ver listagens | BAIXA | `*.acessar` |
| Criar cliente/produto | MÉDIA | `criar` |
| Desconto no PDV | MÉDIA | `pdv.aplicar_desconto` |
| Fiado | ALTA | `pdv.usar_fiado` |
| Ajuste de estoque | ALTA | `estoque.ajustar` |
| Receber / estornar carteira | ALTA | `clientes.receber_carteira` |
| Cancelar venda | ALTA | `vendas.cancelar` |
| Editar venda finalizada | ALTA | `vendas.editar` |
| Emitir NFC-e / NF-e | ALTA | `fiscal.emitir_*` |
| Cancelar nota / CC-e / inutilizar | CRÍTICA | `fiscal.cancelar_nota` / `carta_correcao` / `inutilizar` |
| Certificado, CSC, numeração, Geranet | CRÍTICA | `fiscal.configurar_fiscal` |
| PIX integrado (credenciais) | CRÍTICA | `financeiro.configurar_pix` |
| Criar usuário / alterar permissões | CRÍTICA | `usuarios.*` |
| Limite de usuários do plano | — | ainda não checado (só permissão) |

---

## 8. Operações internas (NÃO exigir permissão do módulo de tela)

- Baixa/estorno de estoque ao finalizar, editar ou cancelar venda
- Débito de carteira no fiado da venda
- Vínculo de PIX local/Geranet na finalização
- Geração de DANFE/recibo/PDF após documento autorizado
- Recálculo de saldo de carteira
- Código automático de produto

Classificação: **INTERNAL_OPERATION**.

---

## 9. Limite vs permissão (usuários)

Futuro:

1. `usuarios.criar`? se não → “sem permissão”
2. `obterLimite(empresa, "usuarios")` vs contagem de vínculos ativos? se estourou → “limite do plano”

Hoje só existe (1). Criação: `POST /api/configuracoes/usuarios` com `sessao.empresaId` (nunca o id do body como fonte da verdade).

Filiais: limite SaaS sem módulo; não implementar.

---

## 10. UX futura de negação (não misturar)

| Motivo | Mensagem |
|---|---|
| `RECURSO_NAO_CONTRATADO` | Recurso indisponível no plano. Conhecer upgrade. |
| `PERMISSAO_USUARIO_NEGADA` | Sem permissão. Falar com o administrador da empresa. |
| `LIMITE_PLANO_ATINGIDO` | Limite do plano. |
| `ASSINATURA_SUSPENSA` | Já existe (`/assinatura`). |
| `SEM_VINCULO_EMPRESA` | Onboarding / 401 |

Constantes em `MOTIVOS_NEGACAO` / `MENSAGEM_MOTIVO_NEGACAO` (ainda não usadas em rotas).

---

## 11. Helper combinado (não ligado)

`avaliarCamadasAcesso` em `lib/plataforma/entitlements/camadas.ts`:

- `MODO_ENTITLEMENT = "off"` → não recusa por plano
- `enforce` (só testes) → plano é teto
- Isola `empresa_id` da assinatura

Não importar em `app/pdv`, fiscal, proxy.

Não criar `exigirAcessoOperacao` ligado. Quando for a hora: autenticado → vínculo → `exigirEmpresaOperacional` → recurso → `exigirPermissao`.

---

## 12. Riscos (só UI / furo de SERVER_GUARD)

Não corrigir nesta fase, salvo gravíssimo:

1. `POST /api/fiscal/geranet/nfce-emitir` — sem `exigirPermissao` (a variante `nfce-emitir-venda` tem)
2. `/api/impressao/**` e actions de impressão — sessão/RLS, sem ação específica
3. PIX Geranet rotas — autenticação de empresa; conferir cobertura vs `configurar_pix` / PDV
4. Relatórios — módulo `relatorios` (`acessar` / `exportar`); proxy + APIs humanas
5. `pdv.cancelar_venda` pouco usado; cancelamento real é `vendas.cancelar`
6. Contabilidade ainda tem `if (perfil === ...)` paralelo à matriz
7. Sidebar Relatórios não consulta permissão

---

## 13. Proposta de banco (NÃO criar agora)

A estrutura de permissões **já existe**. Não precisa de migration para overrides.

Para entitlement de plano, tabelas já existem (`planos_recursos`, `planos_limites`).

Se no futuro quiser `carteira` como módulo de usuário: aí sim migration incremental em `usuarios_permissoes_empresas_modulo_check` + `ACOES_POR_MODULO`. Aguardar aprovação.

---

## 14. O que ligar primeiro

**Permissão de usuário:** já on. Não religar.

**Plano (entitlement):** ver ordem em `docs/entitlements-map.md`. Começar por importador / impressão automática / relatórios. NFC-e, NF-e e PDV por último.

Não esconder menus por plano nesta fase.
