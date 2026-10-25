program PgWebDiagnostico;

{
  Diagnostico isolado da PGWebLib x64.
  Reaproveita a lista das 44 exportacoes e nao entra no Connector.
  A chamada tipada de PW_iInit usa Int16 de 16 bits.
  O teste de PinPad acrescenta somente PW_iPPCommTest e PW_iPPEventLoop.
  O contrato das demais funcoes nao esta comprovado.
  Sem autorizacao explicita, --init retorna INIT_DESABILITADO.
  --init carrega somente PgWebInitSim.dll.
  --init-real carrega a DLL do kit somente com --autorizado-real,
  PGWEB_INIT_REAL e --aceitar-risco-isolamento.
}

{$mode delphi}
{$H+}
{$APPTYPE CONSOLE}

uses
  Classes,
  SysUtils,
  Windows,
  PgWebRestrito;

type
  Int16 = SmallInt;
  Uint16 = Word;
  Uint32 = LongWord;
  TPwInit = function(pszWorkingDir: PAnsiChar): Int16; stdcall;
  TPwCommTest = function(pszMsg: PAnsiChar; uiMsgSize: Uint16; pbCommPort: PByte): Int16; stdcall;
  TPwEventLoop = function(pszDisplay: PAnsiChar; ulDisplaySize: Uint32): Int16; stdcall;
  TProcessEntry32W = packed record
    dwSize: DWORD;
    cntUsage: DWORD;
    th32ProcessID: DWORD;
    pad1: DWORD;
    th32DefaultHeapID: UInt64;
    th32ModuleID: DWORD;
    cntThreads: DWORD;
    th32ParentProcessID: DWORD;
    pcPriClassBase: LongInt;
    dwFlags: DWORD;
    szExeFile: array[0..259] of WideChar;
    pad2: DWORD;
  end;
  TFoto = record
    Arquivos: TStringList;
    Processos: TStringList;
    Conexoes: Integer;
    ConexoesUdp: Integer;
    Dispositivos: TStringList;
    ArquivosEstado: string;
    ProcessosEstado: string;
    ConexoesEstado: string;
    UdpEstado: string;
    DispositivosEstado: string;
    Endpoints: TStringList;
    EndpointsEstado: string;
  end;
  TTcpDono = packed record
    Estado: DWORD;
    LocalAddr: DWORD;
    LocalPort: DWORD;
    RemotoAddr: DWORD;
    RemotoPort: DWORD;
    Pid: DWORD;
  end;
  PTcpDono = ^TTcpDono;

const
  INIT_PERMITIDO = False;
  FRASE_AUTORIZACAO = 'AUTORIZAR-PW-IINIT-4.1.50.924';
  FRASE_REAL = 'AUTORIZAR-PW-IINIT-REAL-4.1.50.924';
  FRASE_PINPAD = 'AUTORIZAR-PINPAD-SIM-4.1.50.924';
  FRASE_PINPAD_REAL = 'AUTORIZAR-PINPAD-REAL-4.1.50.924';
  HASH_DLL_OFICIAL = 'd17ac81323396ae172648935b0b797b74705b1ca01c9ae0cd3b2ff78119d4220';
  PWRET_OK = Int16(0);
  PWRET_INVPARAM = Int16(-2499);
  PWRET_DISPLAY = Int16(-2495);
  PWRET_INVCALL = Int16(-2494);
  PWRET_NOTHING = Int16(-2493);
  PWRET_CANCEL = Int16(-2491);
  PWRET_TIMEOUT = Int16(-2490);
  PWRET_PPNOTFOUND = Int16(-2489);
  PWRET_DLLNOTINIT = Int16(-2487);
  PWRET_FALLBACK = Int16(-2486);
  PWRET_PPCOMERR = Int16(-2484);
  BUFFER_PINPAD = 128;
  LIMITE_VOLTAS = 40;
  LIMITE_PINPAD_MS = 20000;
  PWRET_WRITERR = Int16(-2485);
  SAIDA_RECUSADO = 6;
  SAIDA_EXISTE = 3;
  SAIDA_JUNCAO = 4;
  SAIDA_MONITOR = 8;
  SAIDA_DLL = 12;
  FILE_LIST_DIRECTORY = $0001;
  FILE_ADD_FILE = $0002;
  FILE_FLAG_BACKUP_SEMANTICS = $02000000;
  FILE_ATTRIBUTE_REPARSE_POINT = $00000400;
  INVALID_FILE_ATTRIBUTES = DWORD($FFFFFFFF);
  TH32CS_SNAPPROCESS = $00000002;
  AF_INET = 2;
  TCP_TABLE_OWNER_PID_ALL = 5;
  UDP_TABLE_OWNER_PID = 1;
  ERROR_INSUFFICIENT_BUFFER = 122;
  DRIVE_REMOTE = 4;
  VOLUME_NAME_DOS = 0;
  NOMES: array[0..43] of AnsiString = (
    'PW_End',
    'PW_iAddParam',
    'PW_iConfirmation',
    'PW_iExecTransac',
    'PW_iGetOperations',
    'PW_iGetOperationsEx',
    'PW_iGetResult',
    'PW_iIdleProc',
    'PW_iInit',
    'PW_iInitProcess',
    'PW_iNewTransac',
    'PW_iPPAbort',
    'PW_iPPAddMenuOption',
    'PW_iPPCommTest',
    'PW_iPPConfirmData',
    'PW_iPPDeleteImage',
    'PW_iPPDisplay',
    'PW_iPPDisplayLoadedImage',
    'PW_iPPEndDisplayImage',
    'PW_iPPEndMenu',
    'PW_iPPEventLoop',
    'PW_iPPFinishChip',
    'PW_iPPGenericCMD',
    'PW_iPPGetCard',
    'PW_iPPGetData',
    'PW_iPPGetPIN',
    'PW_iPPGetPINBlock',
    'PW_iPPGetUserData',
    'PW_iPPGoOnChip',
    'PW_iPPKeepDisplayImage',
    'PW_iPPListImages',
    'PW_iPPLoadImage',
    'PW_iPPMenu',
    'PW_iPPPositiveConfirmation',
    'PW_iPPRemoveCard',
    'PW_iPPSetIdleImage',
    'PW_iPPShowMenu',
    'PW_iPPStartMenu',
    'PW_iPPTestKey',
    'PW_iPPWaitEvent',
    'PW_iRegisterEvent',
    'PW_iSetEnvironment',
    'PW_iTransactionInquiry',
    'PW_iWaitConfirmation'
  );

function CreateToolhelp32Snapshot(dwFlags, th32ProcessID: DWORD): THandle; stdcall; external 'kernel32.dll';
function Process32FirstW(hSnapshot: THandle; var lppe: TProcessEntry32W): BOOL; stdcall; external 'kernel32.dll';
function Process32NextW(hSnapshot: THandle; var lppe: TProcessEntry32W): BOOL; stdcall; external 'kernel32.dll';
function QueryDosDeviceW(Nome, Destino: PWideChar; Tamanho: DWORD): DWORD; stdcall; external 'kernel32.dll';
function GetExtendedTcpTable(Tabela: Pointer; var Tamanho: DWORD; Ordenar: BOOL; Familia: ULONG; Classe: Integer; Reservado: ULONG): DWORD; stdcall; external 'iphlpapi.dll';
function GetExtendedUdpTable(Tabela: Pointer; var Tamanho: DWORD; Ordenar: BOOL; Familia: ULONG; Classe: Integer; Reservado: ULONG): DWORD; stdcall; external 'iphlpapi.dll';
function GetFullPathNameW(Nome: PWideChar; Tamanho: DWORD; Buffer: PWideChar; Parte: Pointer): DWORD; stdcall; external 'kernel32.dll';
function GetFinalPathNameByHandleW(Arquivo: THandle; Buffer: PWideChar; Tamanho, Bandeiras: DWORD): DWORD; stdcall; external 'kernel32.dll';
function BCryptOpenAlgorithmProvider(out Alg: THandle; AlgId, Impl: PWideChar; Flags: ULONG): LongInt; stdcall; external 'bcrypt.dll';
function BCryptCloseAlgorithmProvider(Alg: THandle; Flags: ULONG): LongInt; stdcall; external 'bcrypt.dll';
function BCryptGetProperty(Objeto: THandle; Propriedade: PWideChar; Saida: Pointer; TamSaida: ULONG; out Lidos: ULONG; Flags: ULONG): LongInt; stdcall; external 'bcrypt.dll';
function BCryptCreateHash(Alg: THandle; out Hash: THandle; Objeto: Pointer; TamObjeto: ULONG; Segredo: Pointer; TamSegredo: ULONG; Flags: ULONG): LongInt; stdcall; external 'bcrypt.dll';
function BCryptHashData(Hash: THandle; Dados: Pointer; TamDados: ULONG; Flags: ULONG): LongInt; stdcall; external 'bcrypt.dll';
function BCryptFinishHash(Hash: THandle; Saida: Pointer; TamSaida: ULONG; Flags: ULONG): LongInt; stdcall; external 'bcrypt.dll';
function BCryptDestroyHash(Hash: THandle): LongInt; stdcall; external 'bcrypt.dll';

var
  Relatorio: TStringList;

procedure Emitir(const Chave, Valor: string);
begin
  WriteLn(Chave, ' ', Valor);
  if Relatorio <> nil then
    Relatorio.Add(Chave + ' ' + Valor);
end;

procedure EmitirLimites; forward;

function TextoBaixo(const Valor: string): string;
begin
  Result := LowerCase(Valor);
end;

function Ambiente(const Nome: string): string;
begin
  Result := SysUtils.GetEnvironmentVariable(Nome);
end;

function Normalizar(const Caminho: string): string;
var
  Largo, Buffer: WideString;
  Tamanho: DWORD;
