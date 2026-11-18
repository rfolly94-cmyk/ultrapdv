using System.Globalization;
using System.Text;
using UltraPDV.TEF.Interop;
using UltraPDV.TEF.Persistencia;

namespace UltraPDV.TEF.Nucleo;

public sealed record VendaParaCaptura(string Chave, int ValorCentavos, string Data, string Referencia, string Requisicao, string Texto);

/// <summary>
/// Preenche valor, data e referência com o que o journal guardou da venda.
/// NSU, autorização e identificador da aplicação do cartão não são reconstituídos.
/// O dia é o do offset gravado, sem deslocar para UTC.
/// </summary>
public static class SugestaoVendaOriginal
{
    public static IReadOnlyDictionary<ushort, string> Montar(JournalOperacao journal)
    {
        var mapa = new Dictionary<ushort, string>();
        if (journal.ValorCentavos > 0)
        {
            var reais = FormatarReais(journal.ValorCentavos);
            mapa[InformacaoPgWeb.ValorTotal] = reais;
            mapa[InformacaoPgWeb.ValorTransacaoOriginal] = reais;
        }

        mapa[InformacaoPgWeb.DataTransacaoOriginal] = DataVisual(journal.AtualizadoEm);
        if (!string.IsNullOrEmpty(journal.NumeroRequisicao))
        {
            mapa[InformacaoPgWeb.RequisicaoTransacaoOriginal] = journal.NumeroRequisicao;
        }

        if (!string.IsNullOrEmpty(journal.ReferenciaLocal))
        {
            mapa[InformacaoPgWeb.ReferenciaLocalOriginal] = journal.ReferenciaLocal;
        }

        return mapa;
    }

    public static VendaParaCaptura Resumo(JournalOperacao journal)
    {
        var data = DataVisual(journal.AtualizadoEm);
        var reais = FormatarReais(journal.ValorCentavos);
        var referencia = journal.ReferenciaLocal ?? "";
        var requisicao = journal.NumeroRequisicao ?? "";
        var texto = referencia.Length > 0
            ? $"{data} · R$ {reais} · REF {referencia}"
            : $"{data} · R$ {reais}";
        return new VendaParaCaptura(journal.ChaveIdempotencia, journal.ValorCentavos, data, referencia, requisicao, texto);
    }

    public static string DataVisual(DateTimeOffset quando)
    {
        return string.Create(CultureInfo.InvariantCulture, $"{quando.Day:00}/{quando.Month:00}/{quando.Year:0000}");
    }

    public static string FormatarReais(int centavos)
    {
        var absoluto = Math.Abs(centavos);
        var inteiro = (absoluto / 100).ToString(CultureInfo.InvariantCulture);
        var frac = (absoluto % 100).ToString("00", CultureInfo.InvariantCulture);
        var grupos = new StringBuilder();
        for (var indice = 0; indice < inteiro.Length; indice++)
        {
            if (indice > 0 && (inteiro.Length - indice) % 3 == 0)
            {
                grupos.Append('.');
            }

            grupos.Append(inteiro[indice]);
        }

        return grupos.Append(',').Append(frac).ToString();
    }
}
