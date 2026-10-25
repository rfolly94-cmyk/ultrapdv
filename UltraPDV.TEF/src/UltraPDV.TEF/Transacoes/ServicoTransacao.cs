using UltraPDV.TEF.Interop;
using UltraPDV.TEF.Nucleo;
using UltraPDV.TEF.Persistencia;

namespace UltraPDV.TEF.Transacoes;

public sealed record PedidoTransacao(
    ContextoEmpresa Contexto,
    Guid? VendaId,
    string ChaveIdempotencia,
    int ValorCentavos);

public sealed class ServicoTransacao
{
    private readonly RepositorioJournal _journals;

    public ServicoTransacao(RepositorioJournal journals)
    {
        _journals = journals;
    }

    public JournalOperacao RegistrarIntencao(PedidoTransacao pedido)
    {
        if (pedido.ValorCentavos <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(pedido), "O valor da operação precisa ser positivo.");
        }

        var journal = new JournalOperacao(
            pedido.Contexto.EmpresaId,
            pedido.Contexto.TerminalId,
            pedido.VendaId,
            Guid.NewGuid().ToString("N"),
            pedido.ChaveIdempotencia,
            "registrada",
            pedido.ValorCentavos,
            ConfirmacaoChamada: false,
            PagamentoRecebido: false,
            DateTimeOffset.UtcNow);
        return _journals.Gravar(journal);
    }

    public void Cobrar(IBibliotecaPgWeb biblioteca)
    {
        _ = biblioteca;
        throw new OperacaoRealBloqueadaException();
    }

    public void Confirmar(IBibliotecaPgWeb biblioteca)
    {
        _ = biblioteca;
        throw new OperacaoRealBloqueadaException();
    }

    public void Cancelar(IBibliotecaPgWeb biblioteca)
    {
        _ = biblioteca;
        throw new OperacaoRealBloqueadaException();
    }
}
