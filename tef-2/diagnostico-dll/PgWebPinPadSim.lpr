library PgWebPinPadSim;

{
  Substituto nativo do ensaio de PinPad.
  Exporta somente PW_iInit, PW_iPPCommTest e PW_iPPEventLoop.
}

{$mode delphi}

uses
  SysUtils;

type
  Int16 = SmallInt;
  Uint16 = Word;
  Uint32 = LongWord;

var
  Diretorio: AnsiString;
  Volta: Integer;

procedure Registrar(const Etapa: string);
var
  Marca: TextFile;
begin
  AssignFile(Marca, IncludeTrailingPathDelimiter(ExtractFilePath(ParamStr(0))) + 'pinpad-sim-chamado.txt');
  if FileExists(IncludeTrailingPathDelimiter(ExtractFilePath(ParamStr(0))) + 'pinpad-sim-chamado.txt') then
    Append(Marca)
  else
    Rewrite(Marca);
  WriteLn(Marca, Etapa);
  CloseFile(Marca);
end;

procedure Copiar(Destino: PAnsiChar; Tamanho: Cardinal; const Texto: AnsiString);
var
  I, Limite: Integer;
begin
  if (Destino = nil) or (Tamanho = 0) then
    Exit;
  Limite := Length(Texto);
  if Limite > Integer(Tamanho) - 1 then
    Limite := Integer(Tamanho) - 1;
  for I := 1 to Limite do
    Destino[I - 1] := Texto[I];
  Destino[Limite] := #0;
end;

function PW_iInit(pszWorkingDir: PAnsiChar): Int16; stdcall;
begin
  {$IF SizeOf(Int16) <> 2}
  {$ERROR Int16 precisa ter 16 bits}
  {$ENDIF}
  Volta := 0;
  Diretorio := '';
  if pszWorkingDir <> nil then
    Diretorio := pszWorkingDir;
  Registrar('init');
  Result := 0;
end;

function PW_iPPCommTest(pszMsg: PAnsiChar; uiMsgSize: Uint16; pbCommPort: PByte): Int16; stdcall;
var
  Texto: string;
begin
  Registrar('commtest');
  if pbCommPort <> nil then
    pbCommPort^ := $FF;
  if (pszMsg <> nil) and (uiMsgSize > 0) then
    pszMsg^ := #0;
  Texto := LowerCase(string(Diretorio));
  if Pos('pinpad-erro', Texto) > 0 then
    Exit(Int16(-2484));
  if Pos('pinpad-nada', Texto) > 0 then
  begin
    Copiar(pszMsg, uiMsgSize, 'sem pinpad');
    Exit(Int16(-2493));
  end;
  if pbCommPort <> nil then
    pbCommPort^ := 1;
  Result := 0;
end;

function PW_iPPEventLoop(pszDisplay: PAnsiChar; ulDisplaySize: Uint32): Int16; stdcall;
begin
  Registrar('eventloop');
  Inc(Volta);
  if (pszDisplay <> nil) and (ulDisplaySize > 0) then
    pszDisplay^ := #0;
  if Volta = 1 then
    Exit(Int16(-2493));
  if Volta = 2 then
  begin
    Copiar(pszDisplay, ulDisplaySize, 'teste pinpad');
    Exit(Int16(-2495));
  end;
  Result := 0;
end;

exports
  PW_iInit,
  PW_iPPCommTest,
  PW_iPPEventLoop;

begin
end.
