using System.Text;
using UltraPDV.TEF.Interop;
using UltraPDV.TEF.Nucleo;
using UltraPDV.TEF.Persistencia;
using UltraPDV.TEF.Transacoes;

namespace UltraPDV.TEF.Tests;

public class FluxoPayGoTests : IDisposable
{
    private readonly string _raiz = Path.Combine(Path.GetTempPath(), "ultrapdv-tef-fluxo", Guid.NewGuid().ToString("N"));
    private readonly Guid _empresaA = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private readonly Guid _empresaB = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private readonly Guid _terminalA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private readonly Guid _terminalB = Guid.Parse("22222222-2222-2222-2222-222222222222");

    [Fact]
    public void Credito_aguarda_confirmacao_e_simulacao_nao_recebe_pagamento()
    {
        var biblioteca = BibliotecaDeVenda();
        var motor = CriarMotor();
        var resultado = motor.Vender(Pedido(_empresaA, _terminalA, "credito-1", InformacaoPgWeb.Credito, 3), biblioteca, new CapturaFixa("3"));

        Assert.False(resultado.PagamentoRecebido);
        Assert.False(resultado.ConfirmacaoChamada);
        Assert.Equal("aguardando_confirmacao", resultado.Situacao);
        Assert.Contains(biblioteca.Chamadas, chamada => chamada.StartsWith("PW_iNewTransac", StringComparison.Ordinal));
        Assert.DoesNotContain("PW_iConfirmation", biblioteca.Chamadas);

        var confirmacao = motor.Confirmar(new PedidoConfirmacao(Contexto(_empresaA, _terminalA), "credito-1", ConfirmacaoPgWeb.Automatica), biblioteca);
        Assert.False(confirmacao.PagamentoRecebido);
        Assert.True(confirmacao.ConfirmacaoChamada);
        Assert.Equal("ext-a", biblioteca.ReferenciaExternaConfirmada);
        Assert.NotEqual(biblioteca.ReferenciaLocalConfirmada, biblioteca.ReferenciaExternaConfirmada);
    }

    [Fact]
    public void Debito_recusa_parcelamento_sem_abrir_transacao()
    {
        var biblioteca = BibliotecaDeVenda();
        var resultado = CriarMotor().Vender(Pedido(_empresaA, _terminalA, "debito-parcelas", InformacaoPgWeb.Debito, 3), biblioteca, null);

        Assert.Equal("parcelamento_recusado", resultado.Situacao);
        Assert.False(resultado.PagamentoRecebido);
        Assert.DoesNotContain(biblioteca.Chamadas, chamada => chamada.StartsWith("PW_iNewTransac", StringComparison.Ordinal));
    }

    [Fact]
    public void PinPad_e_acionado_sem_marcar_pagamento()
    {
        var biblioteca = BibliotecaDeVenda();
        biblioteca.TipoCaptura = TipoDadoPgWeb.Cartao;
        var resultado = CriarMotor().Vender(Pedido(_empresaA, _terminalA, "pinpad-1", InformacaoPgWeb.Debito, 1), biblioteca, new CapturaFixa("1"));

        Assert.False(resultado.PagamentoRecebido);
        Assert.Contains("PW_iPPGetCard", biblioteca.Chamadas);
        Assert.Contains("PW_iPPEventLoop", biblioteca.Chamadas);
        Assert.DoesNotContain("PW_iConfirmation", biblioteca.Chamadas);
    }

    [Fact]
    public void Falha_de_comunicacao_nao_repete_a_cobranca()
    {
        var biblioteca = BibliotecaDeVenda();
        biblioteca.ProximaExecucao = CodigosPgWeb.PpComErr;
        var motor = CriarMotor();
        var primeira = motor.Vender(Pedido(_empresaA, _terminalA, "falha-1", InformacaoPgWeb.Credito, 1), biblioteca, null);
        var segunda = motor.Vender(Pedido(_empresaA, _terminalA, "falha-2", InformacaoPgWeb.Credito, 1), biblioteca, null);

        Assert.Equal("resultado_desconhecido", primeira.Situacao);
        Assert.False(primeira.PagamentoRecebido);
        Assert.Equal("pendencia_anterior", segunda.Situacao);
        Assert.Equal(1, biblioteca.Chamadas.Count(chamada => chamada.StartsWith("PW_iNewTransac", StringComparison.Ordinal)));
    }

