using System.Runtime.InteropServices;

namespace UltraPDV.TEF.Interop;

/// <summary>
/// Espelho de PW_GetData do PGWebLib.h 4.1.50.924.
/// A SETIS informou que PWL_Type.h nao e um arquivo separado necessario.
/// Os tipos seguem o exemplo C# da PGPagamentos no Windows: ushort, byte e inteiro de 32 bits.
/// O campo final bAlinhaPelaDireita permanece porque esta no header do SDK.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public unsafe struct PwGetData
{
    public const int TamanhoEsperado = 12500;
    public const int CapacidadeMenu = 40;

    public ushort Identificador;
    public byte TipoDeDado;
    public fixed byte Prompt[84];
    public byte NumeroOpcoesMenu;
    public fixed byte TextoMenu[CapacidadeMenu * 41];
    public fixed byte ValorMenu[CapacidadeMenu * 256];
    public fixed byte MascaraCaptura[41];
    public byte TiposEntradaPermitidos;
    public byte TamanhoMinimo;
    public byte TamanhoMaximo;
    public uint ValorMinimo;
    public uint ValorMaximo;
    public byte OcultarDadosDigitados;
    public byte ValidacaoDado;
    public byte AceitaNulo;
    public fixed byte ValorInicial[41];
    public byte TeclasAtalho;
    public fixed byte MensagemValidacao[84];
    public fixed byte MensagemConfirmacao[84];
    public fixed byte MensagemDadoMaior[84];
    public fixed byte MensagemDadoMenor[84];
    public byte CapturarDataVencimentoCartao;
    public uint TipoEntradaCartao;
    public byte ItemInicial;
    public byte NumeroCapturas;
    public fixed byte MensagemPrevia[84];
    public byte TipoEntradaCodigoBarras;
    public byte OmiteMensagemAlerta;
    public byte IniciaPelaEsquerda;
    public byte NotificarCancelamento;
    public byte AlinhaPelaDireita;
}
