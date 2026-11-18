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

    public void Dispose()
    {
        if (Directory.Exists(_raiz))
        {
            Directory.Delete(_raiz, recursive: true);
        }
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

        public CapturaPorCampo(Dictionary<ushort, string> valores)
        {
            _valores = valores;
        }

        public bool TentarResponder(PwGetData pedido, out string valor)
        {
            return _valores.TryGetValue(pedido.Identificador, out valor!);
        }

        public void DefinirAviso(string? aviso) => Aviso = aviso;
    }
}
