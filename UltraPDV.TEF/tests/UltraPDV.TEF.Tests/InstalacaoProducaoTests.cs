using UltraPDV.TEF.Interop;
using UltraPDV.TEF.Nucleo;
using UltraPDV.TEF.Persistencia;
using UltraPDV.TEF.Transacoes;

namespace UltraPDV.TEF.Tests;

public class InstalacaoProducaoTests : IDisposable
{
    private readonly string _raiz = Path.Combine(Path.GetTempPath(), "ultrapdv-tef-prod-" + Guid.NewGuid().ToString("N"));
    private readonly Guid _empresa = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private readonly Guid _terminal = Guid.Parse("11111111-1111-1111-1111-111111111111");

    [Fact]
    public void Diretorio_de_producao_nao_reutiliza_homologacao()
    {
        var homologacao = DiretorioEmpresa.Dados(_raiz, _empresa, _terminal);
        var producao = DiretorioEmpresa.Producao(_raiz, _empresa, _terminal);
        Assert.NotEqual(homologacao, producao);
        Assert.DoesNotContain(homologacao, producao, StringComparison.OrdinalIgnoreCase);
        Assert.EndsWith($"{Path.DirectorySeparatorChar}producao{Path.DirectorySeparatorChar}Data", producao);
        Assert.Equal(Path.Combine(Path.GetFullPath(_raiz), "producao"), DiretorioEmpresa.JournalsProducao(_raiz));
    }

    [Fact]
    public void Politica_bloqueia_venda_e_so_libera_instalacao_isolada()
    {
        var producao = DiretorioEmpresa.Producao(_raiz, _empresa, _terminal);
        var homologacao = DiretorioEmpresa.Dados(_raiz, _empresa, _terminal);
        Assert.True(PoliticaComandoProducao.Bloqueado("vender", CodigosPgWeb.AmbienteProducao, false, producao));
        Assert.True(PoliticaComandoProducao.Bloqueado("confirmar", CodigosPgWeb.AmbienteProducao, false, producao));
        Assert.True(PoliticaComandoProducao.Bloqueado("instalar", CodigosPgWeb.AmbienteProducao, false, homologacao));
        Assert.False(PoliticaComandoProducao.Bloqueado("instalar", CodigosPgWeb.AmbienteProducao, false, producao));
        Assert.False(PoliticaComandoProducao.Bloqueado("configurar", CodigosPgWeb.AmbienteProducao, false, producao));
        Assert.True(PoliticaComandoProducao.Bloqueado("configurar", CodigosPgWeb.AmbienteProducao, false, homologacao));
        Assert.True(PoliticaComandoProducao.Bloqueado("pinpad", CodigosPgWeb.AmbienteProducao, false, producao));
        Assert.False(PoliticaComandoProducao.Bloqueado("pinpad", CodigosPgWeb.AmbienteProducao, true, producao));
        Assert.False(PoliticaComandoProducao.Bloqueado("instalar", CodigosPgWeb.AmbienteTeste, false, homologacao));
        Assert.True(PoliticaComandoProducao.Bloqueado("vender", CodigosPgWeb.AmbienteProducao, false, producao, false));
        Assert.False(PoliticaComandoProducao.Bloqueado("vender", CodigosPgWeb.AmbienteProducao, false, producao, true));
        Assert.False(PoliticaComandoProducao.Bloqueado("confirmar", CodigosPgWeb.AmbienteProducao, false, producao, true));
        Assert.True(PoliticaComandoProducao.Bloqueado("cancelar", CodigosPgWeb.AmbienteProducao, false, producao, true));
        Assert.True(PoliticaComandoProducao.Bloqueado("vender", CodigosPgWeb.AmbienteProducao, false, homologacao, true));
    }

