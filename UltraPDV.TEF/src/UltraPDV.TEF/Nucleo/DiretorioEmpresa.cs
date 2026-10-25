namespace UltraPDV.TEF.Nucleo;

public static class DiretorioEmpresa
{
    public static string Dados(string raiz, Guid empresaId, Guid terminalId)
    {
        if (string.IsNullOrWhiteSpace(raiz))
        {
            throw new IsolamentoEmpresaException("A raiz dos diretórios TEF não foi informada.");
        }

        var raizCompleta = Path.GetFullPath(raiz);
        if (raizCompleta.EndsWith($"{Path.DirectorySeparatorChar}PGWebLib", StringComparison.OrdinalIgnoreCase)
            || raizCompleta.Contains($"{Path.DirectorySeparatorChar}PGWebLib{Path.DirectorySeparatorChar}Data", StringComparison.OrdinalIgnoreCase))
        {
            throw new IsolamentoEmpresaException("A raiz compartilhada da PGWebLib não pode receber dados de empresa.");
        }
        var caminho = Path.GetFullPath(Path.Combine(
            raizCompleta,
            empresaId.ToString("N"),
            terminalId.ToString("N"),
            "Data"));
        var relativo = Path.GetRelativePath(raizCompleta, caminho);
        if (relativo.StartsWith("..", StringComparison.Ordinal) || Path.IsPathRooted(relativo))
        {
            throw new IsolamentoEmpresaException("O diretório de dados saiu da raiz da empresa.");
        }

        if (caminho.Contains($"{Path.DirectorySeparatorChar}PGWebLib{Path.DirectorySeparatorChar}Data", StringComparison.OrdinalIgnoreCase)
            || caminho.EndsWith($"{Path.DirectorySeparatorChar}PGWebLib{Path.DirectorySeparatorChar}Data", StringComparison.OrdinalIgnoreCase))
        {
            throw new IsolamentoEmpresaException("O diretório compartilhado da PGWebLib não pode ser usado.");
        }

        return caminho;
    }

    public static string Producao(string raiz, Guid empresaId, Guid terminalId)
    {
        var homologacao = Dados(raiz, empresaId, terminalId);
        var caminho = Path.GetFullPath(Path.Combine(
            Path.GetDirectoryName(homologacao)!,
            "producao",
            "Data"));
        if (string.Equals(caminho, homologacao, StringComparison.OrdinalIgnoreCase)
            || caminho.StartsWith(homologacao + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
        {
            throw new IsolamentoEmpresaException("O diretório de produção reutilizaria a homologação.");
        }

        var raizCompleta = Path.GetFullPath(raiz);
        var relativo = Path.GetRelativePath(raizCompleta, caminho);
        if (relativo.StartsWith("..", StringComparison.Ordinal) || Path.IsPathRooted(relativo))
        {
            throw new IsolamentoEmpresaException("O diretório de produção saiu da raiz da empresa.");
        }

        return caminho;
    }

    public static string JournalsProducao(string raiz)
    {
        var raizCompleta = Path.GetFullPath(raiz);
        var caminho = Path.GetFullPath(Path.Combine(raizCompleta, "producao"));
        var relativo = Path.GetRelativePath(raizCompleta, caminho);
        if (relativo.StartsWith("..", StringComparison.Ordinal) || Path.IsPathRooted(relativo))
        {
            throw new IsolamentoEmpresaException("Os journals de produção saíram da raiz da empresa.");
        }

        return caminho;
    }

    public static string JournalsConfiguracao(string raiz)
    {
        var producao = JournalsProducao(raiz);
        var caminho = Path.GetFullPath(Path.Combine(producao, "configuracao"));
        if (string.Equals(caminho, producao, StringComparison.OrdinalIgnoreCase))
        {
            throw new IsolamentoEmpresaException("Os journals de configuração reutilizariam os de instalação.");
        }

        var relativo = Path.GetRelativePath(producao, caminho);
        if (relativo.StartsWith("..", StringComparison.Ordinal) || Path.IsPathRooted(relativo))
        {
            throw new IsolamentoEmpresaException("Os journals de configuração saíram da produção.");
        }

        return caminho;
    }
}
