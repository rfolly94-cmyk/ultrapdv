program UltraPDVTef;

{$mode objfpc}{$H+}

uses
  Interfaces,
  SysUtils, Classes, Windows, fpjson, jsonparser,
  ACBrTEFComum,
  ACBrTEFAPIComum,
  ACBrTEFPayGoComum,
  ACBrTEFPayGoWebComum,
  ACBrTEFAPI,
  ACBrTEFAPIPayGoWeb,
  ACBrUtil.Strings;

type
  TEventosTEF = class
  public
    procedure QuandoFinalizarOperacao(
      RespostaTEF: TACBrTEFResp);

    procedure QuandoEsperarOperacao(
      OperacaoAPI: TACBrTEFAPIOperacaoAPI;
      var Cancelar: Boolean);

    procedure QuandoExibirMensagem(
      const Mensagem: String;
      Terminal: TACBrTEFAPITela;
      MilissegundosExibicao: Integer);

    procedure QuandoPerguntarMenu(
      const Titulo: String;
      Opcoes: TStringList;
      var ItemSelecionado: Integer);

    procedure QuandoPerguntarCampo(
      DefinicaoCampo: TACBrTEFAPIDefinicaoCampo;
      var Resposta: String;
      var Validado: Boolean;
      var Cancelado: Boolean);

    procedure QuandoExibirQRCode(
      const DadosQRCode: String);

    procedure QuandoDetectarTransacaoPendente(
      RespostaTEF: TACBrTEFResp;
      const MsgErro: String);

    procedure QuandoGravarLog(const ALogLine: String; var Tratado: Boolean);
  end;

  TPendenciaTef = record
    Rede: String;
    NSU: String;
    Finalizacao: String;
    Identificador: String;
    Valor: Double;
  end;

var
  TEF: TACBrTEFAPI;
  EventosTEF: TEventosTEF;
  PagamentoEmAndamento: Boolean;
  TransacaoAguardandoDecisao: Boolean;
  PendenteRede: String;
  PendenteNSU: String;
  PendenteFinalizacao: String;
  PendenciaIncompleta: Boolean;
  Pendencias: array of TPendenciaTef;
  DiagnosticoInstalacao: Boolean;
  DiagnosticoPagamento: Boolean;
  ObservandoInicializacao: Boolean;
  ObservacaoInstalacaoAtiva: Boolean;
  ObservacaoPontoAusente: Boolean;
  ObservacaoViuAmbiente: Boolean;
  ObservacaoRetornoAmbiente: Integer;
  ObservacaoCodigoAmbiente: Integer;
  ObservacaoAguardaTransacaoNula: Boolean;
  ObservacaoAguardaAmbiente: Boolean;
  ObservacaoPonto: String;
  ObservacaoConsumida: Boolean;
  IdentidadeTravada: Boolean;
  IdentidadeNova: Boolean;
  IdentidadePonto: String;
  IdentidadeAmbiente: String;
  IdentidadeCnpj: String;
  IdentidadeServidor: String;
  IdentidadeEstabelecimento: String;
  DiretorioObservado: String;
  DiretorioTrabalhoObservado: String;
  DiretorioPwInitObservado: String;
  ObservacaoAguardaInit: Boolean;
  ObservacaoRetornoInit: Integer;
  ObservacaoRetornoInitNome: String;
  CredencialTecnica: String;
  IdPagamentoAtivo: String;
  ContadorMenus: Integer;

procedure GuardarPendencia(
  const Rede, NSU, Finalizacao, Identificador: String;
  Valor: Double); forward;
procedure EspelharPendenciaAtual; forward;

procedure LogErro(const Msg: String);
begin
  { stdout fica exclusivamente para JSON Lines }
  WriteLn(StdErr, Msg);
  Flush(StdErr);
end;

function CredencialInformada(const Valor: String): Boolean;
var
  i: Integer;
  C: Char;
