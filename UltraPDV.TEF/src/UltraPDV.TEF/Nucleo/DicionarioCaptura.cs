using System.Globalization;
using UltraPDV.TEF.Interop;

namespace UltraPDV.TEF.Nucleo;

/// <summary>
/// Formatos do dicionário PayGo 4.1.50.924 que a captura precisa converter antes de PW_iAddParam.
/// A data DDMMAA é calculada pelo calendário civil, sem fuso horário.
/// </summary>
public static class DicionarioCaptura
{
    public const ushort DataParcela = 0x3D;
    public const ushort VencimentoCartao = 0xC2;

    public static bool Aplicar(ushort identificador, byte validacao, string entrada, out bool tratado, out string valor, out string erro)
    {
        valor = "";
        erro = "";
        var dicionario = FormatoDicionario(identificador);
        var pedido = FormatoValidacao(validacao);
        if (dicionario != Formato.Nenhum && pedido != Formato.Nenhum && dicionario != pedido)
        {
            tratado = true;
            erro = "A validação devolvida pela biblioteca diverge do formato do dicionário. O valor não foi enviado.";
            return false;
        }

        var formato = pedido != Formato.Nenhum ? pedido : dicionario;
        tratado = formato != Formato.Nenhum;
        if (!tratado)
        {
            return true;
        }

        return formato switch
        {
            Formato.Ddmmaa => DataDdmmaa(entrada, out valor, out erro),
            Formato.Mmaa => DataMmaa(entrada, out valor, out erro),
            Formato.Hhmmss => Hora(entrada, out valor, out erro),
            _ => true,
        };
    }

    public static bool DataDdmmaa(string entrada, out string valor, out string erro)
    {
        valor = "";
        erro = "Informe a data como DD/MM/AAAA. Exemplo: 18/11/2026.";
        if (!PartesData(entrada.Trim(), out var dia, out var mes, out var ano))
        {
            return false;
        }

        if (ano is < 2000 or > 2099 || !DiaExiste(dia, mes, ano))
        {
            erro = "A data não existe.";
            return false;
        }

        valor = $"{dia:00}{mes:00}{ano % 100:00}";
        erro = "";
        return valor.Length == 6 && valor.All(char.IsDigit);
    }

    public static bool DataMmaa(string entrada, out string valor, out string erro)
    {
        valor = "";
        erro = "Informe o mês e o ano como MM/AAAA. Exemplo: 12/2026.";
        var texto = entrada.Trim();
        int mes;
        int ano;
        if (texto.Length == 7 && texto[2] == '/')
        {
            if (!int.TryParse(texto[..2], NumberStyles.None, CultureInfo.InvariantCulture, out mes) || !int.TryParse(texto[3..], NumberStyles.None, CultureInfo.InvariantCulture, out ano))
            {
                return false;
            }
        }
        else if (texto.Length == 7 && texto[4] == '-')
        {
            if (!int.TryParse(texto[..4], NumberStyles.None, CultureInfo.InvariantCulture, out ano) || !int.TryParse(texto[5..], NumberStyles.None, CultureInfo.InvariantCulture, out mes))
            {
                return false;
            }
        }
        else if (texto.Length == 4 && texto.All(char.IsDigit))
        {
            if (!int.TryParse(texto[..2], NumberStyles.None, CultureInfo.InvariantCulture, out mes) || !int.TryParse(texto[2..], NumberStyles.None, CultureInfo.InvariantCulture, out var aa))
            {
                return false;
            }

            ano = 2000 + aa;
        }
        else
        {
            return false;
        }

        if (mes is < 1 or > 12 || ano is < 2000 or > 2099)
        {
            erro = "O mês ou o ano não existe.";
            return false;
        }

        valor = $"{mes:00}{ano % 100:00}";
        erro = "";
        return true;
    }

