program UltraPDVPgWeb;

{
  Agente independente da PGWebLib. JSON Lines em stdin/stdout.
  Nao entra no UltraPDVTef.lpr e nao usa ACBr.
  Sem LAYOUT_HOMOLOGADO, nenhuma chamada chega na DLL.
}

{$mode delphi}
{$H+}
{$PACKRECORDS 8}

uses
  SysUtils,
  Classes,
  fpjson,
  jsonparser,
  PgWebLib;

const
  FUNCOES: array[0..20] of string = (
    'PW_iInit',
    'PW_iNewTransac',
    'PW_iAddParam',
    'PW_iExecTransac',
    'PW_iGetResult',
    'PW_iConfirmation',
    'PW_iWaitConfirmation',
    'PW_iIdleProc',
    'PW_iPPEventLoop',
    'PW_iPPAbort',
    'PW_iPPCommTest',
    'PW_iPPGetCard',
    'PW_iPPGetPIN',
    'PW_iPPGetData',
    'PW_iPPGoOnChip',
    'PW_iPPFinishChip',
    'PW_iPPConfirmData',
    'PW_iPPRemoveCard',
    'PW_iPPGenericCMD',
    'PW_iPPPositiveConfirmation',
    'PW_iPPTestKey'
  );

procedure Emitir(Obj: TJSONObject);
begin
  WriteLn(Obj.AsJSON);
  Flush(Output);
  Obj.Free;
end;

function Base(Id: Integer; Ok, Bloqueado: Boolean; const Nome, Mensagem: string): TJSONObject;
var
  I: Integer;
  Lista: TJSONArray;
begin
  Result := TJSONObject.Create;
  Result.Add('id', Id);
  Result.Add('ok', Ok);
  Result.Add('bloqueado', Bloqueado);
  Result.Add('acbr', False);
  Result.Add('versao', PGWEB_VERSAO);
  Result.Add('dll', PGWEB_DLL);
  Result.Add('layoutHomologado', LAYOUT_HOMOLOGADO);
  Result.Add('tamanhoPwGetData', TamanhoPwGetData);
  Result.Add('loadLibrary', TentativasLoadLibrary);
  Result.Add('carregou', BibliotecaCarregada);
  if Nome <> '' then
    Result.Add('nome', Nome);
  if Mensagem <> '' then
    Result.Add('mensagem', Mensagem);
  Lista := TJSONArray.Create;
  for I := 0 to High(FUNCOES) do
    Lista.Add(FUNCOES[I]);
  Result.Add('funcoes', Lista);
end;

procedure Bloqueado(Id: Integer; const Nome, Mensagem: string);
begin
  Emitir(Base(Id, False, True, Nome, Mensagem));
end;

function CampoTexto(Obj: TJSONObject; const Nome: string): string;
var
  Dado: TJSONData;
begin
  Result := '';
  Dado := Obj.Find(Nome);
  if Dado = nil then Exit;
  if Dado.JSONType = jtString then
    Result := Dado.AsString
  else if Dado.JSONType in [jtNumber] then
    Result := Dado.AsString;
end;

function CampoInteiro(Obj: TJSONObject; const Nome: string; Padrao: Integer): Integer;
var
  Dado: TJSONData;
begin
  Result := Padrao;
  Dado := Obj.Find(Nome);
  if (Dado <> nil) and (Dado.JSONType = jtNumber) then
    Result := Dado.AsInteger;
end;

function CampoBool(Obj: TJSONObject; const Nome: string): Boolean;
var
  Dado: TJSONData;
begin
  Result := False;
  Dado := Obj.Find(Nome);
  if (Dado <> nil) and (Dado.JSONType = jtBoolean) then
    Result := Dado.AsBoolean;
end;

function Sensivel(Info: Integer): Boolean;
begin
  Result := (Info = $1C) or (Info = $C1) or (Info = $C2) or (Info = $C8) or (Info = 3) or (Info = 6) or (Info = 17);
end;

procedure CapturasJson(Destino: TJSONObject; Quantidade: Integer);
var
  Lista, Textos, Valores: TJSONArray;
  Item: TJSONObject;
  I, J, Total: Integer;
  Tipo: Integer;
begin
  Lista := TJSONArray.Create;
  if Quantidade < 0 then Quantidade := 0;
  if Quantidade > CAPTURAS_SUGERIDAS then Quantidade := CAPTURAS_SUGERIDAS;
  for I := 0 to Quantidade - 1 do
  begin
    Item := TJSONObject.Create;
    Tipo := TipoCaptura(I);
    Item.Add('wIdentificador', IdentificadorCaptura(I));
    Item.Add('bTipoDeDado', Tipo);
    Item.Add('szPrompt', string(PromptCaptura(I)));
    Textos := TJSONArray.Create;
    Valores := TJSONArray.Create;
    if not Sensivel(Tipo) then
    begin
      Total := OpcoesCaptura(I);
      for J := 0 to Total - 1 do
      begin
        Textos.Add(string(TextoMenu(I, J)));
        Valores.Add(string(ValorMenu(I, J)));
      end;
    end;
    Item.Add('opcoes', Textos);
    Item.Add('valores', Valores);
    Lista.Add(Item);
  end;
  Destino.Add('captura', Lista);
