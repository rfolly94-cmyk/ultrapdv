using UltraPDV.TEF.Interop;

namespace UltraPDV.TEF.Nucleo;

public static class EncaminhamentoOperacao
{
    public static bool Tentar(string? comando, string? operacaoInformada, out byte operacao)
    {
        operacao = 0;
        if (comando == "configurar")
        {
            if (OperacaoConflita(operacaoInformada, "PWOPER_CONFIG"))
            {
                return false;
            }

            operacao = OperacaoPgWeb.Configuracao;
            return true;
        }

        if (comando == "instalar")
        {
            if (OperacaoConflita(operacaoInformada, "PWOPER_INSTALL"))
            {
                return false;
            }

            operacao = OperacaoPgWeb.Instalacao;
            return true;
        }

        return false;
    }

    public static bool ChaveCompativel(string? comando, string? chave, bool producao)
    {
        var texto = chave ?? "";
        if (comando == "configurar")
        {
            if (texto.StartsWith("ins:", StringComparison.Ordinal))
            {
                return false;
            }

            return !producao || texto.StartsWith("cfg:", StringComparison.Ordinal);
        }

        if (comando == "instalar")
        {
            if (texto.StartsWith("cfg:", StringComparison.Ordinal))
            {
                return false;
            }

            return !producao || texto.StartsWith("ins:", StringComparison.Ordinal);
        }

        return true;
    }

    private static bool OperacaoConflita(string? informada, string esperada)
    {
        return !string.IsNullOrEmpty(informada) && informada != esperada;
    }
}
