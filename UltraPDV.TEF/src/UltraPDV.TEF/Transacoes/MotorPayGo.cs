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

public interface ICapturaOperador
{
    bool TentarResponder(PwGetData pedido, out string valor);

    void DefinirAviso(string? aviso) { }
}

public sealed class MotorPayGo
{
    private readonly RepositorioJournal _journals;
    private readonly CoordenadorSessao _sessoes;
    private bool _destinoTcpIpInformado;
    private bool _producao;
    private string _destinoTcpIpEnviado = "";
    private string _enderecoEsperado = "";

    public MotorPayGo(RepositorioJournal journals, CoordenadorSessao sessoes)
    {
        _journals = journals;
        _sessoes = sessoes;
    }

    public ResultadoMotor Vender(PedidoVenda pedido, IBibliotecaPgWeb biblioteca, ICapturaOperador? captura)
    {
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

    public ResultadoMotor Cancelar(PedidoVenda pedido, IBibliotecaPgWeb biblioteca, ICapturaOperador? captura)
    {
        if (pedido.Contexto.Ambiente == CodigosPgWeb.AmbienteProducao)
        {
            return Recusa(CodigosPgWeb.InvCall, "cancelamento_bloqueado", null, "O cancelamento de produção não foi iniciado.");
        }

        return ExecutarOperacao(pedido, OperacaoPgWeb.CancelamentoVenda, biblioteca, captura, incluirValor: true);
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

    public (string Codigo, string Mensagem, Guid? VendaId) Consultar(ContextoEmpresa contexto, string? chave, int? valorCentavos)
    {
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
                ? "Ponto de homologação instalado."
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

        if (pedido.Modalidade == InformacaoPgWeb.Debito && pedido.Parcelas != 1)
        {
            return Recusa(CodigosPgWeb.InvParam, "parcelamento_recusado", null, "Débito não aceita parcelamento.");
        }

        if (biblioteca.EhNativa && !biblioteca.OperacaoFinanceiraAutorizada)
        {
            var operacaoLocal = operacao is OperacaoPgWeb.Instalacao or OperacaoPgWeb.Configuracao;
            if (!operacaoLocal || !biblioteca.InstalacaoProducaoAutorizada)
            {
                return Recusa(CodigosPgWeb.InvCall, "autorizacao_ausente", null, "A operação financeira não foi autorizada.");
            }
        }

        _destinoTcpIpInformado = false;
        _destinoTcpIpEnviado = "";
        _producao = pedido.Contexto.Ambiente == CodigosPgWeb.AmbienteProducao;
        _enderecoEsperado = pedido.EnderecoComercial?.Trim() ?? "";
        EncerrarInstalacoesAbandonadas(pedido.Contexto.EmpresaId, pedido.Contexto.TerminalId);
        if (_journals.Pendencias(pedido.Contexto.EmpresaId, pedido.Contexto.TerminalId).Count > 0)
        {
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

        var ambiente = AplicarAmbienteSePendente(pedido.Contexto.EmpresaId, pedido.Contexto.TerminalId, biblioteca, pedido.Contexto.Ambiente);
        if (ambiente != CodigosPgWeb.Ok)
        {
            return Falha(emCurso, biblioteca, ambiente, "ambiente_recusado", pedido);
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

        for (var passo = 0; passo < 40; passo++)
        {
            var capturas = new PwGetData[9];
            short quantidade = 9;
            var execucao = biblioteca.Executar(capturas, ref quantidade);
            if (execucao is CodigosPgWeb.Nothing or CodigosPgWeb.Display)
            {
                continue;
            }

            if (execucao == CodigosPgWeb.MoreData)
            {
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
                        biblioteca.AbortarPinPad();
                        _journals.Atualizar(emCurso with { Status = "interrompida", AtualizadoEm = DateTimeOffset.UtcNow });
                        _sessoes.Encerrar(pedido.Contexto.EmpresaId);
                        return new ResultadoMotor(false, false, false, capturaCodigo, "interrompida", emCurso.Identificador, null, "O operador interrompeu a captura. Nenhuma confirmação foi enviada.");
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
                return ConcluirExecucao(emCurso, biblioteca, pedido, operacao);
            }

            var desconhecido = execucao is CodigosPgWeb.PpComErr or CodigosPgWeb.Timeout or CodigosPgWeb.FromHost or CodigosPgWeb.FromHostPendTrn;
            return Falha(emCurso, biblioteca, execucao, desconhecido ? "resultado_desconhecido" : "execucao_recusada", pedido);
        }

        return Falha(emCurso, biblioteca, CodigosPgWeb.Timeout, "resultado_desconhecido", pedido);
    }

    private short AplicarAmbienteSePendente(Guid empresaId, Guid terminalId, IBibliotecaPgWeb biblioteca, short ambiente)
    {
        var instalado = _journals.Listar(empresaId, terminalId).Any(journal => journal.Status == "instalada");
        if (instalado)
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

        return "configuracao";
    }

    private static IEnumerable<(ushort Identificador, string Valor)> ParametrosIniciais(byte operacao)
    {
        yield return (InformacaoPgWeb.Moeda, "986");
        yield return (InformacaoPgWeb.NomeAutomacao, "UltraPDV");
        yield return (InformacaoPgWeb.VersaoAutomacao, "1.3.41");
        yield return (InformacaoPgWeb.DesenvolvedorAutomacao, "UltraPDV");
        yield return (InformacaoPgWeb.CapacidadeAutomacao, "4");
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
        }

        if (operacao == OperacaoPgWeb.Configuracao)
        {
            return ConcluirConfiguracao(atualizado, biblioteca, pedido, exigida, mensagem);
        }

        if (operacao == OperacaoPgWeb.Instalacao)
        {
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
                return ContinuarPinPad(biblioteca, biblioteca.LerCartao(indice));
            case TipoDadoPgWeb.ChipOffline:
                return ContinuarPinPad(biblioteca, biblioteca.ProcessarChipOffline(indice));
            case TipoDadoPgWeb.ChipOnline:
                return ContinuarPinPad(biblioteca, biblioteca.FinalizarChip(indice));
            case TipoDadoPgWeb.ConfirmacaoPinPad:
                return ContinuarPinPad(biblioteca, biblioteca.ConfirmarDadoPinPad(indice));
            case TipoDadoPgWeb.ConfirmacaoPositiva:
                return ContinuarPinPad(biblioteca, biblioteca.ConfirmacaoPositivaPinPad(indice));
            case TipoDadoPgWeb.ComandoPinPad:
                return ContinuarPinPad(biblioteca, biblioteca.ComandoPinPad(indice));
            case TipoDadoPgWeb.SenhaPinPad:
                return ContinuarPinPad(biblioteca, biblioteca.LerSenhaPinPad(indice));
            case TipoDadoPgWeb.DigitacaoPinPad:
                return ContinuarPinPad(biblioteca, biblioteca.LerDadoPinPad(indice));
            case TipoDadoPgWeb.RemocaoCartao:
                return ContinuarPinPad(biblioteca, biblioteca.RemoverCartao());
            case TipoDadoPgWeb.Menu:
                var opcoes = TextoCaptura.OpcoesValidas(ref pedido);
                if (opcoes.Count == 1)
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
            case TipoDadoPgWeb.QrCodeCheckout:
                if (captura is not null && !captura.TentarResponder(pedido, out _))
                {
                    return CodigosPgWeb.Cancel;
                }

                return biblioteca.AdicionarParametro(pedido.Identificador, "");
            default:
                return CodigosPgWeb.InvParam;
        }
    }

    private static short ContinuarPinPad(IBibliotecaPgWeb biblioteca, short inicio)
    {
        if (inicio != CodigosPgWeb.Ok)
        {
            return inicio;
        }

        var display = new byte[128];
        for (var sonda = 0; sonda < 450; sonda++)
        {
            var codigo = biblioteca.LoopPinPad(display);
            if (codigo is CodigosPgWeb.Nothing or CodigosPgWeb.Display)
            {
                Thread.Sleep(200);
                continue;
            }

            return codigo;
        }

        return CodigosPgWeb.Timeout;
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

    private short ResponderDigitacao(IBibliotecaPgWeb biblioteca, ICapturaOperador? captura, PwGetData pedido)
    {
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

            return biblioteca.AdicionarParametro(pedido.Identificador, valor);
        }

        return CodigosPgWeb.Cancel;
    }

    private static short Adicionar(IBibliotecaPgWeb biblioteca, ushort identificador, string valor)
    {
        return biblioteca.AdicionarParametro(identificador, valor);
    }

    private ResultadoMotor Falha(JournalOperacao journal, IBibliotecaPgWeb biblioteca, short codigo, string situacao, PedidoVenda pedido)
    {
        var status = situacao == "resultado_desconhecido" ? "resultado_desconhecido" : "recusada";
        _journals.Atualizar(journal with { Status = status, AtualizadoEm = DateTimeOffset.UtcNow, PagamentoRecebido = false, ConfirmacaoChamada = false });
        if (situacao == "resultado_desconhecido")
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
        if (codigo == CodigosPgWeb.ConfigRequired && !_destinoTcpIpInformado)
        {
            mensagem += " A biblioteca reutilizou o endereço já gravado e não solicitou PWINFO_DESTTCPIP. O retorno final é PWRET_CONFIGREQUIRED. A troca desse endereço é PWOPER_CONFIG, somente quando essa operação for iniciada manualmente.";
        }
        else if (codigo == CodigosPgWeb.ConfigRequired)
        {
            mensagem += " O valor de PWINFO_DESTTCPIP foi enviado. Esse campo único precisa estar em host:porta. A biblioteca não abriu outro campo de porta.";
        }
        return new ResultadoMotor(false, false, false, codigo, situacao, journal.Identificador, null, mensagem);
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

    private static string? LerTexto(IBibliotecaPgWeb biblioteca, ushort informacao)
    {
        Span<byte> buffer = stackalloc byte[256];
        var codigo = biblioteca.LerResultado((short)informacao, buffer);
        if (codigo != CodigosPgWeb.Ok)
        {
            return null;
        }

        var texto = Encoding.ASCII.GetString(buffer);
        var fim = texto.IndexOf('\0');
        return (fim >= 0 ? texto[..fim] : texto).Trim();
    }

    private static ResultadoMotor Recusa(short codigo, string situacao, string? identificador, string mensagem)
    {
        return new ResultadoMotor(false, false, false, codigo, situacao, identificador, null, mensagem);
    }
}
