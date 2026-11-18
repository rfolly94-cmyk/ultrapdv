using System.Runtime.InteropServices;

namespace UltraPDV.TEF.Interop;

/// <summary>
/// PW_OperationsEx no layout windows-natural medido: 72 bytes, Bool como int de 4 bytes.
/// O empacotamento de 1 byte mede 69 e não é o layout desta DLL x64.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 8)]
public unsafe struct PwOperationsEx
{
    public const int TamanhoMedido = 72;

    public byte Tipo;
    public fixed byte Nome[21];
    public fixed byte Autorizador[21];
    public fixed byte Valor[21];
    public int Preferencial;
    public byte ModoPagamento;
}
