using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace UltraPDV.TEF.Persistencia;

public sealed class RepositorioJournal
{
    private static readonly JsonSerializerOptions Json = new() { WriteIndented = false };
    private readonly string _raiz;

    public RepositorioJournal(string raiz)
    {
        _raiz = raiz;
    }

    private string Caminho(Guid empresaId, Guid terminalId, string chave)
    {
        return Path.Combine(Pasta(empresaId, terminalId), Nome(empresaId, terminalId, chave));
    }

    public JournalOperacao Gravar(JournalOperacao journal)
    {
        var pasta = Pasta(journal.EmpresaId, journal.TerminalId);
        Directory.CreateDirectory(pasta);
        var destino = Caminho(journal.EmpresaId, journal.TerminalId, journal.ChaveIdempotencia);
        if (File.Exists(destino))
        {
            var existente = LerArquivo(destino);
            if (existente.EmpresaId != journal.EmpresaId || existente.ChaveIdempotencia != journal.ChaveIdempotencia)
            {
                throw new InvalidOperationException("A chave idempotente colidiu com um journal de outra empresa.");
            }

            return existente;
        }

        var temporario = destino + ".tmp";
        File.WriteAllText(temporario, JsonSerializer.Serialize(journal, Json));
        File.Move(temporario, destino);
        return journal;
    }

    public JournalOperacao Atualizar(JournalOperacao journal)
    {
        var destino = Caminho(journal.EmpresaId, journal.TerminalId, journal.ChaveIdempotencia);
        if (!File.Exists(destino))
        {
            throw new InvalidOperationException("O journal que seria atualizado não existe.");
        }

        var existente = LerArquivo(destino);
        if (existente.EmpresaId != journal.EmpresaId || existente.TerminalId != journal.TerminalId || existente.ChaveIdempotencia != journal.ChaveIdempotencia)
        {
            throw new InvalidOperationException("A atualização tentou cruzar journals de empresas ou terminais.");
        }

        var temporario = destino + ".tmp";
        File.WriteAllText(temporario, JsonSerializer.Serialize(journal, Json));
        File.Move(temporario, destino, overwrite: true);
        return journal;
    }

    public JournalOperacao? Buscar(Guid empresaId, Guid terminalId, string chave)
    {
        var destino = Caminho(empresaId, terminalId, chave);
        return File.Exists(destino) ? LerArquivo(destino) : null;
    }

    public IReadOnlyList<JournalOperacao> Listar(Guid empresaId, Guid terminalId)
    {
        var pasta = Pasta(empresaId, terminalId);
        if (!Directory.Exists(pasta))
        {
            return Array.Empty<JournalOperacao>();
        }

        return Directory.GetFiles(pasta, "*.json")
            .Select(LerArquivo)
            .Where(journal => journal.EmpresaId == empresaId && journal.TerminalId == terminalId)
            .ToArray();
    }

    public IReadOnlyList<JournalOperacao> Pendencias(Guid empresaId, Guid terminalId)
    {
        return Listar(empresaId, terminalId)
            .Where(journal => journal.Status is "aguardando_confirmacao" or "resultado_desconhecido" or "executando")
            .ToArray();
    }

    private string Pasta(Guid empresaId, Guid terminalId)
    {
        return Path.Combine(_raiz, empresaId.ToString("N"), terminalId.ToString("N"), "journals");
    }

    private static string Nome(Guid empresaId, Guid terminalId, string chave)
    {
        var material = Encoding.UTF8.GetBytes(empresaId.ToString("N") + "|" + terminalId.ToString("N") + "|" + chave);
        return Convert.ToHexString(SHA256.HashData(material)) + ".json";
    }

    private static JournalOperacao LerArquivo(string caminho)
    {
        return JsonSerializer.Deserialize<JournalOperacao>(File.ReadAllText(caminho), Json)
            ?? throw new InvalidDataException("O journal não pôde ser lido.");
    }
}
