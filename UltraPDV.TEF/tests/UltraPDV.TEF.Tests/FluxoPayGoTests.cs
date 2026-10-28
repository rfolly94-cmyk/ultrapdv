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
    public void Instalacao_reconhece_o_terminal_ja_instalado_sem_abrir_transacao()
    {
        GravarAmbiente(_empresaA, "TESTE");
        var biblioteca = BibliotecaComTerminalInstalado(_empresaA);
        biblioteca.Resultados[InformacaoPgWeb.MensagemResultado] = "CHAMADA INVALIDA";
        var motor = CriarMotor();

        var resultado = motor.Instalar(Pedido(_empresaA, _terminalA, "instala-existente", "", 1), biblioteca, new CapturaFixa("1"));
        var repetida = motor.Instalar(Pedido(_empresaA, _terminalA, "instala-de-novo", "", 1), biblioteca, new CapturaFixa("1"));
        var journal = new RepositorioJournal(_raiz).Buscar(_empresaA, _terminalA, "instala-existente");
        var consulta = motor.Consultar(Contexto(_empresaA, _terminalA), null, null);

        Assert.Equal("instalada", resultado.Situacao);
        Assert.Equal(CodigosPgWeb.Ok, resultado.Codigo);
        Assert.Contains("TESTE", resultado.Mensagem);
        Assert.False(resultado.PagamentoRecebido);
        Assert.False(resultado.ConfirmacaoChamada);
        Assert.Contains("PW_iSetEnvironment", biblioteca.Chamadas);
        Assert.DoesNotContain(biblioteca.Chamadas, chamada => chamada.StartsWith("PW_iNewTransac", StringComparison.Ordinal));
        Assert.DoesNotContain("PW_iExecTransac", biblioteca.Chamadas);
        Assert.DoesNotContain("PW_iConfirmation", biblioteca.Chamadas);
        Assert.Equal("instalada", journal?.Status);
        Assert.Equal("instalacao", journal?.Operacao);
        Assert.False(journal!.PagamentoRecebido);
        Assert.False(journal.ConfirmacaoChamada);
        Assert.Equal("ponto_instalado", consulta.Codigo);
        Assert.Contains("homologação", consulta.Mensagem);
        Assert.Equal("instalada", repetida.Situacao);
        Assert.Equal(1, biblioteca.Chamadas.Count(chamada => chamada == "PW_iSetEnvironment"));
        Assert.Null(new RepositorioJournal(_raiz).Buscar(_empresaA, _terminalA, "instala-de-novo"));
    }

    [Fact]
    public void Chamada_invalida_sem_registro_da_biblioteca_nao_instala_o_ponto()
    {
        var biblioteca = new BibliotecaRoteiro { CodigoAmbiente = CodigosPgWeb.InvCall };
        biblioteca.Resultados[InformacaoPgWeb.MensagemResultado] = "CHAMADA INVALIDA";

        var resultado = CriarMotor().Instalar(Pedido(_empresaA, _terminalA, "instala-generica", "", 1), biblioteca, null);

        Assert.Equal("ambiente_recusado", resultado.Situacao);
        Assert.Equal(CodigosPgWeb.InvCall, resultado.Codigo);
        Assert.Equal("recusada", new RepositorioJournal(_raiz).Buscar(_empresaA, _terminalA, "instala-generica")?.Status);
        Assert.DoesNotContain(biblioteca.Chamadas, chamada => chamada.StartsWith("PW_iNewTransac", StringComparison.Ordinal));
    }

    [Fact]
    public void Terminal_instalado_em_outro_ambiente_nao_e_reconhecido()
    {
        GravarAmbiente(_empresaA, "PROD");
        var biblioteca = BibliotecaComTerminalInstalado(_empresaA);

        var resultado = CriarMotor().Instalar(Pedido(_empresaA, _terminalA, "instala-prod-no-teste", "", 1), biblioteca, null);
        var consulta = CriarMotor().Consultar(Contexto(_empresaA, _terminalA), null, null);

        Assert.Equal("ambiente_recusado", resultado.Situacao);
        Assert.Contains("PROD", resultado.Mensagem);
        Assert.Contains("TESTE", resultado.Mensagem);
        Assert.Equal("recusada", new RepositorioJournal(_raiz).Buscar(_empresaA, _terminalA, "instala-prod-no-teste")?.Status);
        Assert.Equal("ponto_nao_instalado", consulta.Codigo);
        Assert.DoesNotContain(biblioteca.Chamadas, chamada => chamada.StartsWith("PW_iNewTransac", StringComparison.Ordinal));
    }

    [Fact]
    public void Reconhecimento_do_ponto_nao_autoriza_venda()
    {
        GravarAmbiente(_empresaA, "PROD");
        var biblioteca = BibliotecaComTerminalInstalado(_empresaA);
        var producao = Contexto(_empresaA, _terminalA) with { Ambiente = CodigosPgWeb.AmbienteProducao };
        var motor = CriarMotor();

        var instalacao = motor.Instalar(Pedido(_empresaA, _terminalA, "instala-prod", "", 1) with { Contexto = producao }, biblioteca, null);
        biblioteca.EhNativa = true;
        biblioteca.OperacaoFinanceiraAutorizada = false;
        var venda = motor.Vender(Pedido(_empresaA, _terminalA, "venda-prod", InformacaoPgWeb.Debito, 1) with { Contexto = producao }, biblioteca, null);

        Assert.Equal("instalada", instalacao.Situacao);
        Assert.Contains("PROD", instalacao.Mensagem);
        Assert.DoesNotContain("homologação", instalacao.Mensagem);
        Assert.Equal("autorizacao_ausente", venda.Situacao);
        Assert.False(venda.PagamentoRecebido);
        Assert.Equal(1, biblioteca.Chamadas.Count(chamada => chamada == "PW_iSetEnvironment"));
        Assert.DoesNotContain(biblioteca.Chamadas, chamada => chamada.StartsWith("PW_iNewTransac", StringComparison.Ordinal));
    }

    [Fact]
    public void Venda_nao_trata_chamada_invalida_de_ambiente_como_instalacao()
    {
        GravarAmbiente(_empresaA, "TESTE");
        var biblioteca = BibliotecaDeVenda();
        biblioteca.CodigoAmbiente = CodigosPgWeb.InvCall;
        biblioteca.RegistrarTerminalInstalado = true;
        biblioteca.DiretorioDados = DiretorioDados(_empresaA);
        biblioteca.Resultados[InformacaoPgWeb.MensagemResultado] = "CHAMADA INVALIDA";

        var resultado = CriarMotor().Vender(Pedido(_empresaA, _terminalA, "venda-ambiente", InformacaoPgWeb.Debito, 1), biblioteca, null);

        Assert.Equal("ambiente_recusado", resultado.Situacao);
        Assert.Equal(CodigosPgWeb.InvCall, resultado.Codigo);
        Assert.False(resultado.PagamentoRecebido);
        Assert.DoesNotContain(biblioteca.Chamadas, chamada => chamada.StartsWith("PW_iNewTransac", StringComparison.Ordinal));
        Assert.Equal("recusada", new RepositorioJournal(_raiz).Buscar(_empresaA, _terminalA, "venda-ambiente")?.Status);
    }

    [Fact]
    public void Resultado_desconhecido_nao_e_alterado_pela_tentativa_de_instalacao()
    {
        var journals = new RepositorioJournal(_raiz);
        var momento = DateTimeOffset.Parse("2026-10-26T21:07:02.3520573+00:00");
        journals.Gravar(new JournalOperacao(_empresaA, _terminalA, null, "pendente", "venda-desconhecida", "resultado_desconhecido", 6500, false, false, momento, Operacao: "venda"));
        var biblioteca = new BibliotecaRoteiro { CodigoAmbiente = CodigosPgWeb.InvCall };
        biblioteca.Resultados[InformacaoPgWeb.MensagemResultado] = "CHAMADA INVALIDA";

        var resultado = CriarMotor().Instalar(Pedido(_empresaA, _terminalA, "instala-com-pendencia", "", 1), biblioteca, null);
        var preservado = journals.Buscar(_empresaA, _terminalA, "venda-desconhecida");

        Assert.Equal("pendencia_anterior", resultado.Situacao);
        Assert.Empty(biblioteca.Chamadas);
        Assert.Equal("resultado_desconhecido", preservado?.Status);
        Assert.Equal(momento, preservado?.AtualizadoEm);
        Assert.False(preservado!.PagamentoRecebido);
        Assert.False(preservado.ConfirmacaoChamada);
        Assert.Equal(6500, preservado.ValorCentavos);
        Assert.Null(journals.Buscar(_empresaA, _terminalA, "instala-com-pendencia"));
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

        Assert.Equal("interrompida", recusa.Situacao);
        Assert.False(recusa.PagamentoRecebido);
        Assert.Contains("CANCELADA", recusa.Mensagem);
        Assert.Contains("PW_iPPAbort", biblioteca.Chamadas);
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
    public void Cancelamento_no_menu_registra_operacao_cancelada_sem_pagamento()
    {
        var biblioteca = BibliotecaDeVenda();
        biblioteca.TipoCaptura = TipoDadoPgWeb.Menu;
        biblioteca.ValoresMenu = ["01", "02"];
        biblioteca.Roteiro = new Queue<short>([CodigosPgWeb.MoreData, CodigosPgWeb.Cancel]);
        biblioteca.Resultados[InformacaoPgWeb.MensagemResultado] = "OPERACAO CANCELADA";
        var resultado = CriarMotor().Vender(Pedido(_empresaA, _terminalA, "menu-cancelado", InformacaoPgWeb.Debito, 1), biblioteca, new CapturaQueCancela());

        Assert.Equal("interrompida", resultado.Situacao);
        Assert.False(resultado.PagamentoRecebido);
        Assert.False(resultado.ConfirmacaoChamada);
        Assert.Equal("OPERACAO CANCELADA", resultado.Mensagem);
        Assert.Contains("PW_iPPAbort", biblioteca.Chamadas);
        Assert.DoesNotContain("PW_iConfirmation", biblioteca.Chamadas);
        Assert.Equal(1, biblioteca.Chamadas.Count(chamada => chamada.StartsWith("PW_iNewTransac", StringComparison.Ordinal)));
    }

    [Fact]
    public void Cancelamento_depois_da_autorizacao_desfaz_e_nao_recebe_pagamento()
    {
        var biblioteca = BibliotecaDeVenda();
        biblioteca.TipoCaptura = TipoDadoPgWeb.Menu;
        biblioteca.ValoresMenu = ["01", "02"];
        biblioteca.Resultados[InformacaoPgWeb.MensagemResultado] = "TRANSACAO AUTORIZADA";
        var resultado = CriarMotor().Vender(Pedido(_empresaA, _terminalA, "menu-desfazer", InformacaoPgWeb.Debito, 1), biblioteca, new CapturaQueCancela());

        Assert.Equal("interrompida", resultado.Situacao);
        Assert.False(resultado.PagamentoRecebido);
        Assert.True(resultado.ConfirmacaoChamada);
        Assert.Equal(ConfirmacaoPgWeb.DesfazimentoAborto, biblioteca.UltimoStatusConfirmacao);
        Assert.DoesNotContain(biblioteca.Chamadas, chamada => chamada.StartsWith("PW_iNewTransac:22", StringComparison.Ordinal));
    }

    [Fact]
    public void Venda_aprovada_sem_confirmacao_nao_e_desfeita_ao_voltar()
    {
        var biblioteca = BibliotecaDeVenda();
        biblioteca.TipoCaptura = TipoDadoPgWeb.Menu;
        biblioteca.ValoresMenu = ["01", "02"];
        biblioteca.EhNativa = true;
        biblioteca.OperacaoFinanceiraAutorizada = true;
        biblioteca.Resultados[InformacaoPgWeb.ConfirmacaoRequerida] = "0";
        biblioteca.Resultados[InformacaoPgWeb.MensagemResultado] = "TRANSACAO AUTORIZADA";
        var resultado = CriarMotor().Vender(Pedido(_empresaA, _terminalA, "menu-aprovada", InformacaoPgWeb.Debito, 1), biblioteca, new CapturaQueCancela());

        Assert.Equal("aprovada_sem_confirmacao", resultado.Situacao);
        Assert.True(resultado.PagamentoRecebido);
        Assert.DoesNotContain("PW_iConfirmation", biblioteca.Chamadas);
        Assert.Equal(1, biblioteca.Chamadas.Count(chamada => chamada.StartsWith("PW_iNewTransac", StringComparison.Ordinal)));
    }

    [Fact]
    public void Cancelamento_durante_o_pinpad_chama_abort_sem_esperar_o_timeout()
    {
        var biblioteca = BibliotecaDeVenda();
        biblioteca.TipoCaptura = TipoDadoPgWeb.Cartao;
        biblioteca.BloquearEventoAteAbortar = true;
        biblioteca.Resultados[InformacaoPgWeb.MensagemResultado] = "OPERACAO CANCELADA";
        var inicio = DateTime.UtcNow;
        var resultado = CriarMotor().Vender(Pedido(_empresaA, _terminalA, "pinpad-abort", InformacaoPgWeb.Debito, 1), biblioteca, new CapturaCancelaNoPinPad());

        Assert.True(DateTime.UtcNow - inicio < TimeSpan.FromSeconds(4));
        Assert.Equal("interrompida", resultado.Situacao);
        Assert.False(resultado.PagamentoRecebido);
        Assert.Contains("PW_iPPGetCard", biblioteca.Chamadas);
        Assert.Contains("PW_iPPEventLoop", biblioteca.Chamadas);
        Assert.Contains("PW_iPPAbort", biblioteca.Chamadas);
        Assert.Equal(1, biblioteca.Chamadas.Count(chamada => chamada == "PW_iPPAbort"));
        Assert.DoesNotContain(biblioteca.Chamadas, chamada => chamada.StartsWith("PW_iNewTransac:22", StringComparison.Ordinal));
        Assert.Equal(1, biblioteca.Chamadas.Count(chamada => chamada.StartsWith("PW_iNewTransac", StringComparison.Ordinal)));
    }

    [Fact]
    public void Timeout_e_cancelamento_do_pinpad_geram_um_unico_resultado()
    {
        var journals = new RepositorioJournal(_raiz);
        var biblioteca = BibliotecaDeVenda();
        biblioteca.TipoCaptura = TipoDadoPgWeb.Cartao;
        biblioteca.BloquearEventoAteAbortar = true;
        biblioteca.CodigoAposAbortar = CodigosPgWeb.Timeout;
        biblioteca.Resultados[InformacaoPgWeb.MensagemResultado] = "OPERACAO CANCELADA";
        var resultado = new MotorPayGo(journals, new CoordenadorSessao()).Vender(
            Pedido(_empresaA, _terminalA, "pinpad-timeout", InformacaoPgWeb.Debito, 1),
            biblioteca,
            new CapturaCancelaNoPinPad());

        Assert.Equal("interrompida", resultado.Situacao);
        Assert.False(resultado.PagamentoRecebido);
        Assert.Equal(1, biblioteca.Chamadas.Count(chamada => chamada == "PW_iPPAbort"));
        var gravados = journals.Listar(_empresaA, _terminalA).Where(journal => journal.ChaveIdempotencia == "pinpad-timeout").ToArray();
        Assert.Single(gravados);
        Assert.Equal("interrompida", gravados[0].Status);
        Assert.False(gravados[0].PagamentoRecebido);
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

    [Fact]
    public void Pix_envia_o_valor_sem_tipo_de_cartao_e_recusa_parcelamento()
    {
        var biblioteca = BibliotecaDeVenda();
        biblioteca.TipoCaptura = TipoDadoPgWeb.QrCodeCheckout;
        biblioteca.IdentificadorCaptura = InformacaoPgWeb.MensagemResultado;
        var resultado = CriarMotor().Vender(Pedido(_empresaA, _terminalA, "pix-1", InformacaoPgWeb.Pix, 1), biblioteca, new CapturaFixa("exibido"));

        Assert.False(resultado.PagamentoRecebido);
        Assert.Contains(biblioteca.Parametros, item => item.Identificador == InformacaoPgWeb.ValorTotal && item.Valor == "100");
        Assert.DoesNotContain(biblioteca.Parametros, item => item.Identificador == InformacaoPgWeb.TipoCartao);
        Assert.Contains(biblioteca.Chamadas, chamada => chamada.StartsWith("PW_iNewTransac:21", StringComparison.Ordinal));

        var parcelado = BibliotecaDeVenda();
        var recusa = CriarMotor().Vender(Pedido(_empresaA, _terminalA, "pix-parcelas", InformacaoPgWeb.Pix, 3), parcelado, null);
        Assert.Equal("parcelamento_recusado", recusa.Situacao);
        Assert.DoesNotContain(parcelado.Chamadas, chamada => chamada.StartsWith("PW_iNewTransac", StringComparison.Ordinal));
    }

    [Fact]
    public void Cancelamento_usa_o_journal_do_ambiente_e_nao_apaga_o_outro()
    {
        var homo = new RepositorioJournal(Path.Combine(_raiz, "homo"));
        var prod = new RepositorioJournal(Path.Combine(_raiz, "prod"));
        var chave = "11111111-1111-4111-8111-111111111111:debito:100";
        prod.Gravar(new JournalOperacao(_empresaA, _terminalA, null, "venda-prod", chave, "confirmada", 100, true, true, DateTimeOffset.UtcNow, Operacao: "venda"));
        var motorHomo = new MotorPayGo(homo, new CoordenadorSessao());
        var motorProd = new MotorPayGo(prod, new CoordenadorSessao());
        var biblioteca = BibliotecaDeVenda();

        var cruzado = motorHomo.Cancelar(Pedido(_empresaA, _terminalA, chave, InformacaoPgWeb.Debito, 1), biblioteca, null);
        Assert.Equal("cancelamento_sem_venda", cruzado.Situacao);
        Assert.Empty(biblioteca.Chamadas);
        Assert.Equal("confirmada", prod.Buscar(_empresaA, _terminalA, chave)!.Status);

        var producao = motorProd.Cancelar(Pedido(_empresaA, _terminalA, chave, InformacaoPgWeb.Debito, 1) with
        {
            Contexto = Contexto(_empresaA, _terminalA) with { Ambiente = CodigosPgWeb.AmbienteProducao, Servidor = "producao" },
        }, biblioteca, null);
        Assert.NotEqual("cancelamento_bloqueado", producao.Situacao);
        Assert.Contains(biblioteca.Chamadas, chamada => chamada.StartsWith("PW_iNewTransac:22", StringComparison.Ordinal));
        Assert.Equal("confirmada", prod.Buscar(_empresaA, _terminalA, chave)!.Status);
        Assert.NotNull(prod.Buscar(_empresaA, _terminalA, "cancelamento:" + chave));
    }

    [Fact]
    public void Venda_confirmada_grava_as_duas_vias_e_nao_cruza_empresa()
    {
        var estabelecimento = "VIA ESTABELECIMENTO\nDEBITO A VISTA\n" + new string('E', 3000);
        var cliente = "VIA CLIENTE\nDEBITO A VISTA\n" + new string('C', 2800);
        var biblioteca = BibliotecaDeVenda();
        biblioteca.EhNativa = true;
        biblioteca.OperacaoFinanceiraAutorizada = true;
        biblioteca.Resultados[InformacaoPgWeb.ComprovanteEstabelecimento] = estabelecimento;
        biblioteca.Resultados[InformacaoPgWeb.ComprovanteCliente] = cliente;
        biblioteca.Resultados[InformacaoPgWeb.ComprovanteReduzido] = "CUPOM REDUZIDO";
        var motor = CriarMotor();
        var chave = "via-debito";

        var autorizada = motor.Vender(Pedido(_empresaA, _terminalA, chave, InformacaoPgWeb.Debito, 1), biblioteca, null);
        Assert.Equal("aguardando_confirmacao", autorizada.Situacao);
        var pendente = new RepositorioJournal(_raiz).Buscar(_empresaA, _terminalA, chave);
        Assert.Equal(estabelecimento, pendente!.ViaEstabelecimento);
        Assert.Equal(cliente, pendente.ViaCliente);
        Assert.Contains("\n", pendente.ViaEstabelecimento);
        Assert.Null(motor.Comprovantes(Contexto(_empresaA, _terminalA), chave));
        Assert.DoesNotContain(biblioteca.InformacoesLidas, codigo => codigo == InformacaoPgWeb.ComprovanteReduzido);
        Assert.Contains(biblioteca.Parametros, parametro => parametro.Identificador == InformacaoPgWeb.CapacidadeAutomacao && parametro.Valor == "12");

        var confirmada = motor.Confirmar(new PedidoConfirmacao(Contexto(_empresaA, _terminalA), chave, ConfirmacaoPgWeb.Automatica), biblioteca);
        Assert.Equal("confirmada", confirmada.Situacao);
        var vias = motor.Comprovantes(Contexto(_empresaA, _terminalA), chave);
        Assert.Equal(estabelecimento, vias!.ViaEstabelecimento);
        Assert.Equal(cliente, vias.ViaCliente);
        Assert.NotEqual(vias.ViaEstabelecimento, vias.ViaCliente);
        Assert.Null(motor.Comprovantes(Contexto(_empresaB, _terminalB), chave));
        Assert.Null(new RepositorioJournal(Path.Combine(_raiz, "outro-ambiente")).Buscar(_empresaA, _terminalA, chave));

        biblioteca.Resultados.Remove(InformacaoPgWeb.ComprovanteCliente);
        var incompleta = CriarMotor().Vender(Pedido(_empresaA, _terminalA, "via-incompleta", InformacaoPgWeb.Debito, 1), biblioteca, null);
        Assert.Equal("aguardando_confirmacao", incompleta.Situacao);
        var parcial = new RepositorioJournal(_raiz).Buscar(_empresaA, _terminalA, "via-incompleta");
        Assert.Equal(estabelecimento, parcial!.ViaEstabelecimento);
        Assert.Null(parcial.ViaCliente);
        var confirmacaoParcial = CriarMotor().Confirmar(new PedidoConfirmacao(Contexto(_empresaA, _terminalA), "via-incompleta", ConfirmacaoPgWeb.Automatica), biblioteca);
        Assert.Equal("confirmada", confirmacaoParcial.Situacao);
        Assert.Null(CriarMotor().Comprovantes(Contexto(_empresaA, _terminalA), "via-incompleta"));

        biblioteca.Resultados[InformacaoPgWeb.ComprovanteCliente] = cliente;
        biblioteca.Resultados[InformacaoPgWeb.ComprovanteEstabelecimento] = new string('X', 4096);
        var estouro = CriarMotor().Vender(Pedido(_empresaA, _terminalA, "via-estouro", InformacaoPgWeb.Debito, 1), biblioteca, null);
        Assert.Equal("aguardando_confirmacao", estouro.Situacao);
        Assert.Null(new RepositorioJournal(_raiz).Buscar(_empresaA, _terminalA, "via-estouro")!.ViaEstabelecimento);
        Assert.Contains(biblioteca.Chamadas, chamada => chamada == "PW_iGetResult");
    }

    [Fact]
    public void Mais_de_quarenta_retornos_nada_a_fazer_seguem_ate_a_aprovacao_da_biblioteca()
    {
        var biblioteca = BibliotecaDeVenda();
        biblioteca.Roteiro = RoteiroNada(41, CodigosPgWeb.Ok);
        var resultado = MotorRapido().Vender(Pedido(_empresaA, _terminalA, "pix-espera-ok", InformacaoPgWeb.Debito, 1), biblioteca, null);

        Assert.Equal("aguardando_confirmacao", resultado.Situacao);
        Assert.Equal(CodigosPgWeb.Ok, resultado.Codigo);
        Assert.False(resultado.PagamentoRecebido);
        Assert.False(resultado.ConfirmacaoChamada);
        Assert.Equal(42, biblioteca.Chamadas.Count(chamada => chamada == "PW_iExecTransac"));
        Assert.DoesNotContain("PW_iConfirmation", biblioteca.Chamadas);
        Assert.DoesNotContain(biblioteca.Parametros, item => item.Identificador == InformacaoPgWeb.QrCodeAutorizador);
        Assert.DoesNotContain(biblioteca.InformacoesLidas, informacao => informacao == InformacaoPgWeb.QrCodeAutorizador);
    }

    [Fact]
    public void Mais_de_quarenta_retornos_nada_a_fazer_aceitam_o_cancelamento_do_operador()
    {
        var biblioteca = BibliotecaDeVenda();
        biblioteca.Roteiro = RoteiroNada(41, CodigosPgWeb.Cancel);
        biblioteca.Resultados[InformacaoPgWeb.MensagemResultado] = "OPERACAO CANCELADA";
        var resultado = MotorRapido().Vender(
            Pedido(_empresaA, _terminalA, "pix-espera-cancelada", InformacaoPgWeb.Debito, 1),
            biblioteca,
            new CapturaQuePedeCancelamento());

        Assert.Equal("interrompida", resultado.Situacao);
        Assert.Equal(CodigosPgWeb.Cancel, resultado.Codigo);
        Assert.False(resultado.PagamentoRecebido);
        Assert.Equal(1, biblioteca.Chamadas.Count(chamada => chamada == "PW_iPPAbort"));
        Assert.DoesNotContain("PW_iConfirmation", biblioteca.Chamadas);
        Assert.True(biblioteca.Chamadas.Count(chamada => chamada == "PW_iExecTransac") > 40);
    }

    [Fact]
    public void Mais_de_quarenta_retornos_nada_a_fazer_preservam_o_erro_real_da_biblioteca()
    {
        var biblioteca = BibliotecaDeVenda();
        biblioteca.Roteiro = RoteiroNada(41, CodigosPgWeb.PpComErr);
        var erro = MotorRapido().Vender(Pedido(_empresaA, _terminalA, "pix-espera-erro", InformacaoPgWeb.Debito, 1), biblioteca, null);

        Assert.Equal("resultado_desconhecido", erro.Situacao);
        Assert.Equal(CodigosPgWeb.PpComErr, erro.Codigo);
        Assert.NotEqual(CodigosPgWeb.Timeout, erro.Codigo);
        Assert.False(erro.PagamentoRecebido);
        Assert.DoesNotContain("PW_iConfirmation", biblioteca.Chamadas);

        var timeout = BibliotecaDeVenda();
        timeout.Roteiro = RoteiroNada(41, CodigosPgWeb.Timeout);
        var real = MotorRapido().Vender(Pedido(_empresaA, _terminalB, "pix-espera-timeout", InformacaoPgWeb.Debito, 1), timeout, null);
        Assert.Equal("resultado_desconhecido", real.Situacao);
        Assert.Equal(CodigosPgWeb.Timeout, real.Codigo);
        Assert.DoesNotContain("PW_iConfirmation", timeout.Chamadas);
    }

    [Fact]
    public void Espera_local_nao_falsifica_o_timeout_da_biblioteca()
    {
        var journals = new RepositorioJournal(_raiz);
        var biblioteca = BibliotecaDeVenda();
        biblioteca.Roteiro = RoteiroNada(8, CodigosPgWeb.Ok);
        var instante = new DateTimeOffset(2026, 10, 26, 21, 6, 0, TimeSpan.Zero);
        var motor = new MotorPayGo(journals, new CoordenadorSessao())
        {
            Espera = new EsperaBiblioteca
            {
                Limite = TimeSpan.FromSeconds(30),
                Agora = () => instante,
                Pausa = () => instante = instante.AddSeconds(31),
            },
        };

        var resultado = motor.Vender(Pedido(_empresaA, _terminalA, "pix-espera-local", InformacaoPgWeb.Pix, 1), biblioteca, null);

        Assert.Equal("espera_local_encerrada", resultado.Situacao);
        Assert.Equal(MotorPayGo.CodigoEsperaLocal, resultado.Codigo);
        Assert.NotEqual(CodigosPgWeb.Timeout, resultado.Codigo);
        Assert.False(resultado.PagamentoRecebido);
        Assert.False(resultado.ConfirmacaoChamada);
        Assert.DoesNotContain("PW_iConfirmation", biblioteca.Chamadas);
        Assert.Equal(2, biblioteca.Chamadas.Count(chamada => chamada == "PW_iExecTransac"));
        var journal = journals.Buscar(_empresaA, _terminalA, "pix-espera-local");
        Assert.NotNull(journal);
        Assert.Equal("resultado_desconhecido", journal.Status);
        Assert.False(journal.PagamentoRecebido);
        Assert.False(journal.ConfirmacaoChamada);
    }

    [Fact]
    public void Qr_do_checkout_le_o_payload_e_o_pinpad_continua_sem_essa_leitura()
    {
        var checkout = BibliotecaDeVenda();
        checkout.TipoCaptura = TipoDadoPgWeb.QrCodeCheckout;
        checkout.Resultados[InformacaoPgWeb.QrCodeAutorizador] = "qr-teste-homologacao";
        var captura = new CapturaQr();
        var exibido = MotorRapido().Vender(Pedido(_empresaA, _terminalA, "pix-qr-checkout", InformacaoPgWeb.Pix, 1), checkout, captura);

        Assert.Equal("aguardando_confirmacao", exibido.Situacao);
        Assert.Equal("qr-teste-homologacao", captura.Qr);
        Assert.Equal("", checkout.UltimoValor);
        Assert.Contains(checkout.InformacoesLidas, informacao => informacao == InformacaoPgWeb.QrCodeAutorizador);
        Assert.DoesNotContain(checkout.Parametros, item => item.Identificador == 0x7F50);

        var pinpad = BibliotecaDeVenda();
        pinpad.Roteiro = RoteiroNada(2, CodigosPgWeb.Ok);
        pinpad.Resultados[InformacaoPgWeb.QrCodeAutorizador] = "qr-teste-homologacao";
        var noPinPad = MotorRapido().Vender(Pedido(_empresaA, _terminalB, "pix-qr-pinpad", InformacaoPgWeb.Debito, 1), pinpad, null);
        Assert.Equal("aguardando_confirmacao", noPinPad.Situacao);
        Assert.DoesNotContain(pinpad.InformacoesLidas, informacao => informacao == InformacaoPgWeb.QrCodeAutorizador);
        Assert.DoesNotContain(pinpad.Parametros, item => item.Identificador == 0x7F50);
    }

    private MotorPayGo MotorRapido()
    {
        var motor = CriarMotor();
        motor.Espera = new EsperaBiblioteca
        {
            Limite = TimeSpan.FromMinutes(4),
            Agora = () => new DateTimeOffset(2026, 10, 26, 21, 6, 0, TimeSpan.Zero),
            Pausa = () => { },
        };
        return motor;
    }

    private static Queue<short> RoteiroNada(int quantidade, short final)
    {
        var roteiro = new Queue<short>();
        for (var indice = 0; indice < quantidade; indice++)
        {
            roteiro.Enqueue(CodigosPgWeb.Nothing);
        }

        roteiro.Enqueue(final);
        return roteiro;
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
        return new ContextoEmpresa("usuario", empresa, terminal, "cnpj-teste", CodigosPgWeb.AmbienteTeste, "ponto-teste", "homologacao.exemplo", DiretorioDados(empresa));
    }

    private string DiretorioDados(Guid empresa)
    {
        return Path.Combine(_raiz, empresa.ToString("N"), "Data");
    }

    private void GravarAmbiente(Guid empresa, string token)
    {
        var pasta = Path.Combine(DiretorioDados(empresa), "Log");
        Directory.CreateDirectory(pasta);
        File.WriteAllText(Path.Combine(pasta, "comms_261024.log"), $"09:38:41:191 *** AMBIENTE ALTERADO: [{token}] ***{Environment.NewLine}");
    }

    private BibliotecaRoteiro BibliotecaComTerminalInstalado(Guid empresa)
    {
        return new BibliotecaRoteiro
        {
            CodigoAmbiente = CodigosPgWeb.InvCall,
            DiretorioDados = DiretorioDados(empresa),
            RegistrarTerminalInstalado = true,
        };
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

    private sealed class CapturaCancelaNoPinPad : ICapturaOperador
    {
        private int _consultas;

        public bool ConsumirCancelamento() => Interlocked.Increment(ref _consultas) > 1;

        public bool TentarResponder(PwGetData pedido, out string valor)
        {
            _ = pedido;
            valor = "";
            return false;
        }
    }

    private sealed class CapturaQueCancela : ICapturaOperador
    {
        public bool TentarResponder(PwGetData pedido, out string valor)
        {
            _ = pedido;
            valor = "";
            return false;
        }
    }

    private sealed class CapturaQuePedeCancelamento : ICapturaOperador
    {
        public bool ConsumirCancelamento() => true;

        public bool TentarResponder(PwGetData pedido, out string valor)
        {
            _ = pedido;
            valor = "";
            return false;
        }
    }

    private sealed class CapturaQr : ICapturaOperador
    {
        public string? Qr { get; private set; }

        public void ReceberQrCode(string payload) => Qr = payload;

        public bool TentarResponder(PwGetData pedido, out string valor)
        {
            _ = pedido;
            valor = "exibido";
            return true;
        }
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

    public bool EhNativa { get; set; }

    public bool OperacaoFinanceiraAutorizada { get; set; }

    public bool InstalacaoProducaoAutorizada => false;

    public List<string> Chamadas { get; } = new();

    public List<(ushort Identificador, string Valor)> Parametros { get; } = new();

    public short ProximaExecucao { get; set; } = CodigosPgWeb.Ok;

    public byte TipoCaptura { get; set; }

    public ushort IdentificadorCaptura { get; set; }

    public Queue<short>? Roteiro { get; set; }

    public string? ValorMenuUnico { get; set; }

    public string[]? ValoresMenu { get; set; }

    public string? UltimoValor { get; private set; }

    public ushort UltimoIdentificador { get; private set; }

    public Dictionary<ushort, string> Resultados { get; } = new();

    public List<short> InformacoesLidas { get; } = new();

    public string? ReferenciaLocalConfirmada { get; private set; }

    public string? ReferenciaExternaConfirmada { get; private set; }

    public short CodigoAmbiente { get; set; } = CodigosPgWeb.Ok;

    public string? DiretorioDados { get; set; }

    public bool RegistrarTerminalInstalado { get; set; }

    public short DefinirAmbiente(short ambiente)
    {
        Chamadas.Add("PW_iSetEnvironment");
        _ = ambiente;
        if (RegistrarTerminalInstalado && !string.IsNullOrWhiteSpace(DiretorioDados))
        {
            var pasta = Path.Combine(DiretorioDados, "Log");
            Directory.CreateDirectory(pasta);
            var arquivo = Directory.GetFiles(pasta, "comms_*.log").OrderBy(Path.GetFileName, StringComparer.OrdinalIgnoreCase).LastOrDefault()
                ?? Path.Combine(pasta, "comms_261028.log");
            File.AppendAllText(arquivo, "[PW_iSetEnvironment] TENTATIVA DE ALTERAR AMBIENTE COM O TERMINAL INSTALADO" + Environment.NewLine);
        }

        return CodigoAmbiente;
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
        Parametros.Add((identificador, valor));
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
        InformacoesLidas.Add(informacao);
        if (!Resultados.TryGetValue((ushort)informacao, out var texto))
        {
            return CodigosPgWeb.NoData;
        }

        var bytes = Encoding.Latin1.GetBytes(texto + "\0");
        if (bytes.Length > destino.Length)
        {
            return CodigosPgWeb.BufOvflw;
        }

        bytes.CopyTo(destino);
        return CodigosPgWeb.Ok;
    }

    public uint UltimoStatusConfirmacao { get; private set; }

    public short Confirmar(uint status, string numeroRequisicao, string referenciaLocal, string referenciaExterna, string estabelecimentoVirtual, string sistemaAutorizador)
    {
        Chamadas.Add("PW_iConfirmation");
        UltimoStatusConfirmacao = status;
        _ = status;
        _ = numeroRequisicao;
        _ = estabelecimentoVirtual;
        _ = sistemaAutorizador;
        ReferenciaLocalConfirmada = referenciaLocal;
        ReferenciaExternaConfirmada = referenciaExterna;
        return CodigosPgWeb.Ok;
    }

    public bool BloquearEventoAteAbortar { get; set; }
    public short CodigoAposAbortar { get; set; } = CodigosPgWeb.Cancel;
    private int _abortouPinPad;

    public short AbortarPinPad()
    {
        Chamadas.Add("PW_iPPAbort");
        Interlocked.Increment(ref _abortouPinPad);
        return CodigosPgWeb.Ok;
    }

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
        if (!BloquearEventoAteAbortar)
        {
            return CodigosPgWeb.Ok;
        }

        var inicio = DateTime.UtcNow;
        while (Volatile.Read(ref _abortouPinPad) == 0)
        {
            if (DateTime.UtcNow - inicio > TimeSpan.FromSeconds(8))
            {
                return CodigosPgWeb.Timeout;
            }

            Thread.Sleep(20);
        }

        return CodigoAposAbortar;
    }

    public void Encerrar() => Chamadas.Add("PW_End");
}
