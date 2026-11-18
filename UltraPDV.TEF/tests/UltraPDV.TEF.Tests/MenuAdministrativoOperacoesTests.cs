using System.Text;
using System.Text.RegularExpressions;
using UltraPDV.TEF.Interop;
using UltraPDV.TEF.Nucleo;
using UltraPDV.TEF.Persistencia;
using UltraPDV.TEF.Transacoes;

namespace UltraPDV.TEF.Tests;

public class MenuAdministrativoOperacoesTests : IDisposable
{
    private const string HeaderOficial = @"C:\ultrapdv-backup-tef-20261023-093138\20260923-Integracao-PGWebLib_v4.1.50.924\PGWebLib.h";
    private readonly string _raiz = Path.Combine(Path.GetTempPath(), "ultrapdv-tef-menu", Guid.NewGuid().ToString("N"));
    private readonly Guid _empresa = Guid.Parse("347878e3-608a-46c4-9f22-7bebb982ff6d");
    private readonly Guid _terminal = Guid.Parse("1a4810cf-c260-4b29-9dc2-09141e0b230d");

    public static IEnumerable<object[]> Opcoes()
    {
        foreach (var opcao in CatalogoAdministrativo.Interface)
        {
            yield return new object[] { opcao.Rotulo, opcao.Define, opcao.Codigo, opcao.Classe, opcao.Captura };
        }
    }

    [Theory]
    [MemberData(nameof(Opcoes))]
    public void Opcao_usa_o_identificador_de_GetOperationsEx_e_a_captura_pedida(string rotulo, string define, byte codigo, string classe, byte captura)
    {
        Assert.Equal(codigo, CodigoDoHeader(define));
        var identificador = codigo.ToString("X2");
        var journals = new RepositorioJournal(_raiz);
        var ponto = journals.Gravar(PontoInstalado());
        var biblioteca = BibliotecaDaOpcao(rotulo, identificador, codigo, captura);
        biblioteca.OperacaoFinanceiraAutorizada = true;
        var motor = new MotorPayGo(journals, new CoordenadorSessao());

        var resultado = motor.Administrar(Pedido("adm:" + define), biblioteca, new CapturaValor(identificador));

        if (codigo == OperacaoPgWeb.Manutencao)
        {
            Assert.Equal("ponto_nao_instalado", resultado.Situacao);
            Assert.Contains("nova instalação", resultado.Mensagem);
            Assert.False(resultado.PagamentoRecebido);
            Assert.False(resultado.ConfirmacaoChamada);
            Assert.DoesNotContain("PW_iConfirmation", biblioteca.Chamadas);
            Assert.Equal("desinstalada", journals.Buscar(_empresa, _terminal, ponto.ChaveIdempotencia)?.Status);
            return;
        }

        Assert.Equal("administrativa", resultado.Situacao);
        Assert.False(resultado.PagamentoRecebido);
        Assert.False(resultado.ConfirmacaoChamada);
        Assert.Contains(rotulo + " OK", resultado.Mensagem);
        Assert.DoesNotContain("PW_iConfirmation", biblioteca.Chamadas);
        Assert.Contains("PW_iNewTransac:20", biblioteca.Chamadas);
        Assert.DoesNotContain("PW_iNewTransac:" + identificador, biblioteca.Chamadas);
        var listagem = biblioteca.Chamadas.IndexOf("PW_iGetOperationsEx");
        var transacao = biblioteca.Chamadas.FindIndex(chamada => chamada == "PW_iNewTransac:20");
        Assert.True(listagem >= 0 && listagem < transacao);
        Assert.Contains(biblioteca.Parametros, item => item.Identificador == InformacaoPgWeb.LocalInfo2 && item.Valor == identificador);
        Assert.DoesNotContain(biblioteca.Parametros, item => item.Valor == "1");
        if (captura is TipoDadoPgWeb.Digitado or TipoDadoPgWeb.CodigoBarras)
        {
            Assert.Contains(biblioteca.Parametros, item => item.Identificador == 0x19 && item.Valor == identificador);
        }
        else if (captura == TipoDadoPgWeb.Cartao)
        {
            Assert.Contains("PW_iPPGetCard", biblioteca.Chamadas);
        }
        else if (captura == TipoDadoPgWeb.DigitacaoPinPad)
        {
            Assert.Contains("PW_iPPGetData", biblioteca.Chamadas);
        }

        var journal = journals.Buscar(_empresa, _terminal, "adm:" + define);
        Assert.Equal("administrativa", journal?.Status);
        Assert.Equal(0, journal?.ValorCentavos);
        Assert.False(journal?.PagamentoRecebido);
        Assert.False(journal?.ConfirmacaoChamada);
        if (classe == "consulta")
        {
            Assert.Contains("RELATORIO " + rotulo, resultado.Mensagem);
            Assert.Equal("RELATORIO " + rotulo, journal?.ViaEstabelecimento);
            Assert.Null(journal?.NumeroRequisicao);
        }
    }

