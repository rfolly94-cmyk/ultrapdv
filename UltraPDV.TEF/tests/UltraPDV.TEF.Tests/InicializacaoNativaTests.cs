using UltraPDV.TEF.Interop;

namespace UltraPDV.TEF.Tests;

public class InicializacaoNativaTests
{
    [Fact]
    public void Inicializacao_isolada_de_homologacao_nao_abre_transacao()
    {
        var dll = BibliotecaNativaPgWeb.LocalizarDll();
        Assert.NotNull(dll);
        var diretorio = Path.Combine(Path.GetTempPath(), "ultrapdv-tef-init", Guid.NewGuid().ToString("N"), "Data");
        Directory.CreateDirectory(diretorio);
        var biblioteca = new BibliotecaNativaPgWeb();
        try
        {
            var inicio = biblioteca.Inicializar(diretorio);
            var ambiente = biblioteca.DefinirAmbiente(CodigosPgWeb.AmbienteTeste);
            Assert.Equal(CodigosPgWeb.Ok, inicio);
            Assert.True(ambiente is CodigosPgWeb.Ok or CodigosPgWeb.NotInst, "PW_iSetEnvironment retornou " + ambiente + ".");
            Assert.Contains("PW_iInit", biblioteca.Chamadas);
            Assert.DoesNotContain(biblioteca.Chamadas, chamada => chamada.StartsWith("PW_iNewTransac", StringComparison.Ordinal));
            Assert.DoesNotContain("PW_iConfirmation", biblioteca.Chamadas);
            Assert.DoesNotContain("PW_iExecTransac", biblioteca.Chamadas);
        }
        finally
        {
            if (biblioteca.Chamadas.Contains("PW_iInit"))
            {
                biblioteca.Encerrar();
            }

            if (Directory.Exists(Path.GetDirectoryName(diretorio)))
            {
                try
                {
                    Directory.Delete(Path.GetDirectoryName(diretorio)!, recursive: true);
                }
                catch (IOException)
                {
                }
            }
        }
    }
}