    public static bool Hora(string entrada, out string valor, out string erro)
    {
        valor = "";
        erro = "Informe a hora como HH:MM:SS. Exemplo: 15:30:45.";
        var texto = entrada.Trim();
        int hora;
        int minuto;
        int segundo;
        if (texto.Length == 8 && texto[2] == ':' && texto[5] == ':')
        {
            if (!int.TryParse(texto[..2], NumberStyles.None, CultureInfo.InvariantCulture, out hora) || !int.TryParse(texto.Substring(3, 2), NumberStyles.None, CultureInfo.InvariantCulture, out minuto) || !int.TryParse(texto.Substring(6, 2), NumberStyles.None, CultureInfo.InvariantCulture, out segundo))
            {
                return false;
            }
        }
        else if (texto.Length == 6 && texto.All(char.IsDigit))
        {
            if (!int.TryParse(texto[..2], NumberStyles.None, CultureInfo.InvariantCulture, out hora) || !int.TryParse(texto.Substring(2, 2), NumberStyles.None, CultureInfo.InvariantCulture, out minuto) || !int.TryParse(texto.Substring(4, 2), NumberStyles.None, CultureInfo.InvariantCulture, out segundo))
            {
                return false;
            }
        }
        else
        {
            return false;
        }

        if (hora is < 0 or > 23 || minuto is < 0 or > 59 || segundo is < 0 or > 59)
        {
            erro = "A hora não existe.";
            return false;
        }

        valor = $"{hora:00}{minuto:00}{segundo:00}";
        erro = "";
        return true;
    }

    private static bool PartesData(string texto, out int dia, out int mes, out int ano)
    {
        dia = mes = ano = 0;
        if (texto.Length == 10 && texto[2] == '/' && texto[5] == '/')
        {
            return int.TryParse(texto[..2], NumberStyles.None, CultureInfo.InvariantCulture, out dia)
                && int.TryParse(texto.Substring(3, 2), NumberStyles.None, CultureInfo.InvariantCulture, out mes)
                && int.TryParse(texto[6..], NumberStyles.None, CultureInfo.InvariantCulture, out ano);
        }

        if (texto.Length == 10 && texto[4] == '-' && texto[7] == '-')
        {
            return int.TryParse(texto[..4], NumberStyles.None, CultureInfo.InvariantCulture, out ano)
                && int.TryParse(texto.Substring(5, 2), NumberStyles.None, CultureInfo.InvariantCulture, out mes)
                && int.TryParse(texto[8..], NumberStyles.None, CultureInfo.InvariantCulture, out dia);
        }

        if (texto.Length == 8 && texto.All(char.IsDigit))
        {
            return int.TryParse(texto[..2], NumberStyles.None, CultureInfo.InvariantCulture, out dia)
                && int.TryParse(texto.Substring(2, 2), NumberStyles.None, CultureInfo.InvariantCulture, out mes)
                && int.TryParse(texto[4..], NumberStyles.None, CultureInfo.InvariantCulture, out ano);
        }

        if (texto.Length == 6 && texto.All(char.IsDigit))
        {
            var aa = 0;
            var ok = int.TryParse(texto[..2], NumberStyles.None, CultureInfo.InvariantCulture, out dia)
                && int.TryParse(texto.Substring(2, 2), NumberStyles.None, CultureInfo.InvariantCulture, out mes)
                && int.TryParse(texto[4..], NumberStyles.None, CultureInfo.InvariantCulture, out aa);
            ano = 2000 + aa;
            return ok;
        }

        return false;
    }

    private static bool DiaExiste(int dia, int mes, int ano)
    {
        if (mes is < 1 or > 12 || dia < 1)
        {
            return false;
        }

        var limite = mes switch
        {
            2 => ano % 4 == 0 && (ano % 100 != 0 || ano % 400 == 0) ? 29 : 28,
            4 or 6 or 9 or 11 => 30,
            _ => 31,
        };
        return dia <= limite;
    }

    private static Formato FormatoDicionario(ushort identificador)
    {
        return identificador switch
        {
            InformacaoPgWeb.DataTransacaoOriginal or DataParcela => Formato.Ddmmaa,
            VencimentoCartao => Formato.Mmaa,
            InformacaoPgWeb.HoraTransacaoOriginal => Formato.Hhmmss,
            _ => Formato.Nenhum,
        };
    }

    private static Formato FormatoValidacao(byte validacao)
    {
        return validacao switch
        {
            4 => Formato.Mmaa,
            5 => Formato.Ddmmaa,
            _ => Formato.Nenhum,
        };
    }

    private enum Formato
    {
        Nenhum,
        Ddmmaa,
        Mmaa,
        Hhmmss,
    }
}
