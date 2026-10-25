using System.Runtime.InteropServices;

namespace UltraPDV.TEF.Interop;

/// <summary>
/// Espelho de PW_Operations do header oficial e do exemplo C# da PGPagamentos.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public unsafe struct PwOperations
{
    public const int TamanhoHipotese = 43;

    public byte TipoOperacao;
    public fixed byte Texto[21];
    public fixed byte Valor[21];
}
