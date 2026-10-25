namespace UltraPDV.TEF.Interop;

/// <summary>
/// PWINFO_DESTTCPIP (0x1B) é um único campo no formato host:porta.
/// PWINFO_AUTIP (0x05) e PWINFO_AUTPORT (0x07) só são usados quando a biblioteca pede cada um.
/// </summary>
public static class CapturaEndereco
{
    public const string AvisoNaoEnviado = "O valor não foi enviado à biblioteca e não foi alterado. Digite host:porta neste mesmo campo.";

    public static string Montar(string? prompt, string? mascara, string? previa, string? validacao, ushort identificador, string? aviso)
    {
        var partes = new List<string>();
        Adicionar(partes, previa);
        Adicionar(partes, prompt);
        Adicionar(partes, mascara);
        Adicionar(partes, validacao);
        if (identificador == InformacaoPgWeb.DestinoTcpIp)
        {
            Adicionar(partes, "A biblioteca pediu o servidor no identificador PWINFO_DESTTCPIP. Digite host:porta neste campo. Não há outro campo de porta.");
        }
        else if (identificador == InformacaoPgWeb.EnderecoAutorizador)
        {
            Adicionar(partes, "A biblioteca pediu somente o endereço, no identificador PWINFO_AUTIP.");
        }
        else if (identificador == InformacaoPgWeb.PortaAutorizador)
        {
            Adicionar(partes, "A biblioteca pediu somente a porta, no identificador PWINFO_AUTPORT.");
        }

        Adicionar(partes, aviso);
        return string.Join(" ", partes);
    }

    public static bool PodeEnviar(string? valor, out string endereco)
    {
        endereco = "";
        var texto = (valor ?? "").Trim();
        if (texto.Length is < 3 or > 50)
        {
            return false;
        }

        if (texto.Contains("://", StringComparison.Ordinal) || texto.Contains(' ') || texto.Contains('\\'))
        {
            return false;
        }

        var separador = texto.LastIndexOf(':');
        if (separador < 1 || separador != texto.IndexOf(':') || separador == texto.Length - 1)
        {
            return false;
        }

        var host = texto[..separador];
        var portaTexto = texto[(separador + 1)..];
        if (!HostValido(host) || !int.TryParse(portaTexto, out var porta) || porta is < 1 or > 65535 || portaTexto != porta.ToString())
        {
            return false;
        }

        endereco = texto;
        return true;
    }

    public static string Apresentar(string? texto)
    {
        if (string.IsNullOrWhiteSpace(texto))
        {
            return "";
        }

        var partes = texto.Split(['\r', '\n', '\t'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return string.Join(' ', partes);
    }

    public static bool MensagemFinal(short codigo)
    {
        return codigo is not (CodigosPgWeb.MoreData or CodigosPgWeb.Display or CodigosPgWeb.Nothing);
    }

    private static bool HostValido(string host)
    {
        if (host.Length is < 1 or > 44 || host.StartsWith('.') || host.EndsWith('.') || host.Contains("..", StringComparison.Ordinal))
        {
            return false;
        }

        foreach (var caractere in host)
        {
            var aceito = caractere is (>= 'A' and <= 'Z') or (>= 'a' and <= 'z') or (>= '0' and <= '9') or '.' or '-';
            if (!aceito)
            {
                return false;
            }
        }

        return true;
    }

    private static void Adicionar(List<string> partes, string? texto)
    {
        var limpo = Apresentar(texto);
        if (limpo.Length > 0)
        {
            partes.Add(limpo);
        }
    }
}
