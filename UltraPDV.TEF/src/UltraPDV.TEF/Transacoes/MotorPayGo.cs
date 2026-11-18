using System.Text;
using UltraPDV.TEF.Interop;
using UltraPDV.TEF.Nucleo;
using UltraPDV.TEF.Persistencia;

namespace UltraPDV.TEF.Transacoes;

public sealed record PedidoVenda(
    ContextoEmpresa Contexto,
    Guid? VendaId,
    string ChaveIdempotencia,
    int ValorCentavos,
    string Modalidade,
    int Parcelas,
    string PinPadId,
    string? EnderecoComercial = null);

public sealed record PedidoConfirmacao(
    ContextoEmpresa Contexto,
    string ChaveIdempotencia,
    uint Status);

public sealed record ResultadoMotor(
    bool Concluida,
    bool PagamentoRecebido,
    bool ConfirmacaoChamada,
    short Codigo,
    string Situacao,
    string? Identificador,
    ushort? CapturaPendente,
    string? Mensagem,
    bool ServidorValidado = false);

public sealed record DadosFiscaisVenda(
    string? Autorizacao,
    string? BandeiraNome,
    string? Rede,
    string? Instituicao,
    string? CnpjCredenciadora,
    string? CnpjRecebedor);

public sealed record ComprovantesTef(
    string ViaEstabelecimento,
    string ViaCliente,
    string Rede,
    string Quando);

public interface ICapturaOperador
{
    bool TentarResponder(PwGetData pedido, out string valor);

    void DefinirAviso(string? aviso) { }

    void ReceberQrCode(string payload) { }

    bool ConsumirCancelamento() => false;

    void DefinirSugestao(ushort identificador, string valor) { }

    void DefinirVendas(IReadOnlyList<VendaParaCaptura> vendas) { }
}

public sealed class EsperaBiblioteca
{
    public static readonly EsperaBiblioteca Padrao = new();

    public TimeSpan Limite { get; init; } = TimeSpan.FromMinutes(4);

    public Func<DateTimeOffset>? Agora { get; init; }

    public Action? Pausa { get; init; }
}

public sealed class MotorPayGo
{
    public const short CodigoEsperaLocal = 1;

    private const string PrefixoCancelamento = "cancelamento:";
    private readonly RepositorioJournal _journals;
    private readonly CoordenadorSessao _sessoes;
    private bool _destinoTcpIpInformado;
    private bool _producao;
    private int _abortPinPad;
    private string _destinoTcpIpEnviado = "";
    private string _enderecoEsperado = "";
    private byte _operacao;
    private bool _manutencaoSelecionada;
    private string _pontoCadastrado = "";
    private string _servidorCadastrado = "";
    private string _recusaMenu = "";
    private IReadOnlyList<OperacaoDisponivel> _operacoesDisponiveis = Array.Empty<OperacaoDisponivel>();

    public MotorPayGo(RepositorioJournal journals, CoordenadorSessao sessoes)
    {
        _journals = journals;
        _sessoes = sessoes;
    }

    public EsperaBiblioteca Espera { get; set; } = EsperaBiblioteca.Padrao;

    public ResultadoMotor Vender(PedidoVenda pedido, IBibliotecaPgWeb biblioteca, ICapturaOperador? captura)
    {
        if (InstalacaoRevogada(pedido.Contexto.EmpresaId, pedido.Contexto.TerminalId))
        {
            return Recusa(CodigosPgWeb.NotInst, "ponto_nao_instalado", null, "O ponto de captura não está instalado. Nenhuma cobrança foi iniciada.");
        }

        return ExecutarOperacao(pedido, OperacaoPgWeb.Venda, biblioteca, captura, incluirValor: true);
    }

    public ResultadoMotor VincularVenda(Guid empresaId, Guid terminalId, string chave, Guid vendaId, int valorCentavos)
    {
        var journal = _journals.Buscar(empresaId, terminalId, chave);
        if (journal is null || journal.EmpresaId != empresaId || journal.TerminalId != terminalId)
        {
            return Recusa(CodigosPgWeb.NoData, "journal_ausente", null, "Não há journal desta empresa e deste terminal para vincular. Nenhuma cobrança foi iniciada.");
        }

        if (journal.Operacao != "venda" || journal.Status != "confirmada" || !journal.PagamentoRecebido || !journal.ConfirmacaoChamada || journal.ValorCentavos != valorCentavos)
        {
            return Recusa(CodigosPgWeb.InvCall, "journal_nao_comprovado", journal.Identificador, "A venda não foi vinculada porque o journal não comprova este pagamento.");
        }

        if (journal.VendaId is Guid existente && existente != vendaId)
        {
            return Recusa(CodigosPgWeb.InvCall, "journal_de_outra_venda", journal.Identificador, "Este pagamento já está vinculado a outra venda.");
        }

        if (journal.VendaId == vendaId)
        {
            return new ResultadoMotor(true, true, true, CodigosPgWeb.Ok, "vinculada", journal.Identificador, null, "O pagamento já estava vinculado a esta venda.");
        }

        _journals.Atualizar(journal with { VendaId = vendaId, AtualizadoEm = DateTimeOffset.UtcNow });
        return new ResultadoMotor(true, true, true, CodigosPgWeb.Ok, "vinculada", journal.Identificador, null, "O pagamento confirmado foi vinculado à venda. Nenhuma nova cobrança foi iniciada.");
    }

    public ResultadoMotor Instalar(PedidoVenda pedido, IBibliotecaPgWeb biblioteca, ICapturaOperador? captura)
    {
        if (pedido.ChaveIdempotencia.StartsWith("cfg:", StringComparison.Ordinal))
        {
            return Recusa(CodigosPgWeb.InvParam, "chave_de_configuracao", null, "A chave de configuração não pode iniciar a instalação. Nenhuma transação foi iniciada.");
        }

        return ExecutarOperacao(pedido, OperacaoPgWeb.Instalacao, biblioteca, captura, incluirValor: false);
    }

    public ResultadoMotor Configurar(PedidoVenda pedido, IBibliotecaPgWeb biblioteca, ICapturaOperador? captura)
    {
        if (pedido.ChaveIdempotencia.StartsWith("ins:", StringComparison.Ordinal))
        {
            return Recusa(CodigosPgWeb.InvParam, "chave_de_instalacao", null, "A chave de instalação não pode iniciar a configuração. Nenhuma transação foi iniciada.");
        }

        return ExecutarOperacao(pedido, OperacaoPgWeb.Configuracao, biblioteca, captura, incluirValor: false);
    }

    public ResultadoMotor Administrar(PedidoVenda pedido, IBibliotecaPgWeb biblioteca, ICapturaOperador? captura)
    {
        if (!pedido.ChaveIdempotencia.StartsWith("adm:", StringComparison.Ordinal))
        {
            return Recusa(CodigosPgWeb.InvParam, "chave_de_administracao", null, "A chave não pertence ao menu administrativo. Nenhuma transação foi iniciada.");
        }

        if (pedido.ValorCentavos != 0)
        {
            return Recusa(CodigosPgWeb.InvParam, "valor_invalido", null, "O menu administrativo não aceita valor. Nenhuma cobrança foi iniciada.");
        }

        if (!PontoInstalado(pedido.Contexto.EmpresaId, pedido.Contexto.TerminalId))
        {
            return Recusa(CodigosPgWeb.NotInst, "ponto_nao_instalado", null, "O ponto deste terminal não está instalado. O menu administrativo não foi iniciado.");
        }

        if (captura is not null)
        {
            var vendas = VendasConfirmadas(pedido);
            captura.DefinirVendas(vendas.Select(SugestaoVendaOriginal.Resumo).ToArray());
            if (vendas.Count == 1)
            {
                foreach (var sugestao in SugestaoVendaOriginal.Montar(vendas[0]))
                {
                    captura.DefinirSugestao(sugestao.Key, sugestao.Value);
                }
            }
        }

        return ExecutarOperacao(pedido, OperacaoPgWeb.Administracao, biblioteca, captura, incluirValor: false);
    }

    private IReadOnlyList<JournalOperacao> VendasConfirmadas(PedidoVenda pedido)
    {
        return _journals.Listar(pedido.Contexto.EmpresaId, pedido.Contexto.TerminalId)
            .Where(journal => journal.EmpresaId == pedido.Contexto.EmpresaId
                && journal.TerminalId == pedido.Contexto.TerminalId
                && journal.Operacao == "venda"
                && journal.Status == "confirmada"
                && journal.PagamentoRecebido
                && journal.ValorCentavos > 0)
            .OrderByDescending(journal => journal.AtualizadoEm)
            .Take(20)
            .ToArray();
    }

    public ResultadoMotor Cancelar(PedidoVenda pedido, IBibliotecaPgWeb biblioteca, ICapturaOperador? captura)
    {
        if (pedido.ChaveIdempotencia.StartsWith(PrefixoCancelamento, StringComparison.Ordinal))
        {
            return Recusa(CodigosPgWeb.InvParam, "chave_de_cancelamento", null, "A chave de cancelamento não inicia outro cancelamento. Nenhuma transação foi iniciada.");
        }

        var original = _journals.Buscar(pedido.Contexto.EmpresaId, pedido.Contexto.TerminalId, pedido.ChaveIdempotencia);
        if (original is null || original.EmpresaId != pedido.Contexto.EmpresaId || original.TerminalId != pedido.Contexto.TerminalId)
        {
            return Recusa(CodigosPgWeb.NoData, "cancelamento_sem_venda", null, "Não há venda confirmada desta chave neste ambiente. Nenhum cancelamento foi iniciado.");
        }

        if (original.Status is "aguardando_confirmacao" or "resultado_desconhecido" or "executando")
        {
            return Recusa(CodigosPgWeb.FromHostPendTrn, "cancelamento_pendente", original.Identificador, "Esta transação ainda precisa de confirmação ou tem resultado desconhecido. Nenhum cancelamento foi iniciado.");
        }

        if (original.Operacao != "venda" || original.Status != "confirmada" || !original.PagamentoRecebido || original.ValorCentavos != pedido.ValorCentavos)
        {
            return Recusa(CodigosPgWeb.NoData, "cancelamento_sem_venda", original.Identificador, "Não há venda confirmada desta chave neste ambiente. Nenhum cancelamento foi iniciado.");
        }

        if (captura is not null)
        {
            foreach (var sugestao in SugestaoVendaOriginal.Montar(original))
            {
                captura.DefinirSugestao(sugestao.Key, sugestao.Value);
            }
        }

        var resultado = ExecutarOperacao(
            pedido with { ChaveIdempotencia = PrefixoCancelamento + pedido.ChaveIdempotencia, ValorCentavos = original.ValorCentavos },
            OperacaoPgWeb.CancelamentoVenda,
            biblioteca,
            captura,
            incluirValor: true);
        if (resultado.Situacao == "aprovada_sem_confirmacao")
        {
            MarcarOriginalCancelada(original);
        }

        return resultado;
    }

