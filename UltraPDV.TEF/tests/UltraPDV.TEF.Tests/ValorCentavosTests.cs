using UltraPDV.TEF.Interop;
using UltraPDV.TEF.Nucleo;
using UltraPDV.TEF.Persistencia;
using UltraPDV.TEF.Transacoes;

namespace UltraPDV.TEF.Tests;

public class ValorCentavosTests : IDisposable
{
    private readonly string _raiz = Path.Combine(Path.GetTempPath(), "ultrapdv-tef-centavos", Guid.NewGuid().ToString("N"));
    private readonly Guid _empresa = Guid.Parse("347878e3-608a-46c4-9f22-7bebb982ff6d");
    private readonly Guid _terminal = Guid.Parse("1a4810cf-c260-4b29-9dc2-09141e0b230d");

    [Theory]
    [InlineData("12345,67", "1234567")]
    [InlineData("12.345,67", "1234567")]
    [InlineData("R$ 12.345,67", "1234567")]
    [InlineData("12345.67", "1234567")]
    [InlineData("12,345.67", "1234567")]
    [InlineData("0,01", "1")]
    [InlineData("0,10", "10")]
    [InlineData("1,00", "100")]
    [InlineData("10,5", "1050")]
    [InlineData("10.50", "1050")]
    [InlineData("2,00", "200")]
    [InlineData("R$ 2,00", "200")]
    [InlineData("0,02", "2")]
    [InlineData("R$ 0,02", "2")]
    [InlineData("200", "200")]
    [InlineData("1234567", "1234567")]
    [InlineData("1.234.567,89", "123456789")]
    [InlineData("12.345", "1234500")]
    [InlineData("999999999999,99", "99999999999999")]
    public void Converte_reais_para_centavos_sem_separador(string entrada, string esperado)
    {
        Assert.True(ValorCentavos.Tentar(entrada, out var centavos));
        Assert.Equal(esperado, centavos);
    }

    [Theory]
    [InlineData("")]
    [InlineData("abc")]
    [InlineData("12,345,67")]
    [InlineData("10,567")]
    [InlineData("-1,00")]
    [InlineData("1.2.3,45")]
    [InlineData("12.34.567")]
    [InlineData(",67")]
    [InlineData("12345,")]
    [InlineData("99999999999999999999,99")]
    public void Entrada_invalida_nao_produz_centavos(string entrada)
    {
        Assert.False(ValorCentavos.Tentar(entrada, out var centavos));
        Assert.Equal("", centavos);
    }

    [Fact]
    public void Cancelamento_envia_0x25_e_0x60_em_centavos()
    {
        var journals = new RepositorioJournal(_raiz);
        journals.Gravar(new JournalOperacao(_empresa, _terminal, null, "ponto", "instala", "instalada", 0, false, false, DateTimeOffset.UtcNow, Operacao: "instalacao"));
        var biblioteca = new BibliotecaRoteiro
        {
            EhNativa = true,
            OperacaoFinanceiraAutorizada = true,
            OperacoesListadas = new List<OperacaoDisponivel> { new(0x22, "CANCELAMENTO", "", "34", false, 0) },
            Sequencia = new Queue<BibliotecaRoteiro.PassoCaptura>(new[]
            {
                new BibliotecaRoteiro.PassoCaptura
                {
                    Tipo = TipoDadoPgWeb.Menu,
                    Identificador = InformacaoPgWeb.LocalInfo2,
                    Valores = new[] { "34" },
                    Textos = new[] { "CANCELAMENTO" },
                },
                new BibliotecaRoteiro.PassoCaptura { Tipo = TipoDadoPgWeb.Digitado, Identificador = InformacaoPgWeb.ValorTotal },
                new BibliotecaRoteiro.PassoCaptura { Tipo = TipoDadoPgWeb.Digitado, Identificador = InformacaoPgWeb.ValorTransacaoOriginal },
            }),
        };
        biblioteca.Resultados[InformacaoPgWeb.ConfirmacaoRequerida] = "0";
        biblioteca.Resultados[InformacaoPgWeb.MensagemResultado] = "VALOR RECEBIDO";
        var captura = new CapturaPorCampo(new Dictionary<ushort, string>
        {
            [InformacaoPgWeb.LocalInfo2] = "34",
            [InformacaoPgWeb.ValorTotal] = "12.345,67",
            [InformacaoPgWeb.ValorTransacaoOriginal] = "12345,67",
        });

        var resultado = new MotorPayGo(journals, new CoordenadorSessao()).Administrar(Pedido("adm:valor-original"), biblioteca, captura);

        Assert.Equal("administrativa", resultado.Situacao);
        Assert.False(resultado.PagamentoRecebido);
        Assert.Contains(biblioteca.Parametros, item => item.Identificador == InformacaoPgWeb.ValorTotal && item.Valor == "1234567");
        Assert.Contains(biblioteca.Parametros, item => item.Identificador == InformacaoPgWeb.ValorTransacaoOriginal && item.Valor == "1234567");
        Assert.DoesNotContain(biblioteca.Parametros, item => (item.Identificador == InformacaoPgWeb.ValorTotal || item.Identificador == InformacaoPgWeb.ValorTransacaoOriginal) && (item.Valor.Contains(',') || item.Valor.Contains('.')));
        Assert.DoesNotContain("PW_iConfirmation", biblioteca.Chamadas);
        Assert.Equal(0, journals.Buscar(_empresa, _terminal, "adm:valor-original")?.ValorCentavos);
    }

