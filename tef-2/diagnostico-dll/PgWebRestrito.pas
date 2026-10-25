unit PgWebRestrito;

{
  Processo de diagnostico com token restrito.
  CreateRestrictedToken sozinho nao e tratado como isolamento:
  a prova abre os diretorios com o token resultante.
  O rotulo baixo vem herdado de LocalLow. Nao altera ACL de producao.
}

{$mode delphi}
{$H+}

interface

uses
  Classes;

function ProcessoBaixo: Boolean;
function FilhoAcesso(const Pasta, Dll, PayGo: string; Baixa: Boolean): Integer;
function ProvarAcessoEfetivo(Linhas: TStringList): Boolean;
function IsolamentoExclusivoAtual: Boolean;

implementation

uses
  SysUtils, Windows;

const
  TOKEN_ASSIGN_PRIMARY = $0001;
  TOKEN_DUPLICATE = $0002;
  TOKEN_QUERY = $0008;
  TOKEN_ADJUST_DEFAULT = $0080;
  TOKEN_ADJUST_PRIVILEGES = $0020;
  TokenUser = 1;
  TokenPrivileges = 3;
  TokenElevation = 20;
  TokenLinkedToken = 19;
  TokenIntegrityLevel = 25;
  SE_GROUP_INTEGRITY = $00000020;
  SE_PRIVILEGE_ENABLED = $00000002;
  CREATE_UNICODE_ENVIRONMENT = $00000400;
  CREATE_NO_WINDOW = $08000000;
  FILE_WRITE_DATA = $0002;
  FILE_ADD_FILE = $0002;
  FILE_EXECUTE = $0020;
  FILE_SHARE_ALL = $00000007;
  OPEN_EXISTING = 3;
  CREATE_ALWAYS = 2;
  FILE_FLAG_BACKUP_SEMANTICS = $02000000;
  GENERIC_READ = $80000000;
  ERROR_NOT_ALL_ASSIGNED = 1300;
  DllKit = 'C:\ultrapdv\20260923-Integracao-PGWebLib_v4.1.50.924\x64\PGWebLib.dll';
  INTEGRIDADE_BAIXA = $1000;

type
  TLUID = record
    LowPart: DWORD;
    HighPart: LongInt;
  end;
  TLUIDAttr = record
    Luid: TLUID;
    Attributes: DWORD;
  end;
  TSidAttr = record
    Sid: Pointer;
    Attributes: DWORD;
  end;
  TLabelObrigatorio = record
    Rotulo: TSidAttr;
  end;
  TPrivUm = record
    Count: DWORD;
    Priv: TLUIDAttr;
  end;
  TStartupW = record
    cb: DWORD;
    lpReserved, lpDesktop, lpTitle: PWideChar;
    dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags: DWORD;
    wShowWindow, cbReserved2: Word;
    lpReserved2, hStdInput, hStdOutput, hStdError: THandle;
  end;
  TProcInfo = record
    hProcess, hThread: THandle;
    dwProcessId, dwThreadId: DWORD;
  end;

function CreateRestrictedToken(Existing: THandle; Flags, DisableCount: DWORD; SidsToDisable: Pointer;
  DeleteCount: DWORD; PrivilegesToDelete: Pointer; RestrictCount: DWORD; SidsToRestrict: Pointer;
  var NewToken: THandle): BOOL; stdcall; external 'advapi32.dll';
function ConvertStringSidToSidW(Texto: PWideChar; var Sid: Pointer): BOOL; stdcall; external 'advapi32.dll';
function CreateProcessAsUserW(Token: THandle; App, Cmd: PWideChar; ProcAttr, ThreadAttr: Pointer;
  Inherit: BOOL; Flags: DWORD; Ambiente: Pointer; Dir: PWideChar;   var Start: TStartupW;
  var Info: PROCESS_INFORMATION): BOOL; stdcall; external 'advapi32.dll';