    public ResultadoMotor Confirmar(PedidoConfirmacao pedido, IBibliotecaPgWeb biblioteca)
    {
        if (biblioteca.EhNativa && !biblioteca.OperacaoFinanceiraAutorizada)
        {
            return Recusa(CodigosPgWeb.InvCall, "autorizacao_ausente", null, "A confirmação financeira não foi autorizada.");
        }

        var journal = _journals.Buscar(pedido.Contexto.EmpresaId, pedido.Contexto.TerminalId, pedido.ChaveIdempotencia);
        if (journal is null || journal.Status != "aguardando_confirmacao")
        {
            return Recusa(CodigosPgWeb.NoData, "confirmacao_sem_pendencia", journal?.Identificador, "Não há confirmação pendente desta empresa e deste terminal.");
        }

        if (biblioteca.EhNativa)
        {
            var inicio = biblioteca.Inicializar(pedido.Contexto.DiretorioDados);
            if (inicio != CodigosPgWeb.Ok)
            {
                return Recusa(inicio, "inicializacao_recusada", journal.Identificador, "A biblioteca não iniciou. A confirmação não foi enviada.");
            }

            var ambiente = AplicarAmbienteSePendente(journal.EmpresaId, journal.TerminalId, biblioteca, pedido.Contexto.Ambiente);
            if (ambiente != CodigosPgWeb.Ok)
            {
                return Recusa(ambiente, "ambiente_recusado", journal.Identificador, "O ambiente de homologação não foi aceito. A confirmação não foi enviada.");
            }
        }

        var codigo = biblioteca.Confirmar(
            pedido.Status,
            journal.NumeroRequisicao ?? "",
            journal.ReferenciaLocal ?? "",
            journal.ReferenciaExterna ?? "",
            journal.EstabelecimentoVirtual ?? "",
            journal.SistemaAutorizador ?? "");
        var recebido = biblioteca.EhNativa && codigo == CodigosPgWeb.Ok;
        if (recebido && pedido.ChaveIdempotencia.StartsWith(PrefixoCancelamento, StringComparison.Ordinal))
        {
            var chaveOriginal = pedido.ChaveIdempotencia[PrefixoCancelamento.Length..];
            var vendaOriginal = _journals.Buscar(pedido.Contexto.EmpresaId, pedido.Contexto.TerminalId, chaveOriginal);
            if (vendaOriginal is not null && vendaOriginal.Status == "confirmada")
            {
                MarcarOriginalCancelada(vendaOriginal);
            }
        }

        _journals.Atualizar(journal with
        {
            Status = codigo == CodigosPgWeb.Ok ? "confirmada" : "aguardando_confirmacao",
            ConfirmacaoChamada = true,
            PagamentoRecebido = recebido,
            AtualizadoEm = DateTimeOffset.UtcNow,
        });
        return new ResultadoMotor(codigo == CodigosPgWeb.Ok, recebido, true, codigo, codigo == CodigosPgWeb.Ok ? "confirmada" : "confirmacao_recusada", journal.Identificador, null, null);
    }

    public IReadOnlyList<JournalOperacao> Recuperar(ContextoEmpresa contexto)
    {
        return _journals.Pendencias(contexto.EmpresaId, contexto.TerminalId);
    }

    public ResultadoMotor EncerrarPendenciasAdministrativas(ContextoEmpresa contexto)
    {
        var pendencias = _journals.Pendencias(contexto.EmpresaId, contexto.TerminalId);
        if (pendencias.Count == 0)
        {
            return Recusa(CodigosPgWeb.Ok, "sem_pendencia_administrativa", null, "Não há pendência administrativa para encerrar. Nenhuma cobrança foi iniciada.");
        }

        if (pendencias.Any(journal => !PendenciaAdministrativaSemCobranca(journal)))
        {
            return Recusa(
                CodigosPgWeb.FromHostPendTrn,
                "pendencia_financeira_preservada",
                null,
                "Há pendência financeira neste terminal. Ela se resolve confirmando ou desfazendo a transação na biblioteca. Nenhuma pendência foi encerrada.");
        }

        foreach (var journal in pendencias)
        {
            _journals.Atualizar(journal with
            {
                Status = "recusada",
                PagamentoRecebido = false,
                ConfirmacaoChamada = false,
                AtualizadoEm = DateTimeOffset.UtcNow,
            });
        }

        _sessoes.Encerrar(contexto.EmpresaId);
        return new ResultadoMotor(
            false,
            false,
            false,
            CodigosPgWeb.Ok,
            "pendencia_administrativa_encerrada",
            null,
            null,
            "A pendência administrativa foi encerrada. Não havia pagamento nem confirmação exigida pelo Pay&Go. O terminal pode cobrar de novo.");
    }

    private static bool PendenciaAdministrativaSemCobranca(JournalOperacao journal)
    {
        return journal.Operacao == "administracao"
            && journal.Status == "resultado_desconhecido"
            && journal.ValorCentavos == 0
            && !journal.PagamentoRecebido
            && !journal.ConfirmacaoChamada
            && string.IsNullOrEmpty(journal.NumeroRequisicao)
            && string.IsNullOrEmpty(journal.ReferenciaLocal)
            && string.IsNullOrEmpty(journal.ReferenciaExterna)
            && string.IsNullOrEmpty(journal.AutorizacaoFiscal)
            && journal.ConfirmacaoExigida is null or "" or "0";
    }

    public DadosFiscaisVenda? DadosFiscais(ContextoEmpresa contexto, string? chave)
    {
        if (string.IsNullOrWhiteSpace(chave))
        {
            return null;
        }

        var venda = _journals.Listar(contexto.EmpresaId, contexto.TerminalId)
            .FirstOrDefault(journal => journal.ChaveIdempotencia == chave && journal.Operacao == "venda");
        if (venda is null)
        {
            return null;
        }

        var rede = string.IsNullOrWhiteSpace(venda.SistemaAutorizador) ? null : venda.SistemaAutorizador.Trim();
        if (venda.AutorizacaoFiscal is null && venda.BandeiraNome is null && venda.InstituicaoPagamento is null && venda.CnpjCredenciadora is null && venda.CnpjRecebedor is null && rede is null)
        {
            return null;
        }

        return new DadosFiscaisVenda(venda.AutorizacaoFiscal, venda.BandeiraNome, rede, venda.InstituicaoPagamento, venda.CnpjCredenciadora, venda.CnpjRecebedor);
    }

    public ComprovantesTef? Comprovantes(ContextoEmpresa contexto, string? chave)
    {
        if (string.IsNullOrWhiteSpace(chave))
        {
            return null;
        }

        var venda = _journals.Buscar(contexto.EmpresaId, contexto.TerminalId, chave);
        if (venda is null || venda.EmpresaId != contexto.EmpresaId || venda.TerminalId != contexto.TerminalId)
        {
            return null;
        }

        if (venda.Operacao == "instalacao" || venda.Status != "confirmada" || !venda.PagamentoRecebido || !venda.ConfirmacaoChamada)
        {
            return null;
        }

        if (string.IsNullOrWhiteSpace(venda.ViaEstabelecimento) || string.IsNullOrWhiteSpace(venda.ViaCliente))
        {
            return null;
        }

        var rede = string.IsNullOrWhiteSpace(venda.SistemaAutorizador) ? "" : venda.SistemaAutorizador.Trim();
        if (rede.Length == 0)
        {
            return null;
        }

        return new ComprovantesTef(venda.ViaEstabelecimento, venda.ViaCliente, rede, venda.AtualizadoEm.ToString("o"));
    }

    public string? ComprovanteInstalacao(ContextoEmpresa contexto, string? chave)
    {
        if (string.IsNullOrWhiteSpace(chave))
        {
            return null;
        }

        var journal = _journals.Buscar(contexto.EmpresaId, contexto.TerminalId, chave);
        if (journal is null || journal.EmpresaId != contexto.EmpresaId || journal.TerminalId != contexto.TerminalId)
        {
            return null;
        }

        if (journal.Operacao != "instalacao" || journal.Status != "instalada" || journal.PagamentoRecebido)
        {
            return null;
        }

        var vias = new[] { journal.ViaEstabelecimento, journal.ViaCliente }
            .Where(via => !string.IsNullOrWhiteSpace(via))
            .Select(via => via!.Trim())
            .Distinct(StringComparer.Ordinal);
        var texto = string.Join("\n", vias);
        return texto.Length == 0 ? null : texto;
    }

    public (string Codigo, string Mensagem, Guid? VendaId) Consultar(ContextoEmpresa contexto, string? chave, int? valorCentavos)
    {
        EncerrarInstalacoesAbandonadas(contexto.EmpresaId, contexto.TerminalId);
        ConciliarPontoAusente(contexto);
        var journals = _journals.Listar(contexto.EmpresaId, contexto.TerminalId);
        var instalado = journals.Any(journal => journal.Status == "instalada");
        var semVenda = journals.Count(journal => journal.Operacao == "venda" && journal.Status == "confirmada" && journal.PagamentoRecebido && journal.VendaId is null);
        var pendenteDesconhecido = journals.Any(journal => journal.Operacao == "venda" && journal.Status == "resultado_desconhecido");
        var pendenteExecutando = journals.Any(journal => journal.Operacao == "venda" && journal.Status == "executando");
        var pendenteAguardando = journals.Any(journal => journal.Operacao == "venda" && journal.Status == "aguardando_confirmacao");
        var aviso = pendenteDesconhecido
            ? "Há resultado desconhecido. Há confirmação financeira pendente. Nenhuma nova cobrança foi iniciada."
            : pendenteExecutando
            ? "Há uma operação financeira em execução. Há confirmação financeira pendente. Nenhuma nova cobrança foi iniciada."
            : pendenteAguardando
            ? "Há autorização aguardando confirmação. Há confirmação financeira pendente. Nenhuma nova cobrança foi iniciada."
            : semVenda > 0
            ? $"Há {semVenda} pagamento(s) TEF confirmado(s) sem venda no PDV. Nenhum foi cancelado nem cobrado de novo."
            : instalado
                ? contexto.Ambiente == CodigosPgWeb.AmbienteProducao
                    ? "Ponto de produção instalado."
                    : "Ponto de homologação instalado."
                : journals.Any(journal => journal.Operacao == "instalacao" && journal.Status == "desinstalada")
                    ? "O ponto de captura não está instalado. A manutenção removeu a instalação. Uma nova instalação é necessária."
                    : "Ponto não instalado.";
        if (!string.IsNullOrWhiteSpace(chave))
        {
            var venda = journals.FirstOrDefault(journal => journal.ChaveIdempotencia == chave);
            if (venda is null)
            {
                return (instalado ? "ponto_instalado" : "ponto_nao_instalado", aviso, null);
            }

            if (venda.Status == "confirmada" && venda.PagamentoRecebido && venda.ConfirmacaoChamada && venda.ValorCentavos == valorCentavos)
            {
                if (venda.VendaId is not null)
                {
                    return ("venda_vinculada", "Este pagamento confirmado já está vinculado a uma venda. Ele não pode ser usado em outra venda.", venda.VendaId);
                }

                return ("venda_confirmada", aviso, null);
            }

            if (venda.Status is "aguardando_confirmacao" or "resultado_desconhecido" or "executando")
            {
                return ("venda_pendente", "A operação TEF ainda não está confirmada. A venda não foi registrada.", null);
            }

            return ("venda_nao_confirmada", "A operação TEF não está confirmada. A venda não foi registrada.", null);
        }

        return (instalado ? "ponto_instalado" : "ponto_nao_instalado", aviso, null);
    }