    [Fact]
    public void Consulta_le_o_ponto_e_a_venda_confirmada_sem_biblioteca()
    {
        var journals = new RepositorioJournal(_raiz);
        journals.Gravar(new JournalOperacao(_empresaA, _terminalA, null, "ponto", "instala", "instalada", 0, false, false, DateTimeOffset.UtcNow, Operacao: "instalacao"));
        journals.Gravar(new JournalOperacao(_empresaA, _terminalA, null, "venda", "debito-1", "confirmada", 100, true, true, DateTimeOffset.UtcNow, Operacao: "venda"));
        var motor = new MotorPayGo(journals, new CoordenadorSessao());

        var situacao = motor.Consultar(Contexto(_empresaA, _terminalA), null, null);
        var confirmada = motor.Consultar(Contexto(_empresaA, _terminalA), "debito-1", 100);
        var divergente = motor.Consultar(Contexto(_empresaA, _terminalA), "debito-1", 200);

        Assert.Equal("ponto_instalado", situacao.Codigo);
        Assert.Contains("sem venda", situacao.Mensagem);
        Assert.Equal("venda_confirmada", confirmada.Codigo);
        Assert.Equal("venda_nao_confirmada", divergente.Codigo);
    }

    [Fact]
    public void Confirmacao_encerrada_nao_bloqueia_e_pendencia_nao_abre_outra_transacao()
    {
        var journals = new RepositorioJournal(_raiz);
        journals.Gravar(new JournalOperacao(_empresaA, _terminalA, null, "venda", "debito-confirmado", "confirmada", 100, true, true, DateTimeOffset.UtcNow, Operacao: "venda"));
        var biblioteca = BibliotecaDeVenda();
        var producao = Contexto(_empresaA, _terminalA) with { Ambiente = CodigosPgWeb.AmbienteProducao, Servidor = "producao" };
        var motor = new MotorPayGo(journals, new CoordenadorSessao());

        var nova = motor.Vender(Pedido(_empresaA, _terminalA, "credito-novo", InformacaoPgWeb.Credito, 1) with { Contexto = producao }, biblioteca, null);
        var durantePendencia = motor.Vender(Pedido(_empresaA, _terminalA, "debito-novo", InformacaoPgWeb.Debito, 1) with { Contexto = producao }, biblioteca, null);
        var vendaId = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc");
        var vinculo = motor.VincularVenda(_empresaA, _terminalA, "debito-confirmado", vendaId, 100);
        var repetido = motor.VincularVenda(_empresaA, _terminalA, "debito-confirmado", vendaId, 100);
        var outraEmpresa = motor.VincularVenda(_empresaB, _terminalB, "debito-confirmado", vendaId, 100);
        var reutilizacao = motor.Consultar(producao, "debito-confirmado", 100);

        Assert.Equal("aguardando_confirmacao", nova.Situacao);
        Assert.Equal("pendencia_anterior", durantePendencia.Situacao);
        Assert.Equal(1, biblioteca.Chamadas.Count(chamada => chamada.StartsWith("PW_iNewTransac", StringComparison.Ordinal)));
        Assert.DoesNotContain("PW_iConfirmation", biblioteca.Chamadas);
        Assert.Equal("vinculada", vinculo.Situacao);
        Assert.Equal("vinculada", repetido.Situacao);
        Assert.Equal("journal_ausente", outraEmpresa.Situacao);
        Assert.Equal("venda_vinculada", reutilizacao.Codigo);
        Assert.Equal(vendaId, reutilizacao.VendaId);
    }

