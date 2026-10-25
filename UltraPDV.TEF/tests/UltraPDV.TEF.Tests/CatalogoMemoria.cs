using UltraPDV.TEF.Nucleo;

namespace UltraPDV.TEF.Tests;

public sealed class CatalogoMemoria : ICatalogoEmpresa
{
    private readonly Dictionary<(Guid Empresa, Guid Terminal), ConfiguracaoEmpresa> _itens = new();

    public void Adicionar(ConfiguracaoEmpresa configuracao)
    {
        _itens[(configuracao.EmpresaId, configuracao.TerminalId)] = configuracao;
    }

    public ConfiguracaoEmpresa? Obter(Guid empresaId, Guid terminalId)
    {
        return _itens.TryGetValue((empresaId, terminalId), out var configuracao) ? configuracao : null;
    }
}
