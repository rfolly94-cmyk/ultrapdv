# Interoperabilidade nativa da PGWebLib 4.1.50.924

`PWL_Type.h` não é dependência de execução. A SETIS informou que ele não é um arquivo separado necessário, e essa ausência não bloqueia o motor. Os tipos seguem o exemplo C# da PGPagamentos: `ushort`, `byte`, inteiro de 32 bits e `StdCall`. No Windows x64 essa convenção coincide com `PW_EXPORT` vazio. Os arquivos em `native/hipotese-*` não são definição oficial.

O teste nativo isolado carregou a DLL 4.1.50.924 e `PW_iInit` retornou 0, sem venda nem instalacao. A instalacao do ponto e as transacoes confirmadas pelo motor C# sao outra evidencia e ja ocorreram em homologacao.

## O que o kit contem

O header oficial usado foi `PGWebLib.h` do kit 4.1.50.924, com 86822 bytes. Ele inclui `PWL_Type.h` quando `PGLIB_DACASA` nao esta definido. Esse arquivo nao esta no kit, no backup, nem no repositorio.

`PW_EXPORT` e vazio. O header nao declara `__stdcall` nem `#pragma pack`.

A compilacao de `native/sonda-header-oficial.c`, incluindo somente o diretorio do kit, para em:

`PGWebLib.h:92: fatal error: 'PWL_Type.h' file not found`

O compilador disponivel foi `zig cc -target x86_64-windows-gnu`. O MSVC nao esta instalado. Para estes inteiros, o alvo Windows do zig segue LLP64, o mesmo modelo do MSVC x64: `unsigned int` e `unsigned long` tem 4 bytes.

## Larguras usadas pelo motor C#

O kit inclui `PWL_Type.h` no header, mas esse arquivo nao faz parte do motor. As larguras abaixo sao as do exemplo C# no Windows x64, ja exercidas pela DLL autonoma:

| Tipo no header | Onde o motor usa | Largura adotada | Situacao |
| --- | --- | --- | --- |
| `Byte` | `PW_iNewTransac` | 1 | usada na instalacao e na venda |
| `Word` | `PW_GetData` e `PW_iAddParam` | 2 | usada na instalacao e na venda |
| `Uint16` | indice do PinPad | 2 | usada quando a biblioteca pede o PinPad |
| `Int16` | retorno e contagens | 2 | usada na instalacao e na venda |
| `Uint32` | `PW_iGetResult` e `PW_iConfirmation` | 4 | usada na confirmacao nativa |
| `Bool` | `PW_OperationsEx`, fora do motor | 4 | nao e passada a DLL |
| `char` | textos | 1 | usada nos parametros e nos resultados |

`char`, `void` e os `enum` sao da linguagem. Os valores dos `enum` e dos `#define` foram compilados a partir do proprio `PGWebLib.h` e nao dependem da largura de `Uint32`.

## Hipoteses medidas

Os arquivos em `native/hipotese-*` nao sao o `PWL_Type.h` da SETIS. Eles so existem para o header oficial poder ser analisado.

| Hipotese | `sizeof(PW_GetData)` | alinhamento | `ulTipoEntradaCartao` | `sizeof(PW_Operations)` | `sizeof(PW_OperationsEx)` |
| --- | ---: | ---: | ---: | ---: | ---: |
| Windows, alinhamento natural, `Uint32` de 4 | 12500 | 4 | 12404 | 43 | 72 |
| Mesmas larguras com `#pragma pack(1)` | 12497 | 1 | 12402 | 43 | 69 |
| `Uint32` de 8, como `unsigned long` em LP64 | 12520 | 8 | 12416 | 43 | 72 |

O C# usa `Pack = 4`, `ushort`, `byte`, `uint` e `fixed byte`. `Marshal.SizeOf` e `Marshal.OffsetOf` coincidem com a primeira linha, campo a campo. A instalacao do ponto e as vendas confirmadas na DLL autonoma mostram que esse espelho funciona nas chamadas que o motor C# realmente faz.

`PW_Operations` mede 43 nas tres hipoteses. `PW_OperationsEx` muda com o alinhamento de `Bool`. O motor C# nao passa essa estrutura a DLL.

## O que o motor C# usa

A PGWebLib autonoma 4.1.50.924 ja executou, em homologacao, as chamadas deste motor: `PW_iInit`, `PW_iNewTransac`, `PW_iAddParam`, `PW_iExecTransac` com `PW_GetData`, `PW_iGetResult`, `PW_iConfirmation` e o ciclo de PinPad pedido pela biblioteca. O ponto ficou instalado e a transacao nativa foi confirmada. `PWL_Type.h` nao entra nessa lista e nao e requisito de producao.

`ABI_COMPROVADO` e `LAYOUT_HOMOLOGADO` continuam falsos porque pertencem ao conector antigo. `AssinaturasPgWeb.ComprovadoContraDll` tambem continua falso: ele so registraria uma comparacao com o typedef que o kit nao publica. Nenhum dos tres libera nem bloqueia o motor C#.

Depois da instalacao, o motor nao chama `PW_iSetEnvironment` de novo. O ponto de homologacao nao e convertido em producao.