    [Fact]
    public void Ponto_instalado_nao_recebe_nova_troca_de_ambiente()
    {
        var journals = new RepositorioJournal(_raiz);
        journals.Gravar(new JournalOperacao(_empresaA, _terminalA, null, "ponto", "instalacao-pronta", "instalada", 0, false, false, DateTimeOffset.UtcNow, Operacao: "instalacao"));
        var biblioteca = BibliotecaDeVenda();
        var resultado = new MotorPayGo(journals, new CoordenadorSessao()).Vender(Pedido(_empresaA, _terminalA, "credito-instalado", InformacaoPgWeb.Credito, 1), biblioteca, null);

        Assert.Equal("aguardando_confirmacao", resultado.Situacao);
        Assert.False(resultado.PagamentoRecebido);
        Assert.DoesNotContain(biblioteca.Chamadas, chamada => chamada.StartsWith("PW_iSetEnvironment", StringComparison.Ordinal));
        Assert.Contains(biblioteca.Chamadas, chamada => chamada.StartsWith("PW_iNewTransac", StringComparison.Ordinal));
    }

    [Fact]
    public void Instalacao_abandonada_nao_bloqueia_nova_instalacao_nem_vira_pagamento()
    {
        var journals = new RepositorioJournal(_raiz);
        journals.Gravar(new JournalOperacao(_empresaA, _terminalA, null, "instalacao-antiga", "chave-antiga", "executando", 0, false, false, DateTimeOffset.UtcNow));
        var biblioteca = BibliotecaDeVenda();
        var resultado = new MotorPayGo(journals, new CoordenadorSessao()).Instalar(Pedido(_empresaA, _terminalA, "instala-nova", "", 1), biblioteca, new CapturaFixa("1"));

        Assert.NotEqual("pendencia_anterior", resultado.Situacao);
        Assert.False(resultado.PagamentoRecebido);
        Assert.Equal("interrompida", journals.Buscar(_empresaA, _terminalA, "chave-antiga")?.Status);
        Assert.Contains(biblioteca.Chamadas, chamada => chamada.StartsWith("PW_iNewTransac", StringComparison.Ordinal));
    }

    [Fact]
    public void Journal_interrompido_bloqueia_nova_cobranca_depois_de_recriar_o_motor()
    {
        var journals = new RepositorioJournal(_raiz);
        journals.Gravar(new JournalOperacao(_empresaA, _terminalA, null, "antigo", "chave-interrompida", "executando", 100, false, false, DateTimeOffset.UtcNow));
        var biblioteca = BibliotecaDeVenda();
        var resultado = new MotorPayGo(journals, new CoordenadorSessao()).Vender(Pedido(_empresaA, _terminalA, "nova", InformacaoPgWeb.Credito, 1), biblioteca, null);

        Assert.Equal("pendencia_anterior", resultado.Situacao);
        Assert.Empty(biblioteca.Chamadas);
        Assert.NotEmpty(new MotorPayGo(journals, new CoordenadorSessao()).Recuperar(Contexto(_empresaA, _terminalA)));
    }

    [Fact]
    public void Pendencia_de_uma_empresa_nao_altera_a_outra()
    {
        var journals = new RepositorioJournal(_raiz);
        journals.Gravar(new JournalOperacao(_empresaA, _terminalA, null, "pend-a", "pend-a", "aguardando_confirmacao", 100, false, false, DateTimeOffset.UtcNow));
        var biblioteca = BibliotecaDeVenda();
        var resultado = new MotorPayGo(journals, new CoordenadorSessao()).Vender(Pedido(_empresaB, _terminalB, "venda-b", InformacaoPgWeb.Debito, 1), biblioteca, null);

        Assert.NotEqual("pendencia_anterior", resultado.Situacao);
        Assert.False(resultado.PagamentoRecebido);
        Assert.Empty(journals.Listar(_empresaB, _terminalA));
        Assert.Single(journals.Listar(_empresaA, _terminalA));
    }

