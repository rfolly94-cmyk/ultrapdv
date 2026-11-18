using UltraPDV.TEF.Interop;

namespace UltraPDV.TEF.Nucleo;

/// <summary>
/// Ponto e servidor já gravados para a empresa. Só entram na instalação de homologação
/// quando o formato é o que a biblioteca aceita em PWINFO_POSID e PWINFO_DESTTCPIP.
/// A senha técnica não faz parte deste cadastro.
/// </summary>
public static class DadosInstalacaoHomologacao
{
    public static string Ponto(string? valor)
    {
        var texto = (valor ?? "").Trim();
        if (texto.Length is < 1 or > 40)
        {
            return "";
        }

        foreach (var caractere in texto)
        {
            if (!char.IsAsciiLetterOrDigit(caractere) && caractere is not ('.' or '_' or '-'))
            {
                return "";
            }
        }

        return texto;
    }

    public static string Servidor(string? valor)
    {
        if (!CapturaEndereco.PodeEnviar(valor, out var endereco) || !ServidorComercial.PertenceHomologacao(endereco))
        {
            return "";
        }

        return endereco;
    }
}
