program PgWebGetData;

{
  Diagnostico isolado de PW_GetData.
  O record copia o campo a campo de ACBrTEFPayGoWebComum.pas.
  A capacidade segue o maximo sugerido pelo header: 9.
  piNumParam igual a essa capacidade nao comprova o ABI e nao
  impede a DLL de escrever um PW_GetData de tamanho diferente.
  Uma chamada nativa bloqueada ignora o limite de 8000 ms.
  O supervisor externo identifica o travamento pelo tempo de vida
  do processo. Encerrar o processo a forca nao desfaz efeito fiscal
  nem financeiro.
  Nao entra no agente definitivo nem no Connector.
  ABI_COMPROVADO e LAYOUT_HOMOLOGADO permanecem false.
  Sem as tres autorizacoes, nenhuma DLL e carregada.
}

{$mode delphi}
{$H+}
{$PACKRECORDS 8}
{$ALIGN 8}
{$APPTYPE CONSOLE}

uses
  Classes,
  Windows,
  SysUtils;

const
  HASH_DLL_OFICIAL = 'd17ac81323396ae172648935b0b797b74705b1ca01c9ae0cd3b2ff78119d4220';
  FRASE_GETDATA = 'AUTORIZAR-PW-GETDATA-REAL-4.1.50.924';
  PWOPER_INSTALL = 1;
  ENVRMNT_TEST = 1;
  CAPACIDADE_SUGERIDA = 9;
  LIMITE_MS = 8000;
  PWRET_OK = 0;
  PWRET_MOREDATA = -2497;
  PWRET_NOTHING = -2493;
  PWINFO_REQNUM = $32;
  PWINFO_AUTHSYST = $35;
  PWINFO_VIRTMERCH = $36;
  PWINFO_CNFREQ = $43;
  PWINFO_AUTLOCREF = $44;
  PWINFO_AUTEXTREF = $45;
  PWCNF_REV_OTHER_AUT = $00073131;
  TAMANHO_RESULTADO = 10240;

type
  TPWGetData = record
    wIdentificador: Word;
    bTipoDeDado: Byte;
    szPrompt: array[0..83] of AnsiChar;
    bNumOpcoesMenu: Byte;
    vszTextoMenu: array[0..39, 0..40] of AnsiChar;
    vszValorMenu: array[0..39, 0..255] of AnsiChar;
    szMascaraDeCaptura: array[0..40] of AnsiChar;
    bTiposEntradaPermitidos: Byte;
    bTamanhoMinimo: Byte;
    bTamanhoMaximo: Byte;
    ulValorMinimo: LongWord;
    ulValorMaximo: LongWord;
    bOcultarDadosDigitados: Byte;
    bValidacaoDado: Byte;
    bAceitaNulo: Byte;
    szValorInicial: array[0..40] of AnsiChar;
    bTeclasDeAtalho: Byte;
    szMsgValidacao: array[0..83] of AnsiChar;
    szMsgConfirmacao: array[0..83] of AnsiChar;
    szMsgDadoMaior: array[0..83] of AnsiChar;
    szMsgDadoMenor: array[0..83] of AnsiChar;
    bCapturarDataVencCartao: Byte;
    ulTipoEntradaCartao: LongWord;
    bItemInicial: Byte;
    bNumeroCapturas: Byte;
    szMsgPrevia: array[0..83] of AnsiChar;
    bTipoEntradaCodigoBarras: Byte;
    bOmiteMsgAlerta: Byte;
    bIniciaPelaEsquerda: Byte;
    bNotificarCancelamento: Byte;
    bAlinhaPelaDireita: Byte;
  end;

  TArrPWGetData = array[0..CAPACIDADE_SUGERIDA - 1] of TPWGetData;
  TSonda = record
    Marca: Byte;
    Dados: TPWGetData;
  end;
  TPwInit = function(pszWorkingDir: PAnsiChar): SmallInt; stdcall;
  TPwAmbiente = function(iEnv: SmallInt): SmallInt; stdcall;
  TPwNew = function(bOper: Byte): SmallInt; stdcall;
  TPwExec = function(pvstParam: TArrPWGetData; var piNumParam: SmallInt): SmallInt; stdcall;
  TPwGetResult = function(iInfo: SmallInt; pszData: PAnsiChar; ulDataSize: LongWord): SmallInt; stdcall;
  TPwConfirm = function(ulResult: LongWord; pszReqNum, pszLocRef, pszExtRef, pszVirtMerch, pszAuthSyst: PAnsiChar): SmallInt; stdcall;
  TPwWait = function: SmallInt; stdcall;
  TPwEnd = procedure; stdcall;