    public (string Pendencia, string? Chave) PendenciaParaRetomada(ContextoEmpresa contexto)
    {
        var vendas = _journals.Listar(contexto.EmpresaId, contexto.TerminalId)
            .Where(journal => journal.Operacao == "venda")
            .ToList();
        if (vendas.Any(journal => journal.Status == "resultado_desconhecido"))
        {
            return ("resultado_desconhecido", null);
        }

        if (vendas.Any(journal => journal.Status == "executando"))
        {
            return ("executando", null);
        }

        var aguardando = vendas.Where(journal => journal.Status == "aguardando_confirmacao").ToList();
        if (aguardando.Count == 1)
        {
            return ("aguardando_confirmacao", aguardando[0].ChaveIdempotencia);
        }

        if (aguardando.Count > 1)
        {
            return ("aguardando_confirmacao", null);
        }

        return ("", null);
    }

    public string? ReferenciaInstalacao(ContextoEmpresa contexto)
    {
        return _journals.Listar(contexto.EmpresaId, contexto.TerminalId)
            .Where(journal => journal.Status == "instalada")
            .OrderByDescending(journal => journal.AtualizadoEm)
            .Select(journal => journal.Identificador)
            .FirstOrDefault();
    }

    private ResultadoMotor ExecutarOperacao(PedidoVenda pedido, byte operacao, IBibliotecaPgWeb biblioteca, ICapturaOperador? captura, bool incluirValor)
    {
        if (incluirValor && pedido.ValorCentavos <= 0)
        {
            return Recusa(CodigosPgWeb.InvParam, "valor_invalido", null, "O valor precisa ser positivo.");
        }

        if ((pedido.Modalidade == InformacaoPgWeb.Debito || pedido.Modalidade == InformacaoPgWeb.Pix) && pedido.Parcelas != 1)
        {
            return Recusa(CodigosPgWeb.InvParam, "parcelamento_recusado", null, pedido.Modalidade == InformacaoPgWeb.Pix
                ? "PIX não aceita parcelamento. Nenhuma cobrança foi iniciada."
                : "Débito não aceita parcelamento.");
        }

        if (biblioteca.EhNativa && !biblioteca.OperacaoFinanceiraAutorizada)
        {
            var instalacao = operacao is OperacaoPgWeb.Instalacao or OperacaoPgWeb.Configuracao && biblioteca.InstalacaoProducaoAutorizada;
            var administracao = operacao == OperacaoPgWeb.Administracao && biblioteca.AdministracaoProducaoAutorizada;
            if (!instalacao && !administracao)
            {
                return Recusa(CodigosPgWeb.InvCall, "autorizacao_ausente", null, "A operação financeira não foi autorizada.");
            }
        }

        _destinoTcpIpInformado = false;
        _destinoTcpIpEnviado = "";
        _recusaMenu = "";
        _operacoesDisponiveis = Array.Empty<OperacaoDisponivel>();
        _operacao = operacao;
        _producao = pedido.Contexto.Ambiente == CodigosPgWeb.AmbienteProducao;
        _manutencaoSelecionada = false;
        _pontoCadastrado = "";
        _servidorCadastrado = "";
        if (!_producao && operacao == OperacaoPgWeb.Instalacao)
        {
            _pontoCadastrado = DadosInstalacaoHomologacao.Ponto(pedido.Contexto.PontoCaptura);
            _servidorCadastrado = DadosInstalacaoHomologacao.Servidor(pedido.Contexto.Servidor);
        }
        _enderecoEsperado = pedido.EnderecoComercial?.Trim() ?? "";
        EncerrarInstalacoesAbandonadas(pedido.Contexto.EmpresaId, pedido.Contexto.TerminalId);
        var pendencias = _journals.Pendencias(pedido.Contexto.EmpresaId, pedido.Contexto.TerminalId);
        if (pendencias.Count > 0)
        {
            if (operacao != OperacaoPgWeb.Instalacao && pendencias.All(PendenciaAdministrativaSemCobranca))
            {
                return Recusa(
                    CodigosPgWeb.FromHostPendTrn,
                    "pendencia_administrativa",
                    null,
                    "Há uma operação administrativa sem cobrança neste terminal. O Pay&Go não pediu confirmação e nenhum pagamento foi recebido. Encerre essa pendência para cobrar de novo. Nenhuma nova cobrança foi iniciada.");
            }

            var texto = operacao == OperacaoPgWeb.Instalacao
                ? "Há pendência financeira deste terminal. A instalação não foi iniciada."
                : "Há pendência desta empresa neste terminal. Nenhuma nova cobrança foi iniciada.";
            return Recusa(CodigosPgWeb.FromHostPendTrn, "pendencia_anterior", null, texto);
        }

        _sessoes.Iniciar(pedido.Contexto, pedido.PinPadId);
        var novo = new JournalOperacao(
            pedido.Contexto.EmpresaId,
            pedido.Contexto.TerminalId,
            pedido.VendaId,
            Guid.NewGuid().ToString("N"),
            pedido.ChaveIdempotencia,
            "registrada",
            pedido.ValorCentavos,
            false,
            false,
            DateTimeOffset.UtcNow,
            Operacao: NomeOperacao(operacao));
        var gravado = _journals.Gravar(novo);
        if (gravado.Identificador != novo.Identificador)
        {
            if (!string.Equals(gravado.Operacao, novo.Operacao, StringComparison.Ordinal))
            {
                return Recusa(CodigosPgWeb.InvParam, "chave_de_outra_operacao", gravado.Identificador, "Esta chave já pertence a outra operação. Nenhuma transação foi iniciada.");
            }

            return new ResultadoMotor(false, false, false, CodigosPgWeb.Ok, "duplicada", gravado.Identificador, null, "A mesma chave já possui journal. A cobrança não foi repetida.");
        }

        var emCurso = gravado with { Status = "executando", AtualizadoEm = DateTimeOffset.UtcNow };
        _journals.Atualizar(emCurso);

        var inicio = biblioteca.Inicializar(pedido.Contexto.DiretorioDados);
        if (inicio != CodigosPgWeb.Ok)
        {
            return Falha(emCurso, biblioteca, inicio, "inicializacao_recusada", pedido);
        }

        var marcaLog = operacao == OperacaoPgWeb.Instalacao
            ? MarcaLogAmbiente.Criar(pedido.Contexto.DiretorioDados)
            : MarcaLogAmbiente.Vazia;
        var ambiente = AplicarAmbienteSePendente(pedido.Contexto.EmpresaId, pedido.Contexto.TerminalId, biblioteca, pedido.Contexto.Ambiente, operacao == OperacaoPgWeb.Instalacao);
        if (ambiente != CodigosPgWeb.Ok)
        {
            if (operacao == OperacaoPgWeb.Instalacao)
            {
                var evidencia = MarcaLogAmbiente.Ler(pedido.Contexto.DiretorioDados, marcaLog);
                if (evidencia.RecusaAlteracao && evidencia.AmbienteGravado == pedido.Contexto.Ambiente)
                {
                    return ReconhecerPontoExistente(emCurso, pedido, evidencia.AmbienteGravado.Value);
                }

                if (evidencia.RecusaAlteracao && evidencia.AmbienteGravado is short ambienteGravado)
                {
                    return RecusarAmbienteDivergente(emCurso, pedido, ambienteGravado);
                }
            }

            return Falha(emCurso, biblioteca, ambiente, "ambiente_recusado", pedido);
        }

        if (operacao == OperacaoPgWeb.Administracao)
        {
            var listagem = biblioteca.ListarOperacoes(CatalogoAdministrativo.TipoLista);
            if (listagem.Codigo != CodigosPgWeb.Ok)
            {
                return Falha(emCurso, biblioteca, listagem.Codigo, "operacao_indisponivel", pedido);
            }

            _operacoesDisponiveis = listagem.Operacoes;
        }

        var transacao = biblioteca.NovaTransacao(operacao);
        if (transacao != CodigosPgWeb.Ok)
        {
            return Falha(emCurso, biblioteca, transacao, "transacao_recusada", pedido);
        }

        foreach (var (identificador, valorParametro) in ParametrosIniciais(operacao))
        {
            var parametro = Adicionar(biblioteca, identificador, valorParametro);
            if (parametro != CodigosPgWeb.Ok)
            {
                return Falha(emCurso, biblioteca, parametro, "parametro_recusado", pedido);
            }
        }

        if (incluirValor)
        {
            var valor = Adicionar(biblioteca, InformacaoPgWeb.ValorTotal, pedido.ValorCentavos.ToString(System.Globalization.CultureInfo.InvariantCulture));
            if (valor != CodigosPgWeb.Ok)
            {
                return Falha(emCurso, biblioteca, valor, "parametro_recusado", pedido);
            }
        }

        if (pedido.Modalidade is InformacaoPgWeb.Credito or InformacaoPgWeb.Debito)
        {
            var tipo = Adicionar(biblioteca, InformacaoPgWeb.TipoCartao, pedido.Modalidade);
            if (tipo != CodigosPgWeb.Ok)
            {
                return Falha(emCurso, biblioteca, tipo, "parametro_recusado", pedido);
            }
        }

        if (pedido.Modalidade == InformacaoPgWeb.Credito && pedido.Parcelas > 1)
        {
            var parcelas = Adicionar(biblioteca, InformacaoPgWeb.Parcelas, pedido.Parcelas.ToString(System.Globalization.CultureInfo.InvariantCulture));
            if (parcelas != CodigosPgWeb.Ok)
            {
                return Falha(emCurso, biblioteca, parcelas, "parametro_recusado", pedido);
            }
        }

        var operadorCancelou = false;
        var repetiuCancelamento = false;
        DateTimeOffset? inicioEspera = null;
        while (true)
        {
            var capturas = new PwGetData[9];
            short quantidade = 9;
            var execucao = biblioteca.Executar(capturas, ref quantidade);
            if (execucao == CodigosPgWeb.Display)
            {
                captura?.DefinirAviso(LerTexto(biblioteca, InformacaoPgWeb.MensagemResultado));
                if (!ContinuarEspera(biblioteca, captura, ref operadorCancelou, ref inicioEspera))
                {
                    return EncerrarEsperaLocal(emCurso, pedido);
                }

                continue;
            }

            if (execucao == CodigosPgWeb.Nothing)
            {
                if (!ContinuarEspera(biblioteca, captura, ref operadorCancelou, ref inicioEspera))
                {
                    return EncerrarEsperaLocal(emCurso, pedido);
                }

                continue;
            }

            inicioEspera = null;

            if (execucao == CodigosPgWeb.MoreData)
            {
                if (operadorCancelou)
                {
                    if (repetiuCancelamento)
                    {
                        return RegistrarInterrupcao(emCurso, biblioteca, pedido, LerTexto(biblioteca, InformacaoPgWeb.MensagemResultado));
                    }

                    repetiuCancelamento = true;
                    AbortarPinPadUmaVez(biblioteca);
                    continue;
                }

                if (quantidade < 1)
                {
                    return Falha(emCurso, biblioteca, execucao, "captura_recusada", pedido);
                }

                var total = Math.Min(quantidade, (short)capturas.Length);
                for (short indice = 0; indice < total; indice++)
                {
                    var capturaCodigo = ResponderCaptura(biblioteca, captura, capturas[indice], (ushort)indice);
                    if (capturaCodigo == CodigosPgWeb.Cancel)
                    {
                        if (capturas[indice].TipoDeDado == TipoDadoPgWeb.Menu)
                        {
                            return InterromperMenuDaAutomacao(emCurso, biblioteca, pedido);
                        }

                        AbortarPinPadUmaVez(biblioteca);
                        operadorCancelou = true;
                        break;
                    }

                    if (capturaCodigo != CodigosPgWeb.Ok)
                    {
                        return Falha(emCurso, biblioteca, capturaCodigo, "captura_recusada", pedido);
                    }
                }

                continue;
            }

            if (execucao == CodigosPgWeb.Ok)
            {
                if (operadorCancelou)
                {
                    return ResolverCancelamentoOperador(emCurso, biblioteca, pedido, operacao);
                }

                return ConcluirExecucao(emCurso, biblioteca, pedido, operacao);
            }

            var desconhecido = execucao is CodigosPgWeb.PpComErr or CodigosPgWeb.Timeout or CodigosPgWeb.FromHost or CodigosPgWeb.FromHostPendTrn;
            if (operadorCancelou && !desconhecido)
            {
                return RegistrarInterrupcao(emCurso, biblioteca, pedido, LerTexto(biblioteca, InformacaoPgWeb.MensagemResultado));
            }

            return Falha(emCurso, biblioteca, execucao, desconhecido ? "resultado_desconhecido" : "execucao_recusada", pedido);
        }
    }

