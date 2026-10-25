# Diagnóstico para a SETIS — PGWebLib 4.1.50.924

Nenhum layout foi selecionado. `ABI_COMPROVADO` e `LAYOUT_HOMOLOGADO` permanecem false. `PW_iInit` e o teste de PinPad já rodaram na DLL x64. `PW_iExecTransac` e `PWOPER_INSTALL` reais não foram executados.

O kit publica `PGWebLib.h` e não inclui `PWL_Type.h`. O header oficial não tem `#pragma pack`. `PW_EXPORT` está vazio. `char` mede 1 byte pela linguagem C. As larguras de `Byte`, `Word`, `Int16`, `Uint16`, `Uint32` e `Bool` não estão no kit.

As medições abaixo usam um header auxiliar de teste, marcado como hipótese, compilado com zig cc 0.17.0 para `x86_64-windows-gnu`. O record Pascal foi medido no FPC 3.2.2 x64 com `PACKRECORDS` 1, 2, 4 e 8. Coincidir com esse record não identifica o binário da SETIS.

## PW_GetData

O agente aloca somente `PW_GetData`. Há 9 tamanhos distintos. O valor 12500 aparece em mais de um arranjo: na hipótese com `Word` de 2 bytes e pack padrão, 4 ou 8, e também na hipótese com `Word` de 4 bytes e pack 2. Nesse segundo caso, `wIdentificador` ocupa 4 bytes e o alinhamento da estrutura é 2.

candidato byte1-word2-uint32-4-bool1 pack 0 sizeof 12500 alignof 4 ulTipoEntradaCartao 12404
candidato byte1-word2-uint32-4-bool1 pack 1 sizeof 12497 alignof 1 ulTipoEntradaCartao 12402
candidato byte1-word2-uint32-4-bool1 pack 2 sizeof 12498 alignof 2 ulTipoEntradaCartao 12402
candidato byte1-word2-uint32-4-bool1 pack 4 sizeof 12500 alignof 4 ulTipoEntradaCartao 12404
candidato byte1-word2-uint32-4-bool1 pack 8 sizeof 12500 alignof 4 ulTipoEntradaCartao 12404
candidato byte1-word2-uint32-4-bool4 pack 0 sizeof 12500 alignof 4 ulTipoEntradaCartao 12404
candidato byte1-word2-uint32-4-bool4 pack 1 sizeof 12497 alignof 1 ulTipoEntradaCartao 12402
candidato byte1-word2-uint32-4-bool4 pack 2 sizeof 12498 alignof 2 ulTipoEntradaCartao 12402
candidato byte1-word2-uint32-4-bool4 pack 4 sizeof 12500 alignof 4 ulTipoEntradaCartao 12404
candidato byte1-word2-uint32-4-bool4 pack 8 sizeof 12500 alignof 4 ulTipoEntradaCartao 12404
candidato byte1-word2-uint32-4-bool2 pack 0 sizeof 12500 alignof 4 ulTipoEntradaCartao 12404
candidato byte1-word2-uint32-4-bool2 pack 1 sizeof 12497 alignof 1 ulTipoEntradaCartao 12402
candidato byte1-word2-uint32-4-bool2 pack 2 sizeof 12498 alignof 2 ulTipoEntradaCartao 12402
candidato byte1-word2-uint32-4-bool2 pack 4 sizeof 12500 alignof 4 ulTipoEntradaCartao 12404
candidato byte1-word2-uint32-4-bool2 pack 8 sizeof 12500 alignof 4 ulTipoEntradaCartao 12404
candidato byte1-word4-uint32-4-bool1 pack 0 sizeof 12504 alignof 4 ulTipoEntradaCartao 12408
candidato byte1-word4-uint32-4-bool1 pack 1 sizeof 12499 alignof 1 ulTipoEntradaCartao 12404
candidato byte1-word4-uint32-4-bool1 pack 2 sizeof 12500 alignof 2 ulTipoEntradaCartao 12404
candidato byte1-word4-uint32-4-bool1 pack 4 sizeof 12504 alignof 4 ulTipoEntradaCartao 12408
candidato byte1-word4-uint32-4-bool1 pack 8 sizeof 12504 alignof 4 ulTipoEntradaCartao 12408
candidato byte1-word2-uint32-8-bool1 pack 0 sizeof 12520 alignof 8 ulTipoEntradaCartao 12416
candidato byte1-word2-uint32-8-bool1 pack 1 sizeof 12509 alignof 1 ulTipoEntradaCartao 12410
candidato byte1-word2-uint32-8-bool1 pack 2 sizeof 12510 alignof 2 ulTipoEntradaCartao 12410
candidato byte1-word2-uint32-8-bool1 pack 4 sizeof 12512 alignof 4 ulTipoEntradaCartao 12412
candidato byte1-word2-uint32-8-bool1 pack 8 sizeof 12520 alignof 8 ulTipoEntradaCartao 12416

