# UltraPDV Connector

Ponte local de periféricos do UltraPDV (SaaS). Nesta versão: impressão.

O cliente **não** instala Next.js, Supabase, Git nem o sistema UltraPDV. Instala só o Connector.

Escuta **somente** `127.0.0.1` (nunca `0.0.0.0`). Porta padrão **18181**. O painel só aceita portas **18181–18190**; se a preferida estiver ocupada, o conector procura a próxima livre nessa faixa.

Não guarda certificado A1, senha, token Geranet nem `SUPABASE_SECRET_KEY`. A configuração de porta é **local da máquina**, não de empresa.

## Cliente

1. Instale `UltraPDV-Conector-Setup.exe`.
2. O ícone aparece na bandeja do Windows (área de notificação).
3. Clique com o botão direito: **Abrir configurações**, **Testar impressão**, **Reiniciar conector**, **Sair**.
4. Duplo clique ou “Abrir configurações” abre o painel em `http://127.0.0.1:<porta>/`.
5. No UltraPDV web: **Configurações → Impressão** deve mostrar **UltraPDV Conector conectado**.

A porta usada fica em `%ProgramData%\UltraPDV\print-agent.json` e sobrevive a reinício do Windows e a atualização do agente.

## TEF em computador novo

O Connector 1.3.41 cobra pela PGWebLib.dll x64 4.1.50.924 carregada com Koffi. O pacote não distribui o agente Pascal. Não usa o PayGo Windows, o Warsaw nem a variável `PathPGWebLib_x64`.

A instalação chega sem ponto de captura, credencial ou servidor. Homologação permanece ao lado do agente. O credenciamento de produção continua no perfil já associado em `%ProgramData%\UltraPDV\TEF\Producao\perfis`. Arquivos gravados pela biblioteca nesse perfil não autorizam cobrança. `PW_iSetEnvironment = 0` configura o ambiente solicitado e `PW_iInit = 0` só confirma a inicialização. As pastas já existentes `C:\UltraPDV-TEF` e `%ProgramData%\UltraPDV\TEF\Producao\PGWeb` não são abertas, copiadas nem apagadas.

No UltraPDV, em Configurações TEF, o estabelecimento escolhe o ambiente, conclui o credenciamento oficial, informa o ponto de captura, identifica o PinPad e só então ativa os pagamentos. Um perfil antigo em `C:\UltraPDV-TEF` ou `%ProgramData%\PayGo` permanece no disco e não é aberto por esta biblioteca.

## Desenvolvimento

```bat
cd print-agent
npm start
```

O painel local e o UltraPDV web usam `/health` para identificar o Connector (`app === "UltraPDV-Conector"` ou `servico === "ultrapdv-connector"`). A faixa de portas é 18181–18190; o web tenta essas portas em sequência em `127.0.0.1`.

Para imprimir em desenvolvimento, o motor precisa de `print-agent\bin\SumatraPDF.exe` **e** `print-agent\bin\libmupdf.dll` (o exe 3.6 sem a DLL abre o instalador). O build copia esse par para `print-engine\` no Setup. O cliente final **não** precisa ter o Sumatra instalado.

## Gerar o Setup.exe

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File print-agent\installer\build.ps1
```

Saída: `print-agent\dist\UltraPDV-Conector-Setup.exe`

Requisitos do build: NSIS 3, `runtime\node.exe`, `bin\SumatraPDF.exe` + `bin\libmupdf.dll`. Se o `bin` estiver incompleto, o build pode copiar o par a partir de `C:\Program Files\SumatraPDF\` **neste computador de build**. O Setup gerado continua autocontido.

## Testes

```bat
cd print-agent
npm test
```
