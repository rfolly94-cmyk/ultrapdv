using UltraPDV.TEF.Interop;
using UltraPDV.TEF.Nucleo;
using UltraPDV.TEF.Persistencia;
using UltraPDV.TEF.Transacoes;

namespace UltraPDV.TEF.Tests;

public class CapturaEnderecoTests : IDisposable
{
    private readonly string _raiz = Path.Combine(Path.GetTempPath(), "ultrapdv-tef-endereco-" + Guid.NewGuid().ToString("N"));
    private readonly Guid _empresa = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private readonly Guid _terminal = Guid.Parse("33333333-3333-3333-3333-333333333333");

    [Fact]
    public void Destino_tcp_exige_host_e_porta_juntos_sem_reescrever()
    {
        Assert.True(CapturaEndereco.PodeEnviar("lab.exemplo:31735", out var endereco));
        Assert.Equal("lab.exemplo:31735", endereco);
        Assert.True(CapturaEndereco.PodeEnviar(" lab.exemplo:31735 ", out endereco));
        Assert.Equal("lab.exemplo:31735", endereco);

        Assert.False(CapturaEndereco.PodeEnviar("lab.exemplo", out endereco));
        Assert.Equal("", endereco);
        Assert.False(CapturaEndereco.PodeEnviar("https://lab.exemplo", out endereco));
        Assert.Equal("", endereco);
        Assert.False(CapturaEndereco.PodeEnviar("https://lab.exemplo:31735", out endereco));
        Assert.Equal("", endereco);

        var prompt = CapturaEndereco.Montar("SERVIDOR", "", "\r CONFIGURE", "", InformacaoPgWeb.DestinoTcpIp, null);
        Assert.Contains("SERVIDOR", prompt);
        Assert.Contains("CONFIGURE", prompt);
        Assert.Contains("host:porta", prompt);
        Assert.Contains("PWINFO_DESTTCPIP", prompt);
        Assert.DoesNotContain("31735", prompt);
        Assert.DoesNotContain("https://", prompt);

        var porta = CapturaEndereco.Montar("PORTA", "", "", "", InformacaoPgWeb.PortaAutorizador, null);
        Assert.Contains("PWINFO_AUTPORT", porta);
        Assert.DoesNotContain("host:porta", porta);
        Assert.Equal("CONFIGURE O TERMINAL", CapturaEndereco.Apresentar("\r     CONFIGURE\r     O TERMINAL"));
        Assert.False(CapturaEndereco.MensagemFinal(CodigosPgWeb.Display));
        Assert.True(CapturaEndereco.MensagemFinal(CodigosPgWeb.ConfigRequired));
    }

    [Fact]
    public void Instalacao_nao_envia_url_e_nao_chama_configuracao()
    {
        var biblioteca = new BibliotecaEndereco();
        var motor = new MotorPayGo(new RepositorioJournal(DiretorioEmpresa.JournalsProducao(_raiz)), new CoordenadorSessao());
        var captura = new CapturaFila("https://lab.exemplo", "lab.exemplo:31735");
        var resultado = motor.Instalar(Pedido(), biblioteca, captura);

        Assert.Equal("instalada", resultado.Situacao);
        Assert.Contains(("001B", "lab.exemplo:31735"), biblioteca.Parametros);
        Assert.DoesNotContain(biblioteca.Parametros, item => item.Valor.Contains("https://", StringComparison.Ordinal));
        Assert.DoesNotContain(biblioteca.Chamadas, chamada => chamada.Contains(":FD", StringComparison.Ordinal));
        Assert.Contains("PW_iNewTransac:01", biblioteca.Chamadas);
        Assert.Equal(CapturaEndereco.AvisoNaoEnviado, captura.UltimoAviso);
    }

