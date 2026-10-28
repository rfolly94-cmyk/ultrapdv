using System.Text;
using System.Text.Json;
using UltraPDV.TEF.Interop;
using UltraPDV.TEF.Nucleo;
using UltraPDV.TEF.Persistencia;
using UltraPDV.TEF.Transacoes;

Console.InputEncoding = Encoding.UTF8;
Console.OutputEncoding = Encoding.UTF8;

var json = new JsonSerializerOptions
{
    PropertyNameCaseInsensitive = true,
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
};
var comando = JsonSerializer.Deserialize<ComandoHost>(Console.ReadLine() ?? "", json) ?? new ComandoHost("status", null, null, null, null, null, null, null);
var resposta = Executar(comando, json);
Console.Out.WriteLine(JsonSerializer.Serialize(resposta, json));
Console.Out.Flush();

static RespostaHost Executar(ComandoHost comando, JsonSerializerOptions json)
{
    if (comando.Comando == "status")
    {
        return new RespostaHost("resultado", false, false, false, "MOTOR_CSHARP_PRONTO", "O motor C# está pronto. Nenhuma cobrança foi iniciada.", false, false, null, null, false, null);
    }

    if (PoliticaComandoProducao.Bloqueado(comando.Comando, comando.Ambiente, comando.AutorizaPinPadProducao, comando.Diretorio, comando.AutorizaVendaProducao))
    {
        return new RespostaHost("resultado", false, false, false, "PRODUCAO_NAO_AUTORIZADA", "Produção não está autorizada. Nenhuma cobrança foi iniciada.", false, false, null, null, false, null);
    }

    if (comando.Comando == "situacao")
    {
        if (comando.EmpresaId is null || comando.TerminalId is null)
        {
            return new RespostaHost("resultado", false, false, false, "EMPRESA_AUSENTE", "A empresa e o terminal precisam ser resolvidos pelo UltraPDV.", false, false, null, null, false, null);
        }

        var contextoSituacao = new ContextoEmpresa("connector", comando.EmpresaId.Value, comando.TerminalId.Value, "", CodigosPgWeb.AmbienteTeste, "", "homologacao", comando.Diretorio ?? "");
        var motorSituacao = new MotorPayGo(new RepositorioJournal(comando.RaizJournals ?? @"C:\ProgramData\UltraPDV\tef-empresas"), new CoordenadorSessao());
        var consulta = motorSituacao.Consultar(contextoSituacao, comando.Chave, comando.ValorCentavos);
        var retomada = motorSituacao.PendenciaParaRetomada(contextoSituacao);
        var chaveSituacao = string.IsNullOrWhiteSpace(comando.Chave) ? retomada.Chave : comando.Chave;
        return new RespostaHost("resultado", false, false, false, consulta.Codigo, consulta.Mensagem, false, false, null, null, false, chaveSituacao)
        {
            ReferenciaInstalacao = motorSituacao.ReferenciaInstalacao(contextoSituacao),
            VendaId = consulta.VendaId?.ToString("D"),
            Fiscal = string.IsNullOrWhiteSpace(chaveSituacao) ? null : motorSituacao.DadosFiscais(contextoSituacao, chaveSituacao),
        };
    }

    if (comando.Comando == "vincular")
    {
        if (comando.EmpresaId is null || comando.TerminalId is null || comando.VendaId is null || string.IsNullOrWhiteSpace(comando.Chave))
        {
            return new RespostaHost("resultado", false, false, false, "EMPRESA_AUSENTE", "A empresa, o terminal e a venda precisam ser resolvidos pelo UltraPDV.", false, false, null, null, false, null);
        }

        var motorVinculo = new MotorPayGo(new RepositorioJournal(comando.RaizJournals ?? @"C:\ProgramData\UltraPDV\tef-empresas"), new CoordenadorSessao());
        var vinculo = motorVinculo.VincularVenda(comando.EmpresaId.Value, comando.TerminalId.Value, comando.Chave, comando.VendaId.Value, comando.ValorCentavos ?? 0);
        return new RespostaHost("resultado", false, false, false, vinculo.Situacao, vinculo.Mensagem, false, false, null, null, false, comando.Chave);
    }

    if (comando.Comando == "pinpad")
    {
        if (comando.EmpresaId is null || comando.TerminalId is null)
        {
            return new RespostaHost("resultado", false, false, false, "EMPRESA_AUSENTE", "A empresa e o terminal precisam ser resolvidos pelo UltraPDV.", false, false, null, null, false, null);
        }
        var diretorioPin = comando.Diretorio;
        if (string.IsNullOrWhiteSpace(diretorioPin))
        {
            var raizPin = comando.RaizJournals ?? @"C:\ProgramData\UltraPDV\tef-empresas";
            diretorioPin = Path.Combine(raizPin, comando.EmpresaId.Value.ToString("N"), comando.TerminalId.Value.ToString("N"), "Data");
        }
        var bibliotecaPin = new BibliotecaNativaPgWeb();
        var codigoPin = bibliotecaPin.TestarPinPad(diretorioPin, out _);
        var textoPin = codigoPin == CodigosPgWeb.Ok
            ? $"O PinPad respondeu ao teste de comunicação. Retorno nativo {codigoPin}. Nenhuma cobrança foi iniciada."
            : $"O PinPad não foi aprovado. Retorno nativo {codigoPin}. Nenhuma cobrança foi iniciada.";
        return new RespostaHost("resultado", false, false, true, codigoPin == CodigosPgWeb.Ok ? "pinpad_ok" : "pinpad_falha", textoPin, false, false, null, null, false, null)
        {
            CodigoNativo = codigoPin,
        };
    }

    if (comando.EmpresaId is null || comando.TerminalId is null || string.IsNullOrWhiteSpace(comando.Diretorio))
    {
        return new RespostaHost("resultado", false, false, false, "EMPRESA_AUSENTE", "A empresa e o terminal precisam ser resolvidos pelo UltraPDV.", false, false, null, null, false, null);
    }

    var producao = comando.Ambiente == CodigosPgWeb.AmbienteProducao;
    var vendaProducao = producao && comando.AutorizaVendaProducao && comando.Comando is "vender" or "confirmar" or "cancelar";
    if (producao && comando.Comando is not ("instalar" or "configurar") && !vendaProducao)
    {
        return new RespostaHost("resultado", false, false, false, "PRODUCAO_NAO_AUTORIZADA", "Produção não está autorizada. Nenhuma cobrança foi iniciada.", false, false, null, null, false, null);
    }

    if (comando.Comando is "instalar" or "configurar")
    {
        if (!EncaminhamentoOperacao.Tentar(comando.Comando, comando.OperacaoNativa, out var operacaoNativa))
        {
            return new RespostaHost("resultado", false, false, false, "operacao_divergente", "O comando não corresponde à operação nativa. Nenhuma transação foi iniciada.", false, false, null, null, false, null);
        }

        if ((comando.Comando == "configurar" && operacaoNativa != OperacaoPgWeb.Configuracao) || (comando.Comando == "instalar" && operacaoNativa != OperacaoPgWeb.Instalacao))
        {
            return new RespostaHost("resultado", false, false, false, "operacao_divergente", "O comando não corresponde à operação nativa. Nenhuma transação foi iniciada.", false, false, null, null, false, null);
        }

        if (!EncaminhamentoOperacao.ChaveCompativel(comando.Comando, comando.Chave, producao))
        {
            return new RespostaHost("resultado", false, false, false, "chave_de_outra_operacao", "A chave não pertence a esta operação. Nenhuma transação foi iniciada.", false, false, null, null, false, null);
        }

        if (!string.IsNullOrWhiteSpace(comando.RaizJournalsAlheia) && !string.IsNullOrWhiteSpace(comando.Chave))
        {
            var alheio = new RepositorioJournal(comando.RaizJournalsAlheia).Buscar(comando.EmpresaId.Value, comando.TerminalId.Value, comando.Chave);
            if (alheio is not null)
            {
                return new RespostaHost("resultado", false, false, false, "chave_de_outra_operacao", "Esta chave já está em outro journal. Nenhuma transação foi iniciada.", false, false, null, null, false, null);
            }
        }

        if (comando.Ambiente == CodigosPgWeb.AmbienteProducao && comando.Comando == "instalar" && !comando.ServidorComercialValidado)
        {
            return new RespostaHost("resultado", false, false, false, "servidor_nao_validado", "O servidor comercial de produção ainda não foi confirmado pela biblioteca. A instalação não foi iniciada.", false, false, null, null, false, null);
        }
    }

    var contexto = new ContextoEmpresa(
        "connector",
        comando.EmpresaId.Value,
        comando.TerminalId.Value,
        comando.Cnpj ?? "",
        producao ? CodigosPgWeb.AmbienteProducao : CodigosPgWeb.AmbienteTeste,
        "",
        producao ? "producao" : "homologacao",
        comando.Diretorio);
    var motor = new MotorPayGo(new RepositorioJournal(comando.RaizJournals ?? Path.GetDirectoryName(comando.Diretorio)!), new CoordenadorSessao());
    var biblioteca = new BibliotecaNativaPgWeb();
    if (vendaProducao)
    {
        biblioteca.AutorizarVendaProducao(BibliotecaNativaPgWeb.FraseVendaProducao);
    }
    else if (producao)
    {
        biblioteca.AutorizarInstalacaoProducao(BibliotecaNativaPgWeb.FraseInstalacaoProducao);
    }
    else
    {
        biblioteca.AutorizarHomologacao(BibliotecaNativaPgWeb.FraseHomologacao);
    }

    var pedido = new PedidoVenda(contexto, comando.VendaId, comando.Chave ?? Guid.NewGuid().ToString("N"), comando.ValorCentavos ?? 0, comando.Modalidade ?? "", comando.Parcelas ?? 1, comando.PinPadId ?? "pinpad-local", comando.Comando == "configurar" ? comando.EnderecoComercial : null);
    var captura = new CapturaLinha(json);
    var resultado = comando.Comando switch
    {
        "vender" => motor.Vender(pedido, biblioteca, captura),
        "instalar" => motor.Instalar(pedido, biblioteca, captura),
        "configurar" => motor.Configurar(pedido, biblioteca, captura),
        "cancelar" => motor.Cancelar(pedido, biblioteca, captura),
        "confirmar" => motor.Confirmar(new PedidoConfirmacao(contexto, pedido.ChaveIdempotencia, ConfirmacaoPgWeb.Automatica), biblioteca),
        "recuperar" => Recuperar(motor, contexto),
        _ => new ResultadoMotor(false, false, false, CodigosPgWeb.InvParam, "comando_desconhecido", null, null, "Comando não reconhecido."),
    };
    var recebido = biblioteca.EhNativa && resultado.PagamentoRecebido;
    var confirmada = biblioteca.EhNativa && resultado.ConfirmacaoChamada && resultado.PagamentoRecebido;
    var comprovantes = confirmada ? motor.Comprovantes(contexto, pedido.ChaveIdempotencia) : null;
    return new RespostaHost("resultado", recebido, resultado.ConfirmacaoChamada, biblioteca.EhNativa, resultado.Situacao, resultado.Mensagem, false, confirmada, null, null, false, pedido.ChaveIdempotencia)
    {
        ServidorValidado = resultado.ServidorValidado,
        CodigoNativo = resultado.Codigo,
        Comprovantes = comprovantes,
    };
}