end;

procedure Processar(const Linha: string);
var
  Dados: TJSONData;
  Obj: TJSONObject;
  Id, Codigo, Ambiente: Integer;
  Qtd: SmallInt;
  Op, Erro, Diretorio: string;
  Saida: TJSONObject;
  Display, Mensagem: AnsiString;
  Porta: Byte;
  Status: Cardinal;
begin
  Dados := nil;
  try
    Dados := GetJSON(Linha);
    if not (Dados is TJSONObject) then
      raise Exception.Create('objeto');
    Obj := TJSONObject(Dados);
    try
    Id := CampoInteiro(Obj, 'id', 0);
    Op := CampoTexto(Obj, 'op');
    if Op = 'ping' then
    begin
      Emitir(Base(Id, True, not BibliotecaCarregada, 'PGWEB_PONTE', ''));
      Exit;
    end;
    if Op = 'carregar' then
    begin
      Erro := CarregarBiblioteca(CampoTexto(Obj, 'caminho'), CampoBool(Obj, 'permitir'));
      Saida := Base(Id, Erro = '', Erro <> '', Erro, Erro);
      Emitir(Saida);
      Exit;
    end;
    if not BibliotecaCarregada then
    begin
      Bloqueado(Id, 'PGWEB_DLL_BLOQUEADA', 'A DLL nao foi carregada.');
      Exit;
    end;
    Saida := Base(Id, False, False, '', '');
    Codigo := -2499;
    if Op = 'init' then
    begin
      Diretorio := CampoTexto(Obj, 'diretorio');
      Codigo := ChamarInit(AnsiString(Diretorio));
    end
    else if Op = 'setEnvironment' then
    begin
      Ambiente := CampoInteiro(Obj, 'ambiente', -1);
      Codigo := ChamarSetEnvironment(Ambiente);
    end
    else if Op = 'newTransac' then
      Codigo := ChamarNewTransac(Byte(CampoInteiro(Obj, 'operacao', 0)))
    else if Op = 'addParam' then
      Codigo := ChamarAddParam(Word(CampoInteiro(Obj, 'info', 0)), AnsiString(CampoTexto(Obj, 'valor')))
    else if Op = 'execTransac' then
    begin
      Qtd := CampoInteiro(Obj, 'maximo', CAPTURAS_SUGERIDAS);
      Codigo := ChamarExecTransac(Qtd);
      CapturasJson(Saida, Qtd);
    end
    else if Op = 'getResult' then
    begin
      Codigo := ChamarGetResult(CampoInteiro(Obj, 'info', 0), Display);
      if Sensivel(CampoInteiro(Obj, 'info', 0)) then
        Saida.Add('omitido', True)
      else
        Saida.Add('valor', string(Display));
    end
    else if Op = 'confirmation' then
    begin
      Status := Cardinal(CampoInteiro(Obj, 'status', 0));
      Codigo := ChamarConfirmation(
        Status,
        AnsiString(CampoTexto(Obj, 'reqNum')),
        AnsiString(CampoTexto(Obj, 'locRef')),
        AnsiString(CampoTexto(Obj, 'extRef')),
        AnsiString(CampoTexto(Obj, 'virtMerch')),
        AnsiString(CampoTexto(Obj, 'authSyst'))
      );
    end
    else if Op = 'waitConfirmation' then
      Codigo := ChamarWaitConfirmation
    else if Op = 'idleProc' then
      Codigo := ChamarIdleProc
    else if Op = 'ppEventLoop' then
    begin
      Codigo := ChamarPPEventLoop(Display);
      Saida.Add('display', string(Display));
    end
    else if Op = 'ppAbort' then
      Codigo := ChamarPPAbort
    else if Op = 'ppCommTest' then
    begin
      { pbCommPort e saida. O header devolve 0xFF quando o teste falha. }
      Porta := $FF;
      Codigo := ChamarPPCommTest(Mensagem, Porta);
      Saida.Add('mensagem', string(Mensagem));
      Saida.Add('porta', Porta);
    end
    else if Copy(Op, 1, 6) = 'PW_iPP' then
      Codigo := ChamarPPIndice(AnsiString(Op), Word(CampoInteiro(Obj, 'indice', 0)))
    else
    begin
      Saida.Free;
      Bloqueado(Id, 'PGWEB_OP_DESCONHECIDA', Op);
      Exit;
    end;
    Saida.Add('codigo', Codigo);
    Saida.Booleans['ok'] := Codigo = 0;
    Emitir(Saida);
    finally
      Dados.Free;
    end;
  except
    on E: Exception do
      Bloqueado(0, 'PGWEB_PROTOCOLO', 'Linha JSON invalida.');
  end;
end;

var
  Linha: string;
begin
  while not Eof(Input) do
  begin
    ReadLn(Input, Linha);
    if Trim(Linha) <> '' then
      Processar(Linha);
  end;
end.