begin
  Largo := Caminho;
  SetLength(Buffer, 1024);
  Tamanho := GetFullPathNameW(PWideChar(Largo), 1024, PWideChar(Buffer), nil);
  if (Tamanho > 0) and (Tamanho < 1024) then
    Result := Copy(Buffer, 1, Tamanho)
  else
    Result := ExpandFileName(Caminho);
  Result := StringReplace(Result, '/', '\', [rfReplaceAll]);
  if Copy(Result, 1, 4) = '\\?\' then
    Delete(Result, 1, 4);
  Result := TextoBaixo(Result);
end;

function Atributos(const Caminho: string): DWORD;
var
  Largo: WideString;
begin
  Largo := Caminho;
  Result := GetFileAttributesW(PWideChar(Largo));
end;

function Existe(const Caminho: string): Boolean;
begin
  Result := Atributos(Caminho) <> INVALID_FILE_ATTRIBUTES;
end;

function EhDiretorio(const Caminho: string): Boolean;
var
  Attr: DWORD;
begin
  Attr := Atributos(Caminho);
  Result := (Attr <> INVALID_FILE_ATTRIBUTES) and ((Attr and FILE_ATTRIBUTE_DIRECTORY) <> 0);
end;

function EhReparse(const Caminho: string): Boolean;
var
  Attr: DWORD;
begin
  Attr := Atributos(Caminho);
  Result := (Attr <> INVALID_FILE_ATTRIBUTES) and ((Attr and FILE_ATTRIBUTE_REPARSE_POINT) <> 0);
end;

function CaminhoFinal(const Pasta: string): string;
var
  Largo, Buffer: WideString;
  Handle: THandle;
  Tamanho: DWORD;
begin
  Result := '';
  Largo := Pasta;
  Handle := CreateFileW(PWideChar(Largo), FILE_LIST_DIRECTORY,
    FILE_SHARE_READ or FILE_SHARE_WRITE or FILE_SHARE_DELETE, nil, OPEN_EXISTING,
    FILE_FLAG_BACKUP_SEMANTICS, 0);
  if Handle = INVALID_HANDLE_VALUE then
    Exit;
  SetLength(Buffer, 1024);
  Tamanho := GetFinalPathNameByHandleW(Handle, PWideChar(Buffer), 1024, VOLUME_NAME_DOS);
  CloseHandle(Handle);
  if (Tamanho = 0) or (Tamanho >= 1024) then
    Exit;
  Result := Normalizar(Copy(Buffer, 1, Tamanho));
end;

function PastaProducao: string;
begin
  Result := IncludeTrailingPathDelimiter(Ambiente('ProgramData')) + 'UltraPDV';
end;

function EmProducao(const Normal: string): Boolean;
var
  Base: string;
begin
  Base := Normalizar(PastaProducao);
  Result :=
    (Pos('\programdata\ultrapdv', Normal) > 0) or
    ((Base <> '') and ((Normal = Base) or (Pos(Base + '\', Normal) = 1)));
end;

function EmPerfilPayGo(const Normal: string): Boolean;
var
  PerfilX86, PerfilX64, Diretorio: string;
begin
  Result :=
    (Pos('\paygo\', Normal) > 0) or
    (Pos('\program files (x86)\paygo', Normal) > 0) or
    (Pos('\program files\paygo', Normal) > 0) or
    (Pos('\ultrapdv\tef\producao', Normal) > 0) or
    (Pos('pos-transac.pgweb.io', Normal) > 0) or
    (Pos('\print-agent\', Normal) > 0);
  PerfilX86 := Ambiente('PathPGWebLib');
  PerfilX64 := Ambiente('PathPGWebLib_x64');
  if PerfilX86 <> '' then
  begin
    Diretorio := Normalizar(ExtractFileDir(PerfilX86));
    if (Diretorio <> '') and ((Normal = Diretorio) or (Pos(Diretorio + '\', Normal) = 1)) then
      Result := True;
  end;
  if PerfilX64 <> '' then
  begin
    Diretorio := Normalizar(ExtractFileDir(PerfilX64));
    if (Diretorio <> '') and ((Normal = Diretorio) or (Pos(Diretorio + '\', Normal) = 1)) then
      Result := True;
  end;
end;

function RaizEnsaio: string;
begin
  Result := Normalizar(ExtractFilePath(ParamStr(0)) + '..\ensaio-init');
end;

function FolhaValida(const Nome: string): Boolean;
var
  I: Integer;
begin
  Result := (Length(Nome) >= 16) and (Length(Nome) <= 40) and (Copy(Nome, 1, 7) = 'ensaio-');
  if not Result then
    Exit;
  for I := 1 to Length(Nome) do
    if not (Nome[I] in ['a'..'z', '0'..'9', '-']) then
      Exit(False);
end;

function AncestralReparse(const Normal: string): Boolean;
var
  Atual, Raiz: string;
begin
  Result := False;
  Raiz := ExtractFileDrive(Normal) + '\';
  Atual := Normal;
  while (Atual <> '') and (TextoBaixo(Atual) <> TextoBaixo(Raiz)) and (Atual <> ExtractFileDrive(Normal)) do
  begin
    if Existe(Atual) and EhReparse(Atual) then
      Exit(True);
    if not Existe(Atual) then
    begin
      Atual := ExtractFileDir(Atual);
      Continue;
    end;
    Atual := ExtractFileDir(Atual);
  end;
end;

function Classificar(const Original: string; out Efetivo, Motivo: string; out Codigo: Integer): Boolean;
var
  Unidade, Pai, Final: string;
begin
  Result := False;
  Codigo := SAIDA_RECUSADO;
  Motivo := 'DIRETORIO_RECUSADO';
  Efetivo := '';
  if (Original = '') or (Length(Original) > 180) or (Pos('..', Original) > 0) then
  begin
    Motivo := 'CAMINHO_RELATIVO';
    Exit;
  end;
  if (Copy(Original, 1, 2) = '\\') or (Copy(TextoBaixo(Original), 1, 8) = '\\?\unc\') then
  begin
    Motivo := 'CAMINHO_REDE';
    Exit;
  end;
  if not ((Length(Original) >= 3) and (Original[2] = ':') and (Original[3] = '\')) then
  begin
    Motivo := 'CAMINHO_RELATIVO';
    Exit;
  end;
  Unidade := Copy(Original, 1, 3);
  if GetDriveType(PChar(Unidade)) = DRIVE_REMOTE then
  begin
    Motivo := 'CAMINHO_REDE';
    Exit;
  end;
  Efetivo := Normalizar(Original);
  if (ExtractFileDrive(Efetivo) = '') or EmProducao(Efetivo) or EmPerfilPayGo(Efetivo) then
    Exit;
  if AncestralReparse(Efetivo) or EhReparse(Efetivo) then
  begin
    Codigo := SAIDA_JUNCAO;
    Motivo := 'JUNCAO_RECUSADA';
    Exit;
  end;
  if Pos('\tef-2\diagnostico-dll\ensaio-init\', Efetivo) = 0 then
    Exit;
  Pai := ExtractFileDir(Efetivo);
  if TextoBaixo(Pai) <> RaizEnsaio then
    Exit;
  if not FolhaValida(ExtractFileName(Efetivo)) then
    Exit;
  if not EhDiretorio(Pai) then
  begin
    Motivo := 'PAI_AUSENTE';
    Exit;
  end;
  Final := CaminhoFinal(Pai);
  if (Final = '') or (Final <> Normalizar(Pai)) then
  begin
    Codigo := SAIDA_JUNCAO;
    Motivo := 'JUNCAO_RECUSADA';
    Exit;
  end;
  if Existe(Efetivo) then
  begin
    Codigo := SAIDA_EXISTE;
    Motivo := 'DIRETORIO_EXISTE';
    Exit;
  end;
  Result := True;
  Codigo := 0;
  Motivo := 'DIRETORIO_EXCLUSIVO';
end;

function EhDllOficial(const Dll: string): Boolean;
begin
  Result := TextoBaixo(ExtractFileName(Dll)) = 'pgweblib.dll';
end;

function EhSimulador(const Dll: string): Boolean;
begin
  Result := TextoBaixo(ExtractFileName(Dll)) = 'pgwebinitsim.dll';
end;

function Autorizado(const Argumentos: array of string): Boolean;
var
  I: Integer;
  Explicito: Boolean;
begin
  Explicito := False;
  for I := 0 to High(Argumentos) do
    if TextoBaixo(Argumentos[I]) = '--autorizado' then
      Explicito := True;
  Result := Explicito and (Ambiente('PGWEB_INIT_AUTORIZACAO') = FRASE_AUTORIZACAO);
end;

procedure Arquitetura;
begin
  {$IF SizeOf(Int16) <> 2}
  {$ERROR Int16 precisa ter 16 bits}
  {$ENDIF}
  Emitir('arquitetura', 'x64');
  Emitir('sizeofPointer', IntToStr(SizeOf(Pointer)));
  Emitir('larguraInt16', IntToStr(SizeOf(Int16)));
  Emitir('initPermitido', IntToStr(Ord(INIT_PERMITIDO)));
  Emitir('contratoOutrasFuncoes', 'nao-comprovado');
  Emitir('chamadas', '0');
  Emitir('initChamado', '0');
  Emitir('dllCarregada', '0');
  Emitir('dllReal', '0');
end;

procedure LiberarFoto(var Foto: TFoto);
begin
  Foto.Arquivos.Free;
  Foto.Processos.Free;
  Foto.Dispositivos.Free;
  Foto.Endpoints.Free;
end;

function EnderecoIpv4(Valor: DWORD): string;
begin
  Result := IntToStr(Valor and $FF) + '.' + IntToStr((Valor shr 8) and $FF) + '.' +
    IntToStr((Valor shr 16) and $FF) + '.' + IntToStr((Valor shr 24) and $FF);
end;

function PortaRede(Valor: DWORD): string;
begin
  Result := IntToStr(((Valor and $FF) shl 8) or ((Valor shr 8) and $FF));
end;

procedure AnotarTcp(Tabela: Pointer; Tamanho: DWORD; Lista: TStringList);
var
  Numero, I: Integer;
  Linha: PTcpDono;
begin
  if (Tabela = nil) or (Tamanho < 4) or (Lista = nil) then
    Exit;
  Numero := Integer(PDWORD(Tabela)^);
  if (Numero < 0) or (Tamanho < DWORD(4 + Numero * SizeOf(TTcpDono))) then
    Exit;
  for I := 0 to Numero - 1 do
  begin
    Linha := PTcpDono(PByte(Tabela) + 4 + I * SizeOf(TTcpDono));
    Lista.Add(IntToStr(Linha^.Pid) + ' ' + IntToStr(Linha^.Estado) + ' ' +
      EnderecoIpv4(Linha^.LocalAddr) + ':' + PortaRede(Linha^.LocalPort) + ' ' +
      EnderecoIpv4(Linha^.RemotoAddr) + ':' + PortaRede(Linha^.RemotoPort));
  end;
  Lista.Sort;
end;

function MonitorForcado: Boolean;
begin
  Result := Ambiente('PGWEB_MONITOR_FALHA') = '1';
end;

function Capturar(const Diretorio: string): TFoto;
var
  Info: TSearchRec;
  FotoProc: THandle;
  Entrada: TProcessEntry32W;
  Tabela: Pointer;
  Tamanho, Estado: DWORD;
  Indice: Integer;
  Nome, Destino: WideString;
begin
  Result.Arquivos := TStringList.Create;
  Result.Processos := TStringList.Create;
  Result.Dispositivos := TStringList.Create;
  Result.Endpoints := TStringList.Create;
  Result.EndpointsEstado := 'nao-capturado';
  Result.Conexoes := -1;
  Result.ConexoesUdp := -1;
  Result.ArquivosEstado := 'nao-capturado';
  Result.ProcessosEstado := 'nao-capturado';
  Result.ConexoesEstado := 'nao-capturado';
  Result.UdpEstado := 'nao-capturado';
  Result.DispositivosEstado := 'nao-capturado';
  if MonitorForcado then
    Exit;
  if not Existe(Diretorio) then
    Result.ArquivosEstado := 'observado'
  else if FindFirst(IncludeTrailingPathDelimiter(Diretorio) + '*', faAnyFile, Info) = 0 then
  begin
    repeat
      if (Info.Name <> '.') and (Info.Name <> '..') then
        Result.Arquivos.Add(TextoBaixo(Info.Name) + ':' + IntToStr(Info.Size) + ':' + IntToStr(Info.Time));
    until SysUtils.FindNext(Info) <> 0;
    SysUtils.FindClose(Info);
    Result.ArquivosEstado := 'observado';
  end
  else
    Result.ArquivosEstado := 'observado';
  FotoProc := CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if FotoProc <> INVALID_HANDLE_VALUE then
  begin
    FillChar(Entrada, SizeOf(Entrada), 0);
    Entrada.dwSize := SizeOf(Entrada);
    if Process32FirstW(FotoProc, Entrada) then
    begin
      repeat
        Result.Processos.Add(IntToStr(Entrada.th32ProcessID) + ' ' + TextoBaixo(Entrada.szExeFile));
      until not Process32NextW(FotoProc, Entrada);
      Result.ProcessosEstado := 'observado';
    end;
    CloseHandle(FotoProc);
  end;
  Tamanho := 0;
  Estado := GetExtendedTcpTable(nil, Tamanho, False, AF_INET, TCP_TABLE_OWNER_PID_ALL, 0);
  if (Estado = ERROR_INSUFFICIENT_BUFFER) and (Tamanho >= 4) then
  begin
    GetMem(Tabela, Tamanho);
    try
      if GetExtendedTcpTable(Tabela, Tamanho, False, AF_INET, TCP_TABLE_OWNER_PID_ALL, 0) = 0 then
      begin
        Result.Conexoes := Integer(PDWORD(Tabela)^);
        AnotarTcp(Tabela, Tamanho, Result.Endpoints);
        if Result.Endpoints.Count = Result.Conexoes then
        begin
          Result.ConexoesEstado := 'observado';
          Result.EndpointsEstado := 'observado';
        end;
      end;
    finally
      FreeMem(Tabela);
    end;
  end;
  Tamanho := 0;
  Estado := GetExtendedUdpTable(nil, Tamanho, False, AF_INET, UDP_TABLE_OWNER_PID, 0);
  if (Estado = ERROR_INSUFFICIENT_BUFFER) and (Tamanho >= 4) then
  begin
    GetMem(Tabela, Tamanho);
    try
      if GetExtendedUdpTable(Tabela, Tamanho, False, AF_INET, UDP_TABLE_OWNER_PID, 0) = 0 then
      begin
        Result.ConexoesUdp := Integer(PDWORD(Tabela)^);
        Result.UdpEstado := 'observado';
      end;
    finally
      FreeMem(Tabela);
    end;
  end;
  SetLength(Destino, 256);
  for Indice := 1 to 32 do
  begin
    Nome := 'COM' + IntToStr(Indice);
    if QueryDosDeviceW(PWideChar(Nome), PWideChar(Destino), 256) <> 0 then
      Result.Dispositivos.Add(string(Nome));
  end;
  Result.DispositivosEstado := 'observado';
end;

function MonitorCompleto(const Foto: TFoto): Boolean;
begin
  Result :=
    (Foto.ArquivosEstado = 'observado') and
    (Foto.ProcessosEstado = 'observado') and
    (Foto.ConexoesEstado = 'observado') and
    (Foto.DispositivosEstado = 'observado');
end;

procedure EmitirCanal(const Nome, Estado: string);
begin
  Emitir('canal', Nome + ' ' + Estado);
end;

procedure EmitirEvidencia(const Rotulo: string; const Foto: TFoto);
begin
  EmitirCanal('arquivos-' + Rotulo, Foto.ArquivosEstado);
  EmitirCanal('processos-' + Rotulo, Foto.ProcessosEstado);
  EmitirCanal('conexoes-' + Rotulo, Foto.ConexoesEstado);
  EmitirCanal('dispositivos-' + Rotulo, Foto.DispositivosEstado);
  EmitirCanal('udp-' + Rotulo, Foto.UdpEstado);
  EmitirCanal('tentativaDispositivo-' + Rotulo, 'nao-capturado');
  EmitirCanal('leituraArquivo-' + Rotulo, 'nao-capturado');
  Emitir('arquivos' + Rotulo, IntToStr(Foto.Arquivos.Count));
  Emitir('processos' + Rotulo, IntToStr(Foto.Processos.Count));
  if Foto.ConexoesEstado = 'observado' then
    Emitir('conexoes' + Rotulo, IntToStr(Foto.Conexoes))
  else
    Emitir('conexoes' + Rotulo, 'nao-capturado');
  if Foto.UdpEstado = 'observado' then
    Emitir('udp' + Rotulo, IntToStr(Foto.ConexoesUdp))
  else
    Emitir('udp' + Rotulo, 'nao-capturado');
  Emitir('dispositivos' + Rotulo, IntToStr(Foto.Dispositivos.Count));
end;

procedure EmitirDelta(const Antes, Depois: TFoto);
var
  I, Novas: Integer;
begin
  if (Antes.ArquivosEstado = 'observado') and (Depois.ArquivosEstado = 'observado') then
  begin
    for I := 0 to Depois.Arquivos.Count - 1 do
      if Antes.Arquivos.IndexOf(Depois.Arquivos[I]) < 0 then
        Emitir('arquivoCriado', Depois.Arquivos[I]);
    Emitir('deltaArquivos', 'observado');
    Emitir('conteudoArquivo', 'nao-capturado');
  end
  else
    Emitir('deltaArquivos', 'nao-capturado');
  if (Antes.ProcessosEstado = 'observado') and (Depois.ProcessosEstado = 'observado') then
  begin
    for I := 0 to Depois.Processos.Count - 1 do
      if Antes.Processos.IndexOf(Depois.Processos[I]) < 0 then
        Emitir('processoCriado', Depois.Processos[I]);
    Emitir('deltaProcessos', 'observado');
  end
  else
    Emitir('deltaProcessos', 'nao-capturado');
  if (Antes.ConexoesEstado = 'observado') and (Depois.ConexoesEstado = 'observado') then
  begin
    Emitir('deltaConexoes', IntToStr(Depois.Conexoes - Antes.Conexoes));
    Novas := 0;
    for I := 0 to Depois.Endpoints.Count - 1 do
      if Antes.Endpoints.IndexOf(Depois.Endpoints[I]) < 0 then
      begin
        Emitir('redeEvento', Depois.Endpoints[I]);
        Inc(Novas);
      end;
    if Novas = 0 then
      Emitir('redeEvento', 'nenhum');
    Emitir('redeDelta', 'observado');
  end
  else
  begin
    Emitir('deltaConexoes', 'nao-capturado');
    Emitir('redeDelta', 'nao-capturado');
  end;
  if (Antes.UdpEstado = 'observado') and (Depois.UdpEstado = 'observado') then
    Emitir('deltaUdp', IntToStr(Depois.ConexoesUdp - Antes.ConexoesUdp))
  else
    Emitir('deltaUdp', 'nao-capturado');
  if (Antes.DispositivosEstado = 'observado') and (Depois.DispositivosEstado = 'observado') then
  begin
    for I := 0 to Depois.Dispositivos.Count - 1 do
      if Antes.Dispositivos.IndexOf(Depois.Dispositivos[I]) < 0 then
        Emitir('dispositivoCriado', Depois.Dispositivos[I]);
    Emitir('deltaDispositivos', 'observado');
  end
  else
    Emitir('deltaDispositivos', 'nao-capturado');
  Emitir('tentativaDispositivo', 'nao-capturado');
  Emitir('ausenciaNaoComprova', '1');
end;

function ChamarInitTipado(Lib: HMODULE; const Diretorio: AnsiString): Int16;
var
  Funcao: TPwInit;
  Buffer: AnsiString;
begin
  Funcao := TPwInit(GetProcAddress(Lib, 'PW_iInit'));
  if not Assigned(Funcao) then
  begin
    Emitir('resultado', 'FUNCAO_AUSENTE');
    Halt(SAIDA_DLL);
  end;
  Buffer := Diretorio;
  Result := Funcao(PAnsiChar(Buffer));
end;

function NomeRetorno(Valor: Int16): string;
begin
  if Valor = PWRET_OK then
    Exit('PWRET_OK');
  if Valor = PWRET_INVPARAM then
    Exit('PWRET_INVPARAM');
  if Valor = PWRET_DISPLAY then
    Exit('PWRET_DISPLAY');
  if Valor = PWRET_INVCALL then
    Exit('PWRET_INVCALL');
  if Valor = PWRET_NOTHING then
    Exit('PWRET_NOTHING');
  if Valor = PWRET_CANCEL then
    Exit('PWRET_CANCEL');
  if Valor = PWRET_TIMEOUT then
    Exit('PWRET_TIMEOUT');
  if Valor = PWRET_PPNOTFOUND then
    Exit('PWRET_PPNOTFOUND');
  if Valor = PWRET_DLLNOTINIT then
    Exit('PWRET_DLLNOTINIT');
  if Valor = PWRET_FALLBACK then
    Exit('PWRET_FALLBACK');
  if Valor = PWRET_WRITERR then
    Exit('PWRET_WRITERR');
  if Valor = PWRET_PPCOMERR then
    Exit('PWRET_PPCOMERR');
  Result := 'PWRET_OUTRO';
end;

function TextoAnsi(const Buffer: AnsiString): string;
var
  I: Integer;
  C: Char;
begin
  Result := '';
  for I := 1 to Length(Buffer) do
  begin
    if Buffer[I] = #0 then
      Break;
    C := Char(Buffer[I]);
    if (C < ' ') or (C > '~') then
      C := ' ';
    Result := Result + C;
    if Length(Result) >= 100 then
      Break;
  end;
end;

function EhPinPadSim(const Dll: string): Boolean;
begin
  Result := TextoBaixo(ExtractFileName(Dll)) = 'pgwebpinpadsim.dll';
end;

procedure ExecutarPinPad(Lib: HMODULE; const Diretorio: AnsiString; Simulado: Boolean);
var
  Comm: TPwCommTest;
  Evento: TPwEventLoop;
  Pasta, Mensagem, Display: AnsiString;
  Retorno: Int16;
  Porta: Byte;
  Volta: Integer;
  Inicio, Marca: UInt64;
begin
  {$IF SizeOf(Int16) <> 2}
  {$ERROR Int16 precisa ter 16 bits}
  {$ENDIF}
  {$IF SizeOf(Uint16) <> 2}
  {$ERROR Uint16 precisa ter 16 bits}
  {$ENDIF}
  {$IF SizeOf(Uint32) <> 4}
  {$ERROR Uint32 precisa ter 32 bits}
  {$ENDIF}
  {$IF SizeOf(Byte) <> 1}
  {$ERROR Byte precisa ter 8 bits}
  {$ENDIF}
  Emitir('larguraUint16', IntToStr(SizeOf(Uint16)));
  Emitir('larguraUint32', IntToStr(SizeOf(Uint32)));
  Emitir('larguraByte', IntToStr(SizeOf(Byte)));
  Emitir('buffer', IntToStr(BUFFER_PINPAD));
  Emitir('tiposKit', 'nao-comprovado');
  Comm := TPwCommTest(GetProcAddress(Lib, 'PW_iPPCommTest'));
  Evento := TPwEventLoop(GetProcAddress(Lib, 'PW_iPPEventLoop'));
  if not Assigned(Comm) or not Assigned(Evento) then
  begin
    Emitir('resultado', 'FUNCAO_AUSENTE');
    Halt(SAIDA_DLL);
  end;
  Pasta := Diretorio;
  Retorno := ChamarInitTipado(Lib, Pasta);
  Emitir('initChamado', '1');
  Emitir('chamadas', '1');
  Emitir('initRetorno', IntToStr(Retorno));
  Emitir('initNome', NomeRetorno(Retorno));
  if Retorno <> PWRET_OK then
  begin
    Emitir('commTestChamado', '0');
    Emitir('eventLoopChamado', '0');
    Emitir('resultado', 'INIT_RECUSADO');
    Exit;
  end;
  SetLength(Mensagem, BUFFER_PINPAD);
  FillChar(Mensagem[1], BUFFER_PINPAD, 0);
  Porta := $FF;
  Retorno := Comm(PAnsiChar(Mensagem), BUFFER_PINPAD, @Porta);
  Emitir('commTestChamado', '1');
  Emitir('chamadas', '2');
  Emitir('commTestRetorno', IntToStr(Retorno));
  Emitir('commTestNome', NomeRetorno(Retorno));
  Emitir('porta', IntToHex(Porta, 2));
  if (Retorno = PWRET_NOTHING) or (Retorno = PWRET_DISPLAY) then
    Emitir('mensagem', TextoAnsi(Mensagem));
  if Retorno <> PWRET_OK then
  begin
    Emitir('eventLoopChamado', '0');
    if Simulado then
      Emitir('resultado', 'PINPAD_SIMULADO')
    else
      Emitir('resultado', 'PINPAD_INTERROMPIDO');
    Exit;
  end;
  Inicio := GetTickCount64;
  Volta := 0;
  repeat
    Inc(Volta);
    SetLength(Display, BUFFER_PINPAD);
    FillChar(Display[1], BUFFER_PINPAD, 0);
    Marca := GetTickCount64;
    Retorno := Evento(PAnsiChar(Display), BUFFER_PINPAD);
    Emitir('eventLoopChamado', '1');
    Emitir('volta', IntToStr(Volta));
    Emitir('eventoRetorno', IntToStr(Retorno));
    Emitir('eventoNome', NomeRetorno(Retorno));
    Emitir('eventoMs', IntToStr(GetTickCount64 - Marca));
    if (Retorno = PWRET_DISPLAY) or (Retorno = PWRET_NOTHING) then
      Emitir('mensagem', TextoAnsi(Display));
    if (Retorno <> PWRET_NOTHING) and (Retorno <> PWRET_DISPLAY) then
      Break;
  until (Volta >= LIMITE_VOLTAS) or (GetTickCount64 - Inicio >= LIMITE_PINPAD_MS);
  Emitir('voltas', IntToStr(Volta));
  Emitir('chamadas', IntToStr(2 + Volta));
  if (Retorno = PWRET_NOTHING) or (Retorno = PWRET_DISPLAY) then
    Emitir('resultado', 'PINPAD_LIMITE')
  else if Simulado then
    Emitir('resultado', 'PINPAD_SIMULADO')
  else if Retorno = PWRET_OK then
    Emitir('resultado', 'PINPAD_OK')
  else
    Emitir('resultado', 'PINPAD_INTERROMPIDO');
end;

procedure Recusar(const Motivo: string; Codigo: Integer);
begin
  Emitir('resultado', Motivo);
  Emitir('initChamado', '0');
  Emitir('dllCarregada', '0');
  Emitir('dllReal', '0');
  Halt(Codigo);
end;

procedure Ensaiar(const Dll, Diretorio: string; const Argumentos: array of string);
var
  Efetivo, Motivo, PastaMonitor: string;
  Codigo: Integer;
  Antes, Depois: TFoto;
  Lib: HMODULE;
  Retorno: Int16;
  DiretorioA: AnsiString;
begin
  Arquitetura;
  if not Classificar(Diretorio, Efetivo, Motivo, Codigo) then
    Recusar(Motivo, Codigo);
  Emitir('diretorio', Efetivo);
  Emitir('diretorioEfetivo', Efetivo);
  if not Autorizado(Argumentos) then
  begin
    Emitir('resultado', 'INIT_DESABILITADO');
    Emitir('initChamado', '0');
    Emitir('dllCarregada', '0');
    Halt(0);
  end;
  if not EhSimulador(Dll) then
    Recusar('DLL_REAL_BLOQUEADA', SAIDA_DLL);
  if not FileExists(Dll) then
    Recusar('DLL_AUSENTE', SAIDA_DLL);
  Antes := Capturar(Efetivo);
  try
    EmitirEvidencia('Antes', Antes);
    if not MonitorCompleto(Antes) then
      Recusar('MONITOR_INCOMPLETO', SAIDA_MONITOR);
    if not CreateDir(Efetivo) then
      Recusar('ERRO_GRAVACAO', SAIDA_RECUSADO);
    if Ambiente('PGWEB_PROVA_GRAVACAO') = 'falha' then
    begin
      Emitir('resultado', 'ERRO_GRAVACAO');
      Emitir('initChamado', '0');
      Emitir('dllCarregada', '0');
      Halt(0);
    end;
    Lib := LoadLibraryA(PAnsiChar(AnsiString(Dll)));
    if Lib = 0 then
      Recusar('LOADLIBRARY_FALHOU', SAIDA_DLL);
    Emitir('dllCarregada', '1');
    Emitir('dllReal', '0');
    DiretorioA := AnsiString(Efetivo);
    Retorno := ChamarInitTipado(Lib, DiretorioA);
    FreeLibrary(Lib);
    Emitir('initChamado', '1');
    Emitir('chamadas', '1');
    Emitir('retorno', IntToStr(Retorno));
    Emitir('larguraRetorno', IntToStr(SizeOf(Retorno)));
    Depois := Capturar(Efetivo);
    try
      EmitirEvidencia('Depois', Depois);
      EmitirDelta(Antes, Depois);
    finally
      LiberarFoto(Depois);
    end;
    if Retorno = PWRET_WRITERR then
      Emitir('resultado', 'ERRO_GRAVACAO')
    else
      Emitir('resultado', 'RETORNO_SIMULADO');
  finally
    LiberarFoto(Antes);
  end;
  EmitirLimites;
  PastaMonitor := IncludeTrailingPathDelimiter(ExtractFilePath(ParamStr(0))) + 'monitor';
  ForceDirectories(PastaMonitor);
  if Relatorio <> nil then
    Relatorio.SaveToFile(IncludeTrailingPathDelimiter(PastaMonitor) + 'relatorio.txt');
end;

procedure Resolver(const Dll: string);
var
  Lib: HMODULE;
  I, Achadas: Integer;
  Endereco: Pointer;
begin
  Arquitetura;
  if EhDllOficial(Dll) or EmProducao(Normalizar(Dll)) or EmPerfilPayGo(Normalizar(Dll)) then
    Recusar('DLL_REAL_BLOQUEADA', SAIDA_DLL);
  if not FileExists(Dll) then
    Recusar('DLL_AUSENTE', 2);
  Lib := LoadLibraryA(PAnsiChar(AnsiString(Dll)));
  if Lib = 0 then
    Recusar('LOADLIBRARY_FALHOU', 4);
  Achadas := 0;
  for I := 0 to High(NOMES) do
  begin
    Endereco := GetProcAddress(Lib, PAnsiChar(NOMES[I]));
    if Endereco = nil then
      Emitir('ausente', string(NOMES[I]))
    else
    begin
      Inc(Achadas);
      Emitir('exportada', string(NOMES[I]));
    end;
  end;
  FreeLibrary(Lib);
  Emitir('dllCarregada', '1');
  Emitir('dllReal', '0');
  Emitir('resolvidas', IntToStr(Achadas));
  Emitir('esperadas', IntToStr(Length(NOMES)));
  Emitir('initChamado', '0');
  Emitir('resultado', 'EXPORTACOES_CONSULTADAS');
end;

procedure GerarDiretorio;
var
  Base, Destino: string;
  Tentativa: Integer;
begin
  Arquitetura;
  Base := RaizEnsaio;
  if not EhDiretorio(Base) then
    if not ForceDirectories(Base) then
      Recusar('PAI_AUSENTE', SAIDA_RECUSADO);
  if EhReparse(Base) then
    Recusar('JUNCAO_RECUSADA', SAIDA_JUNCAO);
  for Tentativa := 0 to 20 do
  begin
    Destino := IncludeTrailingPathDelimiter(Base) + 'ensaio-' + IntToHex(GetTickCount64 + QWord(Tentativa), 12);
    if not Existe(Destino) and CreateDir(Destino) then
    begin
      Emitir('diretorio', Normalizar(Destino));
      Emitir('resultado', 'DIRETORIO_NOVO');
      Emitir('initChamado', '0');
      Emitir('dllCarregada', '0');
      Exit;
    end;
    Sleep(1);
  end;
  Recusar('ERRO_GRAVACAO', SAIDA_RECUSADO);
end;

function AcessoDireito(const Pasta: string; Direito: DWORD): string;
var
  Largo: WideString;
  Handle: THandle;
  Erro: DWORD;
begin
  if not EhDiretorio(Pasta) then
    Exit('ausente');
  Largo := Pasta;
  Handle := CreateFileW(PWideChar(Largo), Direito,
    FILE_SHARE_READ or FILE_SHARE_WRITE or FILE_SHARE_DELETE, nil, OPEN_EXISTING,
    FILE_FLAG_BACKUP_SEMANTICS, 0);
  if Handle <> INVALID_HANDLE_VALUE then
  begin
    CloseHandle(Handle);
    Exit('permitido');
  end;
  Erro := GetLastError;
  if Erro = ERROR_ACCESS_DENIED then
    Result := 'negado'
  else
    Result := 'erro' + IntToStr(Erro);
end;

function Acesso(const Pasta: string): string;
begin
  Result := AcessoDireito(Pasta, FILE_LIST_DIRECTORY or FILE_ADD_FILE);
end;

procedure EmitirLimites;
begin
  Emitir('naoObservavel', 'leituraDeArquivo');
  Emitir('naoObservavel', 'gravacaoSemMudarTamanho');
  Emitir('naoObservavel', 'exclusaoEntreAmostras');
  Emitir('naoObservavel', 'processoDeCurtaDuracao');
  Emitir('naoObservavel', 'conexaoEncerradaEntreAmostras');
  Emitir('naoObservavel', 'dns');
  Emitir('naoObservavel', 'aberturaDeDispositivo');
  Emitir('naoObservavel', 'insercaoUsb');
  Emitir('naoObservavel', 'acessoAoRegistro');
  Emitir('naoObservavel', 'escritaEmOutroRotuloBaixo');
  Emitir('ausenciaNaoComprova', '1');
end;

procedure EmitirAcesso(const Nome, Pasta: string);
begin
  Emitir('leitura' + Nome, AcessoDireito(Pasta, FILE_LIST_DIRECTORY));
  Emitir('escrita' + Nome, AcessoDireito(Pasta, FILE_ADD_FILE));
end;

procedure ProvarEscritaEnsaio;
var
  Base, Sonda: string;
  Arquivo: TextFile;
begin
  Base := RaizEnsaio;
  if not EhDiretorio(Base) then
    ForceDirectories(Base);
  Sonda := IncludeTrailingPathDelimiter(Base) + '.permissao-ensaio';
  try
    AssignFile(Arquivo, Sonda);
    Rewrite(Arquivo);
    WriteLn(Arquivo, 'sonda');
    CloseFile(Arquivo);
    SysUtils.DeleteFile(Sonda);
    Emitir('acessoEscritaEnsaio', 'permitido');
    Emitir('acessoLeituraEnsaio', 'permitido');
  except
    Emitir('acessoEscritaEnsaio', 'negado');
  end;
end;

procedure Conta;
var
  PayGo, Conector, ConectorDados, Perfil: string;
  EscritaHerdada: Boolean;
begin
  Arquitetura;
  Emitir('resultado', 'CONTA');
  Emitir('usuario', TextoBaixo(Ambiente('USERNAME')));
  Emitir('contaDiagnostico', 'ausente');
  if Ambiente('PathPGWebLib') = '' then
    Emitir('pathPgweb', 'ausente')
  else
    Emitir('pathPgweb', 'presente');
  if Ambiente('PathPGWebLib_x64') = '' then
    Emitir('pathPgwebX64', 'ausente')
  else
    Emitir('pathPgwebX64', 'presente');
  PayGo := '';
  if Ambiente('PathPGWebLib_x64') <> '' then
    PayGo := ExtractFileDir(Ambiente('PathPGWebLib_x64'));
  Conector := IncludeTrailingPathDelimiter(Ambiente('ProgramFiles')) + 'UltraPDV Connector';
  ConectorDados := IncludeTrailingPathDelimiter(Conector) + 'data';
  Perfil := IncludeTrailingPathDelimiter(PastaProducao) + 'TEF\Producao';
  EmitirAcesso('Producao', PastaProducao);
  EmitirAcesso('Perfil', Perfil);
  EmitirAcesso('Paygo', PayGo);
  EmitirAcesso('Conector', Conector);
  EmitirAcesso('ConectorDados', ConectorDados);
  Emitir('acessoProducao', Acesso(PastaProducao));
  ProvarEscritaEnsaio;
  EscritaHerdada :=
    (AcessoDireito(PastaProducao, FILE_ADD_FILE) = 'permitido') or
    (AcessoDireito(Perfil, FILE_ADD_FILE) = 'permitido') or
    (AcessoDireito(ConectorDados, FILE_ADD_FILE) = 'permitido') or
    (AcessoDireito(PayGo, FILE_ADD_FILE) = 'permitido');
  Emitir('aclAlterada', '0');
  Emitir('credencialCopiada', '0');
  Emitir('initPermitido', '0');
  if EscritaHerdada or (Ambiente('PathPGWebLib') <> '') or (Ambiente('PathPGWebLib_x64') <> '') then
  begin
    Emitir('isolamento', 'insuficiente');
    Emitir('preparacao', 'interrompida');
  end
  else
    Emitir('isolamento', 'suficiente');
  Emitir('contaMinima', '0');
  EmitirLimites;
  Emitir('passo', 'A criacao da conta local fica interrompida enquanto Usuarios puder gravar nas pastas protegidas.');
  Emitir('passo', 'Nao alterar as ACLs de %ProgramData%\UltraPDV, do perfil PayGo nem do Connector instalado.');
  Emitir('passo', 'Nao copiar credenciais, certificados nem arquivos .pos.');
  Emitir('passo', 'PW_iInit da DLL oficial permanece desabilitado.');
end;

function Sha256Arquivo(const Caminho: string; out Hexadecimal: string): Boolean;
const
  Bloco = 65536;
var
  Alg, Hash: THandle;
  AlgId, PropObj, PropHash: WideString;
  TamObj, TamDig, Lidos, LidosArq: ULONG;
  Objeto, Digesto: Pointer;
  Fluxo: TFileStream;
  Buffer: array[0..Bloco - 1] of Byte;
  I: Integer;
begin
  Result := False;
  Hexadecimal := '';
  Alg := 0;
  Hash := 0;
  Objeto := nil;
  Digesto := nil;
  AlgId := 'SHA256';
  PropObj := 'ObjectLength';
  PropHash := 'HashDigestLength';
  if BCryptOpenAlgorithmProvider(Alg, PWideChar(AlgId), nil, 0) <> 0 then
    Exit;
  try
    if BCryptGetProperty(Alg, PWideChar(PropObj), @TamObj, SizeOf(TamObj), Lidos, 0) <> 0 then
      Exit;
    if BCryptGetProperty(Alg, PWideChar(PropHash), @TamDig, SizeOf(TamDig), Lidos, 0) <> 0 then
      Exit;
    if (TamObj = 0) or (TamDig <> 32) then
      Exit;
    GetMem(Objeto, TamObj);
    GetMem(Digesto, TamDig);
    FillChar(Digesto^, TamDig, 0);
    if BCryptCreateHash(Alg, Hash, Objeto, TamObj, nil, 0, 0) <> 0 then
      Exit;
    Fluxo := TFileStream.Create(Caminho, fmOpenRead or fmShareDenyNone);
    try
      repeat
        LidosArq := Fluxo.Read(Buffer, Bloco);
        if (LidosArq > 0) and (BCryptHashData(Hash, @Buffer, LidosArq, 0) <> 0) then
          Exit;
      until LidosArq < Bloco;
    finally
      Fluxo.Free;
    end;
    if BCryptFinishHash(Hash, Digesto, TamDig, 0) <> 0 then
      Exit;
    Hexadecimal := '';
    for I := 0 to TamDig - 1 do
      Hexadecimal := Hexadecimal + LowerCase(IntToHex(PByte(PAnsiChar(Digesto) + I)^, 2));
    Result := Length(Hexadecimal) = 64;
  finally
    if Hash <> 0 then
      BCryptDestroyHash(Hash);
    if Alg <> 0 then
      BCryptCloseAlgorithmProvider(Alg, 0);
    if Objeto <> nil then
      FreeMem(Objeto);
    if Digesto <> nil then
      FreeMem(Digesto);
  end;
end;

function ArquivoCredencial(const Nome: string): Boolean;
var
  Baixo: string;
begin
  Baixo := TextoBaixo(Nome);
  Result :=
    (Baixo = 'tef-chave.json') or
    (Baixo = 'tef-pareamento.json') or
    (Pos('.pos', Baixo) > 0) or
    (Pos('.pfx', Baixo) > 0) or
    (Pos('.p12', Baixo) > 0) or
    (Pos('.pem', Baixo) > 0) or
    (Pos('.key', Baixo) > 0) or
    (Pos('.cer', Baixo) > 0) or
    (Pos('.crt', Baixo) > 0);
end;

function PastaBackup: string;
begin
  Result := Normalizar(ExtractFilePath(ParamStr(0)) + '..\backup-ensaio');
end;

function PastaConectorInstalado: string;
begin
  Result := IncludeTrailingPathDelimiter(Ambiente('ProgramFiles')) + 'UltraPDV Connector';
end;

function HashTexto(const Texto: string; out Hexadecimal: string): Boolean;
var
  Alg, Hash: THandle;
  AlgId, PropObj, PropHash: WideString;
  TamObj, TamDig, Lidos: ULONG;
  Objeto, Digesto: Pointer;
  Bytes: AnsiString;
  I: Integer;
begin
  Result := False;
  Hexadecimal := '';
  Alg := 0;
  Hash := 0;
  Objeto := nil;
  Digesto := nil;
  AlgId := 'SHA256';
  PropObj := 'ObjectLength';
  PropHash := 'HashDigestLength';
  if BCryptOpenAlgorithmProvider(Alg, PWideChar(AlgId), nil, 0) <> 0 then
    Exit;
  try
    if BCryptGetProperty(Alg, PWideChar(PropObj), @TamObj, SizeOf(TamObj), Lidos, 0) <> 0 then
      Exit;
    if BCryptGetProperty(Alg, PWideChar(PropHash), @TamDig, SizeOf(TamDig), Lidos, 0) <> 0 then
      Exit;
    GetMem(Objeto, TamObj);
    GetMem(Digesto, TamDig);
    if BCryptCreateHash(Alg, Hash, Objeto, TamObj, nil, 0, 0) <> 0 then
      Exit;
    Bytes := AnsiString(Texto);
    if (Length(Bytes) > 0) and (BCryptHashData(Hash, PAnsiChar(Bytes), Length(Bytes), 0) <> 0) then
      Exit;
    if BCryptFinishHash(Hash, Digesto, TamDig, 0) <> 0 then
      Exit;
    for I := 0 to TamDig - 1 do
      Hexadecimal := Hexadecimal + LowerCase(IntToHex(PByte(PAnsiChar(Digesto) + I)^, 2));
    Result := Length(Hexadecimal) = 64;
  finally
    if Hash <> 0 then
      BCryptDestroyHash(Hash);
    if Alg <> 0 then
      BCryptCloseAlgorithmProvider(Alg, 0);
    if Objeto <> nil then
      FreeMem(Objeto);
    if Digesto <> nil then
      FreeMem(Digesto);
  end;
end;

function AgregarPastaLimpa(const Pasta: string; out Quantidade: Integer; out Agregado: string): Boolean;
var
  Pendentes, Linhas: TStringList;
  Atual, Relativo, Hash, Texto: string;
  Info: TSearchRec;
  I: Integer;
begin
  Result := False;
  Quantidade := 0;
  Agregado := '';
  if not EhDiretorio(Pasta) then
    Exit;
  Pendentes := TStringList.Create;
  Linhas := TStringList.Create;
  try
    Pendentes.Add(ExcludeTrailingPathDelimiter(Pasta));
    while Pendentes.Count > 0 do
    begin
      Atual := Pendentes[0];
      Pendentes.Delete(0);
      if EhReparse(Atual) then
        Exit;
      if FindFirst(IncludeTrailingPathDelimiter(Atual) + '*', faAnyFile, Info) <> 0 then
        Exit;
      try
        repeat
          if (Info.Name = '.') or (Info.Name = '..') then
            Continue;
          Relativo := Atual + '\' + Info.Name;
          if (Info.Attr and FILE_ATTRIBUTE_REPARSE_POINT) <> 0 then
            Exit;
          if (Info.Attr and FILE_ATTRIBUTE_DIRECTORY) <> 0 then
            Pendentes.Add(Relativo)
          else
          begin
            if not Sha256Arquivo(Relativo, Hash) then
              Exit;
            Linhas.Add(TextoBaixo(Copy(Relativo, Length(ExcludeTrailingPathDelimiter(Pasta)) + 2, MaxInt)) + ':' + Hash);
            Inc(Quantidade);
          end;
        until SysUtils.FindNext(Info) <> 0;
      finally
        SysUtils.FindClose(Info);
      end;
    end;
    Linhas.Sort;
    Texto := '';
    for I := 0 to Linhas.Count - 1 do
      Texto := Texto + Linhas[I] + #10;
    Result := HashTexto(Texto, Agregado);
  finally
    Pendentes.Free;
    Linhas.Free;
  end;
end;

function TemArgumento(const Nome: string): Boolean;
var
  I: Integer;
begin
  Result := False;
  for I := 1 to ParamCount do
    if TextoBaixo(ParamStr(I)) = Nome then
      Exit(True);
end;

function AutorizadoReal: Boolean;
begin
  Result := TemArgumento('--autorizado-real') and (Ambiente('PGWEB_INIT_REAL') = FRASE_REAL);
end;

function RiscoIsolamentoAceito: Boolean;
begin
  Result := AutorizadoReal and TemArgumento('--aceitar-risco-isolamento');
end;

function AutorizadoPinPad: Boolean;
begin
  Result := TemArgumento('--autorizado-pinpad') and (Ambiente('PGWEB_PINPAD_AUTORIZACAO') = FRASE_PINPAD);
end;

function AutorizadoPinPadReal: Boolean;
begin
  Result := TemArgumento('--autorizado-pinpad') and (Ambiente('PGWEB_PINPAD_REAL') = FRASE_PINPAD_REAL);
end;

function HashDllConfere(const Dll: string): Boolean;
var
  Hash: string;
begin
  Result := Sha256Arquivo(Dll, Hash) and (Hash = HASH_DLL_OFICIAL);
end;

function CopiarArquivo(const Origem, Destino: string): Boolean;
var
  Entrada, Saida: TFileStream;
  Buffer: array[0..65535] of Byte;
  Lidos: Integer;
begin
  Result := False;
  Entrada := TFileStream.Create(Origem, fmOpenRead or fmShareDenyNone);
  try
    Saida := TFileStream.Create(Destino, fmCreate);
    try
      repeat
        Lidos := Entrada.Read(Buffer, SizeOf(Buffer));
        if Lidos > 0 then
          Saida.WriteBuffer(Buffer, Lidos);
      until Lidos = 0;
      Result := True;
    finally
      Saida.Free;
    end;
  finally
    Entrada.Free;
  end;
end;

function FazerBackup(out Pasta: string): Boolean;
var
  Origem, Nome, Hash, Versao: string;
  Manifesto: TStringList;
  Copias: array[0..6] of string;
  I, Quantidade: Integer;
  Agregado: string;
begin
  Result := False;
  Pasta := IncludeTrailingPathDelimiter(PastaBackup) + 'ensaio-' + IntToHex(GetTickCount64, 12);
  if not ForceDirectories(Pasta) then
    Exit;
  Manifesto := TStringList.Create;
  try
    Versao := PastaConectorInstalado + '\version.json';
    if not FileExists(Versao) then
      Exit;
    Manifesto.LoadFromFile(Versao);
    if Pos('1.3.19', Manifesto.Text) = 0 then
      Exit;
    Manifesto.Clear;
    Manifesto.Add('conectorVersao 1.3.19');
    Copias[0] := Versao;
    Copias[1] := PastaConectorInstalado + '\tef-pacote.json';
    Copias[2] := IncludeTrailingPathDelimiter(PastaProducao) + 'print-agent.json';
    Copias[3] := IncludeTrailingPathDelimiter(PastaProducao) + 'tef-biblioteca.json';
    Copias[4] := IncludeTrailingPathDelimiter(PastaProducao) + 'tef-pasta.json';
    Copias[5] := IncludeTrailingPathDelimiter(PastaProducao) + 'tef-vinculo.json';
    Copias[6] := IncludeTrailingPathDelimiter(PastaProducao) + 'tef-perfil-autonomo.json';
    for I := 0 to High(Copias) do
    begin
      Origem := Copias[I];
      Nome := ExtractFileName(Origem);
      if ArquivoCredencial(Nome) then
        Exit;
      if not FileExists(Origem) then
        Exit;
      if not Sha256Arquivo(Origem, Hash) then
        Exit;
      if not CopiarArquivo(Origem, IncludeTrailingPathDelimiter(Pasta) + Nome) then
        Exit;
      if not Sha256Arquivo(IncludeTrailingPathDelimiter(Pasta) + Nome, Versao) then
        Exit;
      if Versao <> Hash then
        Exit;
      Manifesto.Add('copiado ' + Nome + ' ' + Hash);
      Emitir('copiado', Nome);
    end;
    Origem := IncludeTrailingPathDelimiter(PastaProducao) + 'tef-chave.json';
    if FileExists(Origem) and Sha256Arquivo(Origem, Hash) then
    begin
      Manifesto.Add('omitido tef-chave.json ' + Hash);
      Emitir('omitido', 'tef-chave.json');
    end
    else
      Exit;
    Origem := IncludeTrailingPathDelimiter(PastaProducao) + 'tef-pareamento.json';
    if FileExists(Origem) and Sha256Arquivo(Origem, Hash) then
    begin
      Manifesto.Add('omitido tef-pareamento.json ' + Hash);
      Emitir('omitido', 'tef-pareamento.json');
    end
    else
      Exit;
    if not AgregarPastaLimpa(IncludeTrailingPathDelimiter(PastaProducao) + 'TEF\Producao', Quantidade, Agregado) then
      Exit;
    Manifesto.Add('posQuantidade ' + IntToStr(Quantidade));
    Manifesto.Add('posAgregado ' + Agregado);
    if not AgregarPastaLimpa(PastaConectorInstalado + '\data', Quantidade, Agregado) then
      Exit;
    Manifesto.Add('conectorDadosAgregado ' + Agregado);
    Manifesto.Add('verificado 1');
    Manifesto.SaveToFile(IncludeTrailingPathDelimiter(Pasta) + 'manifesto.txt');
    Manifesto.Clear;
    Manifesto.Add(Pasta);
    Manifesto.SaveToFile(IncludeTrailingPathDelimiter(PastaBackup) + 'ultimo.txt');
    Emitir('backup', Normalizar(Pasta));
    Emitir('conectorVersao', '1.3.19');
    Emitir('backupVerificado', '1');
    Emitir('credencialCopiada', '0');
    Emitir('isolamentoGarantido', '0');
    Result := True;
  finally
    Manifesto.Free;
  end;
end;

function LinhaManifesto(const Manifesto: TStringList; const Prefixo: string): string;
var
  I: Integer;
begin
  Result := '';
  for I := 0 to Manifesto.Count - 1 do
    if Copy(Manifesto[I], 1, Length(Prefixo)) = Prefixo then
      Exit(Manifesto[I]);
end;

function VigiarProducao(out Motivo: string): Boolean;
var
  Ultimo, Pasta, Atual, Esperado: string;
  Manifesto: TStringList;
  Quantidade: Integer;
  Agregado: string;
begin
  Result := False;
  Motivo := 'VIGILANCIA_INCOMPLETA';
  Ultimo := IncludeTrailingPathDelimiter(PastaBackup) + 'ultimo.txt';
  if not FileExists(Ultimo) then
  begin
    Motivo := 'BACKUP_AUSENTE';
    Exit;
  end;
  Manifesto := TStringList.Create;
  try
    Manifesto.LoadFromFile(Ultimo);
    if Manifesto.Count < 1 then
      Exit;
    Pasta := Manifesto[0];
    if not FileExists(IncludeTrailingPathDelimiter(Pasta) + 'manifesto.txt') then
      Exit;
    Manifesto.LoadFromFile(IncludeTrailingPathDelimiter(Pasta) + 'manifesto.txt');
    if LinhaManifesto(Manifesto, 'verificado 1') = '' then
      Exit;
    if LinhaManifesto(Manifesto, 'conectorVersao 1.3.19') = '' then
    begin
      Motivo := 'PRESERVACAO_CONECTOR';
      Exit;
    end;
    if not Sha256Arquivo(PastaConectorInstalado + '\version.json', Atual) then
      Exit;
    Esperado := LinhaManifesto(Manifesto, 'copiado version.json ');
    if Pos(Atual, Esperado) = 0 then
    begin
      Motivo := 'ACESSO_PRODUCAO';
      Exit;
    end;
    if not Sha256Arquivo(IncludeTrailingPathDelimiter(PastaProducao) + 'tef-chave.json', Atual) then
      Exit;
    Esperado := LinhaManifesto(Manifesto, 'omitido tef-chave.json ');
    if Pos(Atual, Esperado) = 0 then
    begin
      Motivo := 'ACESSO_PRODUCAO';
      Exit;
    end;
    if not AgregarPastaLimpa(IncludeTrailingPathDelimiter(PastaProducao) + 'TEF\Producao', Quantidade, Agregado) then
      Exit;
    Esperado := LinhaManifesto(Manifesto, 'posAgregado ');
    if Pos(Agregado, Esperado) = 0 then
    begin
      Motivo := 'ACESSO_PRODUCAO';
      Exit;
    end;
    if not AgregarPastaLimpa(PastaConectorInstalado + '\data', Quantidade, Agregado) then
      Exit;
    Esperado := LinhaManifesto(Manifesto, 'conectorDadosAgregado ');
    if Pos(Agregado, Esperado) = 0 then
    begin
      Motivo := 'ACESSO_PRODUCAO';
      Exit;
    end;
    Motivo := 'VIGILANCIA_OBSERVADA';
    Result := True;
  finally
    Manifesto.Free;
  end;
end;

function ReservarDiretorioExclusivo(out Destino: string): Boolean;
var
  Base: string;
  Tentativa: Integer;
begin
  Result := False;
  Base := RaizEnsaio;
  if EhReparse(Base) then
    Exit;
  if not EhDiretorio(Base) then
    if not ForceDirectories(Base) then
      Exit;
  for Tentativa := 0 to 20 do
  begin
    Destino := IncludeTrailingPathDelimiter(Base) + 'ensaio-' + IntToHex(GetTickCount64 + QWord(Tentativa), 12);
    if (not Existe(Destino)) and (not EmProducao(Normalizar(Destino))) and (not EmPerfilPayGo(Normalizar(Destino))) then
      Exit(True);
    Sleep(1);
  end;
end;

function ComandoReal: string;
var
  Dll: string;
begin
  Dll := ExpandFileName(ExtractFilePath(ParamStr(0)) + '..\..\..\20260923-Integracao-PGWebLib_v4.1.50.924\x64\PGWebLib.dll');
  Result := '$env:PGWEB_INIT_REAL=''' + FRASE_REAL + '''; & ''' + ParamStr(0) +
    ''' --init-real ''' + Dll + ''' --autorizado-real --aceitar-risco-isolamento';
end;

procedure EnsaiarReal(const Dll: string);
var
  Motivo, Efetivo, Diretorio, PastaMan, Interromper: string;
  Inicio, Fim: UInt64;
  Antes, Depois: TFoto;
  Lib: HMODULE;
  Retorno: Int16;
  DiretorioA: AnsiString;
  Codigo: Integer;
begin
  Arquitetura;
  Interromper := '';
  Emitir('isolamentoGarantido', '0');
  Emitir('comando', ComandoReal);
  if not AutorizadoReal then
  begin
    Emitir('resultado', 'INIT_DESABILITADO');
    Emitir('initChamado', '0');
    Emitir('dllCarregada', '0');
    Emitir('dllReal', '0');
    Exit;
  end;
  Emitir('isolamentoComprovado', '0');
  Emitir('isolamentoExclusivo', '0');
  if not RiscoIsolamentoAceito then
  begin
    Emitir('riscoIsolamento', 'ausente');
    Recusar('ISOLAMENTO_REPROVADO', SAIDA_RECUSADO);
  end;
  Emitir('riscoIsolamento', 'aceito');
  if EhDllOficial(Dll) = False then
    Recusar('DLL_REAL_BLOQUEADA', SAIDA_DLL);
  Efetivo := Normalizar(Dll);
  if (Pos('\20260923-integracao-pgweblib_v4.1.50.924\x64\pgweblib.dll', Efetivo) = 0) or
     EmProducao(Efetivo) or EmPerfilPayGo(Efetivo) or (Pos('\ultrapdv connector\', Efetivo) > 0) then
    Recusar('DLL_REAL_BLOQUEADA', SAIDA_DLL);
  if not HashDllConfere(Dll) then
    Recusar('HASH_DIVERGENTE', SAIDA_DLL);
  Emitir('sha256', HASH_DLL_OFICIAL);
  if not FazerBackup(Diretorio) then
    Recusar('BACKUP_INVALIDO', SAIDA_RECUSADO);
  if Ambiente('PGWEB_VIGIA_FALHA') = '1' then
    Recusar('VIGILANCIA_INCOMPLETA', SAIDA_MONITOR);
  if not VigiarProducao(Motivo) then
    Recusar(Motivo, SAIDA_MONITOR);
  if not ReservarDiretorioExclusivo(Efetivo) then
    Recusar('DIRETORIO_RECUSADO', SAIDA_RECUSADO);
  if not Classificar(Efetivo, Diretorio, Motivo, Codigo) then
    Recusar(Motivo, Codigo);
  if not CreateDir(Diretorio) then
    Recusar('ERRO_GRAVACAO', SAIDA_RECUSADO);
  Emitir('diretorio', Diretorio);
  Antes := Capturar(Diretorio);
  try
    EmitirEvidencia('Antes', Antes);
    if not MonitorCompleto(Antes) then
      Recusar('VIGILANCIA_INCOMPLETA', SAIDA_MONITOR);
    if not HashDllConfere(Dll) then
      Recusar('HASH_DIVERGENTE', SAIDA_DLL);
    Emitir('isolamentoComprovado', '0');
    Emitir('riscoIsolamento', 'aceito');
    Inicio := GetTickCount64;
    Lib := LoadLibraryA(PAnsiChar(AnsiString(Dll)));
    if Lib = 0 then
      Recusar('LOADLIBRARY_FALHOU', SAIDA_DLL);
    Emitir('dllCarregada', '1');
    Emitir('dllReal', '1');
    DiretorioA := AnsiString(Diretorio);
    Retorno := ChamarInitTipado(Lib, DiretorioA);
    Fim := GetTickCount64;
    FreeLibrary(Lib);
    Emitir('initChamado', '1');
    Emitir('chamadas', '1');
    Emitir('retorno', IntToStr(Retorno));
    Emitir('duracaoMs', IntToStr(Fim - Inicio));
    Emitir('larguraRetorno', IntToStr(SizeOf(Retorno)));
    Depois := Capturar(Diretorio);
    try
      EmitirEvidencia('Depois', Depois);
      EmitirDelta(Antes, Depois);
    finally
      LiberarFoto(Depois);
    end;
    if not VigiarProducao(Motivo) then
    begin
      Emitir('resultado', Motivo);
      Emitir('isolamentoGarantido', '0');
      Emitir('interrompido', '1');
      Interromper := Motivo;
    end
    else
    begin
      Emitir('resultado', 'INIT_REAL');
      Emitir('isolamentoGarantido', '0');
    end;
  finally
    LiberarFoto(Antes);
  end;
  EmitirLimites;
  PastaMan := IncludeTrailingPathDelimiter(ExtractFilePath(ParamStr(0))) + 'monitor';
  ForceDirectories(PastaMan);
  if Relatorio <> nil then
    Relatorio.SaveToFile(IncludeTrailingPathDelimiter(PastaMan) + 'relatorio.txt');
  if Interromper <> '' then
    Halt(SAIDA_MONITOR);
end;

procedure Uso;
begin
  Arquitetura;
  Emitir('resultado', 'CONSULTA');
  Emitir('uso', 'PgWebDiagnostico --resolver dll');
  Emitir('uso', 'PgWebDiagnostico --init dll diretorio [--autorizado]');
  Emitir('uso', 'PgWebDiagnostico --backup');
  Emitir('uso', 'PgWebDiagnostico --vigiar');
  Emitir('uso', 'PgWebDiagnostico --init-real dll --autorizado-real --aceitar-risco-isolamento');
  Emitir('uso', 'PgWebDiagnostico --pinpad dll diretorio --autorizado-pinpad');
  Emitir('uso', 'PgWebDiagnostico --pinpad-real dll --autorizado-real --aceitar-risco-isolamento --autorizado-pinpad');
  Emitir('uso', 'PgWebDiagnostico --gerar');
  Emitir('uso', 'PgWebDiagnostico --conta');
end;

function ComandoPinPad: string;
var
  Dll: string;
begin
  Dll := ExpandFileName(ExtractFilePath(ParamStr(0)) + '..\..\..\20260923-Integracao-PGWebLib_v4.1.50.924\x64\PGWebLib.dll');
  Result := '$env:PGWEB_INIT_REAL=''' + FRASE_REAL + '''; $env:PGWEB_PINPAD_REAL=''' + FRASE_PINPAD_REAL +
    '''; & ''' + ParamStr(0) + ''' --pinpad-real ''' + Dll +
    ''' --autorizado-real --aceitar-risco-isolamento --autorizado-pinpad';
end;

procedure EnsaiarPinPad(const Dll, Diretorio: string);
var
  Efetivo, Motivo: string;
  Codigo: Integer;
  Lib: HMODULE;
  DiretorioA: AnsiString;
begin
  Arquitetura;
  if not Classificar(Diretorio, Efetivo, Motivo, Codigo) then
    Recusar(Motivo, Codigo);
  Emitir('diretorio', Efetivo);
  if not AutorizadoPinPad then
  begin
    Emitir('resultado', 'PINPAD_DESABILITADO');
    Emitir('initChamado', '0');
    Emitir('dllCarregada', '0');
    Emitir('dllReal', '0');
    Exit;
  end;
  if not EhPinPadSim(Dll) then
    Recusar('DLL_REAL_BLOQUEADA', SAIDA_DLL);
  if not FileExists(Dll) then
    Recusar('DLL_AUSENTE', SAIDA_DLL);
  if not CreateDir(Efetivo) then
    Recusar('ERRO_GRAVACAO', SAIDA_RECUSADO);
  Lib := LoadLibraryA(PAnsiChar(AnsiString(Dll)));
  if Lib = 0 then
    Recusar('LOADLIBRARY_FALHOU', SAIDA_DLL);
  Emitir('dllCarregada', '1');
  Emitir('dllReal', '0');
  DiretorioA := AnsiString(Efetivo);
  try
    ExecutarPinPad(Lib, DiretorioA, True);
  finally
    FreeLibrary(Lib);
  end;
end;

procedure EnsaiarPinPadReal(const Dll: string);
var
  Motivo, Efetivo, Diretorio, PastaMan, Interromper: string;
  Antes, Depois: TFoto;
  Lib: HMODULE;
  DiretorioA: AnsiString;
  Codigo: Integer;
begin
  Arquitetura;
  Interromper := '';
  Emitir('isolamentoGarantido', '0');
  Emitir('comando', ComandoPinPad);
  if not AutorizadoPinPadReal then
  begin
    Emitir('resultado', 'PINPAD_DESABILITADO');
    Emitir('initChamado', '0');
    Emitir('dllCarregada', '0');
    Emitir('dllReal', '0');
    Exit;
  end;
  if not AutorizadoReal then
  begin
    Emitir('resultado', 'INIT_DESABILITADO');
    Emitir('initChamado', '0');
    Emitir('dllCarregada', '0');
    Emitir('dllReal', '0');
    Exit;
  end;
  Emitir('isolamentoComprovado', '0');
  Emitir('isolamentoExclusivo', '0');
  if not RiscoIsolamentoAceito then
  begin
    Emitir('riscoIsolamento', 'ausente');
    Recusar('ISOLAMENTO_REPROVADO', SAIDA_RECUSADO);
  end;
  Emitir('riscoIsolamento', 'aceito');
  if EhDllOficial(Dll) = False then
    Recusar('DLL_REAL_BLOQUEADA', SAIDA_DLL);
  Efetivo := Normalizar(Dll);
  if (Pos('\20260923-integracao-pgweblib_v4.1.50.924\x64\pgweblib.dll', Efetivo) = 0) or
     EmProducao(Efetivo) or EmPerfilPayGo(Efetivo) or (Pos('\ultrapdv connector\', Efetivo) > 0) then
    Recusar('DLL_REAL_BLOQUEADA', SAIDA_DLL);
  if not HashDllConfere(Dll) then
    Recusar('HASH_DIVERGENTE', SAIDA_DLL);
  Emitir('sha256', HASH_DLL_OFICIAL);
  if not FazerBackup(Diretorio) then
    Recusar('BACKUP_INVALIDO', SAIDA_RECUSADO);
  if Ambiente('PGWEB_VIGIA_FALHA') = '1' then
    Recusar('VIGILANCIA_INCOMPLETA', SAIDA_MONITOR);
  if not VigiarProducao(Motivo) then
    Recusar(Motivo, SAIDA_MONITOR);
  if not ReservarDiretorioExclusivo(Efetivo) then
    Recusar('DIRETORIO_RECUSADO', SAIDA_RECUSADO);
  if not Classificar(Efetivo, Diretorio, Motivo, Codigo) then
    Recusar(Motivo, Codigo);
  if not CreateDir(Diretorio) then
    Recusar('ERRO_GRAVACAO', SAIDA_RECUSADO);
  Emitir('diretorio', Diretorio);
  Antes := Capturar(Diretorio);
  try
    EmitirEvidencia('Antes', Antes);
    if not MonitorCompleto(Antes) then
      Recusar('VIGILANCIA_INCOMPLETA', SAIDA_MONITOR);
    if not HashDllConfere(Dll) then
      Recusar('HASH_DIVERGENTE', SAIDA_DLL);
    Lib := LoadLibraryA(PAnsiChar(AnsiString(Dll)));
    if Lib = 0 then
      Recusar('LOADLIBRARY_FALHOU', SAIDA_DLL);
    Emitir('dllCarregada', '1');
    Emitir('dllReal', '1');
    DiretorioA := AnsiString(Diretorio);
    try
      ExecutarPinPad(Lib, DiretorioA, False);
    finally
      FreeLibrary(Lib);
    end;
    Depois := Capturar(Diretorio);
    try
      EmitirEvidencia('Depois', Depois);
      EmitirDelta(Antes, Depois);
    finally
      LiberarFoto(Depois);
    end;
    if not VigiarProducao(Motivo) then
    begin
      Emitir('resultado', Motivo);
      Emitir('interrompido', '1');
      Interromper := Motivo;
    end;
  finally
    LiberarFoto(Antes);
  end;
  EmitirLimites;
  PastaMan := IncludeTrailingPathDelimiter(ExtractFilePath(ParamStr(0))) + 'monitor';
  ForceDirectories(PastaMan);
  if Relatorio <> nil then
    Relatorio.SaveToFile(IncludeTrailingPathDelimiter(PastaMan) + 'relatorio.txt');
  if Interromper <> '' then
    Halt(SAIDA_MONITOR);
end;

function ArgumentoAutorizado: Boolean;
var
  I: Integer;
  Lista: array of string;
begin
  SetLength(Lista, ParamCount);
  for I := 1 to ParamCount do
    Lista[I - 1] := ParamStr(I);
  Result := Autorizado(Lista);
end;

var
  Acao: string;
  ProvaIsolamento: TStringList;
  Indice, EspacoIsolamento: Integer;
  IsolamentoAprovado: Boolean;
begin
  Relatorio := TStringList.Create;
  try
    if ParamCount = 0 then
      Uso
    else
    begin
      Acao := TextoBaixo(ParamStr(1));
      if Acao = '--arquitetura' then
        Arquitetura
      else if Acao = '--conta' then
        Conta
      else if Acao = '--gerar' then
        GerarDiretorio
      else if Acao = '--backup' then
      begin
        if not FazerBackup(Acao) then
        begin
          Emitir('resultado', 'BACKUP_INVALIDO');
          Emitir('credencialCopiada', '0');
          Halt(SAIDA_RECUSADO);
        end;
        Emitir('resultado', 'BACKUP_OK');
        Emitir('initChamado', '0');
        Emitir('dllCarregada', '0');
      end
      else if Acao = '--vigiar' then
      begin
        Emitir('isolamentoGarantido', '0');
        if Ambiente('PGWEB_VIGIA_FALHA') = '1' then
        begin
          Emitir('resultado', 'VIGILANCIA_INCOMPLETA');
          Halt(SAIDA_MONITOR);
        end;
        if VigiarProducao(Acao) then
          Emitir('resultado', 'VIGILANCIA_OBSERVADA')
        else
        begin
          Emitir('resultado', Acao);
          Halt(SAIDA_MONITOR);
        end;
        Emitir('initChamado', '0');
        Emitir('dllCarregada', '0');
      end
      else if (Acao = '--acesso-efetivo') and (ParamCount >= 2) then
        Halt(FilhoAcesso(ParamStr(2), ParamStr(3), ParamStr(4), True))
      else if (Acao = '--acesso-medio') and (ParamCount >= 2) then
        Halt(FilhoAcesso(ParamStr(2), '', '', False))
      else if Acao = '--isolamento' then
      begin
        ProvaIsolamento := TStringList.Create;
        try
          IsolamentoAprovado := ProvarAcessoEfetivo(ProvaIsolamento);
          if IsolamentoAprovado then
            Emitir('resultado', 'ISOLAMENTO_APROVADO')
          else
            Emitir('resultado', 'ISOLAMENTO_REPROVADO');
          for Indice := 0 to ProvaIsolamento.Count - 1 do
          begin
            EspacoIsolamento := Pos(' ', ProvaIsolamento[Indice]);
            if EspacoIsolamento > 1 then
              Emitir(Copy(ProvaIsolamento[Indice], 1, EspacoIsolamento - 1), Copy(ProvaIsolamento[Indice], EspacoIsolamento + 1, MaxInt));
          end;
          Emitir('initChamado', '0');
          Emitir('dllReal', '0');
          Emitir('isolamentoGarantido', '0');
          if not IsolamentoAprovado then
            Halt(SAIDA_RECUSADO);
        finally
          ProvaIsolamento.Free;
        end;
      end
      else if (Acao = '--init-real') and (ParamCount >= 2) then
        EnsaiarReal(ParamStr(2))
      else if (Acao = '--pinpad') and (ParamCount >= 3) then
        EnsaiarPinPad(ParamStr(2), ParamStr(3))
      else if (Acao = '--pinpad-real') and (ParamCount >= 2) then
        EnsaiarPinPadReal(ParamStr(2))
      else if (Acao = '--resolver') and (ParamCount >= 2) then
        Resolver(ParamStr(2))
      else if (Acao = '--init') and (ParamCount >= 3) then
        Ensaiar(ParamStr(2), ParamStr(3), [ParamStr(4)])
      else
      begin
        Uso;
        Halt(1);
      end;
    end;
  finally
    Relatorio.Free;
  end;
end.