    [Fact]
    public void Frase_de_instalacao_nao_autoriza_venda()
    {
        var biblioteca = new BibliotecaNativaPgWeb();
        biblioteca.AutorizarInstalacaoProducao(BibliotecaNativaPgWeb.FraseInstalacaoProducao);
        Assert.False(biblioteca.OperacaoFinanceiraAutorizada);
        biblioteca.AutorizarVendaProducao("frase-errada");
        Assert.False(biblioteca.OperacaoFinanceiraAutorizada);
        biblioteca.AutorizarVendaProducao(BibliotecaNativaPgWeb.FraseVendaProducao);
        Assert.True(biblioteca.OperacaoFinanceiraAutorizada);
        Assert.Equal(CodigosPgWeb.InvParam, biblioteca.DefinirAmbiente(CodigosPgWeb.AmbienteTeste));
    }

    [Fact]
    public void Instalada_so_depois_da_confirmacao_nativa()
    {
        var journals = DiretorioEmpresa.JournalsProducao(_raiz);
        var motor = new MotorPayGo(new RepositorioJournal(journals), new CoordenadorSessao());
        var contexto = Contexto();
        var recusada = new BibliotecaInstalacaoProducao { CodigoConfirmacao = CodigosPgWeb.InvCall };
        var falha = motor.Instalar(Pedido(contexto, "inst-falha"), recusada, new CapturaValor("informado"));
        Assert.NotEqual("instalada", falha.Situacao);
        Assert.Contains("PW_iConfirmation", recusada.Chamadas);
        Assert.DoesNotContain(new RepositorioJournal(journals).Listar(_empresa, _terminal), item => item.Status == "instalada");

        var contextoOk = new ContextoEmpresa("teste", _empresa, Guid.Parse("22222222-2222-2222-2222-222222222222"), "cnpj", CodigosPgWeb.AmbienteProducao, "", "producao", DiretorioEmpresa.Producao(_raiz, _empresa, Guid.Parse("22222222-2222-2222-2222-222222222222")));
        var aceita = new BibliotecaInstalacaoProducao { CodigoConfirmacao = CodigosPgWeb.Ok };
        var sucesso = motor.Instalar(Pedido(contextoOk, "inst-ok"), aceita, new CapturaValor("informado"));
        Assert.Equal("instalada", sucesso.Situacao);
        Assert.Equal(CodigosPgWeb.AmbienteProducao, aceita.AmbienteRecebido);
        Assert.Contains("PW_iNewTransac:01", aceita.Chamadas);
        Assert.Contains(new RepositorioJournal(journals).Listar(_empresa, Guid.Parse("22222222-2222-2222-2222-222222222222")), item => item.Status == "instalada" && item.ChaveIdempotencia == "inst-ok");
        Assert.Empty(new RepositorioJournal(_raiz).Listar(_empresa, _terminal));
    }

    [Fact]
    public void Venda_nao_herda_a_autorizacao_de_instalacao()
    {
        var biblioteca = new BibliotecaInstalacaoProducao();
        var motor = new MotorPayGo(new RepositorioJournal(DiretorioEmpresa.JournalsProducao(_raiz)), new CoordenadorSessao());
        var resultado = motor.Vender(Pedido(Contexto(), "venda-prod") with { ValorCentavos = 100 }, biblioteca, new CapturaValor("informado"));
        Assert.Equal("autorizacao_ausente", resultado.Situacao);
        Assert.DoesNotContain(biblioteca.Chamadas, chamada => chamada.StartsWith("PW_iNewTransac", StringComparison.Ordinal));
    }

    private ContextoEmpresa Contexto()
    {
        return new ContextoEmpresa("teste", _empresa, _terminal, "cnpj", CodigosPgWeb.AmbienteProducao, "", "producao", DiretorioEmpresa.Producao(_raiz, _empresa, _terminal));
    }

    private static PedidoVenda Pedido(ContextoEmpresa contexto, string chave)
    {
        return new PedidoVenda(contexto, null, chave, 0, "", 1, "pinpad-local");
    }