    public static IEnumerable<object[]> OpcoesSensiveis()
    {
        foreach (var opcao in CatalogoAdministrativo.Interface.Where(item => item.Classe != "consulta"))
        {
            yield return new object[] { opcao.Rotulo, opcao.Define, opcao.Codigo, opcao.Classe, opcao.Captura };
        }
    }

    [Theory]
    [MemberData(nameof(OpcoesSensiveis))]
    public void Operacao_financeira_ou_de_terminal_sem_autorizacao_nao_envia_o_valor(string rotulo, string define, byte codigo, string classe, byte captura)
    {
        _ = classe;
        _ = captura;
        var identificador = codigo.ToString("X2");
        var journals = new RepositorioJournal(_raiz);
        var ponto = journals.Gravar(PontoInstalado());
        var biblioteca = BibliotecaDaOpcao(rotulo, identificador, codigo, TipoDadoPgWeb.Menu);
        biblioteca.OperacaoFinanceiraAutorizada = false;
        biblioteca.AdministracaoProducaoAutorizada = true;
        var producao = Contexto() with { Ambiente = CodigosPgWeb.AmbienteProducao, Servidor = "producao" };
        var motor = new MotorPayGo(journals, new CoordenadorSessao());

        var resultado = motor.Administrar(Pedido("adm:recusa-" + define) with { Contexto = producao }, biblioteca, new CapturaValor(identificador));

        Assert.Equal("interrompida", resultado.Situacao);
        Assert.False(resultado.PagamentoRecebido);
        Assert.False(resultado.ConfirmacaoChamada);
        Assert.Contains("autorização explícita", resultado.Mensagem);
        Assert.DoesNotContain(biblioteca.Parametros, item => item.Valor == identificador);
        Assert.DoesNotContain("PW_iConfirmation", biblioteca.Chamadas);
        Assert.DoesNotContain("PW_iNewTransac:" + identificador, biblioteca.Chamadas);
        Assert.Equal("interrompida", journals.Buscar(_empresa, _terminal, "adm:recusa-" + define)?.Status);
        Assert.Equal("instalada", journals.Buscar(_empresa, _terminal, ponto.ChaveIdempotencia)?.Status);
    }

    [Fact]
    public void Consulta_em_producao_nao_gera_movimentacao()
    {
        var journals = new RepositorioJournal(_raiz);
        journals.Gravar(PontoInstalado());
        var biblioteca = BibliotecaDaOpcao("TESTE COMUNICAÇÃO", "14", 0x14, TipoDadoPgWeb.Menu);
        biblioteca.OperacaoFinanceiraAutorizada = false;
        biblioteca.AdministracaoProducaoAutorizada = true;
        var producao = Contexto() with { Ambiente = CodigosPgWeb.AmbienteProducao, Servidor = "producao" };
        var resultado = new MotorPayGo(journals, new CoordenadorSessao()).Administrar(
            Pedido("adm:consulta-producao") with { Contexto = producao },
            biblioteca,
            new CapturaValor("14"));

        Assert.Equal("administrativa", resultado.Situacao);
        Assert.False(resultado.PagamentoRecebido);
        Assert.False(resultado.ConfirmacaoChamada);
        Assert.Contains("RELATORIO TESTE COMUNICAÇÃO", resultado.Mensagem);
        Assert.DoesNotContain("PW_iConfirmation", biblioteca.Chamadas);
        Assert.Equal(0, journals.Buscar(_empresa, _terminal, "adm:consulta-producao")?.ValorCentavos);
    }

