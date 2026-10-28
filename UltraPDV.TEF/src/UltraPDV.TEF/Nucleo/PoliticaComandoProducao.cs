using UltraPDV.TEF.Interop;

namespace UltraPDV.TEF.Nucleo;

public static class PoliticaComandoProducao
{
    public static bool Bloqueado(string comando, short? ambiente, bool autorizaPinPad, string? diretorio, bool autorizaVenda = false)
    {
        if (ambiente != CodigosPgWeb.AmbienteProducao)
        {
            return false;
        }

        if (comando is "situacao" or "vincular")
        {
            return comando == "vincular" && !DiretorioIsolado(diretorio);
        }

        if (comando is "instalar" or "configurar" && DiretorioIsolado(diretorio))
        {
            return false;
        }

        if (comando == "pinpad" && autorizaPinPad && DiretorioIsolado(diretorio))
        {
            return false;
        }

        if (comando is "vender" or "confirmar" or "cancelar" && autorizaVenda && DiretorioIsolado(diretorio))
        {
            return false;
        }

        return true;
    }

    public static bool DiretorioIsolado(string? diretorio)
    {
        if (string.IsNullOrWhiteSpace(diretorio))
        {
            return false;
        }

        var normalizado = diretorio.Replace('/', '\\');
        return normalizado.Contains("\\producao\\Data", StringComparison.OrdinalIgnoreCase)
            && !normalizado.Contains("\\Data\\producao\\", StringComparison.OrdinalIgnoreCase);
    }
}