function LookupPrivilegeValueW(Sistema, Nome: PWideChar; var Luid: TLUID): BOOL; stdcall; external 'advapi32.dll';
function AdjustTokenPrivileges(Token: THandle; DisableAll: BOOL; Novo: Pointer; Tam: DWORD;
  Anterior: Pointer; var Retorno: DWORD): BOOL; stdcall; external 'advapi32.dll';
function GetSidSubAuthority(Sid: Pointer; Indice: DWORD): PDWORD; stdcall; external 'advapi32.dll';
function GetSidSubAuthorityCount(Sid: Pointer): PUCHAR; stdcall; external 'advapi32.dll';
function LocalFree(Mem: Pointer): Pointer; stdcall; external 'kernel32.dll';
function LerToken(Token: THandle; Classe: DWORD; Info: Pointer; Tam: DWORD; var Lidos: DWORD): BOOL; stdcall; external 'advapi32.dll' name 'GetTokenInformation';
function DefinirToken(Token: THandle; Classe: DWORD; Info: Pointer; Tam: DWORD): BOOL; stdcall; external 'advapi32.dll' name 'SetTokenInformation';
function SHGetFolderPathW(Janela: THandle; Tipo: Integer; Token: THandle; Bandeiras: DWORD; Caminho: PWideChar): HRESULT; stdcall; external 'shell32.dll';

function PastaEspecial(Tipo: Integer): string;
var
  Buf: array[0..MAX_PATH] of WideChar;
begin
  Result := '';
  if SHGetFolderPathW(0, Tipo, 0, 0, Buf) = 0 then
    Result := Buf;
end;

function Ambiente(const Nome: string): string;
begin
  Result := SysUtils.GetEnvironmentVariable(Nome);
end;