    [Fact]
    public void Configuracao_troca_o_endereco_sem_pagamento()
    {
        var biblioteca = new BibliotecaEndereco();
        var motor = new MotorPayGo(new RepositorioJournal(DiretorioEmpresa.JournalsConfiguracao(_raiz)), new CoordenadorSessao());
        var resultado = motor.Configurar(Pedido() with { ChaveIdempotencia = "cfg:endereco" }, biblioteca, new CapturaFila("https://lab.exemplo", "lab.exemplo:31735"));

        Assert.Equal("configurada", resultado.Situacao);
        Assert.False(resultado.PagamentoRecebido);
        Assert.False(resultado.ConfirmacaoChamada);
        Assert.Contains("gravou o novo endereço", resultado.Mensagem);
        Assert.DoesNotContain("lab.exemplo", resultado.Mensagem);
        Assert.Contains("PW_iNewTransac:FD", biblioteca.Chamadas);
        Assert.Equal(1, biblioteca.Chamadas.Count(chamada => chamada.StartsWith("PW_iNewTransac", StringComparison.Ordinal)));
        Assert.DoesNotContain(biblioteca.Chamadas, chamada => chamada.Contains(":01", StringComparison.Ordinal));
        Assert.Contains(("001B", "lab.exemplo:31735"), biblioteca.Parametros);
        Assert.DoesNotContain(biblioteca.Parametros, item => item.Valor.Contains("https://", StringComparison.Ordinal));
        Assert.False(resultado.ServidorValidado);
    }

    [Fact]
    public void Endereco_de_homologacao_nao_e_enviado_na_producao()
    {
        var biblioteca = new BibliotecaEndereco();
        var captura = new CapturaFila("sandbox.exemplo:31735");
        var motor = new MotorPayGo(new RepositorioJournal(DiretorioEmpresa.JournalsConfiguracao(_raiz)), new CoordenadorSessao());
        var resultado = motor.Configurar(
            Pedido() with { ChaveIdempotencia = "cfg:homologacao", EnderecoComercial = "loja.exemplo:31735" },
            biblioteca,
            captura);

        Assert.NotEqual("configurada", resultado.Situacao);
        Assert.False(resultado.ServidorValidado);
        Assert.False(resultado.PagamentoRecebido);
        Assert.DoesNotContain(biblioteca.Parametros, item => item.Identificador == "001B");
        Assert.Contains("homologação", captura.UltimoAviso);
        Assert.DoesNotContain("sandbox.exemplo", resultado.Mensagem);
        Assert.DoesNotContain("loja.exemplo", resultado.Mensagem);
    }

    [Fact]
    public void Servidor_comercial_declarado_e_confirmado_pela_leitura()
    {
        var biblioteca = new BibliotecaEndereco();
        var motor = new MotorPayGo(new RepositorioJournal(DiretorioEmpresa.JournalsConfiguracao(_raiz)), new CoordenadorSessao());
        var resultado = motor.Configurar(
            Pedido() with { ChaveIdempotencia = "cfg:comercial", EnderecoComercial = "loja.exemplo:31735" },
            biblioteca,
            new CapturaFila("sandbox.exemplo:31735", "loja.exemplo:31735"));

        Assert.Equal("configurada", resultado.Situacao);
        Assert.True(resultado.ServidorValidado);
        Assert.False(resultado.PagamentoRecebido);
        Assert.Contains("confirmou o servidor comercial", resultado.Mensagem);
        Assert.DoesNotContain("loja.exemplo", resultado.Mensagem);
        Assert.DoesNotContain("sandbox.exemplo", resultado.Mensagem);
        Assert.Contains(("001B", "loja.exemplo:31735"), biblioteca.Parametros);
        Assert.DoesNotContain(biblioteca.Parametros, item => item.Valor.Contains("sandbox.exemplo", StringComparison.Ordinal));
    }

