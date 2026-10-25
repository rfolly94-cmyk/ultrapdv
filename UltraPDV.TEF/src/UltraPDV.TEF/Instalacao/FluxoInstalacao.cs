using UltraPDV.TEF.Interop;
using UltraPDV.TEF.Nucleo;

namespace UltraPDV.TEF.Instalacao;

public sealed record ResultadoInstalacao(bool Concluida, short Codigo, string Situacao, ushort? CapturaPendente);

public sealed class FluxoInstalacao
{
    public ResultadoInstalacao Preparar(ContextoEmpresa contexto, IBibliotecaPgWeb biblioteca)
    {
        if (biblioteca.EhNativa)
        {
            throw new AutorizacaoAusenteException();
        }

        var ambiente = biblioteca.DefinirAmbiente(contexto.Ambiente);
        if (ambiente != CodigosPgWeb.Ok)
        {
            return new ResultadoInstalacao(false, ambiente, "ambiente_recusado", null);
        }

        var inicio = biblioteca.Inicializar(contexto.DiretorioDados);
        if (inicio != CodigosPgWeb.Ok)
        {
            return new ResultadoInstalacao(false, inicio, "inicializacao_recusada", null);
        }

        var transacao = biblioteca.NovaTransacao(OperacaoPgWeb.Instalacao);
        if (transacao != CodigosPgWeb.Ok)
        {
            return new ResultadoInstalacao(false, transacao, "instalacao_recusada", null);
        }

        var parametro = biblioteca.AdicionarParametro(InformacaoPgWeb.Moeda, "986");
        if (parametro != CodigosPgWeb.Ok)
        {
            return new ResultadoInstalacao(false, parametro, "parametro_recusado", null);
        }

        var capturas = new PwGetData[1];
        short quantidade = 0;
        var execucao = biblioteca.Executar(capturas, ref quantidade);
        if (execucao == CodigosPgWeb.MoreData)
        {
            return new ResultadoInstalacao(false, execucao, "aguardando_dado", capturas[0].Identificador);
        }

        if (execucao != CodigosPgWeb.Ok)
        {
            return new ResultadoInstalacao(false, execucao, "execucao_recusada", null);
        }

        return new ResultadoInstalacao(true, execucao, "preparada", null);
    }
}