    private bool ContinuarEspera(
        IBibliotecaPgWeb biblioteca,
        ICapturaOperador? captura,
        ref bool operadorCancelou,
        ref DateTimeOffset? inicioEspera)
    {
        if (captura?.ConsumirCancelamento() == true)
        {
            AbortarPinPadUmaVez(biblioteca);
            operadorCancelou = true;
        }

        var agora = Espera.Agora?.Invoke() ?? DateTimeOffset.UtcNow;
        inicioEspera ??= agora;
        if (agora - inicioEspera.Value >= Espera.Limite)
        {
            return false;
        }

        if (Espera.Pausa is null)
        {
            Thread.Sleep(40);
        }
        else
        {
            Espera.Pausa();
        }

        return true;
    }

    private ResultadoMotor EncerrarEsperaLocal(JournalOperacao emCurso, PedidoVenda pedido)
    {
        _journals.Atualizar(emCurso with
        {
            Status = "resultado_desconhecido",
            AtualizadoEm = DateTimeOffset.UtcNow,
            PagamentoRecebido = false,
            ConfirmacaoChamada = false,
        });
        _sessoes.MarcarPendencia(pedido.PinPadId, pedido.Contexto.EmpresaId);
        return new ResultadoMotor(
            false,
            false,
            false,
            CodigoEsperaLocal,
            "espera_local_encerrada",
            emCurso.Identificador,
            null,
            "A espera local encerrou sem um retorno final da PGWebLib. O código -2490 não foi produzido pela biblioteca. O resultado financeiro permanece desconhecido.");
    }

    private void MarcarOriginalCancelada(JournalOperacao original)
    {
        _journals.Atualizar(original with
        {
            Status = "cancelada",
            AtualizadoEm = DateTimeOffset.UtcNow,
        });
    }

    private bool PontoInstalado(Guid empresaId, Guid terminalId)
    {
        return _journals.Listar(empresaId, terminalId).Any(journal => journal.Status == "instalada");
    }

    private bool InstalacaoRevogada(Guid empresaId, Guid terminalId)
    {
        var journals = _journals.Listar(empresaId, terminalId);
        var instalada = journals.Any(journal => journal.Status == "instalada");
        var desinstalada = journals.Any(journal => journal.Operacao == "instalacao" && journal.Status == "desinstalada");
        return desinstalada && !instalada;
    }

    private void ConciliarPontoAusente(ContextoEmpresa contexto)
    {
        var instaladas = _journals.Listar(contexto.EmpresaId, contexto.TerminalId)
            .Where(journal => journal.Status == "instalada" && !journal.PagamentoRecebido && journal.Operacao is null or "instalacao")
            .ToList();
        if (instaladas.Count == 0 || !RetornoPosteriorDePontoAusente(contexto.DiretorioDados, instaladas.Max(journal => journal.AtualizadoEm)))
        {
            return;
        }

        RevogarInstalacao(contexto.EmpresaId, contexto.TerminalId);
    }

    private static bool RetornoPosteriorDePontoAusente(string diretorioDados, DateTimeOffset instaladoEm)
    {
        if (string.IsNullOrWhiteSpace(diretorioDados))
        {
            return false;
        }

        var pasta = Path.Combine(diretorioDados, "Log");
        if (!Directory.Exists(pasta))
        {
            return false;
        }

        try
        {
            foreach (var arquivo in Directory.EnumerateFiles(pasta, "comms_*.log"))
            {
                var nome = Path.GetFileNameWithoutExtension(arquivo);
                if (nome.Length < 6 || !DateTime.TryParseExact(nome[^6..], "yyMMdd", System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var dia))
                {
                    continue;
                }

                foreach (var linha in File.ReadLines(arquivo))
                {
                    if (!linha.Contains("<-2498>", StringComparison.Ordinal) || linha.Length < 8)
                    {
                        continue;
                    }

                    if (!TimeSpan.TryParseExact(linha[..8], "hh\\:mm\\:ss", System.Globalization.CultureInfo.InvariantCulture, out var hora))
                    {
                        continue;
                    }

                    var quando = new DateTimeOffset(dia.Year, dia.Month, dia.Day, hora.Hours, hora.Minutes, hora.Seconds, TimeSpan.Zero);
                    if (quando > instaladoEm.ToUniversalTime())
                    {
                        return true;
                    }
                }
            }
        }
        catch (IOException)
        {
            return false;
        }
        catch (UnauthorizedAccessException)
        {
            return false;
        }

        return false;
    }

    private void RevogarInstalacao(Guid empresaId, Guid terminalId)
    {
        foreach (var journal in _journals.Listar(empresaId, terminalId))
        {
            if (journal.Status != "instalada" || journal.PagamentoRecebido || journal.Operacao == "venda")
            {
                continue;
            }

            if (journal.Operacao is not null && journal.Operacao != "instalacao")
            {
                continue;
            }

            _journals.Atualizar(journal with
            {
                Status = "desinstalada",
                PagamentoRecebido = false,
                ConfirmacaoChamada = false,
                AtualizadoEm = DateTimeOffset.UtcNow,
            });
        }
    }

    private ResultadoMotor ReconhecerPontoExistente(JournalOperacao emCurso, PedidoVenda pedido, short ambienteGravado)
    {
        _journals.Atualizar(emCurso with
        {
            Status = "instalada",
            AtualizadoEm = DateTimeOffset.UtcNow,
            PagamentoRecebido = false,
            ConfirmacaoChamada = false,
        });
        _sessoes.Encerrar(pedido.Contexto.EmpresaId);
        var nome = NomeAmbienteBiblioteca(ambienteGravado);
        return new ResultadoMotor(
            true,
            false,
            false,
            CodigosPgWeb.Ok,
            "instalada",
            emCurso.Identificador,
            null,
            $"A PGWebLib registrou que o terminal já está instalado e manteve o ambiente {nome}. Nenhuma nova instalação foi iniciada.");
    }

    private ResultadoMotor RecusarAmbienteDivergente(JournalOperacao emCurso, PedidoVenda pedido, short ambienteGravado)
    {
        _journals.Atualizar(emCurso with
        {
            Status = "recusada",
            AtualizadoEm = DateTimeOffset.UtcNow,
            PagamentoRecebido = false,
            ConfirmacaoChamada = false,
        });
        _sessoes.Encerrar(pedido.Contexto.EmpresaId);
        return new ResultadoMotor(
            false,
            false,
            false,
            CodigosPgWeb.InvCall,
            "ambiente_recusado",
            emCurso.Identificador,
            null,
            $"A PGWebLib manteve o terminal instalado no ambiente {NomeAmbienteBiblioteca(ambienteGravado)}. Este pedido pediu {NomeAmbienteBiblioteca(pedido.Contexto.Ambiente)}. Nenhuma instalação foi iniciada.");
    }

    private static string NomeAmbienteBiblioteca(short ambiente)
    {
        return ambiente == CodigosPgWeb.AmbienteProducao ? "PROD" : "TESTE";
    }

    private short AplicarAmbienteSePendente(Guid empresaId, Guid terminalId, IBibliotecaPgWeb biblioteca, short ambiente, bool verificarBiblioteca = false)
    {
        if (!verificarBiblioteca && PontoInstalado(empresaId, terminalId))
        {
            return CodigosPgWeb.Ok;
        }

        return biblioteca.DefinirAmbiente(ambiente);
    }

    private void EncerrarInstalacoesAbandonadas(Guid empresaId, Guid terminalId)
    {
        foreach (var journal in _journals.Pendencias(empresaId, terminalId))
        {
            if (journal.Status != "executando" || journal.ValorCentavos != 0 || journal.PagamentoRecebido || journal.ConfirmacaoChamada)
            {
                continue;
            }

            if (!string.IsNullOrEmpty(journal.NumeroRequisicao) || !string.IsNullOrEmpty(journal.ReferenciaLocal) || !string.IsNullOrEmpty(journal.ReferenciaExterna))
            {
                continue;
            }

            _journals.Atualizar(journal with
            {
                Status = "interrompida",
                PagamentoRecebido = false,
                ConfirmacaoChamada = false,
                AtualizadoEm = DateTimeOffset.UtcNow,
            });
        }
    }

