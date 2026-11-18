using System.Globalization;
using UltraPDV.TEF.Interop;

namespace UltraPDV.TEF.Nucleo;

/// <summary>
/// Converte um valor em reais para o inteiro do expoente 2 exigido pelos montantes da PGWebLib.
/// Um texto só com dígitos já está em centavos e não é multiplicado de novo.
/// "2,00" e "R$ 2,00" viram 200. "200" permanece 200.
/// </summary>
public static class ValorCentavos
{
    private static readonly HashSet<ushort> Montantes =
    [
        InformacaoPgWeb.ValorTotal,
        InformacaoPgWeb.Desconto,
        InformacaoPgWeb.Saque,
        InformacaoPgWeb.TaxaEmbarque,
        InformacaoPgWeb.Gorjeta,
        InformacaoPgWeb.ValorPrimeiraParcela,
        InformacaoPgWeb.ValorDemaisParcelas,
        InformacaoPgWeb.ValorTransacaoOriginal,
        InformacaoPgWeb.ValorDevido,
    ];

    public static bool EhMontante(ushort identificador) => Montantes.Contains(identificador);

    public static bool Tentar(string? entrada, out string centavos)
    {
        centavos = "";
        if (!Normalizar(entrada, out var reais, out var jaEmCentavos))
        {
            return false;
        }

        if (jaEmCentavos)
        {
            centavos = reais;
            return true;
        }

        if (!decimal.TryParse(reais, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var valor) || valor < 0 || valor > long.MaxValue / 100m)
        {
            return false;
        }

        var escala = valor * 100m;
        if (escala != decimal.Truncate(escala) || escala > long.MaxValue)
        {
            return false;
        }

        centavos = decimal.ToInt64(escala).ToString(CultureInfo.InvariantCulture);
        return true;
    }

    private static bool Normalizar(string? entrada, out string numero, out bool jaEmCentavos)
    {
        numero = "";
        jaEmCentavos = false;
        if (string.IsNullOrWhiteSpace(entrada))
        {
            return false;
        }

        var texto = entrada.Trim();
        if (texto.StartsWith("R$", StringComparison.OrdinalIgnoreCase))
        {
            texto = texto[2..].Trim();
        }

        texto = texto.Replace(" ", "");
        if (texto.Length == 0 || texto.Any(caractere => caractere != ',' && caractere != '.' && !char.IsDigit(caractere)))
        {
            return false;
        }

        if (texto.All(char.IsDigit))
        {
            jaEmCentavos = true;
            return Inteiro(texto, out numero);
        }

        var virgulas = texto.Count(caractere => caractere == ',');
        var pontos = texto.Count(caractere => caractere == '.');
        if (virgulas > 0 && pontos > 0)
        {
            var decimalSeparador = texto.LastIndexOf(',') > texto.LastIndexOf('.') ? ',' : '.';
            var milhar = decimalSeparador == ',' ? '.' : ',';
            return DecimalComMilhar(texto, decimalSeparador, milhar, out numero);
        }

        if (virgulas == 1 && pontos == 0)
        {
            return DecimalComMilhar(texto, ',', null, out numero);
        }

        if (pontos >= 1 && virgulas == 0)
        {
            var depois = texto.Length - texto.LastIndexOf('.') - 1;
            if (pontos == 1 && depois is 1 or 2)
            {
                return DecimalComMilhar(texto, '.', null, out numero);
            }

            if (depois == 3 && GruposDeMilhar(texto, '.'))
            {
                if (!Inteiro(texto.Replace(".", ""), out var reais))
                {
                    return false;
                }

                numero = reais + ".00";
                return true;
            }
        }

        return false;
    }

    private static bool DecimalComMilhar(string texto, char decimalSeparador, char? milhar, out string numero)
    {
        numero = "";
        var partes = texto.Split(decimalSeparador);
        if (partes.Length != 2 || partes[1].Length is < 1 or > 2 || partes[0].Length == 0)
        {
            return false;
        }

        var inteiro = partes[0];
        if (milhar is char separador)
        {
            if (!GruposDeMilhar(inteiro, separador))
            {
                return false;
            }

            inteiro = inteiro.Replace(separador.ToString(), "");
        }
        else if (!inteiro.All(char.IsDigit))
        {
            return false;
        }

        if (!partes[1].All(char.IsDigit) || !inteiro.All(char.IsDigit))
        {
            return false;
        }

        numero = partes[1].Length == 1 ? inteiro + "." + partes[1] + "0" : inteiro + "." + partes[1];
        return true;
    }

    private static bool GruposDeMilhar(string texto, char separador)
    {
        var grupos = texto.Split(separador);
        if (grupos.Length < 2 || grupos[0].Length is < 1 or > 3)
        {
            return false;
        }

        return grupos.Skip(1).All(grupo => grupo.Length == 3 && grupo.All(char.IsDigit)) && grupos[0].All(char.IsDigit);
    }

    private static bool Inteiro(string texto, out string numero)
    {
        numero = "";
        if (!long.TryParse(texto, NumberStyles.None, CultureInfo.InvariantCulture, out var valor) || valor < 0)
        {
            return false;
        }

        numero = valor.ToString(CultureInfo.InvariantCulture);
        return true;
    }
}
