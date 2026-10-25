using System.Runtime.InteropServices;
using UltraPDV.TEF.Instalacao;
using UltraPDV.TEF.Interop;
using UltraPDV.TEF.Nucleo;

namespace UltraPDV.TEF.Tests;

public class InteroperabilidadeTests
{
    [Fact]
    public void Estrutura_de_captura_mede_12500_bytes()
    {
        Assert.Equal(PwGetData.TamanhoEsperado, Marshal.SizeOf<PwGetData>());
        Assert.Equal(0, (int)Marshal.OffsetOf<PwGetData>(nameof(PwGetData.Identificador)));
        Assert.Equal(2, (int)Marshal.OffsetOf<PwGetData>(nameof(PwGetData.TipoDeDado)));
        Assert.Equal(88, (int)Marshal.OffsetOf<PwGetData>(nameof(PwGetData.TextoMenu)));
        Assert.Equal(1728, (int)Marshal.OffsetOf<PwGetData>(nameof(PwGetData.ValorMenu)));
    }

    [Fact]
    public void Codigos_de_retorno_seguem_o_cabecalho()
    {
        Assert.Equal(0, CodigosPgWeb.Ok);
        Assert.Equal(-2499, CodigosPgWeb.InvParam);
        Assert.Equal(-2498, CodigosPgWeb.NotInst);
        Assert.Equal(-2497, CodigosPgWeb.MoreData);
        Assert.Equal(-2491, CodigosPgWeb.Cancel);
        Assert.Equal(-2490, CodigosPgWeb.Timeout);
        Assert.Equal(-2484, CodigosPgWeb.PpComErr);
        Assert.Equal(-2596, CodigosPgWeb.FromHost);
        Assert.Equal(0, CodigosPgWeb.AmbienteProducao);
        Assert.Equal(1, CodigosPgWeb.AmbienteTeste);
    }

    [Fact]
    public void Inicializacao_ausente_nao_abre_transacao()
    {
        var biblioteca = new BibliotecaSimulada { ProximaInicializacao = CodigosPgWeb.NotInst };
        var fluxo = new FluxoInstalacao();
        var resultado = fluxo.Preparar(Contexto("empresa-a"), biblioteca);

        Assert.Equal(CodigosPgWeb.NotInst, resultado.Codigo);
        Assert.Equal("inicializacao_recusada", resultado.Situacao);
        Assert.DoesNotContain(biblioteca.Chamadas, chamada => chamada.StartsWith("PW_iNewTransac", StringComparison.Ordinal));
        Assert.DoesNotContain("PW_iConfirmation", biblioteca.Chamadas);
    }

    [Fact]
    public void Instalacao_simulada_para_no_dado_pendente_sem_confirmacao()
    {
        var biblioteca = new BibliotecaSimulada();
        var resultado = new FluxoInstalacao().Preparar(Contexto("empresa-a"), biblioteca);

        Assert.False(resultado.Concluida);
        Assert.Equal(CodigosPgWeb.MoreData, resultado.Codigo);
        Assert.Equal(InformacaoPgWeb.UsuarioTecnico, resultado.CapturaPendente);
        Assert.Contains("PW_iInit", biblioteca.Chamadas);
        Assert.Contains("PW_iNewTransac:01", biblioteca.Chamadas);
        Assert.DoesNotContain("PW_iConfirmation", biblioteca.Chamadas);
    }

    [Fact]
    public void Biblioteca_nativa_nao_e_chamada()
    {
        var nativa = new BibliotecaNativaPgWeb();
        Assert.Throws<AutorizacaoAusenteException>(() => new FluxoInstalacao().Preparar(Contexto("empresa-a"), nativa));
        Assert.Throws<AutorizacaoAusenteException>(() => nativa.Confirmar(0, "", "", "", "", ""));
        Assert.Throws<AutorizacaoAusenteException>(() => nativa.NovaTransacao(OperacaoPgWeb.Venda));
        Assert.Throws<AutorizacaoAusenteException>(() => nativa.NovaTransacao(OperacaoPgWeb.CancelamentoVenda));
        Assert.Empty(nativa.Chamadas);
    }

    private static ContextoEmpresa Contexto(string nome)
    {
        var empresa = Guid.NewGuid();
        var terminal = Guid.NewGuid();
        return new ContextoEmpresa(nome, empresa, terminal, "00000000000000", CodigosPgWeb.AmbienteTeste, "ponto", "servidor.exemplo:1", Path.Combine(Path.GetTempPath(), empresa.ToString("N"), "Data"));
    }
}