    [Fact]
    public void Valor_invalido_nao_e_enviado_em_0x25()
    {
        var journals = new RepositorioJournal(_raiz);
        journals.Gravar(new JournalOperacao(_empresa, _terminal, null, "ponto", "instala", "instalada", 0, false, false, DateTimeOffset.UtcNow, Operacao: "instalacao"));
        var biblioteca = new BibliotecaRoteiro
        {
            EhNativa = true,
            OperacaoFinanceiraAutorizada = true,
            OperacoesListadas = new List<OperacaoDisponivel> { new(0x22, "CANCELAMENTO", "", "34", false, 0) },
            Sequencia = new Queue<BibliotecaRoteiro.PassoCaptura>(new[]
            {
                new BibliotecaRoteiro.PassoCaptura
                {
                    Tipo = TipoDadoPgWeb.Menu,
                    Identificador = InformacaoPgWeb.LocalInfo2,
                    Valores = new[] { "34" },
                    Textos = new[] { "CANCELAMENTO" },
                },
                new BibliotecaRoteiro.PassoCaptura { Tipo = TipoDadoPgWeb.Digitado, Identificador = InformacaoPgWeb.ValorTotal },
            }),
        };
        var captura = new CapturaPorCampo(new Dictionary<ushort, string>
        {
            [InformacaoPgWeb.LocalInfo2] = "34",
            [InformacaoPgWeb.ValorTotal] = "10,567",
        });

        var resultado = new MotorPayGo(journals, new CoordenadorSessao()).Administrar(Pedido("adm:valor-invalido"), biblioteca, captura);

        Assert.Equal("interrompida", resultado.Situacao);
        Assert.False(resultado.PagamentoRecebido);
        Assert.Contains("não foi enviado", captura.Aviso);
        Assert.DoesNotContain(biblioteca.Parametros, item => item.Identificador == InformacaoPgWeb.ValorTotal);
        Assert.DoesNotContain(biblioteca.Parametros, item => item.Valor == "10,567");
    }

    [Fact]
    public void Centavos_ja_convertidos_nao_sao_multiplicados_de_novo()
    {
        Assert.True(ValorCentavos.Tentar("R$ 2,00", out var primeira));
        Assert.Equal("200", primeira);
        Assert.True(ValorCentavos.Tentar(primeira, out var segunda));
        Assert.Equal("200", segunda);
        Assert.True(ValorCentavos.Tentar("0,02", out var dois));
        Assert.Equal("2", dois);
        Assert.True(ValorCentavos.Tentar(dois, out var doisDeNovo));
        Assert.Equal("2", doisDeNovo);
    }