static ResultadoMotor Recuperar(MotorPayGo motor, ContextoEmpresa contexto)
{
    var pendencias = motor.Recuperar(contexto);
    return new ResultadoMotor(false, false, false, CodigosPgWeb.Ok, pendencias.Count == 0 ? "sem_pendencia" : "pendencia_preservada", null, null, pendencias.Count + " pendência(s) preservada(s). Nenhuma foi confirmada ou cancelada.");
}

internal sealed record ComandoHost(string Comando, Guid? EmpresaId, Guid? TerminalId, Guid? VendaId, string? Diretorio, string? RaizJournals, string? Cnpj, string? Ponto)
{
    public short? Ambiente { get; init; }
    public string? Modalidade { get; init; }
    public int? ValorCentavos { get; init; }
    public int? Parcelas { get; init; }
    public string? Chave { get; init; }
    public string? PinPadId { get; init; }
    public bool AutorizaPinPadProducao { get; init; }
    public bool AutorizaVendaProducao { get; init; }
    public bool ServidorComercialValidado { get; init; }
    public string? EnderecoComercial { get; init; }
    public string? OperacaoNativa { get; init; }
    public string? RaizJournalsAlheia { get; init; }
}

internal sealed record RespostaHost(
    string Tipo,
    bool PagamentoRecebido,
    bool ConfirmacaoChamada,
    bool Nativo,
    string Codigo,
    string? Erro,
    bool Simulado,
    bool Confirmada,
    string? Prompt,
    ushort? Identificador,
    bool Oculto,
    string? Chave)
{
    public bool ServidorValidado { get; init; }
    public short? CodigoNativo { get; init; }
    public string? ReferenciaInstalacao { get; init; }
    public string? VendaId { get; init; }
    public DadosFiscaisVenda? Fiscal { get; init; }
    public ComprovantesTef? Comprovantes { get; init; }
}

