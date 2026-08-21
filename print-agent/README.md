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

## Desenvolvimento

```bat
cd print-agent
npm start
```

O painel local e o `/health` usam a porta efetiva (pode não ser 18181). O UltraPDV web varre 18181–18190 e só aceita `app === "UltraPDV-Conector"`.

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
