using UltraPDV.TEF.Interop;
using UltraPDV.TEF.Nucleo;
using UltraPDV.TEF.Persistencia;

namespace UltraPDV.TEF.Tests;

public class CapturaDigitadaTests
{
    [Fact]
    public void Data_da_venda_original_sai_em_ddmmaa()
    {
        Assert.Equal("181126", Enviar(0x57, 5, "18/11/2026"));
        Assert.Equal("181126", Enviar(0x57, 5, "18112026"));
        Assert.NotEqual("18112026", Enviar(0x57, 5, "18112026"));
        Assert.Equal("051126", Enviar(0x57, 0, "05/11/2026"));
        Assert.Equal("110526", Enviar(0x57, 5, "11/05/2026"));
        Assert.Equal("010226", Enviar(0x57, 5, "01/02/2026"));
        Assert.Equal("290224", Enviar(0x57, 5, "29/02/2024"));
        Assert.Equal("181126", Enviar(0x57, 5, "2026-11-18"));
        Assert.False(DicionarioCaptura.DataDdmmaa("31/02/2026", out _, out _));
        Assert.False(DicionarioCaptura.DataDdmmaa("29/02/2026", out _, out _));
        var conflito = DicionarioCaptura.Aplicar(0x57, 4, "12/2026", out var tratado, out var valor, out var erro);
        Assert.False(conflito);
        Assert.True(tratado);
        Assert.Equal("", valor);
        Assert.Contains("diverge", erro);
    }

    [Fact]
    public void Data_brasileira_vai_sem_mascara_e_preserva_zeros()
    {
        var pedido = Pedido(TipoDadoPgWeb.Digitado, 1, 6, 6, 5);
        TextoCaptura.EscreverMascara(ref pedido, "@@/@@/@@");

        var aceito = CapturaDigitada.Tentar(ref pedido, "01/02/2003", out var valor, out var erro);

        Assert.True(aceito);
        Assert.Equal("", erro);
        Assert.Equal("010203", valor);
    }

    private static string Enviar(ushort identificador, byte validacao, string entrada)
    {
        var pedido = Pedido(TipoDadoPgWeb.Digitado, 1, 0, 0, validacao);
        pedido.Identificador = identificador;
        var aceito = CapturaDigitada.Tentar(ref pedido, entrada, out var valor, out var erro);
        Assert.True(aceito, erro);
        return valor;
    }

    [Fact]
    public void Identificador_nao_perde_zeros_nem_vira_inteiro()
    {
        var pedido = Pedido(TipoDadoPgWeb.Digitado, 1, 6, 6, 0);

        var aceito = CapturaDigitada.Tentar(ref pedido, "000123", out var valor, out _);

        Assert.True(aceito);
        Assert.Equal("000123", valor);
    }

    [Fact]
    public void Tipo_zero_envia_o_valor_inicial_e_ignora_a_digitacao()
    {
        var pedido = Pedido(TipoDadoPgWeb.Digitado, 0, 0, 0, 0);
        TextoCaptura.EscreverValorInicial(ref pedido, "200001");

        var aceito = CapturaDigitada.Tentar(ref pedido, "999999", out var valor, out _);

        Assert.True(aceito);
        Assert.Equal("200001", valor);
    }

    [Fact]
    public void Senha_tecnica_nao_entra_na_mensagem_de_erro()
    {
        var pedido = Pedido(TipoDadoPgWeb.AutenticacaoUsuario, 1, 6, 6, 0);
        pedido.OcultarDadosDigitados = 1;

        var aceito = CapturaDigitada.Tentar(ref pedido, "12", out _, out var erro);

        Assert.False(aceito);
        Assert.DoesNotContain("12", erro);
    }

    [Fact]
    public void Codigo_de_barras_remove_a_mascara()
    {
        var pedido = Pedido(TipoDadoPgWeb.CodigoBarras, 0, 0, 0, 0);
        TextoCaptura.EscreverMascara(ref pedido, "@@@@@.@@@@@");

        var aceito = CapturaDigitada.Tentar(ref pedido, "12345.67890", out var valor, out _);

        Assert.True(aceito);
        Assert.Equal("1234567890", valor);
    }

    [Fact]
    public void Sugestao_leva_valor_data_e_referencia_sem_nsu()
    {
        var journal = new JournalOperacao(
            Guid.NewGuid(),
            Guid.NewGuid(),
            Guid.NewGuid(),
            "venda-1",
            "chave",
            "confirmada",
            200,
            true,
            true,
            new DateTimeOffset(2026, 11, 18, 13, 52, 0, TimeSpan.FromHours(-4)),
            "0000000010",
            "00052",
            "EXT-9",
            AutorizacaoFiscal: "ABC");

        var mapa = SugestaoVendaOriginal.Montar(journal);

        Assert.Equal("2,00", mapa[InformacaoPgWeb.ValorTransacaoOriginal]);
        Assert.Equal("2,00", mapa[InformacaoPgWeb.ValorTotal]);
        Assert.Equal("18/11/2026", mapa[InformacaoPgWeb.DataTransacaoOriginal]);
        Assert.Equal("00052", mapa[InformacaoPgWeb.ReferenciaLocalOriginal]);
        Assert.Equal("0000000010", mapa[InformacaoPgWeb.RequisicaoTransacaoOriginal]);
        Assert.Equal("52", Enviar(0x78, 0, "52"));
        Assert.Equal("00052", Enviar(0x78, 0, "00052"));
        Assert.DoesNotContain(InformacaoPgWeb.NsuTransacaoOriginal, mapa.Keys);
        Assert.DoesNotContain(InformacaoPgWeb.AutorizacaoTransacaoOriginal, mapa.Keys);
    }

    private static PwGetData Pedido(byte tipo, byte entrada, byte minimo, byte maximo, byte validacao)
    {
        return new PwGetData
        {
            TipoDeDado = tipo,
            TiposEntradaPermitidos = entrada,
            TamanhoMinimo = minimo,
            TamanhoMaximo = maximo,
            ValidacaoDado = validacao,
        };
    }
}