file sealed class CapturaLinha : ICapturaOperador
{
    private readonly JsonSerializerOptions _json;
    private readonly object _trava = new();
    private readonly Queue<string> _linhas = new();
    private string? _aviso;
    private string? _qrCode;
    private bool _leitorIniciado;

    public CapturaLinha(JsonSerializerOptions json) => _json = json;

    public void DefinirAviso(string? aviso) => _aviso = aviso;

    public void ReceberQrCode(string payload)
    {
        var texto = payload.Replace("\0", "", StringComparison.Ordinal).Trim();
        _qrCode = texto.Length is > 0 and <= 4096 ? texto : null;
    }

    public bool ConsumirCancelamento()
    {
        GarantirLeitor();
        lock (_trava)
        {
            if (_linhas.Count == 0 || !LinhaCancela(_linhas.Peek()))
            {
                return false;
            }

            _linhas.Dequeue();
            return true;
        }
    }

    public bool TentarResponder(PwGetData pedido, out string valor)
    {
        var evento = new EventoCaptura(
            "captura",
            CapturaEndereco.Montar(
                TextoCaptura.Prompt(ref pedido),
                TextoCaptura.Mascara(ref pedido),
                TextoCaptura.Previa(ref pedido),
                TextoCaptura.Validacao(ref pedido),
                pedido.Identificador,
                _aviso),
            pedido.Identificador,
            pedido.TipoDeDado,
            pedido.OcultarDadosDigitados == 1 || pedido.TipoDeDado == TipoDadoPgWeb.AutenticacaoUsuario,
            TextoCaptura.OpcoesValidas(ref pedido).Select(opcao => new OpcaoHost(opcao.Texto, opcao.Valor)).ToArray(),
            _qrCode);
        _qrCode = null;
        Console.Out.WriteLine(JsonSerializer.Serialize(evento, _json));
        Console.Out.Flush();
        var linha = EsperarLinha();
        if (string.IsNullOrWhiteSpace(linha))
        {
            valor = "";
            return pedido.AceitaNulo == 1;
        }

        var resposta = JsonSerializer.Deserialize<RespostaOperador>(linha, _json);
        if (resposta?.Cancelar == true)
        {
            valor = "";
            return false;
        }

        valor = resposta?.Valor ?? "";
        return valor.Length > 0 || pedido.AceitaNulo == 1;
    }

    private void GarantirLeitor()
    {
        lock (_trava)
        {
            if (_leitorIniciado)
            {
                return;
            }

            _leitorIniciado = true;
        }

        var leitor = new Thread(LerEntrada)
        {
            IsBackground = true,
            Name = "captura-tef",
        };
        leitor.Start();
    }

    private void LerEntrada()
    {
        while (true)
        {
            var linha = Console.ReadLine();
            if (linha is null)
            {
                return;
            }

            lock (_trava)
            {
                _linhas.Enqueue(linha);
                Monitor.PulseAll(_trava);
            }
        }
    }

    private string EsperarLinha()
    {
        GarantirLeitor();
        lock (_trava)
        {
            while (_linhas.Count == 0)
            {
                Monitor.Wait(_trava);
            }

            return _linhas.Dequeue();
        }
    }

    private bool LinhaCancela(string linha)
    {
        if (string.IsNullOrWhiteSpace(linha))
        {
            return false;
        }

        try
        {
            return JsonSerializer.Deserialize<RespostaOperador>(linha, _json)?.Cancelar == true;
        }
        catch (JsonException)
        {
            return false;
        }
    }
}

file sealed record EventoCaptura(string Tipo, string? Prompt, ushort Identificador, byte TipoDado, bool Oculto, OpcaoHost[] Opcoes, string? QrCode);

file sealed record OpcaoHost(string Texto, string Valor);

file sealed class RespostaOperador
{
    public string? Valor { get; init; }
    public bool Cancelar { get; init; }
}