    [Fact]
    public void Cancelamento_administrativo_envia_valor_data_e_referencia_do_journal()
    {
        var journals = new RepositorioJournal(_raiz);
        journals.Gravar(new JournalOperacao(_empresa, _terminal, null, "ponto", "instala-seq", "instalada", 0, false, false, DateTimeOffset.UtcNow, Operacao: "instalacao"));
        var quando = new DateTimeOffset(2026, 11, 18, 13, 52, 0, TimeSpan.FromHours(-4));
        var venda = new JournalOperacao(_empresa, _terminal, Guid.NewGuid(), "venda-original", "venda:52", "confirmada", 200, true, true, quando, "0000000010", "52", Operacao: "venda");
        journals.Gravar(venda);
        var sugestoes = SugestaoVendaOriginal.Montar(venda);
        var biblioteca = BibliotecaAdministrativa(new[]
        {
            new BibliotecaRoteiro.PassoCaptura
            {
                Tipo = TipoDadoPgWeb.Menu,
                Identificador = InformacaoPgWeb.LocalInfo2,
                Valores = new[] { "34" },
                Textos = new[] { "CANCELAMENTO" },
            },
            new BibliotecaRoteiro.PassoCaptura { Tipo = TipoDadoPgWeb.Digitado, Identificador = InformacaoPgWeb.ValorTransacaoOriginal },
            new BibliotecaRoteiro.PassoCaptura { Tipo = TipoDadoPgWeb.Digitado, Identificador = InformacaoPgWeb.DataTransacaoOriginal },
            new BibliotecaRoteiro.PassoCaptura { Tipo = TipoDadoPgWeb.Digitado, Identificador = InformacaoPgWeb.ReferenciaLocalOriginal },
        });
        var captura = new CapturaPorCampo(new Dictionary<ushort, string>
        {
            [InformacaoPgWeb.LocalInfo2] = "34",
            [InformacaoPgWeb.ValorTransacaoOriginal] = sugestoes[InformacaoPgWeb.ValorTransacaoOriginal],
            [InformacaoPgWeb.DataTransacaoOriginal] = sugestoes[InformacaoPgWeb.DataTransacaoOriginal],
            [InformacaoPgWeb.ReferenciaLocalOriginal] = sugestoes[InformacaoPgWeb.ReferenciaLocalOriginal],
        });

        var resultado = new MotorPayGo(journals, new CoordenadorSessao()).Administrar(Pedido("adm:journal-52"), biblioteca, captura);

        Assert.Equal("administrativa", resultado.Situacao);
        Assert.Equal("2,00", captura.Sugestoes[InformacaoPgWeb.ValorTransacaoOriginal]);
        Assert.Equal("18/11/2026", captura.Sugestoes[InformacaoPgWeb.DataTransacaoOriginal]);
        Assert.Equal("52", captura.Sugestoes[InformacaoPgWeb.ReferenciaLocalOriginal]);
        Assert.Equal("52", captura.Vendas[0].Referencia);
        Assert.Equal(200, captura.Vendas[0].ValorCentavos);
        Assert.Contains(biblioteca.Parametros, item => item.Identificador == InformacaoPgWeb.ValorTransacaoOriginal && item.Valor == "200");
        Assert.Contains(biblioteca.Parametros, item => item.Identificador == InformacaoPgWeb.DataTransacaoOriginal && item.Valor == "181126");
        Assert.Contains(biblioteca.Parametros, item => item.Identificador == InformacaoPgWeb.ReferenciaLocalOriginal && item.Valor == "52");
        Assert.DoesNotContain(biblioteca.Parametros, item => item.Identificador == InformacaoPgWeb.ValorTransacaoOriginal && item.Valor == "2");
        Assert.DoesNotContain(biblioteca.Parametros, item => item.Valor is "18112026" or "43060" or "20000");
    }