O Pascal local, com `Byte` de 1, `Word` de 2 e `Cardinal` de 4, mede:

- pack 1: sizeof 12497, alignof 1, ulTipoEntradaCartao 12402
- pack 2: sizeof 12498, alignof 2, ulTipoEntradaCartao 12402
- pack 4: sizeof 12500, alignof 4, ulTipoEntradaCartao 12404
- pack 8: sizeof 12500, alignof 4, ulTipoEntradaCartao 12404

`Bool` não aparece em `PW_GetData`. Por isso as três larguras de `Bool` repetem os mesmos números dessa estrutura.

## Estruturas não alocadas pelo agente

`PW_Operations` mediu 43 bytes e alinhamento 1 nas hipóteses compiladas, porque só contém `Byte` e `char`.

`PW_OperationsEx` no pack 8 muda com `Bool`:

- Bool de 1 byte: sizeof 66, bPaymentMode no deslocamento 65
- Bool de 2 bytes: sizeof 68, bPaymentMode no deslocamento 66
- Bool de 4 bytes: sizeof 72, bPaymentMode no deslocamento 68

## Definições que a SETIS precisa confirmar

1. O arquivo `PWL_Type.h` usado para compilar a DLL 4.1.50.924, com `sizeof` e `_Alignof` de `Byte`, `Word`, `Int16`, `Uint16`, `Uint32` e `Bool`.
2. O `#pragma pack`, ou a ausência dele, e o compilador e o alvo usados na DLL.
3. `sizeof`, `_Alignof` e `offsetof` de `PW_GetData` produzidos por essa mesma ferramenta.
4. A largura de `Bool` em `PW_OperationsEx`, se essa estrutura for usada.

Um `sizeof(PW_GetData)` igual a 12500 não escolhe o contrato. Ele ocorre em arranjos diferentes.

## Captura funcional

A página https://paygodev.readme.io/docs/9-captura-de-dados e o `PGWebLib.h` 4.1.50.924 concordam nos valores de `PWDAT_*` e no destino de cada captura:

- `PWDAT_MENU` (1): `PW_iAddParam(wIdentificador, vszValorMenu da opção)`.
- `PWDAT_TYPED` (2): `PW_iAddParam(wIdentificador, valor sem máscara)`. String vazia somente quando `bAceitaNulo` é 1.
- `PWDAT_PPENTRY`, `PWDAT_PPENCPIN`, `PWDAT_CARDOFF`, `PWDAT_CARDONL`, `PWDAT_PPCONF`, `PWDAT_PPREMCRD`, `PWDAT_PPGENCMD`, `PWDAT_PPDATAPOSCNF` e `PWDAT_TSTKEY`: a função de PinPad correspondente, sem `PW_iAddParam`.
- `PWDAT_CARDINF`: `ulTipoEntradaCartao` 1 digita `PWINFO_CARDFULLPAN`; 2 chama `PW_iPPGetCard`; 3 aceita os dois. `PWRET_FALLBACK` passa a aceitar digitação.

Essas regras foram aplicadas no agente Pascal e na máquina simulada. Elas não medem a estrutura na DLL.

A mesma página nomeia `(Word) wIdentificador`, `(Byte) bTipoDeDado` e `(Uint32)` para `ulValorMinimo`, `ulValorMaximo` e `ulTipoEntradaCartao`. Não informa `sizeof`, `_Alignof` nem `#pragma pack`.

O cabeçalho Rich da DLL x64, lido sem carregar a biblioteca, identifica o linker e os compiladores C e C++ do Visual Studio 2010, build 30319. O padrão desse compilador é `unsigned short` de 2 bytes, `unsigned int` de 4 bytes e pack 8. O cabeçalho Rich não registra o typedef `Word` nem um `#pragma pack` que esteja em `PWL_Type.h`.

## O que ainda falta para liberar PW_iExecTransac

Medido no build da DLL x64 4.1.50.924:

1. `sizeof(Word)`. O valor 2 ou 4 separa os dois arranjos que medem 12500 bytes.
2. `_Alignof(PW_GetData)`. Vale 4 quando `Word` tem 2 bytes e pack 4 ou 8. Vale 2 quando `Word` tem 4 bytes e pack 2.
3. O `PWL_Type.h` desse build, ou a confirmação de que não há `#pragma pack` abaixo de 4 e de que `Byte`, `Word` e `Uint32` são `unsigned char`, `unsigned short` e `unsigned int`.

Sem esses três dados, `PWOPER_INSTALL` real continua bloqueado.