    [Fact]
    public void Cancelamento_aceito_encaminha_a_adquirente_do_menu_0x36()
    {
        var journals = new RepositorioJournal(_raiz);
        journals.Gravar(PontoInstalado());
        var biblioteca = new BibliotecaRoteiro
        {
            EhNativa = true,
            OperacaoFinanceiraAutorizada = true,
            OperacoesListadas = new List<OperacaoDisponivel>
            {
                new(0x22, "CANCELAMENTO", "C6", "34", false, 0),
            },
            Sequencia = new Queue<BibliotecaRoteiro.PassoCaptura>(new[]
            {
                new BibliotecaRoteiro.PassoCaptura
                {
                    Tipo = TipoDadoPgWeb.Menu,
                    Identificador = InformacaoPgWeb.LocalInfo2,
                    Valores = new[] { "1", "34" },
                    Textos = new[] { "POSICAO", "CANCELAMENTO" },
                },
                new BibliotecaRoteiro.PassoCaptura
                {
                    Tipo = TipoDadoPgWeb.Menu,
                    Identificador = InformacaoPgWeb.EstabelecimentoVirtual,
                    Valores = new[] { "C6 PAY", "REDE", "PIX C6 BANK" },
                    Textos = new[] { "C6 PAY", "REDE", "PIX C6 BANK" },
                },
            }),
        };
        biblioteca.Resultados[InformacaoPgWeb.ConfirmacaoRequerida] = "0";
        biblioteca.Resultados[InformacaoPgWeb.MensagemResultado] = "AGUARDANDO ADQUIRENTE";
        var captura = new CapturaPorIdentificador(new Dictionary<ushort, string>
        {
            [InformacaoPgWeb.LocalInfo2] = "34",
            [InformacaoPgWeb.EstabelecimentoVirtual] = "REDE",
        });

        var resultado = new MotorPayGo(journals, new CoordenadorSessao()).Administrar(Pedido("adm:adquirente"), biblioteca, captura);

        Assert.Equal("administrativa", resultado.Situacao);
        Assert.False(resultado.PagamentoRecebido);
        Assert.False(resultado.ConfirmacaoChamada);
        Assert.DoesNotContain("não habilitou", resultado.Mensagem);
        Assert.Contains(biblioteca.Parametros, item => item.Identificador == InformacaoPgWeb.LocalInfo2 && item.Valor == "34");
        Assert.Contains(biblioteca.Parametros, item => item.Identificador == InformacaoPgWeb.EstabelecimentoVirtual && item.Valor == "REDE");
        Assert.DoesNotContain(biblioteca.Parametros, item => item.Identificador == InformacaoPgWeb.EstabelecimentoVirtual && item.Valor is "C6 PAY" or "PIX C6 BANK" or "0" or "1" or "2");
        Assert.DoesNotContain(biblioteca.Parametros, item => item.Identificador == InformacaoPgWeb.ValorTotal);
        Assert.DoesNotContain("PW_iConfirmation", biblioteca.Chamadas);
        Assert.Equal(0, journals.Buscar(_empresa, _terminal, "adm:adquirente")?.ValorCentavos);
    }

    [Fact]
    public void Esc_no_menu_da_adquirente_nao_envia_adquirente_nem_pagamento()
    {
        var journals = new RepositorioJournal(_raiz);
        journals.Gravar(PontoInstalado());
        var biblioteca = new BibliotecaRoteiro
        {
            EhNativa = true,
            OperacaoFinanceiraAutorizada = true,
            OperacoesListadas = new List<OperacaoDisponivel>
            {
                new(0x22, "CANCELAMENTO", "C6", "34", false, 0),
            },
            Sequencia = new Queue<BibliotecaRoteiro.PassoCaptura>(new[]
            {
                new BibliotecaRoteiro.PassoCaptura
                {
                    Tipo = TipoDadoPgWeb.Menu,
                    Identificador = InformacaoPgWeb.LocalInfo2,
                    Valores = new[] { "34" },
                    Textos = new[] { "CANCELAMENTO" },
                },
                new BibliotecaRoteiro.PassoCaptura
                {
                    Tipo = TipoDadoPgWeb.Menu,
                    Identificador = InformacaoPgWeb.EstabelecimentoVirtual,
                    Valores = new[] { "C6 PAY", "REDE", "PIX C6 BANK" },
                    Textos = new[] { "C6 PAY", "REDE", "PIX C6 BANK" },
                },
            }),
        };
        biblioteca.Resultados[InformacaoPgWeb.MensagemResultado] = "OPERAÇÃO CANCELADA";

        var resultado = new MotorPayGo(journals, new CoordenadorSessao()).Administrar(
            Pedido("adm:adquirente-esc"),
            biblioteca,
            new CapturaCancelaDepoisDaOperacao("34"));

        Assert.Equal("interrompida", resultado.Situacao);
        Assert.Equal("OPERAÇÃO CANCELADA", resultado.Mensagem);
        Assert.False(resultado.PagamentoRecebido);
        Assert.Contains(biblioteca.Parametros, item => item.Identificador == InformacaoPgWeb.LocalInfo2 && item.Valor == "34");
        Assert.DoesNotContain(biblioteca.Parametros, item => item.Identificador == InformacaoPgWeb.EstabelecimentoVirtual);
        Assert.DoesNotContain("PW_iPPAbort", biblioteca.Chamadas);
        Assert.DoesNotContain("PW_iConfirmation", biblioteca.Chamadas);
    }