    private static string NomeOperacao(byte operacao)
    {
        if (operacao == OperacaoPgWeb.Instalacao)
        {
            return "instalacao";
        }

        if (operacao == OperacaoPgWeb.Venda)
        {
            return "venda";
        }

        if (operacao == OperacaoPgWeb.CancelamentoVenda)
        {
            return "cancelamento";
        }

        if (operacao == OperacaoPgWeb.Administracao)
        {
            return "administracao";
        }

        return "configuracao";
    }

    private static IEnumerable<(ushort Identificador, string Valor)> ParametrosIniciais(byte operacao)
    {
        yield return (InformacaoPgWeb.Moeda, "986");
        yield return (InformacaoPgWeb.NomeAutomacao, "UltraPDV");
        yield return (InformacaoPgWeb.VersaoAutomacao, "1.3.41");
        yield return (InformacaoPgWeb.DesenvolvedorAutomacao, "UltraPDV");
        yield return (InformacaoPgWeb.CapacidadeAutomacao, InformacaoPgWeb.CapacidadeComViasDiferenciadas);
        if (operacao == OperacaoPgWeb.Instalacao)
        {
            yield return (InformacaoPgWeb.UsaPinPad, "1");
            yield return (InformacaoPgWeb.PortaPinPad, "0");
        }
    }

    private ResultadoMotor ConcluirExecucao(JournalOperacao journal, IBibliotecaPgWeb biblioteca, PedidoVenda pedido, byte operacao)
    {
        var exigida = LerTexto(biblioteca, InformacaoPgWeb.ConfirmacaoRequerida);
        var mensagem = LerTexto(biblioteca, InformacaoPgWeb.MensagemResultado);
        var atualizado = journal with
        {
            NumeroRequisicao = LerTexto(biblioteca, InformacaoPgWeb.NumeroRequisicao),
            ReferenciaLocal = LerTexto(biblioteca, InformacaoPgWeb.ReferenciaLocal),
            ReferenciaExterna = LerTexto(biblioteca, InformacaoPgWeb.ReferenciaExterna),
            EstabelecimentoVirtual = LerTexto(biblioteca, InformacaoPgWeb.EstabelecimentoVirtual),
            SistemaAutorizador = LerTexto(biblioteca, InformacaoPgWeb.SistemaAutorizador),
            ConfirmacaoExigida = exigida,
            AtualizadoEm = DateTimeOffset.UtcNow,
        };
        if (operacao == OperacaoPgWeb.Venda)
        {
            atualizado = ComDadosFiscais(atualizado, biblioteca);
            atualizado = ComComprovantes(atualizado, biblioteca);
        }

        if (operacao == OperacaoPgWeb.Configuracao)
        {
            return ConcluirConfiguracao(atualizado, biblioteca, pedido, exigida, mensagem);
        }

        if (operacao == OperacaoPgWeb.Administracao)
        {
            return ConcluirAdministracao(atualizado, biblioteca, pedido, exigida, mensagem);
        }

        if (operacao == OperacaoPgWeb.Instalacao)
        {
            atualizado = ComComprovantes(atualizado, biblioteca);
            if (!biblioteca.EhNativa)
            {
                _journals.Atualizar(atualizado with { Status = "simulada_sem_pagamento", PagamentoRecebido = false });
                return new ResultadoMotor(false, false, false, CodigosPgWeb.Ok, "simulacao_nao_e_instalacao", journal.Identificador, null, mensagem ?? "A simulação não confirma a instalação.");
            }

            if (exigida == "1")
            {
                var confirmacao = biblioteca.Confirmar(
                    ConfirmacaoPgWeb.Automatica,
                    atualizado.NumeroRequisicao ?? "",
                    atualizado.ReferenciaLocal ?? "",
                    atualizado.ReferenciaExterna ?? "",
                    atualizado.EstabelecimentoVirtual ?? "",
                    atualizado.SistemaAutorizador ?? "");
                var instalada = confirmacao == CodigosPgWeb.Ok;
                _journals.Atualizar(atualizado with
                {
                    Status = instalada ? "instalada" : "aguardando_confirmacao",
                    ConfirmacaoChamada = true,
                    PagamentoRecebido = false,
                });
                if (instalada)
                {
                    _sessoes.Encerrar(pedido.Contexto.EmpresaId);
                }

                return new ResultadoMotor(instalada, false, true, confirmacao, instalada ? "instalada" : "confirmacao_recusada", journal.Identificador, null, mensagem ?? (instalada ? "A biblioteca confirmou a instalação." : "A biblioteca não confirmou a instalação."));
            }

            var aceita = exigida == "0";
            _journals.Atualizar(atualizado with { Status = aceita ? "instalada" : "recusada", PagamentoRecebido = false });
            if (aceita)
            {
                _sessoes.Encerrar(pedido.Contexto.EmpresaId);
            }

            return new ResultadoMotor(aceita, false, false, CodigosPgWeb.Ok, aceita ? "instalada" : "execucao_recusada", journal.Identificador, null, mensagem ?? (aceita ? "A biblioteca concluiu a instalação sem confirmação adicional." : "A biblioteca não informou o resultado da instalação."));
        }

        if (exigida == "0")
        {
            var recebido = biblioteca.EhNativa;
            _journals.Atualizar(atualizado with
            {
                Status = recebido ? "aprovada_sem_confirmacao" : "simulada_sem_pagamento",
                PagamentoRecebido = recebido,
            });
            if (recebido)
            {
                _sessoes.Encerrar(pedido.Contexto.EmpresaId);
            }

            return new ResultadoMotor(
                recebido,
                recebido,
                false,
                CodigosPgWeb.Ok,
                recebido ? "aprovada_sem_confirmacao" : "simulacao_nao_e_pagamento",
                journal.Identificador,
                null,
                LerTexto(biblioteca, InformacaoPgWeb.MensagemResultado));
        }

        _journals.Atualizar(atualizado with { Status = "aguardando_confirmacao", PagamentoRecebido = false });
        _sessoes.MarcarPendencia(pedido.PinPadId, pedido.Contexto.EmpresaId);
        return new ResultadoMotor(false, false, false, CodigosPgWeb.Ok, "aguardando_confirmacao", journal.Identificador, null, "A transação retornou da biblioteca e ainda exige confirmação. O pagamento não foi recebido.");
    }

    private ResultadoMotor ResolverCancelamentoOperador(JournalOperacao emCurso, IBibliotecaPgWeb biblioteca, PedidoVenda pedido, byte operacao)
    {
        var mensagem = LerTexto(biblioteca, InformacaoPgWeb.MensagemResultado);
        var exigida = LerTexto(biblioteca, InformacaoPgWeb.ConfirmacaoRequerida);
        var numero = LerTexto(biblioteca, InformacaoPgWeb.NumeroRequisicao);
        if (operacao == OperacaoPgWeb.Venda
            && exigida == "1"
            && !string.IsNullOrWhiteSpace(numero)
            && !string.IsNullOrWhiteSpace(mensagem)
            && !TextoIndicaCancelamento(mensagem))
        {
            var desfazer = biblioteca.Confirmar(
                ConfirmacaoPgWeb.DesfazimentoAborto,
                numero,
                LerTexto(biblioteca, InformacaoPgWeb.ReferenciaLocal) ?? "",
                LerTexto(biblioteca, InformacaoPgWeb.ReferenciaExterna) ?? "",
                LerTexto(biblioteca, InformacaoPgWeb.EstabelecimentoVirtual) ?? "",
                LerTexto(biblioteca, InformacaoPgWeb.SistemaAutorizador) ?? "");
            if (desfazer != CodigosPgWeb.Ok)
            {
                _journals.Atualizar(emCurso with
                {
                    Status = "resultado_desconhecido",
                    AtualizadoEm = DateTimeOffset.UtcNow,
                    PagamentoRecebido = false,
                    ConfirmacaoChamada = true,
                    NumeroRequisicao = numero,
                });
                _sessoes.MarcarPendencia(pedido.PinPadId, pedido.Contexto.EmpresaId);
                return new ResultadoMotor(false, false, false, desfazer, "resultado_desconhecido", emCurso.Identificador, null, "A transação exigia desfazimento e a biblioteca não confirmou. Nenhum pagamento foi recebido. Nenhuma nova cobrança foi iniciada.");
            }

            _journals.Atualizar(emCurso with
            {
                Status = "interrompida",
                AtualizadoEm = DateTimeOffset.UtcNow,
                PagamentoRecebido = false,
                ConfirmacaoChamada = true,
                NumeroRequisicao = numero,
            });
            _sessoes.Encerrar(pedido.Contexto.EmpresaId);
            return new ResultadoMotor(false, false, true, desfazer, "interrompida", emCurso.Identificador, null, mensagem.Trim());
        }

        if (operacao == OperacaoPgWeb.Venda && exigida == "0" && !string.IsNullOrWhiteSpace(mensagem) && !TextoIndicaCancelamento(mensagem))
        {
            return ConcluirExecucao(emCurso, biblioteca, pedido, operacao);
        }

        return RegistrarInterrupcao(emCurso, biblioteca, pedido, mensagem);
    }

    private ResultadoMotor InterromperMenuDaAutomacao(JournalOperacao emCurso, IBibliotecaPgWeb biblioteca, PedidoVenda pedido)
    {
        if (!string.IsNullOrWhiteSpace(_recusaMenu))
        {
            return RegistrarInterrupcao(emCurso, biblioteca, pedido, _recusaMenu);
        }

        var mensagem = LerTexto(biblioteca, InformacaoPgWeb.MensagemResultado);
        if (!TextoIndicaCancelamento(mensagem))
        {
            mensagem = "OPERAÇÃO CANCELADA";
        }

        return RegistrarInterrupcao(emCurso, biblioteca, pedido, mensagem);
    }

    private ResultadoMotor RegistrarInterrupcao(JournalOperacao emCurso, IBibliotecaPgWeb biblioteca, PedidoVenda pedido, string? mensagemBiblioteca)
    {
        _ = biblioteca;
        var texto = string.IsNullOrWhiteSpace(mensagemBiblioteca) ? "OPERAÇÃO CANCELADA" : mensagemBiblioteca.Trim();
        _journals.Atualizar(emCurso with
        {
            Status = "interrompida",
            AtualizadoEm = DateTimeOffset.UtcNow,
            PagamentoRecebido = false,
            ConfirmacaoChamada = false,
        });
        _sessoes.Encerrar(pedido.Contexto.EmpresaId);
        return new ResultadoMotor(false, false, false, CodigosPgWeb.Cancel, "interrompida", emCurso.Identificador, null, texto);
    }

    private static bool TextoIndicaCancelamento(string? mensagem)
    {
        return (mensagem ?? "").Contains("CANCELAD", StringComparison.OrdinalIgnoreCase);
    }

