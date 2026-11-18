using UltraPDV.TEF.Interop;

namespace UltraPDV.TEF.Nucleo;

/// <summary>
/// Prepara o pszValue de PWDAT_TYPED, PWDAT_BARCODE e PWDAT_USERAUTH.
/// A captura oficial pede o dado sem a máscara. Zeros à esquerda permanecem.
/// </summary>
public static class CapturaDigitada
{
    public static bool Tentar(ref PwGetData pedido, string? entrada, out string valor, out string erro)
    {
        valor = "";
        erro = "";
        if (!DicionarioCaptura.Aplicar(pedido.Identificador, pedido.ValidacaoDado, entrada ?? "", out var tratado, out valor, out erro))
        {
            return false;
        }

        if (tratado)
        {
            return true;
        }

        if (pedido.TipoDeDado == TipoDadoPgWeb.Digitado && pedido.TiposEntradaPermitidos == 0)
        {
            valor = TextoCaptura.ValorInicial(ref pedido);
            if (valor.Length == 0 && pedido.AceitaNulo != 1)
            {
                erro = Texto(TextoCaptura.Validacao(ref pedido), "A biblioteca não permitiu editar este dado.");
            }

            return valor.Length > 0 || pedido.AceitaNulo == 1;
        }

        var util = SemMascara(entrada ?? "", TextoCaptura.Mascara(ref pedido));
        if (util.Length == 0 && pedido.AceitaNulo == 1)
        {
            valor = "";
            return true;
        }

        if (pedido.TipoDeDado == TipoDadoPgWeb.Digitado && !CaracteresAceitos(util, pedido.TiposEntradaPermitidos))
        {
            erro = Texto(TextoCaptura.Validacao(ref pedido), "O dado contém caracteres que a biblioteca não aceita.");
            return false;
        }

        if (pedido.TamanhoMinimo > 0 && util.Length < pedido.TamanhoMinimo)
        {
            erro = Texto(TextoCaptura.DadoMenor(ref pedido), "O dado tem menos caracteres do que a biblioteca pediu.");
            return false;
        }

        if (pedido.TamanhoMaximo > 0 && util.Length > pedido.TamanhoMaximo)
        {
            erro = Texto(TextoCaptura.DadoMaior(ref pedido), "O dado tem mais caracteres do que a biblioteca pediu.");
            return false;
        }

        if (pedido.TipoDeDado == TipoDadoPgWeb.Digitado && pedido.TiposEntradaPermitidos == 1 && !FaixaNumerica(util, pedido.ValorMinimo, pedido.ValorMaximo, TextoCaptura.DadoMenor(ref pedido), TextoCaptura.DadoMaior(ref pedido), TextoCaptura.Validacao(ref pedido), out erro))
        {
            return false;
        }

        if (!Validar(pedido.ValidacaoDado, util, out var motivo))
        {
            erro = Texto(TextoCaptura.Validacao(ref pedido), motivo);
            return false;
        }

        valor = util;
        return true;
    }

    public static string SemMascara(string entrada, string mascara)
    {
        var texto = entrada.Trim();
        if (mascara.Length == 0 || !mascara.Contains('@'))
        {
            return texto;
        }

        var literais = new HashSet<char>(mascara.Where(caractere => caractere != '@'));
        return new string(texto.Where(caractere => !literais.Contains(caractere)).ToArray());
    }

    private static bool CaracteresAceitos(string valor, byte tipos)
    {
        return tipos switch
        {
            1 => valor.Length > 0 && valor.All(char.IsDigit),
            2 => valor.Length > 0 && valor.All(char.IsLetter),
            3 => valor.Length > 0 && valor.All(caractere => char.IsLetterOrDigit(caractere)),
            7 => valor.Length > 0,
            _ => true,
        };
    }

    private static bool FaixaNumerica(string valor, uint minimo, uint maximo, string menor, string maior, string validacao, out string erro)
    {
        erro = "";
        if (minimo == 0 && maximo == 0)
        {
            return true;
        }

        if (!ulong.TryParse(valor, out var numero))
        {
            erro = Texto(validacao, "O dado numérico não cabe na faixa informada pela biblioteca.");
            return false;
        }

        if (minimo != 0 && numero < minimo)
        {
            erro = Texto(menor, "O valor é menor do que o mínimo informado pela biblioteca.");
            return false;
        }

        if (maximo != 0 && numero > maximo)
        {
            erro = Texto(maior, "O valor é maior do que o máximo informado pela biblioteca.");
            return false;
        }

        return true;
    }

    private static bool Validar(byte validacao, string valor, out string motivo)
    {
        motivo = "";
        return validacao switch
        {
            0 => true,
            1 => Exigir(valor.Length > 0, "A biblioteca não aceita este dado vazio.", out motivo),
            2 => Exigir(Modulo10(valor), "O dígito verificador não confere.", out motivo),
            3 => Exigir(Cpf(valor) || Cnpj(valor), "O CPF ou CNPJ não confere.", out motivo),
            4 => Exigir(Data(valor, "MMyy"), "A data não está no formato MMAA.", out motivo),
            5 => Exigir(Data(valor, "ddMMyy"), "A data não está no formato DDMMAA.", out motivo),
            _ => true,
        };
    }

    private static bool Exigir(bool aceito, string texto, out string motivo)
    {
        motivo = aceito ? "" : texto;
        return aceito;
    }

    private static bool Data(string valor, string formato)
    {
        return DateTime.TryParseExact(valor, formato, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out _);
    }

    private static bool Modulo10(string valor)
    {
        if (valor.Length < 2 || !valor.All(char.IsDigit))
        {
            return false;
        }

        var soma = 0;
        var alternar = false;
        for (var i = valor.Length - 1; i >= 0; i--)
        {
            var digito = valor[i] - '0';
            if (alternar)
            {
                digito *= 2;
                if (digito > 9)
                {
                    digito -= 9;
                }
            }

            soma += digito;
            alternar = !alternar;
        }

        return soma % 10 == 0;
    }

    private static bool Cpf(string valor)
    {
        if (valor.Length != 11 || !valor.All(char.IsDigit) || valor.Distinct().Count() == 1)
        {
            return false;
        }

        return Digito(valor, 9, new[] { 10, 9, 8, 7, 6, 5, 4, 3, 2 }) && Digito(valor, 10, new[] { 11, 10, 9, 8, 7, 6, 5, 4, 3, 2 });
    }

    private static bool Cnpj(string valor)
    {
        if (valor.Length != 14 || !valor.All(char.IsDigit) || valor.Distinct().Count() == 1)
        {
            return false;
        }

        return Digito(valor, 12, new[] { 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2 }) && Digito(valor, 13, new[] { 6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2 });
    }

    private static bool Digito(string valor, int posicao, int[] pesos)
    {
        var soma = 0;
        for (var i = 0; i < pesos.Length; i++)
        {
            soma += (valor[i] - '0') * pesos[i];
        }

        var resto = soma % 11;
        var esperado = resto < 2 ? 0 : 11 - resto;
        return valor[posicao] - '0' == esperado;
    }

    private static string Texto(string mensagemBiblioteca, string reserva)
    {
        return string.IsNullOrWhiteSpace(mensagemBiblioteca) ? reserva : mensagemBiblioteca;
    }
}