function Normalizar(const Caminho: string): string;
begin
  Result := LowerCase(ExpandFileName(Caminho));
  Result := StringReplace(Result, '/', '\', [rfReplaceAll]);
end;

function PastaBaixa(const Pasta: string): Boolean;
begin
  Result := Pos('\appdata\locallow\ultrapdv\pgweb-ensaio\', Normalizar(Pasta)) > 0;
end;

function RidIntegridade(Token: THandle): DWORD;
var
  Buf: array[0..255] of Byte;
  Lidos: DWORD;
  Rotulo: ^TSidAttr;
  Contagem: PUCHAR;
begin
  Result := 0;
  Lidos := 0;
  if not LerToken(Token, TokenIntegrityLevel, @Buf, SizeOf(Buf), Lidos) then
    Exit;
  Rotulo := @Buf;
  if Rotulo^.Sid = nil then
    Exit;
  Contagem := GetSidSubAuthorityCount(Rotulo^.Sid);
  if (Contagem = nil) or (Contagem^ = 0) then
    Exit;
  Result := GetSidSubAuthority(Rotulo^.Sid, Contagem^ - 1)^;
end;

function ProcessoBaixo: Boolean;
var
  Token: THandle;
begin
  Result := False;
  if not OpenProcessToken(GetCurrentProcess, TOKEN_QUERY, Token) then
    Exit;
  Result := RidIntegridade(Token) = INTEGRIDADE_BAIXA;
  CloseHandle(Token);
end;

function Abrir(const Caminho: string; Acesso, Bandeiras: DWORD): string;
var
  Handle: THandle;
  Erro: DWORD;
begin
  Handle := CreateFileW(PWideChar(WideString(Caminho)), Acesso, FILE_SHARE_ALL, nil,
    OPEN_EXISTING, Bandeiras, 0);
  if Handle = INVALID_HANDLE_VALUE then
  begin
    Erro := GetLastError;
    if (Erro = ERROR_FILE_NOT_FOUND) or (Erro = ERROR_PATH_NOT_FOUND) then
      Result := 'ausente'
    else if Erro = ERROR_ACCESS_DENIED then
      Result := 'negado'
    else
      Result := 'negado' + IntToStr(Erro);
    Exit;
  end;
  CloseHandle(Handle);
  Result := 'permitido';
end;

function AncestralExistente(const Caminho: string): string;
begin
  Result := Caminho;
  while (Result <> '') and (not DirectoryExists(Result)) and (not FileExists(Result)) do
  begin
    if Result = ExtractFileDir(Result) then
      Exit(Result);
    Result := ExtractFileDir(Result);
  end;
end;

procedure Acrescentar(Linhas: TStringList; const Chave, Valor: string);
begin
  Linhas.Add(Chave + ' ' + Valor);
end;

function GravarSonda(const Pasta: string): string;
var
  Handle: THandle;
  Texto: AnsiString;
  Escritos: DWORD;
begin
  Handle := CreateFileW(PWideChar(WideString(IncludeTrailingPathDelimiter(Pasta) + 'sonda-ok.txt')),
    GENERIC_WRITE, 0, nil, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, 0);
  if Handle = INVALID_HANDLE_VALUE then
    Exit('negado' + IntToStr(GetLastError));
  Texto := 'ok';
  Escritos := 0;
  if not WriteFile(Handle, Texto[1], Length(Texto), Escritos, nil) then
  begin
    CloseHandle(Handle);
    Exit('negado' + IntToStr(GetLastError));
  end;
  CloseHandle(Handle);
  Result := 'permitido';
end;

procedure MedirAcessos(Linhas: TStringList; const Pasta, Dll, PayGoInformado: string; Baixa: Boolean);
var
  Token, Ligado: THandle;
  PayGo, Pai, Versao, Dados, ProgramData, LocalLow, Cache, Repo, Leitura: string;
  Priv: TPrivUm;
  Retorno: DWORD;
  Luid: TLUID;
  Elevado: DWORD;
  Lidos: DWORD;
  Biblioteca: HMODULE;
begin
  ProgramData := IncludeTrailingPathDelimiter(PastaEspecial($0023)) + 'UltraPDV';
  if not Baixa then
  begin
    Acrescentar(Linhas, 'medioProgramData', Abrir(ProgramData, FILE_ADD_FILE, FILE_FLAG_BACKUP_SEMANTICS));
    Exit;
  end;
  Token := 0;
  OpenProcessToken(GetCurrentProcess, TOKEN_QUERY or TOKEN_ADJUST_PRIVILEGES, Token);
  Acrescentar(Linhas, 'integridade', IntToHex(RidIntegridade(Token), 4));
  Elevado := 1;
  Lidos := 0;
  if LerToken(Token, TokenElevation, @Elevado, SizeOf(Elevado), Lidos) then
    Acrescentar(Linhas, 'elevado', IntToStr(Elevado))
  else
    Acrescentar(Linhas, 'elevado', 'erro');
  Ligado := 0;
  if LerToken(Token, TokenLinkedToken, @Ligado, SizeOf(Ligado), Lidos) and (Ligado <> 0) then
  begin
    Acrescentar(Linhas, 'tokenLigado', 'presente');
    CloseHandle(Ligado);
  end
  else
    Acrescentar(Linhas, 'tokenLigado', 'negado');
  FillChar(Priv, SizeOf(Priv), 0);
  Priv.Count := 1;
  if LookupPrivilegeValueW(nil, 'SeDebugPrivilege', Luid) then
  begin
    Priv.Priv.Luid := Luid;
    Priv.Priv.Attributes := SE_PRIVILEGE_ENABLED;
    Retorno := 0;
    AdjustTokenPrivileges(Token, False, @Priv, SizeOf(Priv), nil, Retorno);
    if GetLastError = ERROR_NOT_ALL_ASSIGNED then
      Acrescentar(Linhas, 'ajusteDebug', 'negado')
    else
      Acrescentar(Linhas, 'ajusteDebug', 'permitido');
    Acrescentar(Linhas, 'debugAusente', '1');
  end
  else
    Acrescentar(Linhas, 'ajusteDebug', 'erro');
  if Token <> 0 then
    CloseHandle(Token);
  Dados := IncludeTrailingPathDelimiter(PastaEspecial($0026)) + 'UltraPDV Connector\data';
  Versao := IncludeTrailingPathDelimiter(PastaEspecial($0026)) + 'UltraPDV Connector\version.json';
  Repo := 'C:\ultrapdv';
  LocalLow := IncludeTrailingPathDelimiter(PastaEspecial($0028)) + 'AppData\LocalLow';
  Cache := IncludeTrailingPathDelimiter(PastaEspecial($001C)) + 'Microsoft\Windows\INetCache\Low';
  if PastaBaixa(Pasta) then
    Acrescentar(Linhas, 'escritaEnsaio', GravarSonda(Pasta))
  else
    Acrescentar(Linhas, 'escritaEnsaio', 'recusado');
  Acrescentar(Linhas, 'programData', Abrir(ProgramData, FILE_ADD_FILE, FILE_FLAG_BACKUP_SEMANTICS));
  Acrescentar(Linhas, 'conectorDados', Abrir(Dados, FILE_ADD_FILE, FILE_FLAG_BACKUP_SEMANTICS));
  Acrescentar(Linhas, 'conectorArquivo', Abrir(Versao, FILE_WRITE_DATA, 0));
  Acrescentar(Linhas, 'conectorInstalacao', Abrir(ExtractFileDir(Versao), FILE_ADD_FILE, FILE_FLAG_BACKUP_SEMANTICS));
  PayGo := PayGoInformado;
  if PayGo = '' then
    PayGo := IncludeTrailingPathDelimiter(PastaEspecial($002A)) + 'PayGo';
  if DirectoryExists(PayGo) or FileExists(PayGo) then
  begin
    Acrescentar(Linhas, 'paygoExiste', '1');
    if DirectoryExists(PayGo) then
      Acrescentar(Linhas, 'paygoPerfil', Abrir(PayGo, FILE_ADD_FILE, FILE_FLAG_BACKUP_SEMANTICS))
    else
      Acrescentar(Linhas, 'paygoPerfil', Abrir(ExtractFileDir(PayGo), FILE_ADD_FILE, FILE_FLAG_BACKUP_SEMANTICS));
  end
  else
  begin
    Acrescentar(Linhas, 'paygoExiste', '0');
    Pai := AncestralExistente(PayGo);
    Acrescentar(Linhas, 'paygoPai', Abrir(Pai, FILE_ADD_FILE, FILE_FLAG_BACKUP_SEMANTICS));
  end;
  Acrescentar(Linhas, 'localLow', Abrir(LocalLow, FILE_ADD_FILE, FILE_FLAG_BACKUP_SEMANTICS));
  Acrescentar(Linhas, 'cacheBaixo', Abrir(Cache, FILE_ADD_FILE, FILE_FLAG_BACKUP_SEMANTICS));
  Acrescentar(Linhas, 'repositorio', Abrir(Repo, FILE_ADD_FILE, FILE_FLAG_BACKUP_SEMANTICS));
  Leitura := Abrir(Dll, GENERIC_READ or FILE_EXECUTE, 0);
  Acrescentar(Linhas, 'leituraDll', Leitura);
  Acrescentar(Linhas, 'escritaDll', Abrir(Dll, FILE_WRITE_DATA, 0));
  if (Dll <> '') and (LowerCase(Dll) = LowerCase(DllKit)) and (Leitura = 'permitido') then
  begin
    Biblioteca := LoadLibraryW(PWideChar(WideString(Dll)));
    if Biblioteca = 0 then
      Acrescentar(Linhas, 'cargaDll', 'negado' + IntToStr(GetLastError))
    else
    begin
      FreeLibrary(Biblioteca);
      Acrescentar(Linhas, 'cargaDll', 'permitido');
    end;
  end
  else
    Acrescentar(Linhas, 'cargaDll', 'nao-tentada');
  Acrescentar(Linhas, 'initChamado', '0');
end;

function ValorLinha(Linhas: TStringList; const Chave: string): string;
var
  I, P: Integer;
begin
  Result := '';
  for I := 0 to Linhas.Count - 1 do
  begin
    P := Pos(' ', Linhas[I]);
    if (P > 1) and (Copy(Linhas[I], 1, P - 1) = Chave) then
      Exit(Copy(Linhas[I], P + 1, MaxInt));
  end;
end;

function FilhoAcesso(const Pasta, Dll, PayGo: string; Baixa: Boolean): Integer;
var
  Linhas: TStringList;
  Alvo: string;
begin
  Result := 0;
  Linhas := TStringList.Create;
  try
    MedirAcessos(Linhas, Pasta, Dll, PayGo, Baixa);
    if PastaBaixa(Pasta) then
    begin
      if Baixa then
        Alvo := IncludeTrailingPathDelimiter(Pasta) + 'acesso.txt'
      else
        Alvo := IncludeTrailingPathDelimiter(Pasta) + 'acesso-medio.txt';
      Linhas.SaveToFile(Alvo);
    end
    else
      Result := 6;
  finally
    Linhas.Free;
  end;
end;

function PrivilegiosExtras(var Lista: array of TLUIDAttr): DWORD;
const
  Nomes: array[0..3] of WideString = (
    'SeShutdownPrivilege', 'SeUndockPrivilege', 'SeIncreaseWorkingSetPrivilege', 'SeTimeZonePrivilege'
  );
var
  I, N: Integer;
  Luid: TLUID;
begin
  N := 0;
  for I := 0 to High(Nomes) do
    if LookupPrivilegeValueW(nil, PWideChar(Nomes[I]), Luid) then
    begin
      Lista[N].Luid := Luid;
      Lista[N].Attributes := 0;
      Inc(N);
    end;
  Result := N;
end;

function CriarToken(Baixa, DesativarUsuario: Boolean; out Token: THandle; out Motivo: string): Boolean;
var
  Atual, Restrito: THandle;
  Usuario: array[0..127] of Byte;
  Lidos: DWORD;
  Desativar: TSidAttr;
  Privs: array[0..7] of TLUIDAttr;
  Quantidade: DWORD;
  SidBaixo: Pointer;
  Rotulo: TLabelObrigatorio;
begin
  Result := False;
  Token := 0;
  Motivo := '';
  Atual := 0;
  Restrito := 0;
  SidBaixo := nil;
  if not OpenProcessToken(GetCurrentProcess, TOKEN_DUPLICATE or TOKEN_QUERY or TOKEN_ASSIGN_PRIMARY or TOKEN_ADJUST_DEFAULT, Atual) then
  begin
    Motivo := 'token' + IntToStr(GetLastError);
    Exit;
  end;
  FillChar(Desativar, SizeOf(Desativar), 0);
  Lidos := 0;
  if DesativarUsuario then
  begin
    if not LerToken(Atual, TokenUser, @Usuario, SizeOf(Usuario), Lidos) then
    begin
      Motivo := 'usuario' + IntToStr(GetLastError);
      CloseHandle(Atual);
      Exit;
    end;
    Desativar.Sid := PPointer(@Usuario)^;
  end;
  Quantidade := PrivilegiosExtras(Privs);
  if DesativarUsuario then
  begin
    if not CreateRestrictedToken(Atual, 0, 1, @Desativar, Quantidade, @Privs, 0, nil, Restrito) then
    begin
      Motivo := 'restringir' + IntToStr(GetLastError);
      CloseHandle(Atual);
      Exit;
    end;
  end
  else if not CreateRestrictedToken(Atual, 0, 0, nil, Quantidade, @Privs, 0, nil, Restrito) then
  begin
    Motivo := 'restringir' + IntToStr(GetLastError);
    CloseHandle(Atual);
    Exit;
  end;
  CloseHandle(Atual);
  if Baixa then
  begin
    if not ConvertStringSidToSidW('S-1-16-4096', SidBaixo) then
    begin
      Motivo := 'sid' + IntToStr(GetLastError);
      CloseHandle(Restrito);
      Exit;
    end;
    FillChar(Rotulo, SizeOf(Rotulo), 0);
    Rotulo.Rotulo.Sid := SidBaixo;
    Rotulo.Rotulo.Attributes := SE_GROUP_INTEGRITY;
    if not DefinirToken(Restrito, TokenIntegrityLevel, @Rotulo, SizeOf(Rotulo)) then
    begin
      Motivo := 'integridade' + IntToStr(GetLastError);
      LocalFree(SidBaixo);
      CloseHandle(Restrito);
      Exit;
    end;
    LocalFree(SidBaixo);
  end;
  Token := Restrito;
  Result := True;
end;

function BlocoAmbiente(const Pasta: string): WideString;
begin
  Result :=
    'SystemRoot=' + Ambiente('SystemRoot') + #0 +
    'windir=' + Ambiente('windir') + #0 +
    'PATH=' + Ambiente('SystemRoot') + '\System32' + #0 +
    'TEMP=' + Pasta + #0 +
    'TMP=' + Pasta + #0 +
    'PATHEXT=.EXE' + #0#0;
end;

function ExecutarFilho(Token: THandle; const Argumentos, Pasta: string; out Erro, Codigo: DWORD): Boolean;
var
  Start: TStartupW;
  Info: PROCESS_INFORMATION;
  Cmd, AmbienteTexto: WideString;
begin
  FillChar(Start, SizeOf(Start), 0);
  FillChar(Info, SizeOf(Info), 0);
  Start.cb := SizeOf(Start);
  Cmd := '"' + ParamStr(0) + '" ' + Argumentos;
  UniqueString(Cmd);
  AmbienteTexto := BlocoAmbiente(Pasta);
  UniqueString(AmbienteTexto);
  Result := CreateProcessAsUserW(Token, nil, PWideChar(Cmd), nil, nil, False,
    CREATE_UNICODE_ENVIRONMENT or CREATE_NO_WINDOW, PWideChar(AmbienteTexto),
    PWideChar(WideString(Pasta)), Start, Info);
  Erro := GetLastError;
  Codigo := 0;
  if not Result then
    Exit;
  if WaitForSingleObject(Info.hProcess, 20000) <> WAIT_OBJECT_0 then
    Codigo := $FFFFFFFF
  else
    GetExitCodeProcess(Info.hProcess, Codigo);
  CloseHandle(Info.hThread);
  CloseHandle(Info.hProcess);
end;

function ConcederUsuarios(const Pasta: string): Boolean;
var
  Start: STARTUPINFOW;
  Info: PROCESS_INFORMATION;
  Cmd: WideString;
begin
  FillChar(Start, SizeOf(Start), 0);
  FillChar(Info, SizeOf(Info), 0);
  Start.cb := SizeOf(Start);
  Cmd := WideString(SysUtils.GetEnvironmentVariable('SystemRoot')) + '\System32\icacls.exe "' + Pasta + '" /grant *S-1-5-32-545:(OI)(CI)M';
  UniqueString(Cmd);
  Result := CreateProcessW(nil, PWideChar(Cmd), nil, nil, False, CREATE_NO_WINDOW, nil, nil, Start, Info);
  if not Result then
    Exit;
  WaitForSingleObject(Info.hProcess, 15000);
  CloseHandle(Info.hThread);
  CloseHandle(Info.hProcess);
end;

function CriarPastaProva: string;
var
  Base: string;
begin
  Result := '';
  Base := IncludeTrailingPathDelimiter(Ambiente('USERPROFILE')) + 'AppData\LocalLow\UltraPDV\pgweb-ensaio';
  if not ForceDirectories(Base) then
    Exit;
  Result := IncludeTrailingPathDelimiter(Base) + 'ensaio-' + IntToHex(GetTickCount64, 12);
  if not CreateDir(Result) then
    Result := '';
end;

function LerRelatorio(const Arquivo: string; Linhas: TStringList): Boolean;
var
  Texto: TStringList;
  I: Integer;
begin
  Result := FileExists(Arquivo);
  if not Result then
    Exit;
  Texto := TStringList.Create;
  try
    Texto.LoadFromFile(Arquivo);
    for I := 0 to Texto.Count - 1 do
      Linhas.Add(Texto[I]);
  finally
    Texto.Free;
  end;
end;

function Valor(Linhas: TStringList; const Chave: string): string;
var
  I, P: Integer;
begin
  Result := '';
  for I := 0 to Linhas.Count - 1 do
  begin
    P := Pos(' ', Linhas[I]);
    if (P > 1) and (Copy(Linhas[I], 1, P - 1) = Chave) then
      Exit(Copy(Linhas[I], P + 1, MaxInt));
  end;
end;

function ProvarAcessoEfetivo(Linhas: TStringList): Boolean;
var
  Pasta, Motivo, PayGoFilho: string;
  Token: THandle;
  Erro, Codigo: DWORD;
  ProgramData: string;
begin
  Result := False;
  Acrescentar(Linhas, 'mecanismo', 'CreateRestrictedToken+TokenIntegrityLevel+CreateProcessAsUser');
  Acrescentar(Linhas, 'aclProducaoAlterada', '0');
  Acrescentar(Linhas, 'ausenciaNaoComprova', '1');
  ProgramData := IncludeTrailingPathDelimiter(Ambiente('ProgramData')) + 'UltraPDV';
  Acrescentar(Linhas, 'tokenAtualProgramData', Abrir(ProgramData, FILE_ADD_FILE, FILE_FLAG_BACKUP_SEMANTICS));
  Pasta := CriarPastaProva;
  if Pasta = '' then
  begin
    Acrescentar(Linhas, 'pasta', 'indisponivel');
    Exit;
  end;
  Acrescentar(Linhas, 'pasta', Normalizar(Pasta));
  if not ConcederUsuarios(Pasta) then
    Acrescentar(Linhas, 'concessaoEnsaio', 'erro' + IntToStr(GetLastError))
  else
    Acrescentar(Linhas, 'concessaoEnsaio', 'usuarios');
  if not CriarToken(False, True, Token, Motivo) then
  begin
    Acrescentar(Linhas, 'tokenMedio', Motivo);
    if not CriarToken(False, False, Token, Motivo) then
    begin
      Acrescentar(Linhas, 'tokenMedio', Motivo);
      Exit;
    end;
    Acrescentar(Linhas, 'usuarioDesativado', '0');
  end
  else
    Acrescentar(Linhas, 'usuarioDesativado', '1');
  if not ExecutarFilho(Token, '--acesso-medio "' + Pasta + '"', Pasta, Erro, Codigo) then
    Acrescentar(Linhas, 'processoMedio', 'erro' + IntToStr(Erro))
  else
  begin
    Acrescentar(Linhas, 'processoMedioCodigo', IntToStr(Codigo));
    if not LerRelatorio(IncludeTrailingPathDelimiter(Pasta) + 'acesso-medio.txt', Linhas) then
      Acrescentar(Linhas, 'processoMedio', 'sem-relatorio');
  end;
  CloseHandle(Token);
  if Valor(Linhas, 'medioProgramData') = '' then
  begin
    Acrescentar(Linhas, 'usuarioProcesso', 'inviavel');
    if not CriarToken(False, False, Token, Motivo) then
    begin
      Acrescentar(Linhas, 'tokenMedio', Motivo);
      Exit;
    end;
    if not ExecutarFilho(Token, '--acesso-medio "' + Pasta + '"', Pasta, Erro, Codigo) then
      Acrescentar(Linhas, 'processoMedio', 'erro' + IntToStr(Erro))
    else if not LerRelatorio(IncludeTrailingPathDelimiter(Pasta) + 'acesso-medio.txt', Linhas) then
      Acrescentar(Linhas, 'processoMedio', 'sem-relatorio' + IntToStr(Codigo));
    CloseHandle(Token);
  end;
  if not CriarToken(True, False, Token, Motivo) then
  begin
    Acrescentar(Linhas, 'tokenBaixo', Motivo);
    Exit;
  end;
  PayGoFilho := Ambiente('PathPGWebLib_x64');
  if PayGoFilho = '' then
    PayGoFilho := 'C:\Program Files (x86)\PayGo\PGWebLib\x64\PGWebLib.dll';
  if not ExecutarFilho(Token, '--acesso-efetivo "' + Pasta + '" "' + DllKit + '" "' + PayGoFilho + '"', Pasta, Erro, Codigo) then
  begin
    Acrescentar(Linhas, 'processoBaixo', 'erro' + IntToStr(Erro));
    CloseHandle(Token);
    Exit;
  end;
  Acrescentar(Linhas, 'processoBaixoCodigo', IntToStr(Codigo));
  CloseHandle(Token);
  if not LerRelatorio(IncludeTrailingPathDelimiter(Pasta) + 'acesso.txt', Linhas) then
  begin
    Acrescentar(Linhas, 'processoBaixo', 'sem-relatorio');
    Exit;
  end;
  Result :=
    (Valor(Linhas, 'integridade') = '1000') and
    (Valor(Linhas, 'elevado') = '0') and
    (Valor(Linhas, 'escritaEnsaio') = 'permitido') and
    (Valor(Linhas, 'programData') = 'negado') and
    (Valor(Linhas, 'conectorDados') = 'negado') and
    (Valor(Linhas, 'conectorArquivo') = 'negado') and
    (Valor(Linhas, 'conectorInstalacao') = 'negado') and
    ((Valor(Linhas, 'paygoPai') = 'negado') or (Valor(Linhas, 'paygoPerfil') = 'negado')) and
    (Valor(Linhas, 'localLow') = 'negado') and
    (Valor(Linhas, 'cacheBaixo') = 'negado') and
    (Valor(Linhas, 'repositorio') = 'negado') and
    (Valor(Linhas, 'escritaDll') = 'negado') and
    (Valor(Linhas, 'leituraDll') = 'permitido') and
    (Valor(Linhas, 'cargaDll') = 'permitido') and
    (Valor(Linhas, 'ajusteDebug') = 'negado') and
    (Valor(Linhas, 'tokenLigado') = 'negado') and
    (Valor(Linhas, 'initChamado') = '0') and
    (Valor(Linhas, 'medioProgramData') = 'permitido');
  if Result then
    Acrescentar(Linhas, 'isolamentoExclusivo', '1')
  else
    Acrescentar(Linhas, 'isolamentoExclusivo', '0');
end;

function IsolamentoExclusivoAtual: Boolean;
var
  Linhas: TStringList;
  Pasta: string;
begin
  Result := False;
  Pasta := CriarPastaProva;
  if Pasta = '' then
    Exit;
  ConcederUsuarios(Pasta);
  Linhas := TStringList.Create;
  try
    MedirAcessos(Linhas, Pasta, '', '', True);
    Result :=
      (Valor(Linhas, 'integridade') = '1000') and
      (Valor(Linhas, 'escritaEnsaio') = 'permitido') and
      (Valor(Linhas, 'programData') = 'negado') and
      (Valor(Linhas, 'conectorDados') = 'negado') and
      (Valor(Linhas, 'conectorArquivo') = 'negado') and
      (Valor(Linhas, 'conectorInstalacao') = 'negado') and
      ((Valor(Linhas, 'paygoPai') = 'negado') or (Valor(Linhas, 'paygoPerfil') = 'negado')) and
      (Valor(Linhas, 'localLow') = 'negado') and
      (Valor(Linhas, 'cacheBaixo') = 'negado') and
      (Valor(Linhas, 'repositorio') = 'negado') and
      (Valor(Linhas, 'tokenLigado') = 'negado') and
      (Valor(Linhas, 'initChamado') = '0');
  finally
    Linhas.Free;
  end;
end;

end.
