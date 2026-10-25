namespace UltraPDV.TEF.Nucleo;

public interface ICatalogoEmpresa
{
    ConfiguracaoEmpresa? Obter(Guid empresaId, Guid terminalId);
}

public sealed class ResolvedorEmpresa
{
    private readonly ICatalogoEmpresa _catalogo;
    private readonly string _raizDiretorios;

    public ResolvedorEmpresa(ICatalogoEmpresa catalogo, string raizDiretorios)
    {
        _catalogo = catalogo;
        _raizDiretorios = raizDiretorios;
    }

    public ContextoEmpresa Resolver(SessaoAutenticada sessao, Guid? empresaInformadaPeloCliente, Guid terminalId)
    {
        if (string.IsNullOrWhiteSpace(sessao.UsuarioId))
        {
            throw new AcessoEmpresaNegadoException("A sessão autenticada não identificou o usuário.");
        }

        var permitidos = sessao.Vinculos.Where(vinculo => vinculo.Ativo).ToArray();
        if (permitidos.Length == 0)
        {
            throw new AcessoEmpresaNegadoException("A sessão não possui empresa ativa.");
        }

        var escolhido = empresaInformadaPeloCliente is null
            ? permitidos.SingleOrDefault(vinculo => vinculo.Principal)
            : permitidos.SingleOrDefault(vinculo => vinculo.EmpresaId == empresaInformadaPeloCliente.Value);
        if (escolhido is null)
        {
            throw new AcessoEmpresaNegadoException("A empresa informada não pertence à sessão autenticada.");
        }

        var configuracao = _catalogo.Obter(escolhido.EmpresaId, terminalId);
        if (configuracao is null || configuracao.EmpresaId != escolhido.EmpresaId || configuracao.TerminalId != terminalId)
        {
            throw new AcessoEmpresaNegadoException("O terminal não está vinculado à empresa da sessão.");
        }

        return new ContextoEmpresa(
            sessao.UsuarioId,
            escolhido.EmpresaId,
            configuracao.TerminalId,
            configuracao.Cnpj,
            configuracao.Ambiente,
            configuracao.PontoCaptura,
            configuracao.Servidor,
            DiretorioEmpresa.Dados(_raizDiretorios, escolhido.EmpresaId, configuracao.TerminalId));
    }
}