    [Fact]
    public void Chave_de_instalacao_nao_abre_pwoper_config()
    {
        var biblioteca = new BibliotecaEndereco();
        var motor = new MotorPayGo(new RepositorioJournal(DiretorioEmpresa.JournalsConfiguracao(_raiz)), new CoordenadorSessao());
        var resultado = motor.Configurar(Pedido() with { ChaveIdempotencia = "ins:antiga" }, biblioteca, new CapturaFila("lab.exemplo:31735"));

        Assert.Equal("chave_de_instalacao", resultado.Situacao);
        Assert.False(resultado.PagamentoRecebido);
        Assert.Empty(biblioteca.Chamadas);
    }

    [Fact]
    public void Configuracao_sem_pedido_de_endereco_nao_anuncia_sucesso()
    {
        var biblioteca = new BibliotecaEndereco { Primeiro = InformacaoPgWeb.UsuarioTecnico };
        var motor = new MotorPayGo(new RepositorioJournal(DiretorioEmpresa.JournalsConfiguracao(_raiz)), new CoordenadorSessao());
        var resultado = motor.Configurar(Pedido() with { ChaveIdempotencia = "cfg:sem-endereco" }, biblioteca, new CapturaFila("informado"));

        Assert.Equal("configurada_sem_endereco", resultado.Situacao);
        Assert.Equal(CodigosPgWeb.Ok, resultado.Codigo);
        Assert.False(resultado.PagamentoRecebido);
        Assert.False(resultado.ConfirmacaoChamada);
        Assert.Contains("não solicitou PWINFO_DESTTCPIP", resultado.Mensagem);
        Assert.Contains("retornou 0", resultado.Mensagem);
        Assert.DoesNotContain("gravou o novo endereço", resultado.Mensagem);
        Assert.DoesNotContain(biblioteca.Parametros, item => item.Identificador == "001B");
        Assert.Equal(1, biblioteca.Chamadas.Count(chamada => chamada.StartsWith("PW_iNewTransac", StringComparison.Ordinal)));
        Assert.Contains("PW_iNewTransac:FD", biblioteca.Chamadas);
    }

    [Fact]
    public void Endereco_divergente_nao_e_confirmado()
    {
        var biblioteca = new BibliotecaEndereco { EnderecoDivergente = true };
        var motor = new MotorPayGo(new RepositorioJournal(DiretorioEmpresa.JournalsConfiguracao(_raiz)), new CoordenadorSessao());
        var resultado = motor.Configurar(Pedido() with { ChaveIdempotencia = "cfg:divergente" }, biblioteca, new CapturaFila("lab.exemplo:31735"));

        Assert.Equal("endereco_nao_atualizado", resultado.Situacao);
        Assert.False(resultado.PagamentoRecebido);
        Assert.False(resultado.ConfirmacaoChamada);
        Assert.Contains("não é o valor enviado", resultado.Mensagem);
        Assert.DoesNotContain("lab.exemplo", resultado.Mensagem);
        Assert.DoesNotContain("outro.exemplo", resultado.Mensagem);
        Assert.DoesNotContain(biblioteca.Chamadas, chamada => chamada.Contains(":01", StringComparison.Ordinal));
    }

