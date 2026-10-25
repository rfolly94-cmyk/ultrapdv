using System.Security.Cryptography;

namespace UltraPDV.TEF.Interop;

public sealed record IdentidadeDll(string Caminho, string Sha256, string VersaoArquivo, long Bytes, bool Confere);

public static class IdentidadeDllOficial
{
    public const string Versao = "4.1.50.924";
    public const long Bytes = 4_460_664;
    public const string Sha256 = "D17AC81323396AE172648935B0B797B74705B1CA01C9AE0CD3B2FF78119D4220";

    public static IdentidadeDll Verificar(string caminho)
    {
        if (!Environment.Is64BitProcess)
        {
            throw new InvalidOperationException("A PGWebLib oficial desta etapa é somente x64.");
        }

        var arquivo = new FileInfo(caminho);
        if (!arquivo.Exists)
        {
            throw new FileNotFoundException("A PGWebLib.dll x64 não foi encontrada.", caminho);
        }

        var hash = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(arquivo.FullName)));
        var versao = System.Diagnostics.FileVersionInfo.GetVersionInfo(arquivo.FullName).FileVersion ?? "";
        var confere = hash.Equals(Sha256, StringComparison.OrdinalIgnoreCase)
            && versao == Versao
            && arquivo.Length == Bytes;
        return new IdentidadeDll(arquivo.FullName, hash, versao, arquivo.Length, confere);
    }
}