    [Fact]
    public void Biblioteca_nativa_sem_autorizacao_nao_abre_venda()
    {
        var nativa = new BibliotecaNativaPgWeb();
        var resultado = CriarMotor().Vender(Pedido(_empresaA, _terminalA, "nativa-1", InformacaoPgWeb.Credito, 1), nativa, null);

        Assert.Equal("autorizacao_ausente", resultado.Situacao);
        Assert.False(resultado.PagamentoRecebido);
        Assert.Empty(nativa.Chamadas);
    }

    [Fact]
    public void Menu_com_uma_opcao_segue_sem_perguntar_de_novo()
    {
        var biblioteca = BibliotecaDeVenda();
        biblioteca.TipoCaptura = TipoDadoPgWeb.Menu;
        biblioteca.ValorMenuUnico = "2";
        var resultado = CriarMotor().Vender(Pedido(_empresaA, _terminalA, "menu-1", InformacaoPgWeb.Credito, 1), biblioteca, new CapturaFixa("nao-usar"));

        Assert.Equal("aguardando_confirmacao", resultado.Situacao);
        Assert.False(resultado.PagamentoRecebido);
        Assert.Equal("2", biblioteca.UltimoValor);
    }

    [Fact]
    public void Menu_com_opcao_vazia_escolhe_a_unica_valida_no_identificador_nativo()
    {
        var biblioteca = BibliotecaDeVenda();
        biblioteca.TipoCaptura = TipoDadoPgWeb.Menu;
        biblioteca.IdentificadorCaptura = InformacaoPgWeb.TipoFinanciamento;
        biblioteca.ValoresMenu = ["01", "", ""];
        var resultado = CriarMotor().Vender(Pedido(_empresaA, _terminalA, "menu-financiamento", InformacaoPgWeb.Debito, 1), biblioteca, new CapturaQueRecusa());

        Assert.Equal("aguardando_confirmacao", resultado.Situacao);
        Assert.False(resultado.PagamentoRecebido);
        Assert.Equal(InformacaoPgWeb.TipoFinanciamento, biblioteca.UltimoIdentificador);
        Assert.Equal("01", biblioteca.UltimoValor);
        Assert.Equal(1, biblioteca.Chamadas.Count(chamada => chamada.StartsWith("PW_iNewTransac", StringComparison.Ordinal)));
        Assert.DoesNotContain("PW_iConfirmation", biblioteca.Chamadas);
    }

    [Fact]
    public void Menu_com_varias_opcoes_rejeita_indice_e_aceita_o_valor_nativo()
    {
        var biblioteca = BibliotecaDeVenda();
        biblioteca.TipoCaptura = TipoDadoPgWeb.Menu;
        biblioteca.IdentificadorCaptura = InformacaoPgWeb.TipoFinanciamento;
        biblioteca.ValoresMenu = ["01", "02"];
        var recusa = CriarMotor().Vender(Pedido(_empresaA, _terminalA, "menu-indice", InformacaoPgWeb.Credito, 1), biblioteca, new CapturaFixa("1"));

        Assert.NotEqual("aguardando_confirmacao", recusa.Situacao);
        Assert.False(recusa.PagamentoRecebido);
        Assert.DoesNotContain("PW_iConfirmation", biblioteca.Chamadas);

        var seguinte = BibliotecaDeVenda();
        seguinte.TipoCaptura = TipoDadoPgWeb.Menu;
        seguinte.IdentificadorCaptura = InformacaoPgWeb.TipoFinanciamento;
        seguinte.ValoresMenu = ["01", "02"];
        var aceite = CriarMotor().Vender(Pedido(_empresaA, _terminalA, "menu-valor", InformacaoPgWeb.Credito, 1), seguinte, new CapturaFixa("02"));

        Assert.Equal("aguardando_confirmacao", aceite.Situacao);
        Assert.False(aceite.PagamentoRecebido);
        Assert.Equal(InformacaoPgWeb.TipoFinanciamento, seguinte.UltimoIdentificador);
        Assert.Equal("02", seguinte.UltimoValor);
        Assert.Equal(1, seguinte.Chamadas.Count(chamada => chamada.StartsWith("PW_iNewTransac", StringComparison.Ordinal)));
    }

