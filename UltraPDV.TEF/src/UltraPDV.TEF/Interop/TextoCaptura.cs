using System.Linq;
using System.Text;

namespace UltraPDV.TEF.Interop;

public static class TextoCaptura
{
    public static unsafe string Prompt(ref PwGetData dados)
    {
        fixed (byte* origem = dados.Prompt)
        {
            return Ansi(origem, 84);
        }
    }

    public static unsafe string Mascara(ref PwGetData dados)
    {
        fixed (byte* origem = dados.MascaraCaptura)
        {
            return Ansi(origem, 41);
        }
    }

    public static unsafe string Previa(ref PwGetData dados)
    {
        fixed (byte* origem = dados.MensagemPrevia)
        {
            return Ansi(origem, 84);
        }
    }

    public static unsafe string Validacao(ref PwGetData dados)
    {
        fixed (byte* origem = dados.MensagemValidacao)
        {
            return Ansi(origem, 84);
        }
    }

    public static unsafe IReadOnlyList<OpcaoCaptura> Opcoes(ref PwGetData dados)
    {
        var quantidade = Math.Min(dados.NumeroOpcoesMenu, (byte)PwGetData.CapacidadeMenu);
        if (quantidade == 0)
        {
            return Array.Empty<OpcaoCaptura>();
        }

        var opcoes = new OpcaoCaptura[quantidade];
        fixed (byte* textos = dados.TextoMenu)
        fixed (byte* valores = dados.ValorMenu)
        {
            for (var i = 0; i < quantidade; i++)
            {
                opcoes[i] = new OpcaoCaptura(Ansi(textos + (i * 41), 41), Ansi(valores + (i * 256), 256));
            }
        }

        return opcoes;
    }

    public static IReadOnlyList<OpcaoCaptura> OpcoesValidas(ref PwGetData dados)
    {
        return Opcoes(ref dados)
            .Where(opcao => opcao.Valor.Length > 0)
            .ToArray();
    }

    public static unsafe void EscreverValorMenu(ref PwGetData dados, int indice, string valor)
    {
        fixed (byte* destino = dados.ValorMenu)
        {
            Escrever(destino + (indice * 256), 256, valor);
        }
    }

    public static unsafe string Ansi(byte* origem, int capacidade)
    {
        var tamanho = 0;
        while (tamanho < capacidade && origem[tamanho] != 0)
        {
            tamanho++;
        }

        return Encoding.Latin1.GetString(new ReadOnlySpan<byte>(origem, tamanho)).Trim();
    }

    private static unsafe void Escrever(byte* destino, int capacidade, string valor)
    {
        var bytes = Encoding.Latin1.GetBytes(valor);
        var tamanho = Math.Min(bytes.Length, capacidade - 1);
        for (var i = 0; i < capacidade; i++)
        {
            destino[i] = 0;
        }

        for (var i = 0; i < tamanho; i++)
        {
            destino[i] = bytes[i];
        }
    }
}

public sealed record OpcaoCaptura(string Texto, string Valor);
