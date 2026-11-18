namespace UltraPDV.TEF.Interop;

/// <summary>
/// Uma linha de PW_iGetOperationsEx: tipo, nome, autorizador e szValue da biblioteca.
/// </summary>
public sealed record OperacaoDisponivel(
    byte Tipo,
    string Nome,
    string Autorizador,
    string Valor,
    bool Preferencial,
    byte ModoPagamento);