    [Fact]
    public void Display_e_moredata_nao_recebem_pagamento_nem_abrem_outra_transacao()
    {
        var biblioteca = BibliotecaDeVenda();
        biblioteca.Roteiro = new Queue<short>([CodigosPgWeb.Display, CodigosPgWeb.MoreData, CodigosPgWeb.Ok]);
        biblioteca.TipoCaptura = TipoDadoPgWeb.Menu;
        biblioteca.IdentificadorCaptura = InformacaoPgWeb.TipoFinanciamento;
        biblioteca.ValorMenuUnico = "01";
        var resultado = CriarMotor().Vender(Pedido(_empresaA, _terminalA, "menu-ciclo", InformacaoPgWeb.Debito, 1), biblioteca, new CapturaQueRecusa());

        Assert.Equal("aguardando_confirmacao", resultado.Situacao);
        Assert.False(resultado.PagamentoRecebido);
        Assert.Equal("01", biblioteca.UltimoValor);
        Assert.Equal(InformacaoPgWeb.TipoFinanciamento, biblioteca.UltimoIdentificador);
        Assert.Equal(1, biblioteca.Chamadas.Count(chamada => chamada.StartsWith("PW_iNewTransac", StringComparison.Ordinal)));
        Assert.DoesNotContain("PW_iConfirmation", biblioteca.Chamadas);
    }

