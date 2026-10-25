namespace UltraPDV.TEF.Nucleo;

public static class ServidorComercial
{
    public static bool PertenceHomologacao(string? endereco)
    {
        if (string.IsNullOrWhiteSpace(endereco))
        {
            return false;
        }

        var host = endereco.Split(':')[0];
        return host.Contains("tpgweb.io", StringComparison.OrdinalIgnoreCase)
            || host.Contains("pos-transac-sb", StringComparison.OrdinalIgnoreCase)
            || host.Contains("sandbox", StringComparison.OrdinalIgnoreCase)
            || host.Contains("homolog", StringComparison.OrdinalIgnoreCase);
    }

    public static bool Confere(string? esperado, string? informado)
    {
        if (string.IsNullOrWhiteSpace(esperado) || string.IsNullOrWhiteSpace(informado))
        {
            return false;
        }

        if (PertenceHomologacao(esperado) || PertenceHomologacao(informado))
        {
            return false;
        }

        return string.Equals(esperado.Trim(), informado.Trim(), StringComparison.OrdinalIgnoreCase);
    }
}
