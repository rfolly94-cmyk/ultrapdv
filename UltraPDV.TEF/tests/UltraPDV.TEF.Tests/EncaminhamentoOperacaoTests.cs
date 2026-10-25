using UltraPDV.TEF.Interop;
using UltraPDV.TEF.Nucleo;

namespace UltraPDV.TEF.Tests;

public class EncaminhamentoOperacaoTests
{
    [Fact]
    public void Configurar_e_instalar_tem_operacoes_nativas_exclusivas()
    {
        Assert.True(EncaminhamentoOperacao.Tentar("configurar", "PWOPER_CONFIG", out var configuracao));
        Assert.Equal(OperacaoPgWeb.Configuracao, configuracao);
        Assert.Equal(0xFD, configuracao);

        Assert.True(EncaminhamentoOperacao.Tentar("instalar", "PWOPER_INSTALL", out var instalacao));
        Assert.Equal(OperacaoPgWeb.Instalacao, instalacao);
        Assert.Equal(0x01, instalacao);

        Assert.False(EncaminhamentoOperacao.Tentar("configurar", "PWOPER_INSTALL", out _));
        Assert.False(EncaminhamentoOperacao.Tentar("instalar", "PWOPER_CONFIG", out _));
        Assert.True(EncaminhamentoOperacao.ChaveCompativel("configurar", "cfg:ponto", true));
        Assert.False(EncaminhamentoOperacao.ChaveCompativel("configurar", "ins:ponto", true));
        Assert.True(EncaminhamentoOperacao.ChaveCompativel("instalar", "ins:ponto", true));
        Assert.False(EncaminhamentoOperacao.ChaveCompativel("instalar", "cfg:ponto", true));
    }
}