    [Fact]
    public void Opcao_ausente_na_listagem_mostra_a_recusa_real_sem_sucesso()
    {
        var journals = new RepositorioJournal(_raiz);
        journals.Gravar(PontoInstalado());
        var biblioteca = BibliotecaDaOpcao("TESTE COMUNICAÇÃO", "14", 0x14, TipoDadoPgWeb.Menu);
        biblioteca.OperacaoFinanceiraAutorizada = true;
        biblioteca.Sequencia = new Queue<BibliotecaRoteiro.PassoCaptura>(new[]
        {
            new BibliotecaRoteiro.PassoCaptura
            {
                Tipo = TipoDadoPgWeb.Menu,
                Identificador = InformacaoPgWeb.LocalInfo2,
                Valores = new[] { "14", "99" },
                Textos = new[] { "TESTE COMUNICAÇÃO", "OPCAO AUSENTE" },
            },
        });
        biblioteca.Resultados[InformacaoPgWeb.MensagemResultado] = "OPERACAO NAO HABILITADA";
        var resultado = new MotorPayGo(journals, new CoordenadorSessao()).Administrar(
            Pedido("adm:ausente"),
            biblioteca,
            new CapturaValor("99"));

        Assert.Equal("interrompida", resultado.Situacao);
        Assert.Equal("OPERACAO NAO HABILITADA", resultado.Mensagem);
        Assert.False(resultado.PagamentoRecebido);
        Assert.NotEqual("administrativa", resultado.Situacao);
        Assert.DoesNotContain(biblioteca.Parametros, item => item.Valor == "99");
        Assert.Equal("interrompida", journals.Buscar(_empresa, _terminal, "adm:ausente")?.Status);
    }

    [Fact]
    public void GetOperationsEx_com_erro_devolve_o_codigo_da_biblioteca()
    {
        var journals = new RepositorioJournal(_raiz);
        journals.Gravar(PontoInstalado());
        var biblioteca = new BibliotecaRoteiro { EhNativa = true, OperacaoFinanceiraAutorizada = true, CodigoListagem = CodigosPgWeb.NotInst };
        biblioteca.Resultados[InformacaoPgWeb.MensagemResultado] = "OPERACAO NAO HABILITADA";
        var resultado = new MotorPayGo(journals, new CoordenadorSessao()).Administrar(Pedido("adm:erro-lista"), biblioteca, new CapturaValor("14"));

        Assert.Equal(CodigosPgWeb.NotInst, resultado.Codigo);
        Assert.Equal("operacao_indisponivel", resultado.Situacao);
        Assert.Equal("OPERACAO NAO HABILITADA", resultado.Mensagem);
        Assert.False(resultado.PagamentoRecebido);
        Assert.DoesNotContain(biblioteca.Chamadas, chamada => chamada.StartsWith("PW_iNewTransac", StringComparison.Ordinal));
        Assert.Equal("recusada", journals.Buscar(_empresa, _terminal, "adm:erro-lista")?.Status);
    }

    [Fact]
    public void Consulta_encerra_administracao_abandonada_sem_apagar_o_registro()
    {
        var journals = new RepositorioJournal(_raiz);
        var abandonada = journals.Gravar(new JournalOperacao(
            _empresa, _terminal, null, "menu-abandonado", "adm:abandonada", "executando", 0, false, false, DateTimeOffset.UtcNow, Operacao: "administracao"));
        var comRequisicao = journals.Gravar(new JournalOperacao(
            _empresa, _terminal, null, "menu-com-requisicao", "adm:com-requisicao", "executando", 0, false, false, DateTimeOffset.UtcNow,
            NumeroRequisicao: "732684", Operacao: "administracao"));
        var motor = new MotorPayGo(journals, new CoordenadorSessao());

        motor.Consultar(Contexto(), null, null);

        var resolvida = journals.Buscar(_empresa, _terminal, "adm:abandonada");
        var preservada = journals.Buscar(_empresa, _terminal, "adm:com-requisicao");
        Assert.Equal(abandonada.Identificador, resolvida?.Identificador);
        Assert.Equal("interrompida", resolvida?.Status);
        Assert.False(resolvida?.PagamentoRecebido);
        Assert.Equal("732684", preservada?.NumeroRequisicao);
        Assert.Equal("executando", preservada?.Status);
        Assert.Equal(comRequisicao.Identificador, preservada?.Identificador);
    }

