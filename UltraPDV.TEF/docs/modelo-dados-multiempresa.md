# Proposta de dados — UltraPDV.TEF

Esta etapa não cria tabelas e não altera o banco. O histórico já existente permanece em `tef_operacoes`, `tef_terminais`, `tef_configuracoes`, `tef_ocorrencias_simuladas` e `tef_plataforma`.

## Resolução da empresa

A empresa ativa continua vinda da sessão autenticada no servidor, com vínculo em `usuarios_empresas` (`ativo` e `principal`). O `empresa_id` enviado pelo navegador só é aceito quando já pertence a essa sessão. O PDV e a tela de Configurações não escolhem a empresa sozinhos.

## Isolamento

Cada par empresa e terminal recebe um diretório próprio:

`{raiz}/{empresa}/{terminal}/Data`

`PW_iInit` recebe somente esse diretório. A pasta compartilhada padrão da PGWebLib não é usada. Journals locais ficam em `{raiz}/{empresa}/{terminal}/journals` e a gravação é atômica. A chave idempotente é o nome do arquivo em hash, e o conteúdo guarda `empresa_id`, `terminal_id`, `venda_id` e o identificador da operação.

Uma pendência financeira marca o PinPad físico. Outra empresa não reserva esse equipamento enquanto a pendência existir. Uma sessão ativa recusa a troca de empresa.

## Evolução posterior, ainda sem migration

Quando a instalação oficial for ligada, a configuração por empresa continua em `tef_configuracoes` e o terminal em `tef_terminais`. A operação financeira continua em `tef_operacoes`, com `empresa_id`, `terminal_id`, `venda_id` e chave idempotente. A leitura segue a política de acesso da empresa. Escrita continua pelo servidor, depois da sessão validada.

Não há tabela nova nesta proposta. Um bloqueio de PinPad entre computadores, se for necessário além do processo local, será desenhado numa migration própria antes de qualquer `db push`.
