namespace UltraPDV.TEF.Interop;

public interface IBibliotecaPgWeb
{
    bool EhNativa { get; }

    bool OperacaoFinanceiraAutorizada { get; }

    bool InstalacaoProducaoAutorizada { get; }

    /// <summary>
    /// Autoriza somente PWOPER_ADMIN no diretório de produção. Não autoriza venda.
    /// </summary>
    bool AdministracaoProducaoAutorizada => false;

    short DefinirAmbiente(short ambiente);

    short Inicializar(string diretorioTrabalho);

    short NovaTransacao(byte operacao);

    /// <summary>
    /// PW_iGetOperationsEx. O tamanho da estrutura é o layout medido de 72 bytes.
    /// A implementação padrão não consulta a DLL e devolve lista vazia.
    /// </summary>
    (short Codigo, IReadOnlyList<OperacaoDisponivel> Operacoes) ListarOperacoes(byte tipoOperacao)
        => (CodigosPgWeb.Ok, Array.Empty<OperacaoDisponivel>());

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
