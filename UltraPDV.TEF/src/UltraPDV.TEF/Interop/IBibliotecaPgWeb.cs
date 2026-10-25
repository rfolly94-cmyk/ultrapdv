namespace UltraPDV.TEF.Interop;

public interface IBibliotecaPgWeb
{
    bool EhNativa { get; }

    bool OperacaoFinanceiraAutorizada { get; }

    bool InstalacaoProducaoAutorizada { get; }

    short DefinirAmbiente(short ambiente);

    short Inicializar(string diretorioTrabalho);

    short NovaTransacao(byte operacao);

    short AdicionarParametro(ushort identificador, string valor);

    short Executar(PwGetData[] capturas, ref short quantidade);

    short LerResultado(short informacao, Span<byte> destino);

    short Confirmar(
        uint status,
        string numeroRequisicao,
        string referenciaLocal,
        string referenciaExterna,
        string estabelecimentoVirtual,
        string sistemaAutorizador);

    short AbortarPinPad();

    short RemoverCartao();

    short LerCartao(ushort indice);

    short ProcessarChipOffline(ushort indice);

    short FinalizarChip(ushort indice);

    short ConfirmarDadoPinPad(ushort indice);

    short ConfirmacaoPositivaPinPad(ushort indice);

    short ComandoPinPad(ushort indice);

    short LerSenhaPinPad(ushort indice);

    short LerDadoPinPad(ushort indice);

    short LoopPinPad(Span<byte> display);

    void Encerrar();
}