    public void Dispose()
    {
        if (Directory.Exists(_raiz))
        {
            Directory.Delete(_raiz, recursive: true);
        }
    }

    private static byte CodigoDoHeader(string define)
    {
        var header = File.ReadAllText(HeaderOficial, Encoding.Latin1);
        var encontrado = Regex.Match(header, @"#define\s+" + define + @"\s+(0x[0-9A-Fa-f]+|\d+)");
        Assert.True(encontrado.Success, define);
        var texto = encontrado.Groups[1].Value;
        return texto.StartsWith("0x", StringComparison.OrdinalIgnoreCase)
            ? Convert.ToByte(texto[2..], 16)
            : Convert.ToByte(texto, 10);
    }

    private BibliotecaRoteiro BibliotecaDaOpcao(string rotulo, string identificador, byte codigo, byte captura)
    {
        var passos = new List<BibliotecaRoteiro.PassoCaptura>
        {
            new()
            {
                Tipo = TipoDadoPgWeb.Menu,
                Identificador = InformacaoPgWeb.LocalInfo2,
                Valores = new[] { "1", identificador },
                Textos = new[] { "POSICAO", rotulo },
            },
        };
        if (captura != TipoDadoPgWeb.Menu)
        {
            passos.Add(new BibliotecaRoteiro.PassoCaptura
            {
                Tipo = captura,
                Identificador = 0x19,
            });
        }

        var biblioteca = new BibliotecaRoteiro
        {
            EhNativa = true,
            Sequencia = new Queue<BibliotecaRoteiro.PassoCaptura>(passos),
            OperacoesListadas = new List<OperacaoDisponivel>
            {
                new(codigo, rotulo, "C6", identificador, false, 0),
            },
        };
        biblioteca.Resultados[InformacaoPgWeb.ConfirmacaoRequerida] = "0";
        biblioteca.Resultados[InformacaoPgWeb.MensagemResultado] = rotulo + " OK";
        biblioteca.Resultados[InformacaoPgWeb.ComprovanteEstabelecimento] = "RELATORIO " + rotulo;
        return biblioteca;
    }

    private int _pontos;

    private JournalOperacao PontoInstalado()
    {
        _pontos++;
        return new JournalOperacao(_empresa, _terminal, null, "ponto", "instala-" + _pontos, "instalada", 0, false, false, DateTimeOffset.UtcNow, Operacao: "instalacao");
    }

    private PedidoVenda Pedido(string chave)
    {
        return new PedidoVenda(Contexto(), null, chave, 0, "", 1, "pinpad");
    }

    private ContextoEmpresa Contexto()
    {
        return new ContextoEmpresa("usuario", _empresa, _terminal, "cnpj-teste", CodigosPgWeb.AmbienteTeste, "ponto-teste", "homologacao.exemplo", Path.Combine(_raiz, "Data"));
    }

    private sealed class CapturaValor : ICapturaOperador
    {
        private readonly string _valor;

        public CapturaValor(string valor)
        {
            _valor = valor;
        }

        public bool TentarResponder(PwGetData pedido, out string valor)
        {
            _ = pedido;
            valor = _valor;
            return true;
        }
    }

    private sealed class CapturaPorIdentificador : ICapturaOperador
    {
        private readonly Dictionary<ushort, string> _valores;

        public CapturaPorIdentificador(Dictionary<ushort, string> valores)
        {
            _valores = valores;
        }

        public bool TentarResponder(PwGetData pedido, out string valor)
        {
            return _valores.TryGetValue(pedido.Identificador, out valor!);
        }
    }

    private sealed class CapturaCancelaDepoisDaOperacao : ICapturaOperador
    {
        private readonly string _operacao;
        private bool _operacaoEnviada;

        public CapturaCancelaDepoisDaOperacao(string operacao)
        {
            _operacao = operacao;
        }

        public bool TentarResponder(PwGetData pedido, out string valor)
        {
            if (!_operacaoEnviada && pedido.Identificador == InformacaoPgWeb.LocalInfo2)
            {
                _operacaoEnviada = true;
                valor = _operacao;
                return true;
            }

            valor = "";
            return false;
        }
    }
}