begin
  Result := (Length(Valor) >= 4) and (Length(Valor) <= 40);
  if not Result then
    Exit;
  for i := 1 to Length(Valor) do
  begin
    C := Valor[i];
    if (C <= ' ') or (C = #127) then
      Exit(False);
  end;
end;

procedure LimparCredencialTecnica;
begin
  CredencialTecnica := '';
end;

procedure DefinirCredencialTecnica(const Valor: String);
begin
  if CredencialInformada(Valor) then
    CredencialTecnica := Valor
  else
    CredencialTecnica := '';
end;

function NomeTela(Terminal: TACBrTEFAPITela): String;
begin
  case Terminal of
    telaOperador: Result := 'telaOperador';
    telaCliente: Result := 'telaCliente';
  else
    Result := 'telaTodas';
  end;
end;

function NomeRetornoPayGo(const Codigo: String): String;
var
  N: Integer;
begin
  if Trim(Codigo) = '' then
    Exit('ausente');
  N := StrToIntDef(Trim(Codigo), 999999);
  case N of
    PWRET_OK: Result := 'PWRET_OK';
    PWRET_CANCEL: Result := 'PWRET_CANCEL';
    PWRET_NOTINST: Result := 'PWRET_NOTINST';
    PWRET_INVPARAM: Result := 'PWRET_INVPARAM';
    PWRET_TIMEOUT: Result := 'PWRET_TIMEOUT';
    PWRET_MOREDATA: Result := 'PWRET_MOREDATA';
    PWRET_REQPARAM: Result := 'PWRET_REQPARAM';
    PWRET_FROMHOST: Result := 'PWRET_FROMHOST';
    PWRET_INVCALL: Result := 'PWRET_INVCALL';
    PWRET_DLLNOTINIT: Result := 'PWRET_DLLNOTINIT';
    PWRET_TRNNOTINIT: Result := 'PWRET_TRNNOTINIT';
  else
    Result := 'PWRET';
  end;
  Result := Result + ' codigo=' + Trim(Codigo);
end;

{ Mascara trilha, PAN e sequencias longas. O texto do prompt permanece. }
function SanitizarTextoDiagnostico(const Texto: String): String;
var
  i, j, n, total: Integer;
  C: Char;
  Bruto, Saida: String;
begin
  Bruto := StringReplace(Texto, #13, ' ', [rfReplaceAll]);
  Bruto := StringReplace(Bruto, #10, ' ', [rfReplaceAll]);
  if CredencialInformada(CredencialTecnica) and
     (Pos(CredencialTecnica, Bruto) > 0) then
    Bruto := StringReplace(Bruto, CredencialTecnica, '[redigido]', [rfReplaceAll]);
  total := 0;
  for i := 1 to Length(Bruto) do
    if Bruto[i] in ['0'..'9'] then
      Inc(total);

  Saida := '';
  i := 1;
  while i <= Length(Bruto) do
  begin
    C := Bruto[i];
    if (C = '%') or (C = ';') then
    begin
      Saida := Saida + '[trilha]';
      Inc(i);
      while (i <= Length(Bruto)) and (Bruto[i] <> ' ') do
        Inc(i);
    end
    else if C in ['0'..'9'] then
    begin
      j := i;
      n := 0;
      while (j <= Length(Bruto)) and (Bruto[j] in ['0'..'9']) do
      begin
        Inc(n);
        Inc(j);
      end;
      if (n >= 6) or ((total >= 12) and (n >= 3)) then
        Saida := Saida + '[digitos]'
      else
        Saida := Saida + Copy(Bruto, i, n);
      i := j;
    end
    else
    begin
      Saida := Saida + C;
      Inc(i);
    end;
  end;

  if Length(Saida) > 180 then
    Saida := Copy(Saida, 1, 180);
  Result := Saida;
end;

procedure LogDiagnosticoInstalacao(
  const Callback, Tela, Milissegundos, Retorno, Texto: String);
begin
  LogErro(
    '[ACBrTEF][instalar] callback=' + Callback +
    ' tela=' + Tela +
    ' ms=' + Milissegundos +
    ' retorno=' + Retorno +
    ' texto=' + SanitizarTextoDiagnostico(Texto)
  );
end;

function NormalizarPergunta(const Texto: String): String;
begin
  Result := Trim(UpperCase(TiraAcentos(Texto)));
  while Pos('  ', Result) > 0 do
    Result := StringReplace(Result, '  ', ' ', [rfReplaceAll]);
end;

function PerguntaSenhaTecnica(const Titulo: String): Boolean;
begin
  Result := NormalizarPergunta(Titulo) = 'INFORME A SENHA TECNICA';
end;

function TextoMenuSeguro(const Texto: String): String;
begin
  Result := SanitizarTextoDiagnostico(Texto);
  Result := StringReplace(Result, '"', '''', [rfReplaceAll]);
end;

procedure LogMenuPagamento(const Titulo: String; Opcoes: TStringList);
var
  i, Total: Integer;
begin
  Total := 0;
  if Assigned(Opcoes) then
    Total := Opcoes.Count;
  LogErro(
    '[ACBrTEF][pagamento] callback=QuandoPerguntarMenu titulo="' +
    TextoMenuSeguro(Titulo) + '" opcoes=' + IntToStr(Total)
  );
  for i := 0 to Total - 1 do
    LogErro(
      '[ACBrTEF][pagamento] menu[' + IntToStr(i) + ']="' +
      TextoMenuSeguro(Opcoes[i]) + '"'
    );
end;

{ TEventosTEF }

procedure TEventosTEF.QuandoFinalizarOperacao(
  RespostaTEF: TACBrTEFResp);
begin
  if Assigned(RespostaTEF) then
    LogErro('[ACBrTEF] Operacao finalizada')
  else
    LogErro('[ACBrTEF] Operacao finalizada sem resposta');
end;

procedure TEventosTEF.QuandoDetectarTransacaoPendente(
  RespostaTEF: TACBrTEFResp;
  const MsgErro: String);
begin
  { So registra. Nao confirma e nao desfaz. }
  LogErro('[ACBrTEF] Pendencia detectada sem decisao: ' + MsgErro);
  if not Assigned(RespostaTEF) then
  begin
    PendenciaIncompleta := True;
    TransacaoAguardandoDecisao := True;
    Exit;
  end;
  if (Trim(RespostaTEF.Rede) = '') or (Trim(RespostaTEF.NSU) = '') or
     (Trim(RespostaTEF.Finalizacao) = '') then
  begin
    PendenciaIncompleta := True;
    TransacaoAguardandoDecisao := True;
    Exit;
  end;
  GuardarPendencia(
    RespostaTEF.Rede,
    RespostaTEF.NSU,
    RespostaTEF.Finalizacao,
    RespostaTEF.DocumentoVinculado,
    RespostaTEF.ValorTotal
  );
end;

procedure TEventosTEF.QuandoEsperarOperacao(
  OperacaoAPI: TACBrTEFAPIOperacaoAPI;
  var Cancelar: Boolean);
begin
  Cancelar := False;
end;

procedure TEventosTEF.QuandoExibirMensagem(
  const Mensagem: String;
  Terminal: TACBrTEFAPITela;
  MilissegundosExibicao: Integer);
begin
  if DiagnosticoInstalacao then
    LogDiagnosticoInstalacao(
      'QuandoExibirMensagem',
      NomeTela(Terminal),
      IntToStr(MilissegundosExibicao),
      'ausente',
      Mensagem)
  else
    LogErro('[ACBrTEF] ' + Mensagem);
end;

function AguardarRespostaMenu(const Id, SolicitacaoId: String;
  TotalOpcoes: Integer): Integer;
var
  Inicio: QWord;
  Disponiveis: DWORD;
  LinhaResposta: String;
  Dado: TJSONData;
  Obj: TJSONObject;
  Dados: TJSONData;
  Indice: Integer;
begin
  Result := -1;
  Inicio := GetTickCount64;
  { Nunca aceitar o proximo comando financeiro como resposta do menu. }
  while GetTickCount64 - Inicio < 120000 do
  begin
    Disponiveis := 0;
    if not PeekNamedPipe(GetStdHandle(STD_INPUT_HANDLE), nil, 0,
      nil, @Disponiveis, nil) then
    begin
      LogErro('[ACBrTEF] PeekNamedPipe falhou. Erro Windows=' +
        IntToStr(GetLastError));
      Exit;
    end;
    if Disponiveis = 0 then
    begin
      Sleep(50);
      Continue;
    end;
    ReadLn(Input, LinhaResposta);
    Dado := nil;
    try
      try
        Dado := GetJSON(LinhaResposta);
        if Dado.JSONType <> jtObject then Continue;
        Obj := TJSONObject(Dado);
        if (Obj.Get('id', '') <> Id) or
           (Obj.Get('acao', '') <> 'menu_resposta') then Continue;
        Dados := Obj.Find('dados');
        if (Dados = nil) or (Dados.JSONType <> jtObject) then Continue;
        if TJSONObject(Dados).Get('solicitacaoId', '') <> SolicitacaoId then Continue;
        if TJSONObject(Dados).Find('indice') = nil then Continue;
        if TJSONObject(Dados).Find('indice').JSONType <> jtNumber then Continue;
        Indice := TJSONObject(Dados).Get('indice', -1);
        if (Indice >= -1) and (Indice < TotalOpcoes) then
        begin
          Result := Indice;
          Exit;
        end;
      except
        on E: Exception do LogErro('[ACBrTEF] Resposta de menu invalida');
      end;
    finally
      Dado.Free;
    end;
  end;
  LogErro('[ACBrTEF] Menu expirou: cancelado');
end;

procedure TEventosTEF.QuandoPerguntarMenu(
  const Titulo: String;
  Opcoes: TStringList;
  var ItemSelecionado: Integer);
var
  EventoMenu: TJSONObject;
  ItensMenu: TJSONArray;
  iMenu: Integer;
begin
  if DiagnosticoPagamento then
    LogMenuPagamento(Titulo, Opcoes)
  else if DiagnosticoInstalacao then
    LogDiagnosticoInstalacao(
      'QuandoPerguntarMenu',
      'menu',
      'ausente',
      'ausente',
      Titulo)
  else
    LogErro('[ACBrTEF] Menu solicitado: ' + Titulo);

  ItemSelecionado := -1;
  if not PagamentoEmAndamento or (IdPagamentoAtivo = '') or
     not Assigned(Opcoes) or (Opcoes.Count = 0) then Exit;
  Inc(ContadorMenus);
  EventoMenu := TJSONObject.Create;
  try
    EventoMenu.Add('tipo', 'menu');
    EventoMenu.Add('id', IdPagamentoAtivo);
    EventoMenu.Add('solicitacaoId', IdPagamentoAtivo + '-' + IntToStr(ContadorMenus));
    EventoMenu.Add('titulo', Titulo);
    ItensMenu := TJSONArray.Create;
    for iMenu := 0 to Opcoes.Count - 1 do ItensMenu.Add(Opcoes[iMenu]);
    EventoMenu.Add('opcoes', ItensMenu);
    WriteLn(EventoMenu.AsJSON);
    Flush(Output);
  finally
    EventoMenu.Free;
  end;
  ItemSelecionado := AguardarRespostaMenu(IdPagamentoAtivo,
    IdPagamentoAtivo + '-' + IntToStr(ContadorMenus), Opcoes.Count);
end;

procedure TEventosTEF.QuandoPerguntarCampo(
  DefinicaoCampo: TACBrTEFAPIDefinicaoCampo;
  var Resposta: String;
  var Validado: Boolean;
  var Cancelado: Boolean);
begin
  if DiagnosticoInstalacao and
     PerguntaSenhaTecnica(DefinicaoCampo.TituloPergunta) then
  begin
    if CredencialInformada(CredencialTecnica) then
    begin
      LogErro(
        '[ACBrTEF][instalar] callback=QuandoPerguntarCampo' +
        ' campo=senha_tecnica resposta=fornecida'
      );
      Resposta := CredencialTecnica;
      Validado := True;
      Cancelado := False;
      Exit;
    end;
    LogErro(
      '[ACBrTEF][instalar] callback=QuandoPerguntarCampo' +
      ' campo=senha_tecnica resposta=ausente'
    );
    Resposta := '';
    LimparCredencialTecnica;
    Validado := False;
    Cancelado := True;
    Exit;
  end;

  if DiagnosticoInstalacao then
    LogDiagnosticoInstalacao(
      'QuandoPerguntarCampo',
      'campo',
      'ausente',
      'ausente',
      DefinicaoCampo.TituloPergunta)
  else
    LogErro('[ACBrTEF] Campo solicitado: ' +
      DefinicaoCampo.TituloPergunta);

  Resposta := '';
  Validado := False;
  Cancelado := True;
end;

procedure TEventosTEF.QuandoExibirQRCode(
  const DadosQRCode: String);
begin
  LogErro('[ACBrTEF] QRCode solicitado');
end;

procedure Responder(
  const AId: String;
  AOk: Boolean;
  const AResultado: TJSONObject;
  const AErro: String);
var
  Resp: TJSONObject;
begin
  Resp := TJSONObject.Create;
  try
    Resp.Add('id', AId);
    Resp.Add('ok', AOk);

    if Assigned(AResultado) then
      Resp.Add('resultado', AResultado.Clone)
    else
      Resp.Add('resultado', TJSONObject.Create);

    if AErro = '' then
      Resp.Add('erro', TJSONNull.Create)
    else
      Resp.Add('erro', AErro);

    WriteLn(Resp.AsJSON);
    Flush(Output);
  finally
    Resp.Free;
  end;
end;

procedure ConfigurarEventosTEF;
begin
  TEF.QuandoFinalizarOperacao :=
    @EventosTEF.QuandoFinalizarOperacao;

  TEF.QuandoEsperarOperacao :=
    @EventosTEF.QuandoEsperarOperacao;

  TEF.QuandoExibirMensagem :=
    @EventosTEF.QuandoExibirMensagem;

  TEF.QuandoPerguntarMenu :=
    @EventosTEF.QuandoPerguntarMenu;

  TEF.QuandoPerguntarCampo :=
    @EventosTEF.QuandoPerguntarCampo;

  TEF.QuandoExibirQRCode :=
    @EventosTEF.QuandoExibirQRCode;

  TEF.QuandoGravarLog :=
    @EventosTEF.QuandoGravarLog;
end;

procedure EspelharPendenciaAtual;
begin
  TransacaoAguardandoDecisao := (Length(Pendencias) > 0) or PendenciaIncompleta;
  if Length(Pendencias) > 0 then
  begin
    PendenteRede := Pendencias[0].Rede;
    PendenteNSU := Pendencias[0].NSU;
    PendenteFinalizacao := Pendencias[0].Finalizacao;
  end
  else
  begin
    PendenteRede := '';
    PendenteNSU := '';
    PendenteFinalizacao := '';
  end;
end;

procedure GuardarPendencia(
  const Rede, NSU, Finalizacao, Identificador: String;
  Valor: Double);
var
  i, n: Integer;
begin
  if (Trim(Rede) = '') or (Trim(NSU) = '') or (Trim(Finalizacao) = '') then
  begin
    PendenciaIncompleta := True;
    TransacaoAguardandoDecisao := True;
    Exit;
  end;
  for i := 0 to High(Pendencias) do
    if (Pendencias[i].Rede = Rede) and (Pendencias[i].NSU = NSU) and
       (Pendencias[i].Finalizacao = Finalizacao) then
    begin
      EspelharPendenciaAtual;
      Exit;
    end;
  n := Length(Pendencias);
  SetLength(Pendencias, n + 1);
  Pendencias[n].Rede := Rede;
  Pendencias[n].NSU := NSU;
  Pendencias[n].Finalizacao := Finalizacao;
  Pendencias[n].Identificador := Identificador;
  Pendencias[n].Valor := Valor;
  EspelharPendenciaAtual;
end;

procedure RemoverPendencia(const Rede, NSU, Finalizacao: String);
var
  i, j: Integer;
begin
  j := 0;
  for i := 0 to High(Pendencias) do
    if not ((Pendencias[i].Rede = Rede) and (Pendencias[i].NSU = NSU) and
            (Pendencias[i].Finalizacao = Finalizacao)) then
    begin
      Pendencias[j] := Pendencias[i];
      Inc(j);
    end;
  SetLength(Pendencias, j);
  EspelharPendenciaAtual;
end;

procedure AnexarProximaPendencia(Resultado: TJSONObject);
var
  Item: TJSONObject;
begin
  Item := TJSONObject.Create;
  Item.Add('rede', Pendencias[0].Rede);
  Item.Add('nsu', Pendencias[0].NSU);
  Item.Add('finalizacao', Pendencias[0].Finalizacao);
  Item.Add('identificador', Pendencias[0].Identificador);
  Item.Add('valor', Pendencias[0].Valor);
  Resultado.Add('proximaPendencia', Item);
end;

procedure AnexarPendenciaNoJson(Resultado: TJSONObject);
var
  Item: TJSONObject;
begin
  Resultado.Add('pendenciaDetectada', (Length(Pendencias) > 0) or PendenciaIncompleta);
  Resultado.Add('pendenciasDetectadas', Length(Pendencias));
  Resultado.Add('pendenciaIncompleta', PendenciaIncompleta);
  Resultado.Add('tratamentoTransacaoPendente', 'tefpenPerguntar');
  Resultado.Add('tratamentoTransacaoInicializacao', 'tefopiProcessarPendentes');
  Resultado.Add('confirmarTransacoesPendentesNoHost', False);
  if Length(Pendencias) = 0 then
    Resultado.Add('pendencia', TJSONNull.Create)
  else
  begin
    Item := TJSONObject.Create;
    Item.Add('rede', Pendencias[0].Rede);
    Item.Add('nsu', Pendencias[0].NSU);
    Item.Add('finalizacao', Pendencias[0].Finalizacao);
    Item.Add('identificador', Pendencias[0].Identificador);
    Item.Add('valor', Pendencias[0].Valor);
    Resultado.Add('pendencia', Item);
  end;
end;

procedure LimparObservacaoInstalacao;
begin
  ObservandoInicializacao := False;
  ObservacaoInstalacaoAtiva := False;
  ObservacaoPontoAusente := False;
  ObservacaoViuAmbiente := False;
  ObservacaoRetornoAmbiente := -999;
  ObservacaoCodigoAmbiente := -1;
  ObservacaoAguardaTransacaoNula := False;
  ObservacaoAguardaAmbiente := False;
  ObservacaoAguardaInit := False;
  ObservacaoRetornoInit := -999;
  ObservacaoRetornoInitNome := '';
  ObservacaoPonto := '';
  ObservacaoConsumida := False;
end;

function ExtrairArgumentoLog(const Linha, Marca: String): String;
var
  Inicio, Fim: Integer;
begin
  Result := '';
  Inicio := Pos(Marca, Linha);
  if Inicio = 0 then
    Exit;
  Inicio := Inicio + Length(Marca);
  while (Inicio <= Length(Linha)) and (Linha[Inicio] in [' ', '(']) do
    Inc(Inicio);
  Fim := Length(Linha);
  while (Fim >= Inicio) and (Linha[Fim] in [' ', ')']) do
    Dec(Fim);
  if Fim >= Inicio then
    Result := Copy(Linha, Inicio, Fim - Inicio + 1);
end;

function NomeRetornoPw(const Linha: String): String;
var
  Inicio, Fim: Integer;
begin
  Result := '';
  Inicio := Pos('PWRET_', Linha);
  if Inicio = 0 then
    Exit;
  Fim := Inicio;
  while (Fim <= Length(Linha)) and (Linha[Fim] in ['A'..'Z', '0'..'9', '_']) do
    Inc(Fim);
  Result := Copy(Linha, Inicio, Fim - Inicio);
end;

function CodigoRetornoPw(const Nome: String): Integer;
begin
  if Nome = 'PWRET_OK' then
    Result := 0
  else if Nome = 'PWRET_WRITERR' then
    Result := -2485
  else if Nome = 'PWRET_INVCALL' then
    Result := -2494
  else
    Result := -999;
end;

function DiretorioPaiProducao: String;
var
  Base: String;
begin
  Base := Trim(SysUtils.GetEnvironmentVariable('PROGRAMDATA'));
  if Base = '' then
    Base := Trim(SysUtils.GetEnvironmentVariable('ALLUSERSPROFILE'));
  if Base = '' then
    Exit('');
  Result := IncludeTrailingPathDelimiter(Base) + 'UltraPDV\TEF\Producao';
end;

function ExtrairCodigoAmbiente(const Linha: String): Integer;
var
  Inicio, Fim: Integer;
begin
  Result := -1;
  Inicio := Pos('PW_iSetEnvironment(', Linha);
  if Inicio = 0 then
    Exit;
  Inicio := Inicio + Length('PW_iSetEnvironment(');
  while (Inicio <= Length(Linha)) and (Linha[Inicio] = ' ') do
    Inc(Inicio);
  Fim := Inicio;
  while (Fim <= Length(Linha)) and (Linha[Fim] in ['0'..'9']) do
    Inc(Fim);
  if Fim = Inicio then
    Exit;
  Result := StrToIntDef(Copy(Linha, Inicio, Fim - Inicio), -1);
end;

procedure ObservarLinhaPayGo(const Linha: String);
begin
  if not ObservandoInicializacao then
    Exit;
  if (Pos('PW_iNewTransac', Linha) > 0) and (Pos('PWOPER_NULL', Linha) > 0) then
  begin
    ObservacaoAguardaTransacaoNula := True;
    Exit;
  end;
  if ObservacaoAguardaTransacaoNula and (Pos('PWRET_', Linha) > 0) then
  begin
    ObservacaoAguardaTransacaoNula := False;
    ObservacaoPontoAusente := Pos('PWRET_NOTINST', Linha) > 0;
    Exit;
  end;
  if Pos('PW_iSetEnvironment(', Linha) > 0 then
  begin
    ObservacaoViuAmbiente := True;
    ObservacaoAguardaAmbiente := True;
    ObservacaoCodigoAmbiente := ExtrairCodigoAmbiente(Linha);
    Exit;
  end;
  if ObservacaoAguardaAmbiente and (Pos('PWRET_', Linha) > 0) then
  begin
    ObservacaoAguardaAmbiente := False;
    if Pos('PWRET_OK', Linha) > 0 then
      ObservacaoRetornoAmbiente := 0
    else
      ObservacaoRetornoAmbiente := -1;
    Exit;
  end;
  if Pos('PW_iInit(', Linha) > 0 then
  begin
    ObservacaoAguardaInit := True;
    if ExtrairArgumentoLog(Linha, 'PW_iInit') <> '' then
    begin
      DiretorioPwInitObservado := ExtrairArgumentoLog(Linha, 'PW_iInit');
      DiretorioTrabalhoObservado := DiretorioPwInitObservado;
    end;
    Exit;
  end;
  if ObservacaoAguardaInit and (Pos('PWRET_', Linha) > 0) then
  begin
    ObservacaoAguardaInit := False;
    ObservacaoRetornoInitNome := NomeRetornoPw(Linha);
    ObservacaoRetornoInit := CodigoRetornoPw(ObservacaoRetornoInitNome);
  end;
end;

function NomeAmbienteObservado: String;
begin
  if ObservacaoCodigoAmbiente = 0 then
    Result := 'producao'
  else if ObservacaoCodigoAmbiente = 1 then
    Result := 'homologacao'
  else
    Result := '';
end;

function ObservacaoInstalacaoPronta: Boolean;
begin
  Result :=
    ObservacaoInstalacaoAtiva and
    (not ObservacaoConsumida) and
    ObservacaoPontoAusente and
    ObservacaoViuAmbiente and
    (ObservacaoRetornoAmbiente = 0) and
    (ObservacaoPonto <> '') and
    ((ObservacaoCodigoAmbiente = 0) or (ObservacaoCodigoAmbiente = 1));
end;

function TextoDados(Dados: TJSONObject; const Nome: String): String;
begin
  if Dados = nil then
    Result := ''
  else
    Result := Trim(Dados.Get(Nome, ''));
end;

function SomenteDigitosCnpj(const Valor: String): String;
var
  i: Integer;
begin
  Result := '';
  for i := 1 to Length(Valor) do
    if Valor[i] in ['0'..'9'] then
      Result := Result + Valor[i];
end;

function DigitoCnpj(const Base: String; const Pesos: array of Byte): Integer;
var
  i, Soma: Integer;
begin
  Soma := 0;
  for i := 0 to High(Pesos) do
    Soma := Soma + (Ord(Base[i + 1]) - Ord('0')) * Pesos[i];
  Result := Soma mod 11;
  if Result < 2 then
    Result := 0
  else
    Result := 11 - Result;
end;

function CnpjAutorizado(const Valor: String): Boolean;
var
  Digitos: String;
begin
  Digitos := SomenteDigitosCnpj(Valor);
  if Length(Digitos) <> 14 then
    Exit(False);
  if DigitoCnpj(Copy(Digitos, 1, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) <>
     (Ord(Digitos[13]) - Ord('0')) then
    Exit(False);
  Result :=
    DigitoCnpj(Copy(Digitos, 1, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) =
    (Ord(Digitos[14]) - Ord('0'));
end;

function PontoAutorizado(const Valor: String): Boolean;
var
  i: Integer;
begin
  Result := (Valor <> '') and (Length(Valor) <= 11);
  if not Result then
    Exit;
  for i := 1 to Length(Valor) do
    if not (Valor[i] in ['0'..'9']) then
      Exit(False);
end;

function ServidorAutorizado(const Valor: String): Boolean;
var
  Texto, Host, PortaTxt: String;
  Separador, i, Porta: Integer;
begin
  Result := False;
  Texto := Trim(Valor);
  if (Texto = '') or (Length(Texto) > 200) or (Pos(' ', Texto) > 0) or
     (Pos('://', Texto) > 0) then
    Exit;
  Separador := 0;
  for i := Length(Texto) downto 1 do
    if Texto[i] = ':' then
    begin
      Separador := i;
      Break;
    end;
  if (Separador < 2) or (Separador >= Length(Texto)) then
    Exit;
  Host := Copy(Texto, 1, Separador - 1);
  PortaTxt := Copy(Texto, Separador + 1, MaxInt);
  if (Host = '') or (Host[1] = '.') or (Host[Length(Host)] = '.') or
     (Pos('..', Host) > 0) then
    Exit;
  for i := 1 to Length(Host) do
    if not (Host[i] in ['A'..'Z', 'a'..'z', '0'..'9', '.', '-']) then
      Exit;
  for i := 1 to Length(PortaTxt) do
    if not (PortaTxt[i] in ['0'..'9']) then
      Exit;
  Porta := StrToIntDef(PortaTxt, 0);
  Result := (Porta >= 1) and (Porta <= 65535);
end;

function EstabelecimentoAutorizado(const Valor: String): Boolean;
begin
  Result :=
    (Valor <> '') and
    (Length(Valor) <= 40) and
    (Pos(#13, Valor) = 0) and
    (Pos(#10, Valor) = 0);
end;

function AmbienteAutorizado(const Valor: String): Boolean;
begin
  Result := (Valor = 'homologacao') or (Valor = 'producao');
end;

function TokenDiretorioSolicitado(Dados: TJSONObject): String;
var
  Token: String;
begin
  Token := TextoDados(Dados, 'diretorio');
  if Token = '' then
  begin
    if TextoDados(Dados, 'ambiente') = 'producao' then
      Result := 'producao'
    else
      Result := 'sandbox';
    Exit;
  end;
  Result := Token;
end;

function DiretorioSolicitadoValido(const Token, Ambiente: String): Boolean;
begin
  if (Token <> 'producao') and (Token <> 'sandbox') then
    Exit(False);
  if (Ambiente = 'producao') and (Token <> 'producao') then
    Exit(False);
  if (Ambiente <> 'producao') and (Token = 'producao') then
    Exit(False);
  Result := True;
end;

function CaminhoPaiLocal(const Valor: String): Boolean;
var
  Normal: String;
begin
  Normal := UpperCase(Valor);
  Result :=
    (Length(Valor) >= 4) and
    (Length(Valor) <= 200) and
    (Valor[1] in ['A'..'Z', 'a'..'z']) and
    (Valor[2] = ':') and
    (Valor[3] = '\') and
    (Pos('\\', Valor) = 0) and
    (Pos('..', Valor) = 0) and
    (Pos('/', Valor) = 0) and
    (Pos(#0, Valor) = 0) and
    (Pos(#13, Valor) = 0) and
    (Pos(#10, Valor) = 0) and
    (Pos('\WINDOWS\', Normal) = 0) and
    (Pos('\PROGRAM FILES\', Normal) = 0) and
    (Pos('\PROGRAM FILES (X86)\', Normal) = 0) and
    (Pos('\SYSTEM32\', Normal) = 0) and
    (Pos('\SYSWOW64\', Normal) = 0) and
    (Copy(Normal, Length(Normal) - 7, 8) <> '\WINDOWS') and
    (Copy(Normal, Length(Normal) - 8, 9) <> '\SYSTEM32') and
    (Copy(Normal, Length(Normal) - 8, 9) <> '\SYSWOW64') and
    (Copy(Normal, Length(Normal) - 13, 14) <> '\PROGRAM FILES') and
    (Copy(Normal, Length(Normal) - 19, 20) <> '\PROGRAM FILES (X86)');
end;

function AplicarDiretorioBiblioteca(const Token, PaiExplicito: String): Boolean;
var
  Base, Pai, Biblioteca, Sandbox: String;
begin
  { O ACBr acrescenta PGWeb ao DiretorioTrabalho antes de PW_iInit.
    Producao usa a pasta gravavel em ProgramData. Sandbox permanece
    ao lado do executavel. Um pai explicito, se vier, precisa ser local.
    Esta rotina nao cria, copia nem apaga arquivos. }
  Result := False;
  Base := IncludeTrailingPathDelimiter(ExtractFilePath(ParamStr(0)));
  Sandbox := Base + 'TEF';
  if Token = 'producao' then
  begin
    if PaiExplicito <> '' then
    begin
      if not CaminhoPaiLocal(PaiExplicito) then
        Exit;
      if not DirectoryExists(PaiExplicito) then
        Exit;
      Pai := ExcludeTrailingPathDelimiter(PaiExplicito);
      if Pos(UpperCase(IncludeTrailingPathDelimiter(Sandbox)), UpperCase(IncludeTrailingPathDelimiter(Pai))) = 1 then
        Exit;
    end
    else
      Pai := DiretorioPaiProducao;
    if Pai = '' then
      Exit;
    Biblioteca := IncludeTrailingPathDelimiter(Pai) + 'PGWeb';
    if not DirectoryExists(Biblioteca) then
      Exit;
    TEF.DiretorioTrabalho := Pai;
    DiretorioTrabalhoObservado := IncludeTrailingPathDelimiter(Biblioteca);
  end
  else
  begin
    if PaiExplicito <> '' then
    begin
      if not CaminhoPaiLocal(PaiExplicito) then
        Exit;
      if not DirectoryExists(PaiExplicito) then
        Exit;
      Pai := ExcludeTrailingPathDelimiter(PaiExplicito);
      if Pos(UpperCase(IncludeTrailingPathDelimiter(DiretorioPaiProducao)), UpperCase(IncludeTrailingPathDelimiter(Pai))) = 1 then
        Exit;
      TEF.DiretorioTrabalho := Pai;
      DiretorioTrabalhoObservado := IncludeTrailingPathDelimiter(Pai) + 'PGWeb\';
    end
    else
    begin
      TEF.DiretorioTrabalho := Sandbox;
      DiretorioTrabalhoObservado := Sandbox + '\PGWeb\';
    end;
  end;
  DiretorioObservado := Token;
  Result := True;
end;

function PedidoInformaIdentidade(Dados: TJSONObject): Boolean;
begin
  Result :=
    (TextoDados(Dados, 'pontoCaptura') <> '') or
    (TextoDados(Dados, 'ambiente') <> '') or
    (TextoDados(Dados, 'cnpj') <> '') or
    (TextoDados(Dados, 'servidor') <> '') or
    (TextoDados(Dados, 'estabelecimento') <> '');
end;

function PedidoRepeteIdentidade(Dados: TJSONObject): Boolean;
begin
  Result :=
    IdentidadeNova and
    (TextoDados(Dados, 'pontoCaptura') = IdentidadePonto) and
    (TextoDados(Dados, 'ambiente') = IdentidadeAmbiente) and
    (SomenteDigitosCnpj(TextoDados(Dados, 'cnpj')) = IdentidadeCnpj) and
    (TextoDados(Dados, 'servidor') = IdentidadeServidor) and
    (TextoDados(Dados, 'estabelecimento') = IdentidadeEstabelecimento);
end;

function PedidoConfereIdentidade(Dados: TJSONObject): Boolean;
begin
  if not IdentidadeTravada then
    Exit(False);
  if not IdentidadeNova then
    Exit(not PedidoInformaIdentidade(Dados));
  if not PedidoInformaIdentidade(Dados) then
    Exit(True);
  Result := PedidoRepeteIdentidade(Dados);
end;

procedure AnexarModoInicializacao(Resultado: TJSONObject);
begin
  if IdentidadeNova then
    Resultado.Add('modo', 'novo')
  else
    Resultado.Add('modo', 'existente');
  Resultado.Add('pontoCaptura', IdentidadePonto);
  Resultado.Add('ambiente', IdentidadeAmbiente);
  Resultado.Add('pontoSolicitado', IdentidadePonto);
  Resultado.Add('servidorSolicitado', IdentidadeServidor);
  Resultado.Add('ambienteSolicitado', IdentidadeAmbiente);
  { PW_iSetEnvironment so ocorre quando PWOPER_NULL devolve PWRET_NOTINST.
    Instalacao existente ignora o ponto e o servidor informados nesta chamada. }
  Resultado.Add('bibliotecaInstalada', not ObservacaoPontoAusente);
  Resultado.Add('setEnvironmentExecutado', ObservacaoViuAmbiente);
  Resultado.Add('retornoSetEnvironment', ObservacaoRetornoAmbiente);
  Resultado.Add('codigoAmbiente', ObservacaoCodigoAmbiente);
  Resultado.Add('diretorioBiblioteca', DiretorioObservado);
  Resultado.Add('diretorioTrabalho', DiretorioTrabalhoObservado);
  Resultado.Add('diretorioPwInit', DiretorioPwInitObservado);
  Resultado.Add('retornoPwInit', ObservacaoRetornoInit);
  Resultado.Add('retornoPwInitNome', ObservacaoRetornoInitNome);
end;

procedure LimparParametrosPayGo;
begin
  TEF.DadosEstabelecimento.CNPJ := '';
  TEF.DadosEstabelecimento.RazaoSocial := '';
  TEF.DadosTerminal.CodTerminal := '';
  TEF.DadosTerminal.EnderecoServidor := '';
  TEF.DadosTerminal.Ambiente := ambNaoDefinido;
end;

procedure TEventosTEF.QuandoGravarLog(const ALogLine: String; var Tratado: Boolean);
begin
  ObservarLinhaPayGo(ALogLine);
  if CredencialInformada(CredencialTecnica) and
     (Pos(CredencialTecnica, ALogLine) > 0) then
  begin
    LogErro('[ACBrTEF] ' + SanitizarTextoDiagnostico(ALogLine));
    Tratado := True;
    Exit;
  end;
  Tratado := False;
end;

procedure ResponderInstalacaoSemProva(const AId, Mensagem: String);
var
  Resultado: TJSONObject;
begin
  Resultado := TJSONObject.Create;
  try
    Resultado.Add('sucessoChamada', False);
    Resultado.Add('sucessoTransacao', False);
    Resultado.Add('operacao', 'PWOPER_INSTALL');
    Resultado.Add('codigoOperacao', PWOPER_INSTALL);
    Resultado.Add('observacaoBiblioteca', False);
    Resultado.Add('pontoNaoExistia', False);
    Resultado.Add('instalacaoConcluida', False);
    Resultado.Add('retornoSetEnvironment', -1);
    Resultado.Add('pontoCaptura', '');
    Resultado.Add('ambiente', '');
    Resultado.Add('mensagem', Mensagem);
    Resultado.Add('rede', '');
    Resultado.Add('nsu', '');
    Resultado.Add('finalizacao', '');
    Responder(AId, True, Resultado, '');
  finally
    Resultado.Free;
  end;
end;

procedure InicializarTEF(const AId: String; Dados: TJSONObject);
var
  Resultado: TJSONObject;
begin
  Resultado := nil;

  try
    try
      { Desliga a terceira perna automatica antes de qualquer Inicializar.
        O default do ACBr e True e confirmaria a venda assim que ela fosse aprovada. }
      TEF.ConfirmarTransacaoAutomaticamente := False;

      if TEF.Inicializado then
      begin
        if not DiretorioSolicitadoValido(
          TokenDiretorioSolicitado(Dados),
          TextoDados(Dados, 'ambiente')
        ) or (TokenDiretorioSolicitado(Dados) <> DiretorioObservado) then
        begin
          Responder(AId, False, nil, 'TEF_DIRETORIO_DIVERGENTE');
          Exit;
        end;
        if (TextoDados(Dados, 'diretorioPai') <> '') and
           (UpperCase(ExcludeTrailingPathDelimiter(TextoDados(Dados, 'diretorioPai'))) <>
            UpperCase(ExcludeTrailingPathDelimiter(TEF.DiretorioTrabalho))) then
        begin
          Responder(AId, False, nil, 'TEF_DIRETORIO_DIVERGENTE');
          Exit;
        end;
        if not PedidoConfereIdentidade(Dados) then
        begin
          Responder(AId, False, nil, 'TEF_IDENTIDADE_DIVERGENTE');
          Exit;
        end;

        Resultado := TJSONObject.Create;
        Resultado.Add('inicializado', True);
        Resultado.Add('modelo', 'PayGoWeb');
        Resultado.Add(
          'confirmarTransacaoAutomaticamente',
          TEF.ConfirmarTransacaoAutomaticamente
        );
        Resultado.Add(
          'mensagem',
          'ACBrTEFAPI ja inicializado'
        );
        AnexarModoInicializacao(Resultado);
        AnexarPendenciaNoJson(Resultado);

        Responder(AId, True, Resultado, '');
        Exit;
      end;

      TEF.Modelo := tefApiPayGoWeb;
      TEF.PathDLL := 'C:\Program Files (x86)\PayGo\PGWebLib\x64\PGWebLib.dll';

      ConfigurarEventosTEF;

      TEF.TratamentoTransacaoPendente := tefpenPerguntar;
      TEF.TratamentoTransacaoInicializacao := tefopiProcessarPendentes;
      TEF.QuandoDetectarTransacaoPendente :=
        @EventosTEF.QuandoDetectarTransacaoPendente;

      { A biblioteca copia estes campos dentro de Inicializar.
        PW_iSetEnvironment so roda quando o ambiente foi informado e o ponto
        ainda nao esta instalado. Sem parametros, a inicializacao existente
        permanece em ambNaoDefinido e nao grava ponto, CNPJ, servidor nem ambiente. }
      TEF.DadosAutomacao.NomeSoftwareHouse := 'UltraPDV';
      TEF.DadosAutomacao.NomeAplicacao := 'UltraPDV';
      TEF.DadosAutomacao.VersaoAplicacao := '1.3.13';
      LimparParametrosPayGo;
      if PedidoInformaIdentidade(Dados) then
      begin
        if not (
          PontoAutorizado(TextoDados(Dados, 'pontoCaptura')) and
          AmbienteAutorizado(TextoDados(Dados, 'ambiente')) and
          CnpjAutorizado(TextoDados(Dados, 'cnpj')) and
          ServidorAutorizado(TextoDados(Dados, 'servidor')) and
          EstabelecimentoAutorizado(TextoDados(Dados, 'estabelecimento'))
        ) then
        begin
          Responder(AId, False, nil, 'TEF_PARAMETROS_AUSENTES');
          Exit;
        end;
        TEF.DadosTerminal.CodTerminal := TextoDados(Dados, 'pontoCaptura');
        TEF.DadosEstabelecimento.CNPJ := SomenteDigitosCnpj(TextoDados(Dados, 'cnpj'));
        TEF.DadosEstabelecimento.RazaoSocial := TextoDados(Dados, 'estabelecimento');
        TEF.DadosTerminal.EnderecoServidor := TextoDados(Dados, 'servidor');
        if TextoDados(Dados, 'ambiente') = 'producao' then
          TEF.DadosTerminal.Ambiente := ambProducao
        else
          TEF.DadosTerminal.Ambiente := ambHomologacao;
      end;

      LogErro('[ACBrTEF] Inicializando PayGoWeb');

      if not DiretorioSolicitadoValido(
        TokenDiretorioSolicitado(Dados),
        TextoDados(Dados, 'ambiente')
      ) then
      begin
        Responder(AId, False, nil, 'TEF_DIRETORIO_RECUSADO');
        Exit;
      end;
      if not AplicarDiretorioBiblioteca(
        TokenDiretorioSolicitado(Dados),
        TextoDados(Dados, 'diretorioPai')
      ) then
      begin
        Responder(AId, False, nil, 'TEF_DIRETORIO_AUSENTE');
        Exit;
      end;
      DiretorioPwInitObservado := '';

      LimparObservacaoInstalacao;
      ObservandoInicializacao := True;
      try
        TEF.Inicializar;
      finally
        ObservandoInicializacao := False;
      end;
      if TEF.Inicializado then
      begin
        IdentidadeTravada := True;
        IdentidadeNova := PedidoInformaIdentidade(Dados);
        if IdentidadeNova then
        begin
          IdentidadePonto := TextoDados(Dados, 'pontoCaptura');
          IdentidadeAmbiente := TextoDados(Dados, 'ambiente');
          IdentidadeCnpj := SomenteDigitosCnpj(TextoDados(Dados, 'cnpj'));
          IdentidadeServidor := TextoDados(Dados, 'servidor');
          IdentidadeEstabelecimento := TextoDados(Dados, 'estabelecimento');
        end
        else
        begin
          IdentidadePonto := '';
          IdentidadeAmbiente := '';
          IdentidadeCnpj := '';
          IdentidadeServidor := '';
          IdentidadeEstabelecimento := '';
        end;
      end;
      ObservacaoPonto := IdentidadePonto;
      ObservacaoInstalacaoAtiva :=
        IdentidadeNova and
        ObservacaoPontoAusente and
        ObservacaoViuAmbiente and
        (ObservacaoRetornoAmbiente = 0) and
        (ObservacaoPonto = IdentidadePonto) and
        (NomeAmbienteObservado = IdentidadeAmbiente);

      if not TEF.Inicializado then
        DiretorioObservado := '';

      Resultado := TJSONObject.Create;
      Resultado.Add(
        'inicializado',
        TEF.Inicializado
      );
      Resultado.Add('modelo', 'PayGoWeb');
      Resultado.Add(
        'confirmarTransacaoAutomaticamente',
        TEF.ConfirmarTransacaoAutomaticamente
      );

      if TEF.Inicializado then
        Resultado.Add(
          'mensagem',
          'ACBrTEFAPI inicializado'
        )
      else
        Resultado.Add(
          'mensagem',
          'ACBrTEFAPI nao confirmou inicializacao'
        );

      AnexarModoInicializacao(Resultado);
      AnexarPendenciaNoJson(Resultado);

      Responder(
        AId,
        TEF.Inicializado,
        Resultado,
        ''
      );

    except
      on E: Exception do
      begin
        LogErro(
          '[ACBrTEF] Falha na inicializacao: ' +
          SanitizarTextoDiagnostico(E.Message)
        );

        if Resultado <> nil then
          Resultado.Free;
        Resultado := TJSONObject.Create;
        Resultado.Add('inicializado', False);
        Resultado.Add('diretorioBiblioteca', DiretorioObservado);
        Resultado.Add('diretorioTrabalho', DiretorioTrabalhoObservado);
        Resultado.Add('diretorioPwInit', DiretorioPwInitObservado);
        Resultado.Add('retornoPwInit', ObservacaoRetornoInit);
        Resultado.Add('retornoPwInitNome', ObservacaoRetornoInitNome);
        Responder(
          AId,
          False,
          Resultado,
          'TEF_INICIALIZACAO_FALHOU: ' +
          SanitizarTextoDiagnostico(E.Message)
        );
      end;
    end;

  finally
    Resultado.Free;
  end;
end;

function TextoComprovante(Lista: TStrings): String;
begin
  if (Lista = nil) or (Lista.Count = 0) then
    Result := ''
  else
    Result := Lista.Text;
end;

function SomenteDigitos(const Valor: String): String;
var
  i: Integer;
begin
  Result := '';
  for i := 1 to Length(Valor) do
    if Valor[i] in ['0'..'9'] then
      Result := Result + Valor[i];
end;

{ Repete só o que o ACBr/PayGo devolveu. Não preenche CNPJ nem bandeira. }
procedure AdicionarDadosFiscais(Resultado: TJSONObject; Resp: TACBrTEFResp);
var
  Recebedor: String;
begin
  Resultado.Add('bandeira', Trim(Resp.NFCeSAT.Bandeira));
  Resultado.Add('nomeCartao', Trim(Resp.CodigoBandeiraPadrao));
  Resultado.Add('nomeBandeiraPadrao', Trim(Resp.NomeAdministradora));
  Resultado.Add('cnpjCredenciadora', SomenteDigitos(Resp.NFCeSAT.CNPJCredenciadora));
  Resultado.Add('instituicao', Trim(Resp.Instituicao));
  Recebedor := '';
  if Assigned(Resp.Conteudo) then
    Recebedor := SomenteDigitos(
      Resp.Conteudo.LeInformacao(PWINFO_MERCHCNPJCPF, 0).AsString);
  Resultado.Add('cnpjRecebedor', Recebedor);
end;

{ PWINFO_CARDTYPE: 1 crédito, 2 débito. Ausência fica nula. Não lê o comprovante. }
procedure AnexarTipoCartao(Resultado: TJSONObject; Resp: TACBrTEFResp);
var
  TipoCartao: Integer;
  TextoTipo: String;
begin
  TipoCartao := -1;
  if Assigned(Resp) and Assigned(Resp.Conteudo) then
  begin
    TextoTipo := Trim(Resp.Conteudo.LeInformacao(PWINFO_CARDTYPE, 0).AsString);
    if TextoTipo <> '' then
      TipoCartao := Resp.Conteudo.LeInformacao(PWINFO_CARDTYPE, 0).AsInteger;
  end;
  if TipoCartao >= 0 then
    Resultado.Add('tipoCartao', TipoCartao)
  else
    Resultado.Add('tipoCartao', TJSONNull.Create);
end;

procedure InstalarTEF(const AId: String; Dados: TJSONObject);
var
  Resultado: TJSONObject;
  Sucesso: Boolean;
  Resp: TACBrTEFResp;
  Mensagem: String;
  InstalacaoConcluida: Boolean;
begin
  Resultado := nil;
  Resp := nil;
  InstalacaoConcluida := False;

  if not TEF.Inicializado then
  begin
    Responder(AId, False, nil, 'TEF_NAO_INICIALIZADO');
    Exit;
  end;

  if PagamentoEmAndamento then
  begin
    Responder(AId, False, nil, 'TEF_OCUPADO');
    Exit;
  end;

  { Nao chama a administrativa enquanto houver venda aguardando terceira perna. }
  if TransacaoAguardandoDecisao then
  begin
    Responder(AId, False, nil, 'TEF_TRANSACAO_PENDENTE');
    Exit;
  end;

  if not IdentidadeNova or not IdentidadeTravada then
  begin
    ResponderInstalacaoSemProva(
      AId,
      'Instalacao de ponto novo exige parametros autorizados nesta inicializacao.'
    );
    Exit;
  end;

  if not PedidoRepeteIdentidade(Dados) then
  begin
    ResponderInstalacaoSemProva(
      AId,
      'Os parametros informados divergem da inicializacao deste processo.'
    );
    Exit;
  end;

  if not ObservacaoInstalacaoPronta or
     (ObservacaoPonto <> IdentidadePonto) or
     (NomeAmbienteObservado <> IdentidadeAmbiente) then
  begin
    ResponderInstalacaoSemProva(
      AId,
      'O ponto ja estava instalado ou o ambiente nao foi observado nesta inicializacao.'
    );
    Exit;
  end;

  try
    try
      LogErro('[ACBrTEF] Instalacao PWOPER_INSTALL');
      { OperacaoAdminToPWOPER_ nao mapeia nenhum TACBrTEFOperacao para
        PWOPER_INSTALL. A sobrecarga string repassa o codigo numerico. }
      DefinirCredencialTecnica(TextoDados(Dados, 'credencial'));
      DiagnosticoInstalacao := True;
      try
        Sucesso := TEF.EfetuarAdministrativa(IntToStr(PWOPER_INSTALL));
        if Assigned(TEF.UltimaRespostaTEF) and
           Assigned(TEF.UltimaRespostaTEF.Conteudo) then
          LogDiagnosticoInstalacao(
            'resultado',
            'nenhuma',
            'ausente',
            NomeRetornoPayGo(
              TEF.UltimaRespostaTEF.Conteudo.LeInformacao(PWINFO_RET, 0).AsString),
            '')
        else
          LogDiagnosticoInstalacao(
            'resultado', 'nenhuma', 'ausente', 'ausente', '');
      finally
        DiagnosticoInstalacao := False;
        LimparCredencialTecnica;
      end;

      Resultado := TJSONObject.Create;
      Resultado.Add('sucessoChamada', Sucesso);
      Resultado.Add('operacao', 'PWOPER_INSTALL');
      Resultado.Add('codigoOperacao', PWOPER_INSTALL);

      Resp := TEF.UltimaRespostaTEF;
      if Assigned(Resp) then
      begin
        Resultado.Add('sucessoTransacao', Resp.Sucesso);
        Resultado.Add('rede', Resp.Rede);
        Resultado.Add('nsu', Resp.NSU);
        Resultado.Add('finalizacao', Resp.Finalizacao);
        Mensagem := Trim(Resp.TextoEspecialOperador);
        if Mensagem = '' then
          Mensagem := Trim(Resp.TextoEspecialCliente);
        if Mensagem = '' then
        begin
          if Resp.Sucesso then
            Mensagem := 'Ponto de captura instalado'
          else
            Mensagem := 'Instalacao nao concluida';
        end;
        Resultado.Add('mensagem', Mensagem);
        Resultado.Add('textoOperador', Trim(Resp.TextoEspecialOperador));
        Resultado.Add('textoCliente', Trim(Resp.TextoEspecialCliente));
        InstalacaoConcluida := Resp.Sucesso;
        if Resp.Sucesso then
          ObservacaoConsumida := True;
      end
      else
      begin
        Resultado.Add('sucessoTransacao', False);
        Resultado.Add('rede', '');
        Resultado.Add('nsu', '');
        Resultado.Add('finalizacao', '');
        Resultado.Add('mensagem', 'Instalacao sem resposta');
        Resultado.Add('textoOperador', '');
        Resultado.Add('textoCliente', '');
      end;

      Resultado.Add('observacaoBiblioteca', True);
      Resultado.Add('pontoNaoExistia', True);
      Resultado.Add('retornoSetEnvironment', 0);
      Resultado.Add('instalacaoConcluida', InstalacaoConcluida);
      Resultado.Add('pontoCaptura', IdentidadePonto);
      Resultado.Add('ambiente', IdentidadeAmbiente);
      Resultado.Add('cnpj', IdentidadeCnpj);
      Resultado.Add('servidor', IdentidadeServidor);
      Resultado.Add('estabelecimento', IdentidadeEstabelecimento);

      Responder(AId, True, Resultado, '');
    except
      on E: Exception do
      begin
        LogDiagnosticoInstalacao(
          'excecao',
          'nenhuma',
          'ausente',
          'ausente',
          E.Message);
        Responder(AId, False, nil, E.Message);
      end;
    end;
  finally
    Resultado.Free;
  end;
end;

procedure PagarTEF(const AId: String; Dados: TJSONObject);
var
  Resultado: TJSONObject;
  CampoId: TJSONData;
  CampoValor: TJSONData;
  Identificador: String;
  Valor: Currency;
  Preferencia: String;
  Cartoes: TACBrTEFTiposCartao;
  SucessoChamada: Boolean;
  Resp: TACBrTEFResp;
  Mensagem: String;
begin
  Resultado := nil;

  if not TEF.Inicializado then
  begin
    Responder(AId, False, nil, 'TEF_NAO_INICIALIZADO');
    Exit;
  end;

  if PagamentoEmAndamento then
  begin
    Responder(AId, False, nil, 'TEF_OCUPADO');
    Exit;
  end;

  if TransacaoAguardandoDecisao then
  begin
    Responder(AId, False, nil, 'TEF_TRANSACAO_PENDENTE');
    Exit;
  end;

  if not Assigned(Dados) then
  begin
    Responder(AId, False, nil, 'TEF_DADOS_INVALIDOS');
    Exit;
  end;

  CampoId := Dados.Find('identificador');
  CampoValor := Dados.Find('valor');
  if (CampoId = nil) or (CampoId.JSONType <> jtString) or
     (CampoValor = nil) or (CampoValor.JSONType <> jtNumber) then
  begin
    Responder(AId, False, nil, 'TEF_DADOS_INVALIDOS');
    Exit;
  end;

  Identificador := Trim(CampoId.AsString);
  Valor := CampoValor.AsFloat;
  if (Identificador = '') or (Valor <= 0) then
  begin
    Responder(AId, False, nil, 'TEF_DADOS_INVALIDOS');
    Exit;
  end;

  PagamentoEmAndamento := True;
  IdPagamentoAtivo := AId;
  ContadorMenus := 0;
  try
    try
      LogErro('[ACBrTEF] Pagamento identificador=' + Identificador);
      { A escolha do PDV é preferência. O tipo autorizado sai em PWINFO_CARDTYPE. }
      Preferencia := LowerCase(TextoDados(Dados, 'preferencia'));
      if Preferencia = 'debito' then
        Cartoes := [teftcDebito]
      else if Preferencia = 'credito' then
        Cartoes := [teftcCredito]
      else
        Cartoes := [teftcDebito, teftcCredito];
      DiagnosticoPagamento := True;
      try
        SucessoChamada := TEF.EfetuarPagamento(
          Identificador, Valor, tefmpCartao, Cartoes);
      finally
        DiagnosticoPagamento := False;
      end;

      Resultado := TJSONObject.Create;
      Resultado.Add('sucessoChamada', SucessoChamada);
      Resultado.Add('identificador', Identificador);

      Resp := TEF.UltimaRespostaTEF;
      if Assigned(Resp) and Assigned(Resp.Conteudo) then
      begin
        LogErro('[ACBrTEF][pagamento] PWINFO_RET=' +
          Resp.Conteudo.LeInformacao(PWINFO_RET, 0).AsString);
        LogErro('[ACBrTEF][pagamento] PWINFO_RESULTMSG=' +
          Resp.Conteudo.LeInformacao(PWINFO_RESULTMSG, 0).AsString);
      end;
      if Assigned(Resp) then
      begin
        if Resp.ValorTotal > 0 then
          Resultado.Add('valor', Resp.ValorTotal)
        else
          Resultado.Add('valor', Double(Valor));

        Resultado.Add('sucessoTransacao', Resp.Sucesso);
        Resultado.Add('rede', Resp.Rede);
        Resultado.Add('nsu', Resp.NSU);
        Resultado.Add('codigoAutorizacao', Resp.CodigoAutorizacaoTransacao);
        Resultado.Add('codigoFinalizacao', Resp.Finalizacao);
        Resultado.Add('finalizacao', Resp.Finalizacao);
        Resultado.Add('confirmar', Resp.Confirmar);
        Resultado.Add('precisaConfirmacao', Resp.Confirmar);
        Resultado.Add(
          'transacaoPendenteConfirmacao',
          Resp.Sucesso and Resp.Confirmar
        );
        if Resp.Sucesso and Resp.Confirmar then
          GuardarPendencia(
            Resp.Rede,
            Resp.NSU,
            Resp.Finalizacao,
            Identificador,
            Resp.ValorTotal
          );

        Mensagem := Trim(Resp.TextoEspecialOperador);
        if Mensagem = '' then
          Mensagem := Trim(Resp.TextoEspecialCliente);
        if Mensagem = '' then
        begin
          if Resp.Sucesso then
            Mensagem := 'Transacao aprovada'
          else
            Mensagem := 'Transacao nao aprovada';
        end;
        Resultado.Add('mensagem', Mensagem);
        AdicionarDadosFiscais(Resultado, Resp);
        AnexarTipoCartao(Resultado, Resp);
        Resultado.Add('comprovante1Via', TextoComprovante(Resp.ImagemComprovante1aVia));
        Resultado.Add('comprovante2Via', TextoComprovante(Resp.ImagemComprovante2aVia));
        Resultado.Add('pontoCaptura', IdentidadePonto);
        Resultado.Add('host', IdentidadeServidor);
      end
      else
      begin
        Resultado.Add('valor', Double(Valor));
        Resultado.Add('sucessoTransacao', False);
        Resultado.Add('rede', '');
        Resultado.Add('nsu', '');
        Resultado.Add('codigoAutorizacao', '');
        Resultado.Add('codigoFinalizacao', '');
        Resultado.Add('finalizacao', '');
        Resultado.Add('confirmar', False);
        Resultado.Add('precisaConfirmacao', False);
        Resultado.Add('transacaoPendenteConfirmacao', False);
        Resultado.Add('mensagem', 'Transacao sem resposta');
        AnexarTipoCartao(Resultado, nil);
        Resultado.Add('comprovante1Via', '');
        Resultado.Add('comprovante2Via', '');
        Resultado.Add('pontoCaptura', IdentidadePonto);
        Resultado.Add('host', IdentidadeServidor);
      end;

      { Nao confirma nem desfaz aqui. A terceira perna sai so por acao explicita. }
      Responder(AId, True, Resultado, '');
    except
      on E: Exception do
      begin
        LogErro('[ACBrTEF] Falha no pagamento: ' + E.Message);
        Responder(AId, False, nil, E.Message);
      end;
    end;
  finally
    PagamentoEmAndamento := False;
    IdPagamentoAtivo := '';
    Resultado.Free;
  end;
end;

function LerTextoObrigatorio(
  Dados: TJSONObject;
  const Nome: String;
  out Valor: String): Boolean;
var
  Campo: TJSONData;
begin
  Valor := '';
  Result := False;
  if not Assigned(Dados) then
    Exit;
  Campo := Dados.Find(Nome);
  if (Campo = nil) or (Campo.JSONType <> jtString) then
    Exit;
  Valor := Trim(Campo.AsString);
  Result := Valor <> '';
end;

procedure DecidirTransacao(const AId: String; Dados: TJSONObject; Confirmar: Boolean);
var
  Resultado: TJSONObject;
  Rede: String;
  NSU: String;
  Finalizacao: String;
  Status: TACBrTEFStatusTransacao;
begin
  Resultado := nil;

  if not TEF.Inicializado then
  begin
    Responder(AId, False, nil, 'TEF_NAO_INICIALIZADO');
    Exit;
  end;

  if PagamentoEmAndamento then
  begin
    Responder(AId, False, nil, 'TEF_OCUPADO');
    Exit;
  end;

  if not TransacaoAguardandoDecisao then
  begin
    Responder(AId, False, nil, 'TEF_DADOS_INVALIDOS');
    Exit;
  end;

  if not LerTextoObrigatorio(Dados, 'rede', Rede) or
     not LerTextoObrigatorio(Dados, 'nsu', NSU) or
     not LerTextoObrigatorio(Dados, 'finalizacao', Finalizacao) then
  begin
    Responder(AId, False, nil, 'TEF_DADOS_INVALIDOS');
    Exit;
  end;

  if (Rede <> PendenteRede) or (NSU <> PendenteNSU) or
     (Finalizacao <> PendenteFinalizacao) then
  begin
    Responder(AId, False, nil, 'TEF_DADOS_INVALIDOS');
    Exit;
  end;

  if Confirmar then
    Status := tefstsSucessoManual
  else
    Status := tefstsErroDiverso;

  try
    if Confirmar then
      LogErro('[ACBrTEF] Confirmar transacao nsu=' + NSU)
    else
      LogErro('[ACBrTEF] Desfazer transacao nsu=' + NSU);

    { PayGo: tefstsSucessoManual -> PWCNF_CNF_MANU_AUT
             tefstsErroDiverso   -> PWCNF_REV_MANU_AUT
      CancelarTransacao e outra operacao e nao serve para a terceira perna. }
    TEF.FinalizarTransacao(Rede, NSU, Finalizacao, Status);

    RemoverPendencia(Rede, NSU, Finalizacao);

    Resultado := TJSONObject.Create;
    Resultado.Add('confirmada', Confirmar);
    Resultado.Add('desfeita', not Confirmar);
    Resultado.Add('rede', Rede);
    Resultado.Add('nsu', NSU);
    Resultado.Add('finalizacao', Finalizacao);
    Resultado.Add('transacaoPendenteConfirmacao', TransacaoAguardandoDecisao);
    if Length(Pendencias) = 0 then
      Resultado.Add('proximaPendencia', TJSONNull.Create)
    else
      AnexarProximaPendencia(Resultado);
    if Confirmar then
      Resultado.Add('statusAcbr', 'tefstsSucessoManual')
    else
      Resultado.Add('statusAcbr', 'tefstsErroDiverso');

    Responder(AId, True, Resultado, '');
  except
    on E: Exception do
    begin
      LogErro('[ACBrTEF] Falha na terceira perna: ' + E.Message);
      Responder(AId, False, nil, E.Message);
    end;
  end;

  Resultado.Free;
end;

function JsonBool(Obj: TJSONObject; const Nome: String): Boolean;
var
  Item: TJSONData;
begin
  Item := Obj.Find(Nome);
  Result := Assigned(Item) and (Item.JSONType = jtBoolean) and Item.AsBoolean;
end;

function JsonStr(Obj: TJSONObject; const Nome: String): String;
var
  Item: TJSONData;
begin
  Result := '';
  Item := Obj.Find(Nome);
  if Assigned(Item) and (Item.JSONType = jtString) then
    Result := Item.AsString;
end;

function CampoPp(const Info: String; Inicio, Fim: Integer): String;
var
  i: Integer;
begin
  Result := '';
  if (Inicio < 1) or (Fim < Inicio) or (Length(Info) < Inicio) then
    Exit;
  if Fim > Length(Info) then
    Fim := Length(Info);
  Result := Copy(Info, Inicio, Fim - Inicio + 1);
  for i := Length(Result) downto 1 do
    if Result[i] in [#0, #9, #10, #13] then
      Delete(Result, i, 1);
  Result := Trim(Result);
end;

function MascararSerie(const Serie: String): String;
var
  i: Integer;
begin
  Result := '';
  if Serie = '' then
    Exit;
  if Length(Serie) <= 4 then
  begin
    for i := 1 to Length(Serie) do
      Result := Result + '*';
    Exit;
  end;
  for i := 1 to Length(Serie) - 4 do
    Result := Result + '*';
  Result := Result + Copy(Serie, Length(Serie) - 3, 4);
end;

function ModeloConhecidoNaBiblioteca(const Modelo: String): Boolean;
var
  Normal, Token: String;
  i: Integer;
const
  Tokens: array[0..7] of String = (
    'PPC900', 'PPC910', 'PPC920', 'IPP320', 'IPP350',
    'VX820', 'V240', 'LANE3000'
  );
begin
  Normal := UpperCase(Trim(Modelo));
  Result := False;
  if Normal = '' then
    Exit;
  for i := Low(Tokens) to High(Tokens) do
  begin
    Token := Tokens[i];
    if Pos(Token, Normal) > 0 then
      Exit(True);
  end;
end;

function TextoSeguroBiblioteca(const Texto: String): String;
var
  i, Digitos: Integer;
  C: Char;
begin
  Result := '';
  Digitos := 0;
  for i := 1 to Length(Texto) do
  begin
    C := Texto[i];
    if C in ['0'..'9'] then
      Inc(Digitos)
    else
      Digitos := 0;
    if Digitos > 12 then
    begin
      Result := '';
      Exit;
    end;
    if C in [#32..#126] then
      Result := Result + C;
    if Length(Result) >= 160 then
      Break;
  end;
  Result := Trim(Result);
end;

function ApiPayGo: TACBrTEFPGWebAPI;
begin
  Result := nil;
  if (TEF = nil) or (TEF.TEF = nil) then
    Exit;
  if not (TEF.TEF is TACBrTEFAPIClassPayGoWeb) then
    Exit;
  Result := TACBrTEFAPIClassPayGoWeb(TEF.TEF).TEFPayGoAPI;
end;

function PinpadOcupado: Boolean;
begin
  Result := PagamentoEmAndamento or TransacaoAguardandoDecisao;
end;

procedure PreencherPpinfo(Resultado: TJSONObject; const Info: String);
var
  Fabricante, Modelo, Firmware, Aplicacao, Especificacao, Serie: String;
  SemContato: Boolean;
begin
  Fabricante := CampoPp(Info, 1, 20);
  Modelo := CampoPp(Info, 21, 39);
  SemContato := Copy(Info + ' ', 40, 1) = 'C';
  Firmware := CampoPp(Info, 41, 60);
  Especificacao := CampoPp(Info, 61, 64);
  Aplicacao := CampoPp(Info, 65, 80);
  Serie := CampoPp(Info, 81, 100);
  Resultado.Add('ppinfoDisponivel',
    (Fabricante <> '') or (Modelo <> '') or (Firmware <> '') or (Serie <> ''));
  Resultado.Add('fabricante', Fabricante);
  Resultado.Add('modelo', Modelo);
  Resultado.Add('firmware', Firmware);
  Resultado.Add('aplicacao', Aplicacao);
  Resultado.Add('especificacao', Especificacao);
  Resultado.Add('semContato', SemContato and (Length(Info) >= 40));
  Resultado.Add('serieMascarada', MascararSerie(Serie));
  if Modelo = '' then
    Resultado.Add('limitacaoModelo', 'sem_modelo')
  else if ModeloConhecidoNaBiblioteca(Modelo) then
    Resultado.Add('limitacaoModelo', 'conhecido_sem_homologacao')
  else
    Resultado.Add('limitacaoModelo', 'nao_reconhecido');
end;

procedure PreencherPpinfoAusente(Resultado: TJSONObject; const Motivo: String);
begin
  Resultado.Add('ppinfoDisponivel', False);
  Resultado.Add('fabricante', '');
  Resultado.Add('modelo', '');
  Resultado.Add('firmware', '');
  Resultado.Add('aplicacao', '');
  Resultado.Add('especificacao', '');
  Resultado.Add('semContato', False);
  Resultado.Add('serieMascarada', '');
  Resultado.Add('limitacaoModelo', 'indisponivel');
  Resultado.Add('ppinfoMotivo', Motivo);
end;

procedure LerPpinfo(Resultado: TJSONObject);
var
  PG: TACBrTEFPGWebAPI;
  Info: String;
begin
  PG := ApiPayGo;
  if PG = nil then
  begin
    PreencherPpinfoAusente(Resultado, 'api_indisponivel');
    Exit;
  end;
  try
    Info := PG.ObterInfo(PWINFO_PPINFO);
  except
    on E: Exception do
    begin
      LogErro('[ACBrTEF] PWINFO_PPINFO indisponivel');
      PreencherPpinfoAusente(Resultado, 'sem_transacao');
      Exit;
    end;
  end;
  if (Info = '') or (Info = #0) or (Trim(Info) = '') then
    PreencherPpinfoAusente(Resultado, 'sem_dado')
  else
    PreencherPpinfo(Resultado, Info);
end;

{ Contrato documentado no ACBr (VerificarPresencaPinPad):
  PW_iPPCommTest e repetida somente enquanto devolve PWRET_NOTHING
  (-2493, continuar o processamento). A porta 0 e a busca automatica
  de PWINFO_PPCOMMPORT. Valor de 1 a 255 e a porta ja configurada
  em PortaPinPad; a COM vista pelo Windows nao e forcada.
  O limite encerra a repeticao. Uma chamada que nao retorna nao e
  abortada e o processo nao e encerrado. }
function ChamarTesteComunicacao(PortaSolicitada: Integer;
  var PortaUtilizada: Integer; var Codigo: SmallInt; var Aviso: String;
  var DuracaoMs: Int64; var Chamou: Boolean): Boolean;
const
  LIMITE_REPETICOES_PPCOMM = 8;
  LIMITE_MS_PPCOMM = 15000;
var
  Modulo: HMODULE;
  Funcao: function(pszMsg: PAnsiChar; uiMsgSize: Word;
    var pbCommPort: Byte): SmallInt; stdcall;
  Buffer: array[0..511] of AnsiChar;
  Porta: Byte;
  Inicio: QWord;
  Tentativas: Integer;
begin
  Result := False;
  PortaUtilizada := -1;
  Codigo := 0;
  Aviso := '';
  DuracaoMs := 0;
  Chamou := False;
  if (PortaSolicitada < 0) or (PortaSolicitada > 255) then
  begin
    Aviso := 'porta da biblioteca fora do intervalo da API';
    Exit;
  end;
  Modulo := GetModuleHandle('PGWebLib.dll');
  if Modulo = 0 then
    Modulo := GetModuleHandle(
      'C:\Program Files (x86)\PayGo\PGWebLib\x64\PGWebLib.dll');
  if Modulo = 0 then
  begin
    Aviso := 'PGWebLib nao carregada';
    Exit;
  end;
  Pointer(Funcao) := GetProcAddress(Modulo, 'PW_iPPCommTest');
  if not Assigned(Funcao) then
  begin
    Aviso := 'PW_iPPCommTest indisponivel';
    Exit;
  end;
  Porta := Byte(PortaSolicitada);
  Inicio := GetTickCount64;
  Tentativas := 0;
  repeat
    FillChar(Buffer, SizeOf(Buffer), 0);
    Codigo := Funcao(@Buffer[0], SizeOf(Buffer), Porta);
    Aviso := TextoSeguroBiblioteca(String(Buffer));
    Chamou := True;
    Inc(Tentativas);
  until (Codigo <> PWRET_NOTHING) or
        (Tentativas >= LIMITE_REPETICOES_PPCOMM) or
        (GetTickCount64 - Inicio >= LIMITE_MS_PPCOMM);
  DuracaoMs := Int64(GetTickCount64 - Inicio);
  if Codigo = PWRET_OK then
  begin
    PortaUtilizada := Porta;
    Result := True;
  end;
end;

function DescreverPorta(Porta: Integer): String;
begin
  if Porta = 0 then
    Result := 'busca automatica'
  else if Porta > 0 then
    Result := 'porta ' + IntToStr(Porta)
  else
    Result := '';
end;

procedure ResponderPinpadIndisponivel(const AId, Codigo, Mensagem: String);
var
  Resultado: TJSONObject;
begin
  Resultado := TJSONObject.Create;
  try
    Resultado.Add('codigo', Codigo);
    Resultado.Add('mensagem', Mensagem);
    Resultado.Add('paygoInicializado', TEF.Inicializado);
    Resultado.Add('reinicializou', False);
    Resultado.Add('comunicacao', 'indisponivel');
    Responder(AId, False, Resultado, Mensagem);
  finally
    Resultado.Free;
  end;
end;

procedure DiagnosticarPinpad(const AId: String; TestarComunicacao: Boolean);
var
  Resultado: TJSONObject;
  PG: TACBrTEFPGWebAPI;
  PortaConfigurada, PortaUtilizada: Integer;
  CodigoTeste: SmallInt;
  Aviso, Comunicacao, Mensagem: String;
  Comunicou, Chamou: Boolean;
  DuracaoMs: Int64;
begin
  if PinpadOcupado then
  begin
    ResponderPinpadIndisponivel(
      AId,
      'PINPAD_OCUPADO',
      'Terminal ocupado com operacao financeira.'
    );
    Exit;
  end;

  if not TEF.Inicializado then
  begin
    ResponderPinpadIndisponivel(
      AId,
      'PINPAD_PAYGO_NAO_INICIALIZADO',
      'Comunicacao indisponivel. O PayGoWeb nao sera reiniciado por este diagnostico.'
    );
    Exit;
  end;

  PG := ApiPayGo;
  if PG = nil then
  begin
    ResponderPinpadIndisponivel(
      AId,
      'PINPAD_COMUNICACAO_INDISPONIVEL',
      'Comunicacao indisponivel.'
    );
    Exit;
  end;

  Resultado := TJSONObject.Create;
  try
    PortaConfigurada := PG.PortaPinPad;
    Resultado.Add('paygoInicializado', True);
    Resultado.Add('reinicializou', False);
    Resultado.Add('portaConfigurada', PortaConfigurada);
    Resultado.Add('portaConfiguradaDescricao', DescreverPorta(PortaConfigurada));
    LerPpinfo(Resultado);

    if not TestarComunicacao then
    begin
      Resultado.Add('comunicacao', 'nao_executada');
      Resultado.Add('codigoBiblioteca', TJSONNull.Create);
      Resultado.Add('portaUtilizada', TJSONNull.Create);
      if JsonBool(Resultado, 'ppinfoDisponivel') then
        Resultado.Add(
          'mensagem',
          'Dados do pinpad lidos. A comunicacao ainda nao foi testada.'
        )
      else
        Resultado.Add(
          'mensagem',
          'A biblioteca nao disponibilizou PWINFO_PPINFO. O diagnostico nao inicia transacao.'
        );
      Resultado.Add('codigo', 'PINPAD_IDENTIFICACAO');
      Responder(AId, True, Resultado, '');
      Exit;
    end;

    if (PortaConfigurada < 0) or (PortaConfigurada > 255) then
    begin
      Resultado.Add('codigoBiblioteca', TJSONNull.Create);
      Resultado.Add('portaUtilizada', TJSONNull.Create);
      Resultado.Add('comunicacao', 'sem_porta');
      Resultado.Add('mensagem',
        'A biblioteca nao tem porta de pinpad utilizavel pela API. A porta do Windows nao foi forcada.');
      Resultado.Add('codigo', 'PINPAD_TESTE');
      Responder(AId, True, Resultado, '');
      Exit;
    end;

    Comunicou := ChamarTesteComunicacao(
      PortaConfigurada, PortaUtilizada, CodigoTeste, Aviso, DuracaoMs, Chamou);
    Resultado.Add('duracaoMs', DuracaoMs);
    if Chamou then
      Resultado.Add('codigoBiblioteca', CodigoTeste)
    else
      Resultado.Add('codigoBiblioteca', TJSONNull.Create);
    if Aviso <> '' then
      Resultado.Add('avisoBiblioteca', Aviso);
    if Comunicou then
      Resultado.Add('portaUtilizada', PortaUtilizada)
    else
      Resultado.Add('portaUtilizada', TJSONNull.Create);

    LerPpinfo(Resultado);

    Comunicacao := 'indisponivel';
    Mensagem := 'Comunicacao indisponivel.';
    if Comunicou then
    begin
      Comunicacao := 'confirmada';
      Mensagem := 'Pinpad conectado e comunicacao confirmada.';
      if JsonStr(Resultado, 'limitacaoModelo') = 'nao_reconhecido' then
        Resultado.Add(
          'observacaoModelo',
          'Modelo nao reconhecido pela lista interna da biblioteca. Isso nao e homologacao.'
        );
    end
    else if CodigoTeste = PWRET_PPS_INVMODEL then
    begin
      Comunicacao := 'modelo_nao_reconhecido';
      Mensagem := 'Modelo nao reconhecido.';
    end
    else if (CodigoTeste = PWRET_PPS_NOAPPSLIC) or
            (CodigoTeste = PWRET_PPS_ERRPIN) then
    begin
      Comunicacao := 'aplicacao_indisponivel';
      Mensagem := 'Aplicacao ou chaves necessarias nao disponiveis.';
    end
    else if (CodigoTeste = PWRET_PPS_COMMERR) or
            (CodigoTeste = PWRET_PPS_PORTERR) or
            (CodigoTeste = PWRET_PPS_NOTOPEN) or
            (CodigoTeste = PWRET_PPNOTFOUND) then
    begin
      Comunicacao := 'nao_encontrado';
      Mensagem := 'Pinpad nao encontrado.';
    end
    else if CodigoTeste = PWRET_PPCOMERR then
    begin
      Comunicacao := 'indisponivel';
      Mensagem := 'Comunicacao indisponivel.';
    end
    else if CodigoTeste = PWRET_PPS_COMMTOUT then
    begin
      Comunicacao := 'timeout_biblioteca';
      Mensagem := 'A biblioteca informou tempo esgotado aguardando o pinpad.';
    end
    else if CodigoTeste = PWRET_NOTHING then
    begin
      Comunicacao := 'nao_concluido';
      Mensagem := 'A biblioteca devolveu PWRET_NOTHING e pediu para continuar. O teste nao foi concluido.';
    end
    else if Chamou then
    begin
      Comunicacao := 'codigo_biblioteca';
      Mensagem := 'A biblioteca devolveu um codigo nao classificado.';
    end;

    Resultado.Add('comunicacao', Comunicacao);
    Resultado.Add('mensagem', Mensagem);
    Resultado.Add('codigo', 'PINPAD_TESTE');
    Responder(AId, True, Resultado, '');
  finally
    Resultado.Free;
  end;
end;

procedure ProcessarLinha(const Linha: String);
var
  Json: TJSONData;
  Obj: TJSONObject;
  Id: String;
  Acao: String;
  Resultado: TJSONObject;
begin
  if Trim(Linha) = '' then
    Exit;

  Json := nil;

  try
    try
      Json := GetJSON(Linha);

      if Json.JSONType <> jtObject then
      begin
        Responder(
          '',
          False,
          nil,
          'JSON_INVALIDO'
        );
        Exit;
      end;

      Obj := TJSONObject(Json);

      Id := Obj.Get('id', '');
      Acao := Obj.Get('acao', '');

      if Acao = 'teste' then
      begin
        Resultado := TJSONObject.Create;
        try
          Resultado.Add(
            'mensagem',
            'UltraPDVTef ativo'
          );
          Resultado.Add('versao', 1);
          Resultado.Add(
            'acbrInicializado',
            TEF.Inicializado
          );

          Responder(
            Id,
            True,
            Resultado,
            ''
          );
        finally
          Resultado.Free;
        end;

        Exit;
      end;

      if Acao = 'inicializar' then
      begin
        if (Obj.Find('dados') <> nil) and
           (Obj.Find('dados').JSONType = jtObject) then
          InicializarTEF(Id, TJSONObject(Obj.Find('dados')))
        else
          InicializarTEF(Id, nil);
        Exit;
      end;

      if Acao = 'pinpad-diagnostico' then
      begin
        DiagnosticarPinpad(Id, False);
        Exit;
      end;

      if Acao = 'pinpad-testar-comunicacao' then
      begin
        DiagnosticarPinpad(Id, True);
        Exit;
      end;

      if Acao = 'instalar' then
      begin
        if (Obj.Find('dados') <> nil) and
           (Obj.Find('dados').JSONType = jtObject) then
          InstalarTEF(Id, TJSONObject(Obj.Find('dados')))
        else
          InstalarTEF(Id, nil);
        Exit;
      end;

      if Acao = 'pagamento' then
      begin
        if (Obj.Find('dados') <> nil) and
           (Obj.Find('dados').JSONType = jtObject) then
          PagarTEF(Id, TJSONObject(Obj.Find('dados')))
        else
          PagarTEF(Id, nil);
        Exit;
      end;

      if (Acao = 'confirmar') or (Acao = 'desfazer') then
      begin
        if (Obj.Find('dados') <> nil) and
           (Obj.Find('dados').JSONType = jtObject) then
          DecidirTransacao(
            Id,
            TJSONObject(Obj.Find('dados')),
            Acao = 'confirmar'
          )
        else
          DecidirTransacao(Id, nil, Acao = 'confirmar');
        Exit;
      end;

      Responder(
        Id,
        False,
        nil,
        'ACAO_NAO_SUPORTADA'
      );

    except
      on E: Exception do
      begin
        LogErro(
          '[UltraPDVTef] JSON invalido: ' +
          E.Message
        );

        Responder(
          '',
          False,
          nil,
          'JSON_INVALIDO'
        );
      end;
    end;

  finally
    Json.Free;
  end;
end;

var
  Linha: String;

begin
  TEF := nil;
  EventosTEF := nil;
  PagamentoEmAndamento := False;
  TransacaoAguardandoDecisao := False;
  PendenciaIncompleta := False;
  PendenteRede := '';
  PendenteNSU := '';
  PendenteFinalizacao := '';
  SetLength(Pendencias, 0);

  try
    EventosTEF := TEventosTEF.Create;
    TEF := TACBrTEFAPI.Create(nil);

    while not EOF(Input) do
    begin
      ReadLn(Linha);
      ProcessarLinha(Linha);
    end;

  finally
    TEF.Free;
    EventosTEF.Free;
  end;
end.