    private static bool EhCancelamentoDeTransacaoAnterior(OpcaoCaptura opcao)
    {
        return TextoDeCancelamento(opcao.Texto) || TextoDeCancelamento(opcao.Valor);
    }

    private static bool TextoDeCancelamento(string texto)
    {
        return texto.Trim().Equals("CANCELAMENTO", StringComparison.OrdinalIgnoreCase);
    }

    private short ResponderCaptura(IBibliotecaPgWeb biblioteca, ICapturaOperador? captura, PwGetData pedido, ushort indice)
    {
        if (pedido.Identificador == InformacaoPgWeb.UsaPinPad)
        {
            return biblioteca.AdicionarParametro(pedido.Identificador, "1");
        }

        if (pedido.Identificador == InformacaoPgWeb.PortaPinPad)
        {
            return biblioteca.AdicionarParametro(pedido.Identificador, "0");
        }

        switch (pedido.TipoDeDado)
        {
            case TipoDadoPgWeb.Cartao:
                return ContinuarPinPad(biblioteca, captura, biblioteca.LerCartao(indice));
            case TipoDadoPgWeb.ChipOffline:
                return ContinuarPinPad(biblioteca, captura, biblioteca.ProcessarChipOffline(indice));
            case TipoDadoPgWeb.ChipOnline:
                return ContinuarPinPad(biblioteca, captura, biblioteca.FinalizarChip(indice));
            case TipoDadoPgWeb.ConfirmacaoPinPad:
                return ContinuarPinPad(biblioteca, captura, biblioteca.ConfirmarDadoPinPad(indice));
            case TipoDadoPgWeb.ConfirmacaoPositiva:
                return ContinuarPinPad(biblioteca, captura, biblioteca.ConfirmacaoPositivaPinPad(indice));
            case TipoDadoPgWeb.ComandoPinPad:
                return ContinuarPinPad(biblioteca, captura, biblioteca.ComandoPinPad(indice));
            case TipoDadoPgWeb.SenhaPinPad:
                return ContinuarPinPad(biblioteca, captura, biblioteca.LerSenhaPinPad(indice));
            case TipoDadoPgWeb.DigitacaoPinPad:
                return ContinuarPinPad(biblioteca, captura, biblioteca.LerDadoPinPad(indice));
            case TipoDadoPgWeb.RemocaoCartao:
                return ContinuarPinPad(biblioteca, captura, biblioteca.RemoverCartao());
            case TipoDadoPgWeb.Menu:
                var opcoes = TextoCaptura.OpcoesValidas(ref pedido);
                if (_operacao == OperacaoPgWeb.Administracao)
                {
                    return ResponderMenuAdministrativo(biblioteca, captura, pedido, opcoes);
                }

                if (opcoes.Count == 1 && !EhCancelamentoDeTransacaoAnterior(opcoes[0]))
                {
                    return biblioteca.AdicionarParametro(pedido.Identificador, opcoes[0].Valor);
                }

                if (opcoes.Count == 0)
                {
                    return CodigosPgWeb.InvParam;
                }

                return ResponderDigitacao(biblioteca, captura, pedido);
            case TipoDadoPgWeb.Digitado:
            case TipoDadoPgWeb.AutenticacaoUsuario:
            case TipoDadoPgWeb.CodigoBarras:
                return ResponderDigitacao(biblioteca, captura, pedido);
            case TipoDadoPgWeb.MensagemCheckout:
                if (captura is not null && !captura.TentarResponder(pedido, out _))
                {
                    return CodigosPgWeb.Cancel;
                }

                return biblioteca.AdicionarParametro(pedido.Identificador, "");
            case TipoDadoPgWeb.QrCodeCheckout:
                var qr = LerTextoAmplo(biblioteca, InformacaoPgWeb.QrCodeAutorizador);
                if (!string.IsNullOrWhiteSpace(qr))
                {
                    captura?.ReceberQrCode(qr);
                }

                if (captura is not null && !captura.TentarResponder(pedido, out _))
                {
                    return CodigosPgWeb.Cancel;
                }

                return biblioteca.AdicionarParametro(pedido.Identificador, "");
            default:
                return CodigosPgWeb.InvParam;
        }
    }

    private void AbortarPinPadUmaVez(IBibliotecaPgWeb biblioteca)
    {
        if (Interlocked.CompareExchange(ref _abortPinPad, 1, 0) == 0)
        {
            biblioteca.AbortarPinPad();
        }
    }

    private short ContinuarPinPad(IBibliotecaPgWeb biblioteca, ICapturaOperador? captura, short inicio)
    {
        if (inicio != CodigosPgWeb.Ok)
        {
            return inicio;
        }

        using var parado = new CancellationTokenSource();
        var vigilante = Task.Run(() =>
        {
            while (!parado.IsCancellationRequested)
            {
                if (captura?.ConsumirCancelamento() == true)
                {
                    AbortarPinPadUmaVez(biblioteca);
                    return;
                }

                Thread.Sleep(40);
            }
        });

        short codigo;
        try
        {
            var display = new byte[128];
            codigo = CodigosPgWeb.Timeout;
            for (var sonda = 0; sonda < 450; sonda++)
            {
                codigo = biblioteca.LoopPinPad(display);
                if (codigo is CodigosPgWeb.Nothing or CodigosPgWeb.Display)
                {
                    Thread.Sleep(200);
                    continue;
                }

                break;
            }
        }
        finally
        {
            parado.Cancel();
            vigilante.Wait(TimeSpan.FromSeconds(2));
        }

        if (Volatile.Read(ref _abortPinPad) == 1 && codigo is CodigosPgWeb.Timeout or CodigosPgWeb.Nothing or CodigosPgWeb.Display)
        {
            return CodigosPgWeb.Cancel;
        }

        return codigo;
    }

    private ResultadoMotor ConcluirConfiguracao(JournalOperacao atualizado, IBibliotecaPgWeb biblioteca, PedidoVenda pedido, string? exigida, string? mensagem)
    {
        if (!_destinoTcpIpInformado)
        {
            _journals.Atualizar(atualizado with { Status = "recusada", PagamentoRecebido = false, ConfirmacaoChamada = false });
            _sessoes.Encerrar(pedido.Contexto.EmpresaId);
            var motivo = string.IsNullOrWhiteSpace(mensagem) ? "A biblioteca não informou outro motivo." : mensagem;
            return new ResultadoMotor(false, false, false, CodigosPgWeb.Ok, "configurada_sem_endereco", atualizado.Identificador, null, $"PWOPER_CONFIG retornou {CodigosPgWeb.Ok}. A biblioteca não solicitou PWINFO_DESTTCPIP. {motivo} O endereço gravado não foi substituído.");
        }

        var lido = LerTexto(biblioteca, InformacaoPgWeb.DestinoTcpIp);
        if (!string.Equals(lido, _destinoTcpIpEnviado, StringComparison.Ordinal))
        {
            _journals.Atualizar(atualizado with { Status = "recusada", PagamentoRecebido = false, ConfirmacaoChamada = false });
            _sessoes.Encerrar(pedido.Contexto.EmpresaId);
            return new ResultadoMotor(false, false, false, CodigosPgWeb.Ok, "endereco_nao_atualizado", atualizado.Identificador, null, $"PWOPER_CONFIG retornou {CodigosPgWeb.Ok}. O valor lido em PWINFO_DESTTCPIP não é o valor enviado nesta operação. O endereço não foi confirmado.");
        }

        var resultado = ConcluirSemPagamento(atualizado, biblioteca, pedido, exigida, mensagem, "configurada");
        if (resultado.Situacao != "configurada")
        {
            return resultado;
        }

        var validado = ServidorComercial.Confere(_enderecoEsperado, _destinoTcpIpEnviado);
        return resultado with
        {
            Mensagem = validado
                ? "A biblioteca confirmou o servidor comercial declarado em PWINFO_DESTTCPIP. Nenhum pagamento foi iniciado."
                : "A biblioteca gravou o novo endereço de PWINFO_DESTTCPIP. Nenhum pagamento foi iniciado.",
            ServidorValidado = validado,
        };
    }

    private ResultadoMotor ConcluirAdministracao(JournalOperacao atualizado, IBibliotecaPgWeb biblioteca, PedidoVenda pedido, string? exigida, string? mensagem)
    {
        if (!biblioteca.EhNativa)
        {
            _journals.Atualizar(atualizado with { Status = "simulada_sem_pagamento", PagamentoRecebido = false, ConfirmacaoChamada = false });
            return new ResultadoMotor(false, false, false, CodigosPgWeb.Ok, "simulacao_nao_e_administracao", atualizado.Identificador, null, mensagem ?? "A simulação não executa o menu administrativo.");
        }

        var relatorio = RelatorioAdministrativo(biblioteca, mensagem);
        if (exigida == "1")
        {
            var confirmacao = biblioteca.Confirmar(
                ConfirmacaoPgWeb.Automatica,
                atualizado.NumeroRequisicao ?? "",
                atualizado.ReferenciaLocal ?? "",
                atualizado.ReferenciaExterna ?? "",
                atualizado.EstabelecimentoVirtual ?? "",
                atualizado.SistemaAutorizador ?? "");
            var aceita = confirmacao == CodigosPgWeb.Ok;
            _journals.Atualizar(ComVias(atualizado, relatorio) with
            {
                Status = aceita ? "administrativa" : "recusada",
                ConfirmacaoChamada = true,
                PagamentoRecebido = false,
            });
            _sessoes.Encerrar(pedido.Contexto.EmpresaId);
            var texto = string.IsNullOrWhiteSpace(relatorio.Texto) ? "A biblioteca encerrou o menu administrativo." : relatorio.Texto;
            return AvaliarManutencao(new ResultadoMotor(aceita, false, true, confirmacao, aceita ? "administrativa" : "administracao_recusada", atualizado.Identificador, null, aceita ? texto : "A biblioteca não confirmou o menu administrativo. Nenhuma cobrança foi iniciada."), biblioteca, pedido);
        }

        var concluida = exigida == "0";
        _journals.Atualizar(ComVias(atualizado, relatorio) with { Status = concluida ? "administrativa" : "recusada", PagamentoRecebido = false, ConfirmacaoChamada = false });
        _sessoes.Encerrar(pedido.Contexto.EmpresaId);
        return AvaliarManutencao(new ResultadoMotor(concluida, false, false, CodigosPgWeb.Ok, concluida ? "administrativa" : "administracao_recusada", atualizado.Identificador, null, relatorio.Texto.Length > 0 ? relatorio.Texto : (concluida ? "A biblioteca concluiu o menu administrativo. Nenhuma cobrança foi iniciada." : "A biblioteca não concluiu o menu administrativo. Nenhuma cobrança foi iniciada.")), biblioteca, pedido);
    }

