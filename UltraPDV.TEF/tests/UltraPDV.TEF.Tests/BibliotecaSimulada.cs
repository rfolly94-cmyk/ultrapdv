using UltraPDV.TEF.Interop;

namespace UltraPDV.TEF.Tests;

public sealed class BibliotecaSimulada : IBibliotecaPgWeb
{
    private int _etapa;

    public bool EhNativa => false;

    public bool OperacaoFinanceiraAutorizada => false;

    public bool InstalacaoProducaoAutorizada => false;

    public List<string> Chamadas { get; } = new();

    public short ProximaInicializacao { get; set; } = CodigosPgWeb.Ok;

    public short DefinirAmbiente(short ambiente)
    {
        Chamadas.Add("PW_iSetEnvironment");
        return ambiente is CodigosPgWeb.AmbienteProducao or CodigosPgWeb.AmbienteTeste
            ? CodigosPgWeb.Ok
            : CodigosPgWeb.InvParam;
    }

    public short Inicializar(string diretorioTrabalho)
    {
        Chamadas.Add("PW_iInit");
        if (string.IsNullOrWhiteSpace(diretorioTrabalho))
        {
            return CodigosPgWeb.InvParam;
        }

        return ProximaInicializacao;
    }

    public short NovaTransacao(byte operacao)
    {
        Chamadas.Add("PW_iNewTransac:" + operacao.ToString("X2"));
        return operacao == OperacaoPgWeb.Instalacao ? CodigosPgWeb.Ok : CodigosPgWeb.InvCall;
    }

    public short AdicionarParametro(ushort identificador, string valor)
    {
        Chamadas.Add("PW_iAddParam");
        _ = identificador;
        _ = valor;
        return CodigosPgWeb.Ok;
    }

    public short Executar(PwGetData[] capturas, ref short quantidade)
    {
        Chamadas.Add("PW_iExecTransac");
        if (_etapa == 0)
        {
            _etapa = 1;
            capturas[0].Identificador = InformacaoPgWeb.UsuarioTecnico;
            capturas[0].TipoDeDado = 17;
            quantidade = 1;
            return CodigosPgWeb.MoreData;
        }

        quantidade = 0;
        return CodigosPgWeb.Ok;
    }

    public short LerResultado(short informacao, Span<byte> destino)
    {
        Chamadas.Add("PW_iGetResult");
        _ = informacao;
        _ = destino;
        return CodigosPgWeb.NoData;
    }

    public short Confirmar(
        uint status,
        string numeroRequisicao,
        string referenciaLocal,
        string referenciaExterna,
        string estabelecimentoVirtual,
        string sistemaAutorizador)
    {
        Chamadas.Add("PW_iConfirmation");
        return CodigosPgWeb.InvCall;
    }

    public short AbortarPinPad()
    {
        Chamadas.Add("PW_iPPAbort");
        return CodigosPgWeb.Ok;
    }

    public short RemoverCartao()
    {
        Chamadas.Add("PW_iPPRemoveCard");
        return CodigosPgWeb.Ok;
    }

    public short LerCartao(ushort indice)
    {
        Chamadas.Add("PW_iPPGetCard");
        _ = indice;
        return CodigosPgWeb.Ok;
    }

    public short ProcessarChipOffline(ushort indice)
    {
        Chamadas.Add("PW_iPPGoOnChip");
        _ = indice;
        return CodigosPgWeb.Ok;
    }

    public short FinalizarChip(ushort indice)
    {
        Chamadas.Add("PW_iPPFinishChip");
        _ = indice;
        return CodigosPgWeb.Ok;
    }

    public short ConfirmarDadoPinPad(ushort indice)
    {
        Chamadas.Add("PW_iPPConfirmData");
        _ = indice;
        return CodigosPgWeb.Ok;
    }

    public short ConfirmacaoPositivaPinPad(ushort indice)
    {
        Chamadas.Add("PW_iPPPositiveConfirmation");
        _ = indice;
        return CodigosPgWeb.Ok;
    }

    public short ComandoPinPad(ushort indice)
    {
        Chamadas.Add("PW_iPPGenericCMD");
        _ = indice;
        return CodigosPgWeb.Ok;
    }

    public short LerSenhaPinPad(ushort indice)
    {
        Chamadas.Add("PW_iPPGetPIN");
        _ = indice;
        return CodigosPgWeb.Ok;
    }

    public short LerDadoPinPad(ushort indice)
    {
        Chamadas.Add("PW_iPPGetData");
        _ = indice;
        return CodigosPgWeb.Ok;
    }

    public short LoopPinPad(Span<byte> display)
    {
        Chamadas.Add("PW_iPPEventLoop");
        _ = display;
        return CodigosPgWeb.Ok;
    }

    public void Encerrar() => Chamadas.Add("PW_End");
}