    [Fact]
    public void Valores_ja_convertidos_e_zeros_da_referencia_chegam_iguais_a_biblioteca()
    {
        var journals = new RepositorioJournal(_raiz);
        journals.Gravar(new JournalOperacao(_empresa, _terminal, null, "ponto", "instala-wire", "instalada", 0, false, false, DateTimeOffset.UtcNow, Operacao: "instalacao"));
        var biblioteca = BibliotecaAdministrativa(new[]
        {
            new BibliotecaRoteiro.PassoCaptura { Tipo = TipoDadoPgWeb.Digitado, Identificador = InformacaoPgWeb.ValorTransacaoOriginal },
            new BibliotecaRoteiro.PassoCaptura { Tipo = TipoDadoPgWeb.Digitado, Identificador = InformacaoPgWeb.DataTransacaoOriginal },
            new BibliotecaRoteiro.PassoCaptura { Tipo = TipoDadoPgWeb.Digitado, Identificador = InformacaoPgWeb.ReferenciaLocalOriginal },
        });
        var captura = new CapturaPorCampo(new Dictionary<ushort, string>
        {
            [InformacaoPgWeb.ValorTransacaoOriginal] = "200",
            [InformacaoPgWeb.DataTransacaoOriginal] = "05/11/2026",
            [InformacaoPgWeb.ReferenciaLocalOriginal] = "00052",
        });

        var resultado = new MotorPayGo(journals, new CoordenadorSessao()).Administrar(Pedido("adm:wire"), biblioteca, captura);

        Assert.Equal("administrativa", resultado.Situacao);
        Assert.Contains(biblioteca.Parametros, item => item.Identificador == InformacaoPgWeb.ValorTransacaoOriginal && item.Valor == "200");
        Assert.Contains(biblioteca.Parametros, item => item.Identificador == InformacaoPgWeb.DataTransacaoOriginal && item.Valor == "051126");
        Assert.Contains(biblioteca.Parametros, item => item.Identificador == InformacaoPgWeb.ReferenciaLocalOriginal && item.Valor == "00052");
        Assert.DoesNotContain(biblioteca.Parametros, item => item.Valor == "20000" || item.Valor == "18112026");
    }

    public void Dispose()
    {
        if (Directory.Exists(_raiz))
        {
            Directory.Delete(_raiz, recursive: true);
        }
    }

    private static BibliotecaRoteiro BibliotecaAdministrativa(BibliotecaRoteiro.PassoCaptura[] passos)
    {
        return new BibliotecaRoteiro
        {
            EhNativa = true,
            OperacaoFinanceiraAutorizada = true,
            OperacoesListadas = new List<OperacaoDisponivel> { new(0x22, "CANCELAMENTO", "", "34", false, 0) },
            Sequencia = new Queue<BibliotecaRoteiro.PassoCaptura>(passos),
            Resultados =
            {
                [InformacaoPgWeb.ConfirmacaoRequerida] = "0",
                [InformacaoPgWeb.MensagemResultado] = "VALOR RECEBIDO",
            },
        };
    }

    private PedidoVenda Pedido(string chave)
    {
        var contexto = new ContextoEmpresa("usuario", _empresa, _terminal, "cnpj-teste", CodigosPgWeb.AmbienteTeste, "ponto-teste", "homologacao.exemplo", Path.Combine(_raiz, "Data"));
        return new PedidoVenda(contexto, null, chave, 0, "", 1, "pinpad");
    }

    private sealed class CapturaPorCampo : ICapturaOperador
    {
        private readonly Dictionary<ushort, string> _valores;
        public string? Aviso { get; private set; }
        public Dictionary<ushort, string> Sugestoes { get; } = new();
        public List<VendaParaCaptura> Vendas { get; } = new();

        public CapturaPorCampo(Dictionary<ushort, string> valores)
        {
            _valores = valores;
        }

        public void DefinirSugestao(ushort identificador, string valor) => Sugestoes[identificador] = valor;

        public void DefinirVendas(IReadOnlyList<VendaParaCaptura> vendas) => Vendas.AddRange(vendas);

        public bool TentarResponder(PwGetData pedido, out string valor)
        {
            return _valores.TryGetValue(pedido.Identificador, out valor!);
        }

        public void DefinirAviso(string? aviso) => Aviso = aviso;
    }
}
