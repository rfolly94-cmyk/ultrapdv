namespace UltraPDV.TEF.Nucleo;

public sealed record VinculoEmpresa(Guid EmpresaId, bool Ativo, bool Principal);

public sealed record SessaoAutenticada(string UsuarioId, IReadOnlyList<VinculoEmpresa> Vinculos);

public sealed record ConfiguracaoEmpresa(
    Guid EmpresaId,
    Guid TerminalId,
    string Cnpj,
    short Ambiente,
    string PontoCaptura,
    string Servidor);

public sealed record ContextoEmpresa(
    string UsuarioId,
    Guid EmpresaId,
    Guid TerminalId,
    string Cnpj,
    short Ambiente,
    string PontoCaptura,
    string Servidor,
    string DiretorioDados);