    [Fact]
    public void Retomada_devolve_somente_a_confirmacao_pendente()
    {
        var journals = new RepositorioJournal(_raiz);
        journals.Gravar(new JournalOperacao(_empresaA, _terminalA, null, "venda", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:debito:100", "aguardando_confirmacao", 100, false, false, DateTimeOffset.UtcNow, Operacao: "venda"));
        journals.Gravar(new JournalOperacao(_empresaA, _terminalA, null, "antiga", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb:debito:100", "confirmada", 100, true, true, DateTimeOffset.UtcNow, Operacao: "venda"));
        var motor = new MotorPayGo(journals, new CoordenadorSessao());

        var retomada = motor.PendenciaParaRetomada(Contexto(_empresaA, _terminalA));
        var situacao = motor.Consultar(Contexto(_empresaA, _terminalA), null, null);

        Assert.Equal("aguardando_confirmacao", retomada.Pendencia);
        Assert.Equal("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:debito:100", retomada.Chave);
        Assert.Equal("ponto_nao_instalado", situacao.Codigo);
        Assert.Contains("aguardando confirmação", situacao.Mensagem);
    }

    [Fact]
    public void Instalacao_responde_pinpad_sem_perguntar_e_nao_recebe_pagamento()
    {
        var biblioteca = BibliotecaDeVenda();
        biblioteca.TipoCaptura = TipoDadoPgWeb.Digitado;
        biblioteca.IdentificadorCaptura = InformacaoPgWeb.UsaPinPad;
        var resultado = CriarMotor().Instalar(Pedido(_empresaA, _terminalA, "instala-1", "", 1), biblioteca, new CapturaQueRecusa());

        Assert.Equal("simulacao_nao_e_instalacao", resultado.Situacao);
        Assert.False(resultado.PagamentoRecebido);
        Assert.False(resultado.ConfirmacaoChamada);
        Assert.Equal("1", biblioteca.UltimoValor);
    }

    [Fact]
    public void Display_nao_encerra_a_transacao_antes_da_proxima_execucao()
    {
        var biblioteca = BibliotecaDeVenda();
        biblioteca.Roteiro = new Queue<short>(new[] { CodigosPgWeb.Display, CodigosPgWeb.Ok });
        var resultado = CriarMotor().Vender(Pedido(_empresaA, _terminalA, "display-1", InformacaoPgWeb.Credito, 1), biblioteca, null);

        Assert.Equal("aguardando_confirmacao", resultado.Situacao);
        Assert.False(resultado.PagamentoRecebido);
        Assert.Equal(2, biblioteca.Chamadas.Count(chamada => chamada == "PW_iExecTransac"));
    }

    [Fact]
    public void Erro_da_biblioteca_informa_o_codigo_sem_receber_pagamento()
    {
        var biblioteca = BibliotecaDeVenda();
        biblioteca.Roteiro = new Queue<short>(new[] { CodigosPgWeb.InvParam });
        var resultado = CriarMotor().Vender(Pedido(_empresaA, _terminalA, "erro-1", InformacaoPgWeb.Credito, 1), biblioteca, null);

        Assert.Equal("execucao_recusada", resultado.Situacao);
        Assert.False(resultado.PagamentoRecebido);
        Assert.Contains("-2499", resultado.Mensagem);
    }

    [Fact]
    public void Venda_guarda_os_dados_fiscais_lidos_na_mesma_sessao()
    {
        var biblioteca = BibliotecaDeVenda();
        biblioteca.Resultados[InformacaoPgWeb.CodigoAutorizacao] = "A1B2C3";
        biblioteca.Resultados[InformacaoPgWeb.NomeCartaoPadrao] = "Maestro";
        biblioteca.Resultados[InformacaoPgWeb.CnpjEntidadePagamento] = "01.027.058/0001-91";
        biblioteca.Resultados[InformacaoPgWeb.CnpjRecebedor] = "11222333000181";
        biblioteca.Resultados[InformacaoPgWeb.NomeEntidadePagamento] = "PRODUTO";
        var motor = CriarMotor();
        var resultado = motor.Vender(Pedido(_empresaA, _terminalA, "fiscal-1", InformacaoPgWeb.Debito, 1), biblioteca, null);

        Assert.False(resultado.PagamentoRecebido);
        Assert.Equal("aguardando_confirmacao", resultado.Situacao);
        Assert.DoesNotContain("PW_iConfirmation", biblioteca.Chamadas);
        Assert.Equal(1, biblioteca.Chamadas.Count(chamada => chamada.StartsWith("PW_iNewTransac", StringComparison.Ordinal)));

        var fiscal = motor.DadosFiscais(Contexto(_empresaA, _terminalA), "fiscal-1");
        Assert.NotNull(fiscal);
        Assert.Equal("A1B2C3", fiscal.Autorizacao);
        Assert.Equal("Maestro", fiscal.BandeiraNome);
        Assert.Equal("auth-a", fiscal.Rede);
        Assert.Equal("PRODUTO", fiscal.Instituicao);
        Assert.Equal("01027058000191", fiscal.CnpjCredenciadora);
        Assert.Equal("11222333000181", fiscal.CnpjRecebedor);
        Assert.NotEqual("req-a", fiscal.Autorizacao);
    }

    [Fact]
    public void Referencia_de_confirmacao_e_nome_da_rede_nao_viram_dado_fiscal()
    {
        var biblioteca = BibliotecaDeVenda();
        biblioteca.Resultados[InformacaoPgWeb.CodigoAutorizacao] = "req-a";
        biblioteca.Resultados[InformacaoPgWeb.NomeCartaoPadrao] = "auth-a";
        biblioteca.Resultados[InformacaoPgWeb.NomeCartao] = "4111111111111111";
        var motor = CriarMotor();
        motor.Vender(Pedido(_empresaA, _terminalA, "fiscal-2", InformacaoPgWeb.Debito, 1), biblioteca, null);

        var fiscal = motor.DadosFiscais(Contexto(_empresaA, _terminalA), "fiscal-2");
        Assert.NotNull(fiscal);
        Assert.Null(fiscal.Autorizacao);
        Assert.Null(fiscal.BandeiraNome);
        Assert.Equal("auth-a", fiscal.Rede);
        Assert.DoesNotContain("PW_iConfirmation", biblioteca.Chamadas);
    }

    private sealed class CapturaQueRecusa : ICapturaOperador
    {
        public bool TentarResponder(PwGetData pedido, out string valor)
        {
            _ = pedido;
            valor = "";
            throw new InvalidOperationException("A instalação não deveria perguntar este dado ao operador.");
        }
    }

    public void Dispose()
    {
        if (Directory.Exists(_raiz))
        {
            Directory.Delete(_raiz, recursive: true);
        }
    }

    private MotorPayGo CriarMotor() => new(new RepositorioJournal(_raiz), new CoordenadorSessao());

    private PedidoVenda Pedido(Guid empresa, Guid terminal, string chave, string modalidade, int parcelas)
    {
        return new PedidoVenda(Contexto(empresa, terminal), Guid.NewGuid(), chave, 100, modalidade, parcelas, "pinpad-" + terminal.ToString("N"));
    }

    private ContextoEmpresa Contexto(Guid empresa, Guid terminal)
    {
        return new ContextoEmpresa("usuario", empresa, terminal, "cnpj-teste", CodigosPgWeb.AmbienteTeste, "ponto-teste", "homologacao.exemplo", Path.Combine(_raiz, empresa.ToString("N"), "Data"));
    }

    private static BibliotecaRoteiro BibliotecaDeVenda()
    {
        return new BibliotecaRoteiro
        {
            Resultados =
            {
                [InformacaoPgWeb.ConfirmacaoRequerida] = "1",
                [InformacaoPgWeb.NumeroRequisicao] = "req-a",
                [InformacaoPgWeb.ReferenciaLocal] = "loc-a",
                [InformacaoPgWeb.ReferenciaExterna] = "ext-a",
                [InformacaoPgWeb.EstabelecimentoVirtual] = "vm-a",
                [InformacaoPgWeb.SistemaAutorizador] = "auth-a",
            },
        };
    }

    private sealed class CapturaFixa : ICapturaOperador
    {
        private readonly string _valor;

        public CapturaFixa(string valor) => _valor = valor;

        public bool TentarResponder(PwGetData pedido, out string valor)
        {
            _ = pedido;
            valor = _valor;
            return true;
        }
    }
}

internal sealed class BibliotecaRoteiro : IBibliotecaPgWeb
{
    private bool _capturaEntregue;

    public bool EhNativa => false;

    public bool OperacaoFinanceiraAutorizada => false;

    public bool InstalacaoProducaoAutorizada => false;

    public List<string> Chamadas { get; } = new();

    public short ProximaExecucao { get; set; } = CodigosPgWeb.Ok;

    public byte TipoCaptura { get; set; }

    public ushort IdentificadorCaptura { get; set; }

    public Queue<short>? Roteiro { get; set; }

    public string? ValorMenuUnico { get; set; }

    public string[]? ValoresMenu { get; set; }

    public string? UltimoValor { get; private set; }

    public ushort UltimoIdentificador { get; private set; }

    public Dictionary<ushort, string> Resultados { get; } = new();

    public string? ReferenciaLocalConfirmada { get; private set; }

    public string? ReferenciaExternaConfirmada { get; private set; }

    public short DefinirAmbiente(short ambiente)
    {
        Chamadas.Add("PW_iSetEnvironment");
        return CodigosPgWeb.Ok;
    }

    public short Inicializar(string diretorioTrabalho)
    {
        Chamadas.Add("PW_iInit");
        return string.IsNullOrWhiteSpace(diretorioTrabalho) ? CodigosPgWeb.InvParam : CodigosPgWeb.Ok;
    }

    public short NovaTransacao(byte operacao)
    {
        Chamadas.Add("PW_iNewTransac:" + operacao.ToString("X2"));
        return CodigosPgWeb.Ok;
    }

    public short AdicionarParametro(ushort identificador, string valor)
    {
        Chamadas.Add("PW_iAddParam");
        UltimoValor = valor;
        UltimoIdentificador = identificador;
        return CodigosPgWeb.Ok;
    }

    public short Executar(PwGetData[] capturas, ref short quantidade)
    {
        Chamadas.Add("PW_iExecTransac");
        if (Roteiro is { Count: > 0 })
        {
            var codigo = Roteiro.Dequeue();
            if (codigo == CodigosPgWeb.MoreData)
            {
                capturas[0].TipoDeDado = TipoCaptura;
                capturas[0].Identificador = IdentificadorCaptura == 0 ? InformacaoPgWeb.TipoCartao : IdentificadorCaptura;
                PreencherMenu(ref capturas[0]);
                quantidade = 1;
            }
            else
            {
                quantidade = 0;
            }

            return codigo;
        }

        if (TipoCaptura != 0 && !_capturaEntregue)
        {
            _capturaEntregue = true;
            capturas[0].TipoDeDado = TipoCaptura;
            capturas[0].Identificador = IdentificadorCaptura == 0 ? InformacaoPgWeb.TipoCartao : IdentificadorCaptura;
            PreencherMenu(ref capturas[0]);
            quantidade = 1;
            return CodigosPgWeb.MoreData;
        }

        quantidade = 0;
        return ProximaExecucao;
    }

    private void PreencherMenu(ref PwGetData captura)
    {
        if (ValoresMenu is { Length: > 0 })
        {
            captura.NumeroOpcoesMenu = (byte)Math.Min(ValoresMenu.Length, PwGetData.CapacidadeMenu);
            for (var indice = 0; indice < captura.NumeroOpcoesMenu; indice++)
            {
                TextoCaptura.EscreverValorMenu(ref captura, indice, ValoresMenu[indice]);
            }

            return;
        }

        if (ValorMenuUnico is not null)
        {
            captura.NumeroOpcoesMenu = 1;
            TextoCaptura.EscreverValorMenu(ref captura, 0, ValorMenuUnico);
        }
    }

    public short LerResultado(short informacao, Span<byte> destino)
    {
        Chamadas.Add("PW_iGetResult");
        if (!Resultados.TryGetValue((ushort)informacao, out var texto))
        {
            return CodigosPgWeb.NoData;
        }

        Encoding.ASCII.GetBytes(texto + "\0").AsSpan(0, Math.Min(destino.Length, texto.Length + 1)).CopyTo(destino);
        return CodigosPgWeb.Ok;
    }

    public short Confirmar(uint status, string numeroRequisicao, string referenciaLocal, string referenciaExterna, string estabelecimentoVirtual, string sistemaAutorizador)
    {
        Chamadas.Add("PW_iConfirmation");
        _ = status;
        _ = numeroRequisicao;
        _ = estabelecimentoVirtual;
        _ = sistemaAutorizador;
        ReferenciaLocalConfirmada = referenciaLocal;
        ReferenciaExternaConfirmada = referenciaExterna;
        return CodigosPgWeb.Ok;
    }

    public short AbortarPinPad() => CodigosPgWeb.Ok;

    public short RemoverCartao() => CodigosPgWeb.Ok;

    public short LerCartao(ushort indice)
    {
        Chamadas.Add("PW_iPPGetCard");
        _ = indice;
        return CodigosPgWeb.Ok;
    }

    public short ProcessarChipOffline(ushort indice) => CodigosPgWeb.Ok;

    public short FinalizarChip(ushort indice) => CodigosPgWeb.Ok;

    public short ConfirmarDadoPinPad(ushort indice) => CodigosPgWeb.Ok;

    public short ConfirmacaoPositivaPinPad(ushort indice) => CodigosPgWeb.Ok;

    public short ComandoPinPad(ushort indice) => CodigosPgWeb.Ok;

    public short LerSenhaPinPad(ushort indice) => CodigosPgWeb.Ok;

    public short LerDadoPinPad(ushort indice) => CodigosPgWeb.Ok;

    public short LoopPinPad(Span<byte> display)
    {
        Chamadas.Add("PW_iPPEventLoop");
        _ = display;
        return CodigosPgWeb.Ok;
    }

    public void Encerrar() => Chamadas.Add("PW_End");
}