function BCryptOpenAlgorithmProvider(out Alg: THandle; AlgId, Impl: PWideChar; Flags: ULONG): LongInt; stdcall; external 'bcrypt.dll';
function BCryptCloseAlgorithmProvider(Alg: THandle; Flags: ULONG): LongInt; stdcall; external 'bcrypt.dll';
function BCryptGetProperty(Objeto: THandle; Propriedade: PWideChar; Saida: Pointer; TamSaida: ULONG; out Lidos: ULONG; Flags: ULONG): LongInt; stdcall; external 'bcrypt.dll';
function BCryptCreateHash(Alg: THandle; out Hash: THandle; Objeto: Pointer; TamObjeto: ULONG; Segredo: Pointer; TamSegredo: ULONG; Flags: ULONG): LongInt; stdcall; external 'bcrypt.dll';
function BCryptHashData(Hash: THandle; Dados: Pointer; TamDados: ULONG; Flags: ULONG): LongInt; stdcall; external 'bcrypt.dll';
function BCryptFinishHash(Hash: THandle; Saida: Pointer; TamSaida: ULONG; Flags: ULONG): LongInt; stdcall; external 'bcrypt.dll';
function BCryptDestroyHash(Hash: THandle): LongInt; stdcall; external 'bcrypt.dll';

var
  GLoads: Integer;

procedure Emitir(const Chave, Valor: string);
begin
  WriteLn(Chave, ' ', Valor);
end;

function TemFlag(const Nome: string): Boolean;
var
  I: Integer;
begin
  Result := False;
  for I := 1 to ParamCount do
    if SameText(ParamStr(I), Nome) then
      Exit(True);
end;