    [Fact]
    public void Journals_de_configuracao_ficam_separados()
    {
        var instalacao = new MotorPayGo(new RepositorioJournal(DiretorioEmpresa.JournalsProducao(_raiz)), new CoordenadorSessao());
        var configuracao = new MotorPayGo(new RepositorioJournal(DiretorioEmpresa.JournalsConfiguracao(_raiz)), new CoordenadorSessao());
        var bibliotecaInstalacao = new BibliotecaEndereco();
        var bibliotecaConfiguracao = new BibliotecaEndereco();
        Assert.Equal("instalada", instalacao.Instalar(Pedido() with { ChaveIdempotencia = "ins:um" }, bibliotecaInstalacao, new CapturaFila("lab.exemplo:31735")).Situacao);
        Assert.Equal("configurada", configuracao.Configurar(Pedido() with { ChaveIdempotencia = "cfg:dois" }, bibliotecaConfiguracao, new CapturaFila("lab.exemplo:31735")).Situacao);

        var journalsInstalacao = new RepositorioJournal(DiretorioEmpresa.JournalsProducao(_raiz)).Listar(_empresa, _terminal);
        var journalsConfiguracao = new RepositorioJournal(DiretorioEmpresa.JournalsConfiguracao(_raiz)).Listar(_empresa, _terminal);
        Assert.Contains(journalsInstalacao, journal => journal.Operacao == "instalacao");
        Assert.DoesNotContain(journalsInstalacao, journal => journal.Operacao == "configuracao");
        Assert.Contains(journalsConfiguracao, journal => journal.Operacao == "configuracao");
        Assert.DoesNotContain(journalsConfiguracao, journal => journal.Operacao == "instalacao");
        Assert.Contains("PW_iNewTransac:01", bibliotecaInstalacao.Chamadas);
        Assert.Contains("PW_iNewTransac:FD", bibliotecaConfiguracao.Chamadas);
        Assert.False(Directory.Exists(Path.Combine(_raiz, _empresa.ToString("N"), _terminal.ToString("N"), "journals")));
    }

    [Fact]
    public void Endereco_gravado_nao_e_pedido_de_novo()
    {
        var biblioteca = new BibliotecaEndereco { RecusaConfiguracao = true, Primeiro = InformacaoPgWeb.UsuarioTecnico };
        var motor = new MotorPayGo(new RepositorioJournal(DiretorioEmpresa.JournalsProducao(_raiz)), new CoordenadorSessao());
        var resultado = motor.Instalar(Pedido(), biblioteca, new CapturaFila("informado"));

        Assert.Equal("execucao_recusada", resultado.Situacao);
        Assert.Equal(CodigosPgWeb.ConfigRequired, resultado.Codigo);
        Assert.False(resultado.PagamentoRecebido);
        Assert.False(resultado.ConfirmacaoChamada);
        Assert.Contains("CONFIGURE O TERMINAL", resultado.Mensagem);
        Assert.Contains("reutilizou o endereço já gravado", resultado.Mensagem);
        Assert.Contains("PWOPER_CONFIG", resultado.Mensagem);
        Assert.DoesNotContain("outro campo de porta", resultado.Mensagem);
        Assert.DoesNotContain(biblioteca.Parametros, item => item.Identificador == "001B");
        Assert.Contains("PW_iNewTransac:01", biblioteca.Chamadas);
        Assert.DoesNotContain(biblioteca.Chamadas, chamada => chamada.Contains(":FD", StringComparison.Ordinal));
    }

    [Fact]
    public void Porta_separada_nao_e_anexada_ao_endereco()
    {
        var biblioteca = new BibliotecaEndereco
        {
            Primeiro = InformacaoPgWeb.EnderecoAutorizador,
            Segundo = InformacaoPgWeb.PortaAutorizador,
        };
        var motor = new MotorPayGo(new RepositorioJournal(DiretorioEmpresa.JournalsProducao(_raiz)), new CoordenadorSessao());
        var resultado = motor.Instalar(Pedido(), biblioteca, new CapturaFila("lab.exemplo", "31735"));

        Assert.Equal("instalada", resultado.Situacao);
        Assert.Contains(("0005", "lab.exemplo"), biblioteca.Parametros);
        Assert.Contains(("0007", "31735"), biblioteca.Parametros);
        Assert.DoesNotContain(biblioteca.Parametros, item => item.Valor == "lab.exemplo:31735");
    }

    public void Dispose()
    {
        if (Directory.Exists(_raiz))
        {
            Directory.Delete(_raiz, recursive: true);
        }
    }

    private PedidoVenda Pedido()
    {
        var contexto = new ContextoEmpresa("teste", _empresa, _terminal, "cnpj", CodigosPgWeb.AmbienteProducao, "", "producao", DiretorioEmpresa.Producao(_raiz, _empresa, _terminal));
        return new PedidoVenda(contexto, null, "endereco-" + Guid.NewGuid().ToString("N"), 0, "", 1, "pinpad-local");
    }