    private ResultadoMotor AvaliarManutencao(ResultadoMotor resultado, IBibliotecaPgWeb biblioteca, PedidoVenda pedido)
    {
        if (resultado.Situacao != "administrativa" || !_manutencaoSelecionada || !string.IsNullOrWhiteSpace(LerTexto(biblioteca, InformacaoPgWeb.PontoCaptura)))
        {
            return resultado;
        }

        RevogarInstalacao(pedido.Contexto.EmpresaId, pedido.Contexto.TerminalId);
        return resultado with
        {
            Concluida = false,
            PagamentoRecebido = false,
            Situacao = "ponto_nao_instalado",
            Mensagem = "A manutenção removeu a instalação do ponto de captura. O PinPad e os parâmetros de comunicação deixaram de valer. Uma nova instalação é necessária. Nenhuma cobrança foi iniciada.",
        };
    }

    private (string? Loja, string? Cliente, string Texto) RelatorioAdministrativo(IBibliotecaPgWeb biblioteca, string? mensagem)
    {
        var loja = TextoOuNulo(LerTextoAmplo(biblioteca, InformacaoPgWeb.ComprovanteEstabelecimento));
        var cliente = TextoOuNulo(LerTextoAmplo(biblioteca, InformacaoPgWeb.ComprovanteCliente));
        var reduzido = TextoOuNulo(LerTextoAmplo(biblioteca, InformacaoPgWeb.ComprovanteReduzido));
        var partes = new[] { mensagem, loja, cliente, reduzido }.Where(parte => !string.IsNullOrWhiteSpace(parte)).Select(parte => parte!.Trim());
        return (loja, cliente, string.Join("\n", partes));
    }

    private static JournalOperacao ComVias(JournalOperacao atualizado, (string? Loja, string? Cliente, string Texto) relatorio)
    {
        return atualizado with
        {
            ViaEstabelecimento = relatorio.Loja ?? atualizado.ViaEstabelecimento,
            ViaCliente = relatorio.Cliente ?? atualizado.ViaCliente,
        };
    }

    private static string? TextoOuNulo(string? valor)
    {
        return string.IsNullOrWhiteSpace(valor) ? null : valor.Trim();
    }

    private ResultadoMotor ConcluirSemPagamento(JournalOperacao atualizado, IBibliotecaPgWeb biblioteca, PedidoVenda pedido, string? exigida, string? mensagem, string statusOk)
    {
        if (!biblioteca.EhNativa)
        {
            _journals.Atualizar(atualizado with { Status = "simulada_sem_pagamento", PagamentoRecebido = false });
            return new ResultadoMotor(false, false, false, CodigosPgWeb.Ok, "simulacao_nao_e_instalacao", atualizado.Identificador, null, mensagem ?? "A simulação não confirma a operação.");
        }

        if (exigida == "1")
        {
            var confirmacao = biblioteca.Confirmar(
                ConfirmacaoPgWeb.Automatica,
                atualizado.NumeroRequisicao ?? "",
                atualizado.ReferenciaLocal ?? "",
                atualizado.ReferenciaExterna ?? "",
                atualizado.EstabelecimentoVirtual ?? "",
                atualizado.SistemaAutorizador ?? "");
            var aceita = confirmacao == CodigosPgWeb.Ok;
            _journals.Atualizar(atualizado with
            {
                Status = aceita ? statusOk : "aguardando_confirmacao",
                ConfirmacaoChamada = true,
                PagamentoRecebido = false,
            });
            if (aceita)
            {
                _sessoes.Encerrar(pedido.Contexto.EmpresaId);
            }

            return new ResultadoMotor(aceita, false, true, confirmacao, aceita ? statusOk : "confirmacao_recusada", atualizado.Identificador, null, mensagem ?? (aceita ? "A biblioteca confirmou a operação." : "A biblioteca não confirmou a operação."));
        }

        var concluida = exigida == "0";
        _journals.Atualizar(atualizado with { Status = concluida ? statusOk : "recusada", PagamentoRecebido = false });
        if (concluida)
        {
            _sessoes.Encerrar(pedido.Contexto.EmpresaId);
        }

        return new ResultadoMotor(concluida, false, false, CodigosPgWeb.Ok, concluida ? statusOk : "execucao_recusada", atualizado.Identificador, null, mensagem ?? (concluida ? "A biblioteca concluiu a operação." : "A biblioteca não informou o resultado."));
    }

    private short ResponderMenuAdministrativo(IBibliotecaPgWeb biblioteca, ICapturaOperador? captura, PwGetData pedido, IReadOnlyList<OpcaoCaptura> opcoes)
    {
        if (opcoes.Count == 0)
        {
            return CodigosPgWeb.InvParam;
        }

        if (captura is null || !captura.TentarResponder(pedido, out var valor) || string.IsNullOrWhiteSpace(valor))
        {
            return CodigosPgWeb.Cancel;
        }

        if (!opcoes.Any(opcao => opcao.Valor == valor))
        {
            captura.DefinirAviso("Escolha uma opção devolvida pela biblioteca. Nenhum índice foi enviado.");
            return CodigosPgWeb.Cancel;
        }

        if (pedido.Identificador != InformacaoPgWeb.LocalInfo2)
        {
            return biblioteca.AdicionarParametro(pedido.Identificador, valor);
        }

        var nativa = _operacoesDisponiveis.FirstOrDefault(item => item.Valor == valor);
        if (nativa is null)
        {
            var textoBiblioteca = LerTexto(biblioteca, InformacaoPgWeb.MensagemResultado);
            _recusaMenu = string.IsNullOrWhiteSpace(textoBiblioteca)
                ? "A adquirente não habilitou esta operação. Nenhum valor foi enviado."
                : textoBiblioteca.Trim();
            return CodigosPgWeb.Cancel;
        }

        if (CatalogoAdministrativo.Financeira(nativa.Tipo) && !biblioteca.OperacaoFinanceiraAutorizada)
        {
            _recusaMenu = "Esta operação financeira exige autorização explícita. Nenhum valor foi enviado.";
            return CodigosPgWeb.Cancel;
        }

        if (CatalogoAdministrativo.AlteraTerminal(nativa.Tipo) && _producao && !biblioteca.InstalacaoProducaoAutorizada)
        {
            _recusaMenu = "Esta operação altera parâmetros do terminal e exige autorização explícita. Nenhum valor foi enviado.";
            return CodigosPgWeb.Cancel;
        }

        if (nativa.Tipo == OperacaoPgWeb.Manutencao)
        {
            _manutencaoSelecionada = true;
        }

        return biblioteca.AdicionarParametro(pedido.Identificador, nativa.Valor);
    }

    private short ResponderDigitacao(IBibliotecaPgWeb biblioteca, ICapturaOperador? captura, PwGetData pedido)
    {
        if (_operacao == OperacaoPgWeb.Instalacao && !_producao && pedido.Identificador == InformacaoPgWeb.PontoCaptura && _pontoCadastrado.Length > 0)
        {
            return biblioteca.AdicionarParametro(pedido.Identificador, _pontoCadastrado);
        }

        if (_operacao == OperacaoPgWeb.Instalacao && !_producao && pedido.Identificador == InformacaoPgWeb.DestinoTcpIp && _servidorCadastrado.Length > 0)
        {
            _destinoTcpIpInformado = true;
            _destinoTcpIpEnviado = _servidorCadastrado;
            return biblioteca.AdicionarParametro(pedido.Identificador, _servidorCadastrado);
        }

        for (var tentativa = 0; tentativa < 4; tentativa++)
        {
            if (captura is null || !captura.TentarResponder(pedido, out var valor))
            {
                return CodigosPgWeb.Cancel;
            }

            if (pedido.Identificador == InformacaoPgWeb.DestinoTcpIp)
            {
                if (!CapturaEndereco.PodeEnviar(valor, out var endereco))
                {
                    captura.DefinirAviso(CapturaEndereco.AvisoNaoEnviado);
                    continue;
                }

                if (_producao && ServidorComercial.PertenceHomologacao(endereco))
                {
                    captura.DefinirAviso("Este endereço é de homologação. Informe o servidor comercial de produção fornecido pela PayGo. O valor não foi enviado.");
                    continue;
                }

                if (_enderecoEsperado.Length > 0 && !ServidorComercial.Confere(_enderecoEsperado, endereco))
                {
                    captura.DefinirAviso("O valor não é o servidor comercial informado para esta empresa. O valor não foi enviado.");
                    continue;
                }

                _destinoTcpIpInformado = true;
                _destinoTcpIpEnviado = endereco;
                return biblioteca.AdicionarParametro(pedido.Identificador, endereco);
            }

            if (pedido.TipoDeDado == TipoDadoPgWeb.Menu)
            {
                var permitidas = TextoCaptura.OpcoesValidas(ref pedido);
                if (!permitidas.Any(opcao => opcao.Valor == valor))
                {
                    captura?.DefinirAviso("Escolha uma opção devolvida pela biblioteca. Nenhum índice foi enviado.");
                    continue;
                }

                return biblioteca.AdicionarParametro(pedido.Identificador, valor);
            }

            if (ValorCentavos.EhMontante(pedido.Identificador))
            {
                if (!ValorCentavos.Tentar(valor, out var centavos))
                {
                    captura?.DefinirAviso("Informe o valor em reais, como 12.345,67. O valor não foi enviado.");
                    continue;
                }

                return biblioteca.AdicionarParametro(pedido.Identificador, centavos);
            }

            if (!CapturaDigitada.Tentar(ref pedido, valor, out var preparado, out var erroCaptura))
            {
                captura?.DefinirAviso(erroCaptura);
                continue;
            }

            if (pedido.TipoDeDado == TipoDadoPgWeb.CodigoBarras && pedido.Identificador == InformacaoPgWeb.CodigoBarras)
            {
                var codigo = biblioteca.AdicionarParametro(InformacaoPgWeb.CodigoBarras, preparado);
                if (codigo != CodigosPgWeb.Ok)
                {
                    return codigo;
                }

                return biblioteca.AdicionarParametro(InformacaoPgWeb.ModoEntradaCodigoBarras, "1");
            }

            return biblioteca.AdicionarParametro(pedido.Identificador, preparado);
        }

        return CodigosPgWeb.Cancel;
    }

    private static short Adicionar(IBibliotecaPgWeb biblioteca, ushort identificador, string valor)
    {
        return biblioteca.AdicionarParametro(identificador, valor);
    }