function Baixo(const Texto: string): string;
begin
  Result := LowerCase(StringReplace(Texto, '/', '\', [rfReplaceAll]));
end;

function CaminhoProibido(const Texto: string): Boolean;
var
  Item: string;
begin
  Item := Baixo(Texto);
  Result :=
    (Pos('\tef\producao', Item) > 0) or
    (Pos('\programdata\', Item) > 0) or
    (Pos('\paygo\', Item) > 0);
end;

function AmbientePayGoPresente: Boolean;
begin
  Result :=
    (GetEnvironmentVariable('PathPGWebLib') <> '') or
    (GetEnvironmentVariable('PathPGWebLib_x64') <> '') or
    (GetEnvironmentVariable('PGWebLibAtualiza') <> '') or
    (GetEnvironmentVariable('PGWebLibPermiteAtualiza') <> '');
end;

function DiretorioVazio(const Caminho: string): Boolean;
var
  Busca: TSearchRec;
  Achou: Integer;
begin
  Result := True;
  Achou := FindFirst(IncludeTrailingPathDelimiter(Caminho) + '*', faAnyFile, Busca);
  if Achou <> 0 then
    Exit;
  try
    repeat
      if (Busca.Name <> '.') and (Busca.Name <> '..') then
        Exit(False);
      Achou := FindNext(Busca);
    until Achou <> 0;
  finally
    FindClose(Busca);
  end;
end;

function Sha256Arquivo(const Caminho: string; out Hexadecimal: string): Boolean;
const
  Bloco = 65536;
var
  Alg, Hash: THandle;
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
  if BCryptOpenAlgorithmProvider(Alg, 'SHA256', nil, 0) <> 0 then
    Exit;
  try
    if BCryptGetProperty(Alg, 'ObjectLength', @TamObj, SizeOf(TamObj), Lidos, 0) <> 0 then
      Exit;
    if BCryptGetProperty(Alg, 'HashDigestLength', @TamDig, SizeOf(TamDig), Lidos, 0) <> 0 then
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
    for I := 0 to TamDig - 1 do
      Hexadecimal := Hexadecimal + LowerCase(IntToHex(PByte(PAnsiChar(Digesto) + I)^, 2));
    Result := Hexadecimal = HASH_DLL_OFICIAL;
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

procedure EmitirLayout;
var
  Amostra: TPWGetData;
  Sonda: TSonda;

  procedure Campo(const Nome: string; const Item: Pointer; Tamanho: Integer);
  begin
    Emitir('campo', Nome + ' offset=' + IntToStr(PtrUInt(Item) - PtrUInt(@Amostra)) + ' sizeof=' + IntToStr(Tamanho));
  end;

begin
  Emitir('resultado', 'LAYOUT_LOCAL');
  Emitir('referencia', 'ACBrTEFPayGoWebComum.TPW_GetData');
  Emitir('passagem', 'array-estatico');
  Emitir('convencao', 'stdcall');
  Emitir('slots', IntToStr(CAPACIDADE_SUGERIDA));
  Emitir('numParamInicial', IntToStr(CAPACIDADE_SUGERIDA));
  Emitir('execMaximo', '1');
  Emitir('abiComprovado', '0');
  Emitir('layoutHomologado', '0');
  Emitir('layoutSelecionado', '0');
  Emitir('protecaoEscrita', '0');
  Emitir('abiNota', 'piNumParam nao impede escrita com sizeof divergente');
  Emitir('limiteMs', IntToStr(LIMITE_MS));
  Emitir('limiteNativo', 'nao-interrompe-chamada');
  Emitir('supervisor', 'supervisor-getdata.mjs');
  Emitir('reversaoForcada', 'nao-garantida');
  Emitir('loadLibrary', IntToStr(GLoads));
  Emitir('sizeof', IntToStr(SizeOf(Amostra)));
  Emitir('alinhamento', IntToStr(PtrUInt(@Sonda.Dados) - PtrUInt(@Sonda)));
  Emitir('sizeofByte', IntToStr(SizeOf(Byte)));
  Emitir('sizeofWord', IntToStr(SizeOf(Word)));
  Emitir('sizeofLongWord', IntToStr(SizeOf(LongWord)));
  Campo('wIdentificador', @Amostra.wIdentificador, SizeOf(Amostra.wIdentificador));
  Campo('bTipoDeDado', @Amostra.bTipoDeDado, SizeOf(Amostra.bTipoDeDado));
  Campo('ulValorMinimo', @Amostra.ulValorMinimo, SizeOf(Amostra.ulValorMinimo));
  Campo('ulTipoEntradaCartao', @Amostra.ulTipoEntradaCartao, SizeOf(Amostra.ulTipoEntradaCartao));
  Campo('bAlinhaPelaDireita', @Amostra.bAlinhaPelaDireita, SizeOf(Amostra.bAlinhaPelaDireita));
end;

function Autorizado: Boolean;
begin
  Result := TemFlag('--autorizado-getdata') and TemFlag('--aceitar-risco-isolamento') and
    (GetEnvironmentVariable('PGWEB_GETDATA_REAL') = FRASE_GETDATA);
end;

function DllAceita(const Caminho: string; out Motivo: string): Boolean;
var
  HashOk: Boolean;
  Hash: string;
begin
  Motivo := '';
  Result := False;
  if CaminhoProibido(Caminho) then
  begin
    Motivo := 'DIRETORIO_PRODUCAO';
    Exit;
  end;
  if not SameText(ExtractFileName(Caminho), 'PGWebLib.dll') or
     (Pos('\x64\', Baixo(Caminho)) = 0) then
  begin
    Motivo := 'DLL_REAL_BLOQUEADA';
    Exit;
  end;
  if not FileExists(Caminho) then
  begin
    Motivo := 'ARQUIVO_AUSENTE';
    Exit;
  end;
  Hash := '';
  HashOk := Sha256Arquivo(Caminho, Hash);
  Emitir('sha256', HASH_DLL_OFICIAL);
  Emitir('hashConfere', IntToStr(Ord(HashOk)));
  if not HashOk then
    Motivo := 'HASH_DIVERGENTE';
  Result := HashOk;
end;

procedure RegistrarCaptura(const Item: TPWGetData; Indice, Total: Integer);
begin
  if (Indice < 0) or (Indice >= Total) or (Indice >= CAPACIDADE_SUGERIDA) then
    Exit;
  Emitir('captura', IntToStr(Indice));
  Emitir('wIdentificador', IntToStr(Item.wIdentificador));
  Emitir('bTipoDeDado', IntToStr(Item.bTipoDeDado));
  Emitir('promptPreenchido', IntToStr(Ord(Item.szPrompt[0] <> #0)));
  Emitir('menuOpcoes', IntToStr(Item.bNumOpcoesMenu));
  Emitir('ocultar', IntToStr(Item.bOcultarDadosDigitados));
  Emitir('aceitaNulo', IntToStr(Item.bAceitaNulo));
  Emitir('numeroCapturas', IntToStr(Item.bNumeroCapturas));
end;

function CriarEnsaio(out Diretorio: string): Boolean;
var
  Base: string;
begin
  Base := IncludeTrailingPathDelimiter(ExtractFilePath(ParamStr(0))) + 'ensaio-getdata';
  Diretorio := IncludeTrailingPathDelimiter(Base) + 'ensaio-' + IntToHex(GetTickCount64, 16);
  Result := False;
  if CaminhoProibido(Diretorio) or DirectoryExists(Diretorio) then
    Exit;
  Result := ForceDirectories(Diretorio);
end;

procedure FinalizarBiblioteca(Lib: HMODULE; Encerrar: TPwEnd);
begin
  if Assigned(Encerrar) then
  begin
    Encerrar();
    Emitir('end', 'chamado');
  end
  else if Lib <> 0 then
    Emitir('end', 'ausente');
  if Lib <> 0 then
    FreeLibrary(Lib);
end;

procedure ExecutarInstalacao(const CaminhoDll: string);
var
  Motivo, Diretorio, Hash, Atual: string;
  Lib: HMODULE;
  Init: TPwInit;
  Ambiente: TPwAmbiente;
  Nova: TPwNew;
  Exec: TPwExec;
  Ler: TPwGetResult;
  Confirmar: TPwConfirm;
  Esperar: TPwWait;
  Encerrar: TPwEnd;
  Parametros: TArrPWGetData;
  Quantidade, Codigo: SmallInt;
  Inicio: UInt64;
  Volta, I: Integer;
  Cnf, ReqNum, LocRef, ExtRef, VirtMerch, AuthSyst: AnsiString;

  function LerTexto(Info: SmallInt; out Texto: AnsiString; out CodigoLeitura: SmallInt): Boolean;
  var
    Buffer: array[0..TAMANHO_RESULTADO - 1] of AnsiChar;
  begin
    FillChar(Buffer, SizeOf(Buffer), 0);
    Texto := '';
    CodigoLeitura := Ler(Info, @Buffer[0], TAMANHO_RESULTADO);
    if CodigoLeitura = PWRET_OK then
      Texto := PAnsiChar(@Buffer[0]);
    Result := (CodigoLeitura = PWRET_OK) and (Texto <> '');
  end;

  procedure RegistrarReferencia(const Nome: string; Presente: Boolean);
  begin
    Emitir(Nome, IntToStr(Ord(Presente)));
  end;

  procedure DesfazerSeExigido;
  var
    CodigoLeitura: SmallInt;
    TemReq, TemLoc, TemExt, TemMerch, TemSyst, Completas: Boolean;
  begin
    if not LerTexto(PWINFO_CNFREQ, Cnf, CodigoLeitura) then
    begin
      Emitir('cnfReq', 'indisponivel');
      Emitir('confirmacao', 'nao-exigida');
      Exit;
    end;
    if (Length(Cnf) = 1) and ((Cnf = '0') or (Cnf = '1')) then
      Emitir('cnfReq', string(Cnf))
    else
      Emitir('cnfReq', 'indisponivel');
    if Cnf <> '1' then
    begin
      Emitir('confirmacao', 'nao-exigida');
      Exit;
    end;
    TemReq := LerTexto(PWINFO_REQNUM, ReqNum, CodigoLeitura);
    TemLoc := LerTexto(PWINFO_AUTLOCREF, LocRef, CodigoLeitura);
    TemExt := LerTexto(PWINFO_AUTEXTREF, ExtRef, CodigoLeitura);
    TemMerch := LerTexto(PWINFO_VIRTMERCH, VirtMerch, CodigoLeitura);
    TemSyst := LerTexto(PWINFO_AUTHSYST, AuthSyst, CodigoLeitura);
    RegistrarReferencia('reqNum', TemReq);
    RegistrarReferencia('locRef', TemLoc);
    RegistrarReferencia('extRef', TemExt);
    RegistrarReferencia('virtMerch', TemMerch);
    RegistrarReferencia('authSyst', TemSyst);
    Completas := TemReq and TemLoc and TemExt and TemMerch and TemSyst;
    if not Completas then
    begin
      Emitir('confirmacao', 'bloqueada-sem-referencia');
      Exit;
    end;
    Emitir('confirmacao', 'desfazimento');
    Emitir('pwcnf', 'PWCNF_REV_OTHER_AUT');
    Codigo := Confirmar(PWCNF_REV_OTHER_AUT, PAnsiChar(ReqNum), PAnsiChar(LocRef), PAnsiChar(ExtRef), PAnsiChar(VirtMerch), PAnsiChar(AuthSyst));
    Emitir('confirmation', IntToStr(Codigo));
    if Codigo <> PWRET_OK then
      Exit;
    Emitir('waitConfirmationContrato', 'bloqueia-ate-finalizar');
    Codigo := Esperar();
    Emitir('waitConfirmation', IntToStr(Codigo));
  end;

begin
  Lib := 0;
  Encerrar := nil;
  if not Autorizado then
  begin
    Emitir('resultado', 'EXEC_DESABILITADO');
    Emitir('loadLibrary', '0');
    Halt(0);
  end;
  if AmbientePayGoPresente then
  begin
    Emitir('resultado', 'AMBIENTE_PAYGO');
    Emitir('loadLibrary', '0');
    Halt(4);
  end;
  if not DllAceita(CaminhoDll, Motivo) then
  begin
    Emitir('resultado', Motivo);
    Emitir('loadLibrary', '0');
    Halt(2);
  end;
  if not CriarEnsaio(Diretorio) then
  begin
    Emitir('resultado', 'DIRETORIO_PRODUCAO');
    Emitir('loadLibrary', '0');
    Halt(3);
  end;
  if not DiretorioVazio(Diretorio) then
  begin
    Emitir('resultado', 'PERFIL_EXISTENTE');
    Emitir('loadLibrary', '0');
    Halt(3);
  end;
  Emitir('diretorio', Diretorio);
  Emitir('perfilCopiado', '0');
  if not SetCurrentDir(Diretorio) then
  begin
    Emitir('resultado', 'DIRETORIO_RECUSADO');
    Emitir('loadLibrary', '0');
    Halt(3);
  end;
  Atual := GetCurrentDir;
  if not SameText(ExcludeTrailingPathDelimiter(Atual), ExcludeTrailingPathDelimiter(Diretorio)) then
  begin
    Emitir('resultado', 'DIRETORIO_RECUSADO');
    Emitir('loadLibrary', '0');
    Halt(3);
  end;
  Emitir('cwd', Atual);
  if not Sha256Arquivo(CaminhoDll, Hash) then
  begin
    Emitir('resultado', 'HASH_DIVERGENTE');
    Emitir('loadLibrary', '0');
    Halt(2);
  end;
  Inc(GLoads);
  Lib := LoadLibrary(PChar(CaminhoDll));
  if Lib = 0 then
  begin
    Emitir('resultado', 'DLL_AUSENTE');
    Emitir('loadLibrary', IntToStr(GLoads));
    Halt(2);
  end;
  try
    Init := TPwInit(GetProcAddress(Lib, 'PW_iInit'));
    Ambiente := TPwAmbiente(GetProcAddress(Lib, 'PW_iSetEnvironment'));
    Nova := TPwNew(GetProcAddress(Lib, 'PW_iNewTransac'));
    Exec := TPwExec(GetProcAddress(Lib, 'PW_iExecTransac'));
    Ler := TPwGetResult(GetProcAddress(Lib, 'PW_iGetResult'));
    Confirmar := TPwConfirm(GetProcAddress(Lib, 'PW_iConfirmation'));
    Esperar := TPwWait(GetProcAddress(Lib, 'PW_iWaitConfirmation'));
    Encerrar := TPwEnd(GetProcAddress(Lib, 'PW_End'));
    if not Assigned(Init) or not Assigned(Ambiente) or not Assigned(Nova) or not Assigned(Exec) or
       not Assigned(Ler) or not Assigned(Confirmar) or not Assigned(Esperar) or not Assigned(Encerrar) then
    begin
      Emitir('resultado', 'FUNCAO_AUSENTE');
      Exit;
    end;
    Emitir('initDiretorio', Diretorio);
    Codigo := Init(PAnsiChar(AnsiString(ExcludeTrailingPathDelimiter(Diretorio))));
    Emitir('init', IntToStr(Codigo));
    if Codigo <> PWRET_OK then
    begin
      Emitir('resultado', 'INIT_RECUSADO');
      Exit;
    end;
    Codigo := Ambiente(ENVRMNT_TEST);
    Emitir('ambiente', IntToStr(Codigo));
    Emitir('ambienteNome', 'ENVRMNT_TEST');
    if Codigo <> PWRET_OK then
    begin
      Emitir('resultado', 'AMBIENTE_RECUSADO');
      Exit;
    end;
    Emitir('ambienteAntesDaOperacao', '1');
    Codigo := Nova(PWOPER_INSTALL);
    Emitir('newTransac', IntToStr(Codigo));
    Emitir('operacao', 'PWOPER_INSTALL');
    if Codigo <> PWRET_OK then
    begin
      Emitir('resultado', 'INSTALACAO_RECUSADA');
      Exit;
    end;
    Inicio := GetTickCount64;
    Volta := 0;
    Initialize(Parametros);
    Quantidade := CAPACIDADE_SUGERIDA;
    Codigo := Exec(Parametros, Quantidade);
    Inc(Volta);
    Emitir('exec', IntToStr(Codigo));
    Emitir('numParam', IntToStr(Quantidade));
    Emitir('duracaoMs', IntToStr(GetTickCount64 - Inicio));
    Emitir('execChamado', IntToStr(Volta));
    Emitir('segundaTransacao', '0');
    Emitir('addParam', '0');
    if (Quantidade < 0) or (Quantidade > CAPACIDADE_SUGERIDA) then
    begin
      Emitir('contagem', 'invalida');
    end
    else
    begin
      Emitir('contagem', 'valida');
      if Codigo = PWRET_MOREDATA then
        for I := 0 to Quantidade - 1 do
          RegistrarCaptura(Parametros[I], I, Quantidade);
    end;
    if Codigo = PWRET_OK then
    begin
      Emitir('encerramento', 'ok-getresult');
      DesfazerSeExigido;
    end
    else if Codigo = PWRET_MOREDATA then
    begin
      Emitir('encerramento', 'moredata-sem-nova-transacao');
      Emitir('confirmacao', 'nao-aplicavel');
    end
    else if Codigo = PWRET_NOTHING then
    begin
      Emitir('encerramento', 'nothing-sem-nova-execucao');
      Emitir('confirmacao', 'nao-aplicavel');
    end
    else
    begin
      Emitir('encerramento', 'erro-sem-confirmacao');
      Emitir('confirmacao', 'nao-aplicavel');
    end;
    Emitir('resultado', 'EXEC_UNICO');
  finally
    FinalizarBiblioteca(Lib, Encerrar);
    Emitir('loadLibrary', IntToStr(GLoads));
  end;
end;

var
  Motivo, Dll: string;
begin
  GLoads := 0;
  EmitirLayout;
  if (ParamCount = 0) or (ParamStr(1) = '--layout') then
    Halt(0);
  Dll := ParamStr(2);
  if ParamStr(1) = '--preparar' then
  begin
    if DllAceita(Dll, Motivo) then
      Emitir('resultado', 'PREPARADO_SEM_EXECUCAO')
    else
      Emitir('resultado', Motivo);
    Emitir('loadLibrary', '0');
    if Motivo = '' then
      Halt(0);
    if Motivo = 'DIRETORIO_PRODUCAO' then
      Halt(3);
    Halt(2);
  end;
  if ParamStr(1) = '--exec-install' then
    ExecutarInstalacao(Dll)
  else
  begin
    Emitir('resultado', 'COMANDO_DESCONHECIDO');
    Halt(1);
  end;
end.