    private sealed class CapturaFila : ICapturaOperador
    {
        private readonly Queue<string> _valores;
        public string? UltimoAviso { get; private set; }
        public CapturaFila(params string[] valores) => _valores = new Queue<string>(valores);
        public void DefinirAviso(string? aviso) => UltimoAviso = aviso;
        public bool TentarResponder(PwGetData pedido, out string valor)
        {
            _ = pedido;
            if (_valores.Count == 0)
            {
                valor = "";
                return false;
            }

            valor = _valores.Dequeue();
            return true;
        }
    }

    private sealed class BibliotecaEndereco : IBibliotecaPgWeb
    {
        private int _execucoes;
        public ushort Primeiro { get; init; } = InformacaoPgWeb.DestinoTcpIp;
        public ushort Segundo { get; init; }
        public bool RecusaConfiguracao { get; init; }
        public bool EnderecoDivergente { get; init; }
        public bool EhNativa => true;
        public bool OperacaoFinanceiraAutorizada => false;
        public bool InstalacaoProducaoAutorizada => true;
        public List<string> Chamadas { get; } = new();
        public List<(string Identificador, string Valor)> Parametros { get; } = new();

        public short DefinirAmbiente(short ambiente)
        {
            Chamadas.Add("PW_iSetEnvironment");
            _ = ambiente;
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
            Parametros.Add((identificador.ToString("X4"), valor));
            return CodigosPgWeb.Ok;
        }

        public short Executar(PwGetData[] capturas, ref short quantidade)
        {
            Chamadas.Add("PW_iExecTransac");
            _execucoes++;
            if (_execucoes == 1)
            {
                capturas[0].Identificador = Primeiro;
                capturas[0].TipoDeDado = TipoDadoPgWeb.Digitado;
                if (Segundo != 0)
                {
                    capturas[1].Identificador = Segundo;
                    capturas[1].TipoDeDado = TipoDadoPgWeb.Digitado;
                    quantidade = 2;
                }
                else
                {
                    quantidade = 1;
                }

                return CodigosPgWeb.MoreData;
            }

            quantidade = 0;
            return RecusaConfiguracao ? CodigosPgWeb.ConfigRequired : CodigosPgWeb.Ok;
        }

        public short LerResultado(short informacao, Span<byte> destino)
        {
            var texto = informacao == InformacaoPgWeb.ConfirmacaoRequerida
                ? "0"
                : informacao == InformacaoPgWeb.MensagemResultado
                    ? "\r     CONFIGURE\r     O TERMINAL"
                    : informacao == InformacaoPgWeb.DestinoTcpIp
                        ? EnderecoLido()
                        : "";
            var bytes = System.Text.Encoding.ASCII.GetBytes(texto + "\0");
            bytes.AsSpan(0, Math.Min(bytes.Length, destino.Length)).CopyTo(destino);
            return texto.Length == 0 ? CodigosPgWeb.NoData : CodigosPgWeb.Ok;
        }

        private string EnderecoLido()
        {
            if (EnderecoDivergente)
            {
                return "outro.exemplo:9";
            }

            for (var indice = Parametros.Count - 1; indice >= 0; indice--)
            {
                if (Parametros[indice].Identificador == "001B")
                {
                    return Parametros[indice].Valor;
                }
            }

            return "";
        }

        public short Confirmar(uint status, string numeroRequisicao, string referenciaLocal, string referenciaExterna, string estabelecimentoVirtual, string sistemaAutorizador)
        {
            _ = status;
            _ = numeroRequisicao;
            _ = referenciaLocal;
            _ = referenciaExterna;
            _ = estabelecimentoVirtual;
            _ = sistemaAutorizador;
            return CodigosPgWeb.Ok;
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
        public void Encerrar() { }
    }
}