    public void Dispose()
    {
        if (Directory.Exists(_raiz))
        {
            Directory.Delete(_raiz, recursive: true);
        }
    }

    private sealed class CapturaValor : ICapturaOperador
    {
        private readonly string _valor;
        public CapturaValor(string valor) => _valor = valor;
        public bool TentarResponder(PwGetData pedido, out string valor)
        {
            _ = pedido;
            valor = _valor;
            return true;
        }
    }

    private sealed class BibliotecaInstalacaoProducao : IBibliotecaPgWeb
    {
        private bool _capturou;

        public bool EhNativa => true;
        public bool OperacaoFinanceiraAutorizada => false;
        public bool InstalacaoProducaoAutorizada => true;
        public short CodigoConfirmacao { get; set; } = CodigosPgWeb.Ok;
        public short AmbienteRecebido { get; private set; } = -1;
        public List<string> Chamadas { get; } = new();

        public short DefinirAmbiente(short ambiente)
        {
            Chamadas.Add("PW_iSetEnvironment");
            AmbienteRecebido = ambiente;
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
            _ = identificador;
            _ = valor;
            return CodigosPgWeb.Ok;
        }

        public short Executar(PwGetData[] capturas, ref short quantidade)
        {
            Chamadas.Add("PW_iExecTransac");
            if (!_capturou)
            {
                _capturou = true;
                capturas[0].Identificador = InformacaoPgWeb.UsuarioTecnico;
                capturas[0].TipoDeDado = TipoDadoPgWeb.AutenticacaoUsuario;
                quantidade = 1;
                return CodigosPgWeb.MoreData;
            }

            quantidade = 0;
            return CodigosPgWeb.Ok;
        }

        public short LerResultado(short informacao, Span<byte> destino)
        {
            Chamadas.Add("PW_iGetResult");
            var texto = informacao == InformacaoPgWeb.ConfirmacaoRequerida ? "1" : "";
            var bytes = System.Text.Encoding.ASCII.GetBytes(texto + "\0");
            bytes.AsSpan(0, Math.Min(bytes.Length, destino.Length)).CopyTo(destino);
            return string.IsNullOrEmpty(texto) ? CodigosPgWeb.NoData : CodigosPgWeb.Ok;
        }

        public short Confirmar(uint status, string numeroRequisicao, string referenciaLocal, string referenciaExterna, string estabelecimentoVirtual, string sistemaAutorizador)
        {
            Chamadas.Add("PW_iConfirmation");
            _ = status;
            _ = numeroRequisicao;
            _ = referenciaLocal;
            _ = referenciaExterna;
            _ = estabelecimentoVirtual;
            _ = sistemaAutorizador;
            return CodigoConfirmacao;
        }

        public short AbortarPinPad() => CodigosPgWeb.Ok;
        public short RemoverCartao() => CodigosPgWeb.Ok;
        public short LerCartao(ushort indice) { _ = indice; return CodigosPgWeb.Ok; }
        public short ProcessarChipOffline(ushort indice) { _ = indice; return CodigosPgWeb.Ok; }
        public short FinalizarChip(ushort indice) { _ = indice; return CodigosPgWeb.Ok; }
        public short ConfirmarDadoPinPad(ushort indice) { _ = indice; return CodigosPgWeb.Ok; }
        public short ConfirmacaoPositivaPinPad(ushort indice) { _ = indice; return CodigosPgWeb.Ok; }
        public short ComandoPinPad(ushort indice) { _ = indice; return CodigosPgWeb.Ok; }
        public short LerSenhaPinPad(ushort indice) { _ = indice; return CodigosPgWeb.Ok; }
        public short LerDadoPinPad(ushort indice) { _ = indice; return CodigosPgWeb.Ok; }
        public short LoopPinPad(Span<byte> display) { _ = display; return CodigosPgWeb.Ok; }
        public void Encerrar() => Chamadas.Add("PW_End");
    }
}