    private ResultadoMotor Falha(JournalOperacao journal, IBibliotecaPgWeb biblioteca, short codigo, string situacao, PedidoVenda pedido)
    {
        var confirmacaoExigida = LerTexto(biblioteca, InformacaoPgWeb.ConfirmacaoRequerida);
        var administrativaEncerrada = journal.Operacao == "administracao"
            && journal.ValorCentavos == 0
            && !journal.PagamentoRecebido
            && codigo == CodigosPgWeb.FromHost
            && confirmacaoExigida != "1";
        var status = situacao == "resultado_desconhecido" && !administrativaEncerrada ? "resultado_desconhecido" : "recusada";
        var situacaoFinal = administrativaEncerrada ? "recusada" : situacao;
        _journals.Atualizar(journal with
        {
            Status = status,
            AtualizadoEm = DateTimeOffset.UtcNow,
            PagamentoRecebido = false,
            ConfirmacaoChamada = false,
            ConfirmacaoExigida = confirmacaoExigida,
        });
        if (status == "resultado_desconhecido")
        {
            _sessoes.MarcarPendencia(pedido.PinPadId, pedido.Contexto.EmpresaId);
        }
        else
        {
            _sessoes.Encerrar(pedido.Contexto.EmpresaId);
        }

        var detalhe = CapturaEndereco.Apresentar(LerTexto(biblioteca, InformacaoPgWeb.MensagemResultado));
        var mensagem = string.IsNullOrWhiteSpace(detalhe)
            ? $"A biblioteca retornou {codigo}. A operação não foi confirmada."
            : detalhe;
        if (codigo == CodigosPgWeb.NotInst && (journal.Operacao == "venda" || situacao == "transacao_recusada"))
        {
            RevogarInstalacao(pedido.Contexto.EmpresaId, pedido.Contexto.TerminalId);
            situacaoFinal = "ponto_nao_instalado";
            if (!mensagem.Contains("nova instalação", StringComparison.OrdinalIgnoreCase))
            {
                mensagem += " Nenhuma cobrança foi iniciada. Uma nova instalação é necessária.";
            }
        }
        if (codigo == CodigosPgWeb.ConfigRequired && !_destinoTcpIpInformado)
        {
            mensagem += " A biblioteca reutilizou o endereço já gravado e não solicitou PWINFO_DESTTCPIP. O retorno final é PWRET_CONFIGREQUIRED. A troca desse endereço é PWOPER_CONFIG, somente quando essa operação for iniciada manualmente.";
        }
        else if (codigo == CodigosPgWeb.ConfigRequired)
        {
            mensagem += " O valor de PWINFO_DESTTCPIP foi enviado. Esse campo único precisa estar em host:porta. A biblioteca não abriu outro campo de porta.";
        }
        return new ResultadoMotor(false, false, false, codigo, situacaoFinal, journal.Identificador, null, mensagem);
    }

    private static JournalOperacao ComDadosFiscais(JournalOperacao journal, IBibliotecaPgWeb biblioteca)
    {
        var padrao = TextoFiscal(LerTexto(biblioteca, InformacaoPgWeb.NomeCartaoPadrao), journal);
        var cartao = TextoFiscal(LerTexto(biblioteca, InformacaoPgWeb.NomeCartao), journal);
        var bandeira = string.IsNullOrWhiteSpace(padrao) ? cartao : padrao;
        if (MesmoTexto(bandeira, journal.SistemaAutorizador))
        {
            bandeira = null;
        }

        return journal with
        {
            AutorizacaoFiscal = TextoFiscal(LerTexto(biblioteca, InformacaoPgWeb.CodigoAutorizacao), journal, 20),
            BandeiraNome = bandeira,
            InstituicaoPagamento = TextoFiscal(LerTexto(biblioteca, InformacaoPgWeb.NomeEntidadePagamento), journal),
            CnpjCredenciadora = CnpjFiscal(LerTexto(biblioteca, InformacaoPgWeb.CnpjEntidadePagamento)),
            CnpjRecebedor = CnpjFiscal(LerTexto(biblioteca, InformacaoPgWeb.CnpjRecebedor)),
        };
    }

    private static JournalOperacao ComComprovantes(JournalOperacao journal, IBibliotecaPgWeb biblioteca)
    {
        return journal with
        {
            ViaEstabelecimento = LerComprovante(biblioteca, InformacaoPgWeb.ComprovanteEstabelecimento),
            ViaCliente = LerComprovante(biblioteca, InformacaoPgWeb.ComprovanteCliente),
        };
    }

    private static string? LerComprovante(IBibliotecaPgWeb biblioteca, ushort informacao)
    {
        Span<byte> buffer = stackalloc byte[4096];
        var codigo = biblioteca.LerResultado((short)informacao, buffer);
        if (codigo != CodigosPgWeb.Ok)
        {
            return null;
        }

        var fim = buffer.IndexOf((byte)0);
        if (fim <= 0)
        {
            return null;
        }

        var texto = Encoding.Latin1.GetString(buffer[..fim]);
        return string.IsNullOrWhiteSpace(texto) ? null : texto;
    }

    private static string? TextoFiscal(string? valor, JournalOperacao journal, int limite = 40)
    {
        if (string.IsNullOrWhiteSpace(valor))
        {
            return null;
        }

        var texto = valor.Trim();
        if (texto.Length > limite || texto.Contains('\n') || texto.Contains('\r') || ParecePan(texto))
        {
            return null;
        }

        if (MesmoTexto(texto, journal.NumeroRequisicao)
            || MesmoTexto(texto, journal.ReferenciaLocal)
            || MesmoTexto(texto, journal.ReferenciaExterna)
            || MesmoTexto(texto, journal.EstabelecimentoVirtual))
        {
            return null;
        }

        return texto;
    }

    private static bool MesmoTexto(string? esquerda, string? direita)
    {
        return !string.IsNullOrWhiteSpace(esquerda)
            && !string.IsNullOrWhiteSpace(direita)
            && string.Equals(esquerda.Trim(), direita.Trim(), StringComparison.OrdinalIgnoreCase);
    }

    private static bool ParecePan(string valor)
    {
        if (valor.Length < 13 || valor.Length > 19)
        {
            return false;
        }

        foreach (var caractere in valor)
        {
            if (caractere < '0' || caractere > '9')
            {
                return false;
            }
        }

        return true;
    }

    private static string? CnpjFiscal(string? valor)
    {
        if (string.IsNullOrWhiteSpace(valor))
        {
            return null;
        }

        var digitos = new StringBuilder(valor.Length);
        foreach (var caractere in valor)
        {
            if (caractere is >= '0' and <= '9')
            {
                digitos.Append(caractere);
            }
        }

        return digitos.Length == 14 ? digitos.ToString() : null;
    }

    private static string? LerTextoAmplo(IBibliotecaPgWeb biblioteca, ushort informacao)
    {
        Span<byte> buffer = stackalloc byte[4096];
        var codigo = biblioteca.LerResultado((short)informacao, buffer);
        if (codigo != CodigosPgWeb.Ok)
        {
            return null;
        }

        var fim = buffer.IndexOf((byte)0);
        if (fim <= 0)
        {
            return null;
        }

        var texto = Encoding.Latin1.GetString(buffer[..fim]);
        return string.IsNullOrWhiteSpace(texto) ? null : texto;
    }

    private static string? LerTexto(IBibliotecaPgWeb biblioteca, ushort informacao)
    {
        Span<byte> buffer = stackalloc byte[256];
        var codigo = biblioteca.LerResultado((short)informacao, buffer);
        if (codigo != CodigosPgWeb.Ok)
        {
            return null;
        }

        var fim = buffer.IndexOf((byte)0);
        if (fim <= 0)
        {
            return null;
        }

        var texto = Encoding.Latin1.GetString(buffer[..fim]).Trim();
        return string.IsNullOrWhiteSpace(texto) ? null : texto;
    }

    private static ResultadoMotor Recusa(short codigo, string situacao, string? identificador, string mensagem)
    {
        return new ResultadoMotor(false, false, false, codigo, situacao, identificador, null, mensagem);
    }

    private readonly record struct EvidenciaAmbiente(bool RecusaAlteracao, short? AmbienteGravado);

    private readonly record struct MarcaLogAmbiente(string? Arquivo, long Tamanho)
    {
        public static MarcaLogAmbiente Vazia => new(null, 0);

        public static MarcaLogAmbiente Criar(string diretorio)
        {
            var recente = MaisRecente(diretorio);
            return recente is null ? Vazia : new MarcaLogAmbiente(recente.FullName, recente.Length);
        }

        public static EvidenciaAmbiente Ler(string diretorio, MarcaLogAmbiente marca)
        {
            var pasta = Path.Combine(diretorio, "Log");
            if (!Directory.Exists(pasta))
            {
                return new EvidenciaAmbiente(false, null);
            }

            short? ambiente = null;
            foreach (var arquivo in Directory.GetFiles(pasta, "comms_*.log").OrderBy(Path.GetFileName, StringComparer.OrdinalIgnoreCase))
            {
                foreach (var linha in LerLinhas(arquivo, 0))
                {
                    if (linha.Contains("*** AMBIENTE ALTERADO: [TESTE] ***", StringComparison.Ordinal))
                    {
                        ambiente = CodigosPgWeb.AmbienteTeste;
                    }
                    else if (linha.Contains("*** AMBIENTE ALTERADO: [PROD] ***", StringComparison.Ordinal))
                    {
                        ambiente = CodigosPgWeb.AmbienteProducao;
                    }
                }
            }

            var recusa = false;
            foreach (var arquivo in Directory.GetFiles(pasta, "comms_*.log"))
            {
                var inicio = string.Equals(arquivo, marca.Arquivo, StringComparison.OrdinalIgnoreCase) ? marca.Tamanho : 0;
                if (marca.Arquivo is not null && inicio == 0 && !string.Equals(arquivo, marca.Arquivo, StringComparison.OrdinalIgnoreCase))
                {
                    var marcado = new FileInfo(marca.Arquivo);
                    var atual = new FileInfo(arquivo);
                    if (atual.LastWriteTimeUtc < marcado.LastWriteTimeUtc)
                    {
                        continue;
                    }
                }

                foreach (var linha in LerLinhas(arquivo, inicio))
                {
                    if (linha.Contains("[PW_iSetEnvironment] TENTATIVA DE ALTERAR AMBIENTE COM O TERMINAL INSTALADO", StringComparison.Ordinal))
                    {
                        recusa = true;
                    }
                }
            }

            return new EvidenciaAmbiente(recusa, ambiente);
        }

        private static FileInfo? MaisRecente(string diretorio)
        {
            var pasta = Path.Combine(diretorio, "Log");
            if (!Directory.Exists(pasta))
            {
                return null;
            }

            return new DirectoryInfo(pasta)
                .GetFiles("comms_*.log")
                .OrderByDescending(arquivo => arquivo.LastWriteTimeUtc)
                .ThenByDescending(arquivo => arquivo.Name, StringComparer.OrdinalIgnoreCase)
                .FirstOrDefault();
        }

        private static IEnumerable<string> LerLinhas(string arquivo, long inicio)
        {
            using var fluxo = new FileStream(arquivo, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            if (inicio > fluxo.Length)
            {
                inicio = fluxo.Length;
            }

            fluxo.Position = inicio;
            using var leitor = new StreamReader(fluxo, Encoding.Latin1);
            while (leitor.ReadLine() is string linha)
            {
                yield return linha;
            }
        }
    }
}
