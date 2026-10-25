using System.Runtime.InteropServices;

namespace UltraPDV.TEF.Interop;

/// <summary>
/// Chamadas da PGWebLib no modelo do exemplo C# da PGPagamentos: StdCall e textos ANSI.
/// Inicializar e encerrar podem ocorrer em diretorio isolado.
/// Venda de homologacao exige a frase de homologacao.
/// Instalacao de producao e venda de producao usam frases distintas e nao se autorizam entre si.
/// </summary>
public sealed class BibliotecaNativaPgWeb : IBibliotecaPgWeb
{
    public const string FraseHomologacao = "AUTORIZO_OPERACAO_HOMOLOGACAO_PAYGO";
    public const string FraseInstalacaoProducao = "AUTORIZO_INSTALACAO_PRODUCAO_PAYGO";
    public const string FraseVendaProducao = "AUTORIZO_VENDA_PRODUCAO_PAYGO";

    private static readonly object Trava = new();
    private static bool _resolverRegistrado;
    private short _ambiente = -1;
    private bool _autorizada;
    private bool _instalacaoProducao;
    private bool _vendaProducao;

    public BibliotecaNativaPgWeb()
    {
        RegistrarResolvedor();
    }

    public bool EhNativa => true;

    public bool OperacaoFinanceiraAutorizada => _vendaProducao
        ? _ambiente == CodigosPgWeb.AmbienteProducao
        : _autorizada && _ambiente == CodigosPgWeb.AmbienteTeste && !_instalacaoProducao;

    public bool InstalacaoProducaoAutorizada => _instalacaoProducao && !_vendaProducao;

    public IReadOnlyList<string> Chamadas => _chamadas;

    private readonly List<string> _chamadas = new();

    public void AutorizarHomologacao(string frase)
    {
        _instalacaoProducao = false;
        _vendaProducao = false;
        _autorizada = string.Equals(frase, FraseHomologacao, StringComparison.Ordinal);
        if (_autorizada)
        {
            _ambiente = CodigosPgWeb.AmbienteTeste;
        }
    }

    public void AutorizarInstalacaoProducao(string frase)
    {
        _autorizada = false;
        _vendaProducao = false;
        _ambiente = -1;
        _instalacaoProducao = string.Equals(frase, FraseInstalacaoProducao, StringComparison.Ordinal);
    }

    public void AutorizarVendaProducao(string frase)
    {
        _autorizada = false;
        _instalacaoProducao = false;
        _vendaProducao = string.Equals(frase, FraseVendaProducao, StringComparison.Ordinal);
        _ambiente = _vendaProducao ? CodigosPgWeb.AmbienteProducao : (short)-1;
    }

    public short DefinirAmbiente(short ambiente)
    {
        if (_instalacaoProducao || _vendaProducao)
        {
            if (ambiente != CodigosPgWeb.AmbienteProducao)
            {
                return CodigosPgWeb.InvParam;
            }

            _chamadas.Add("PW_iSetEnvironment");
            var codigoProducao = PW_iSetEnvironment(ambiente);
            if (codigoProducao == CodigosPgWeb.Ok)
            {
                _ambiente = ambiente;
            }

            return codigoProducao;
        }

        if (_autorizada && ambiente != CodigosPgWeb.AmbienteTeste)
        {
            _ambiente = -1;
            _autorizada = false;
            return CodigosPgWeb.InvParam;
        }

        _chamadas.Add("PW_iSetEnvironment");
        var codigo = PW_iSetEnvironment(ambiente);
        if (codigo == CodigosPgWeb.Ok)
        {
            _ambiente = ambiente;
        }

        return codigo;
    }

    public short Inicializar(string diretorioTrabalho)
    {
        _chamadas.Add("PW_iInit");
        return PW_iInit(diretorioTrabalho);
    }

    public short NovaTransacao(byte operacao)
    {
        ExigirAutorizacao();
        _chamadas.Add("PW_iNewTransac");
        return PW_iNewTransac(operacao);
    }

    public short AdicionarParametro(ushort identificador, string valor)
    {
        ExigirAutorizacao();
        _chamadas.Add("PW_iAddParam");
        return PW_iAddParam(identificador, valor);
    }

    public short Executar(PwGetData[] capturas, ref short quantidade)
    {
        ExigirAutorizacao();
        _chamadas.Add("PW_iExecTransac");
        return PW_iExecTransac(capturas, ref quantidade);
    }

    public short LerResultado(short informacao, Span<byte> destino)
    {
        _chamadas.Add("PW_iGetResult");
        var buffer = new byte[Math.Max(destino.Length, 1)];
        var codigo = PW_iGetResult(informacao, buffer, (uint)buffer.Length);
        buffer.AsSpan(0, Math.Min(buffer.Length, destino.Length)).CopyTo(destino);
        return codigo;
    }

    public short Confirmar(
        uint status,
        string numeroRequisicao,
        string referenciaLocal,
        string referenciaExterna,
        string estabelecimentoVirtual,
        string sistemaAutorizador)
    {
        ExigirAutorizacao();
        _chamadas.Add("PW_iConfirmation");
        return PW_iConfirmation(status, numeroRequisicao, referenciaLocal, referenciaExterna, estabelecimentoVirtual, sistemaAutorizador);
    }

    public short AbortarPinPad()
    {
        _chamadas.Add("PW_iPPAbort");
        return PW_iPPAbort();
    }

    public short RemoverCartao()
    {
        ExigirAutorizacao();
        _chamadas.Add("PW_iPPRemoveCard");
        return PW_iPPRemoveCard();
    }

    public short LerCartao(ushort indice) => PinPad("PW_iPPGetCard", () => PW_iPPGetCard(indice));

    public short ProcessarChipOffline(ushort indice) => PinPad("PW_iPPGoOnChip", () => PW_iPPGoOnChip(indice));

    public short FinalizarChip(ushort indice) => PinPad("PW_iPPFinishChip", () => PW_iPPFinishChip(indice));

    public short ConfirmarDadoPinPad(ushort indice) => PinPad("PW_iPPConfirmData", () => PW_iPPConfirmData(indice));

    public short ConfirmacaoPositivaPinPad(ushort indice) => PinPad("PW_iPPPositiveConfirmation", () => PW_iPPPositiveConfirmation(indice));

    public short ComandoPinPad(ushort indice) => PinPad("PW_iPPGenericCMD", () => PW_iPPGenericCMD(indice));

    public short LerSenhaPinPad(ushort indice) => PinPad("PW_iPPGetPIN", () => PW_iPPGetPIN(indice));

    public short LerDadoPinPad(ushort indice) => PinPad("PW_iPPGetData", () => PW_iPPGetData(indice));

    public short LoopPinPad(Span<byte> display)
    {
        ExigirAutorizacao();
        _chamadas.Add("PW_iPPEventLoop");
        var buffer = new byte[Math.Max(display.Length, 100)];
        var codigo = PW_iPPEventLoop(buffer, (uint)buffer.Length);
        buffer.AsSpan(0, Math.Min(buffer.Length, display.Length)).CopyTo(display);
        return codigo;
    }

    public short TestarPinPad(string diretorioTrabalho, out string mensagem)
    {
        var inicio = Inicializar(diretorioTrabalho);
        if (inicio != CodigosPgWeb.Ok)
        {
            mensagem = "A biblioteca não iniciou. O PinPad não foi testado e nenhuma cobrança foi iniciada.";
            return inicio;
        }
        var texto = new byte[128];
        byte porta = 0;
        var codigo = PW_iPPCommTest(texto, (ushort)texto.Length, ref porta);
        Encerrar();
        mensagem = codigo == CodigosPgWeb.Ok
            ? "O PinPad respondeu ao teste de comunicação. Nenhuma cobrança foi iniciada."
            : "O PinPad não respondeu ao teste de comunicação. Nenhuma cobrança foi iniciada.";
        return codigo;
    }

    public void Encerrar()
    {
        _chamadas.Add("PW_End");
        PW_End();
    }

    public static string? LocalizarDll()
    {
        foreach (var candidato in new[]
        {
            Environment.GetEnvironmentVariable("ULTRAPDV_PGWEBLIB"),
            @"C:\ultrapdv-backup-tef-20261023-093138\20260923-Integracao-PGWebLib_v4.1.50.924\x64\PGWebLib.dll",
            @"C:\Program Files\UltraPDV Connector\bin\tef\PGWebLib.dll",
        })
        {
            if (!string.IsNullOrWhiteSpace(candidato) && File.Exists(candidato) && IdentidadeDllOficial.Verificar(candidato).Confere)
            {
                return candidato;
            }
        }

        return null;
    }

    private short PinPad(string nome, Func<short> chamada)
    {
        ExigirAutorizacao();
        _chamadas.Add(nome);
        return chamada();
    }

    private void ExigirAutorizacao()
    {
        if (!OperacaoFinanceiraAutorizada && !_instalacaoProducao && !_vendaProducao)
        {
            throw new AutorizacaoAusenteException();
        }
    }

    private static void RegistrarResolvedor()
    {
        lock (Trava)
        {
            if (_resolverRegistrado)
            {
                return;
            }

            NativeLibrary.SetDllImportResolver(typeof(BibliotecaNativaPgWeb).Assembly, (nome, _, _) =>
            {
                if (!string.Equals(nome, "PGWebLib.dll", StringComparison.OrdinalIgnoreCase))
                {
                    return IntPtr.Zero;
                }

                var caminho = LocalizarDll();
                return caminho is null ? IntPtr.Zero : NativeLibrary.Load(caminho);
            });
            _resolverRegistrado = true;
        }
    }

    [DllImport("PGWebLib.dll", CallingConvention = CallingConvention.StdCall, CharSet = CharSet.Ansi)]
    private static extern short PW_iInit(string diretorioTrabalho);

    [DllImport("PGWebLib.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern short PW_iSetEnvironment(short ambiente);

    [DllImport("PGWebLib.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern short PW_iNewTransac(byte operacao);

    [DllImport("PGWebLib.dll", CallingConvention = CallingConvention.StdCall, CharSet = CharSet.Ansi)]
    private static extern short PW_iAddParam(ushort identificador, string valor);

    [DllImport("PGWebLib.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern short PW_iExecTransac([Out] PwGetData[] capturas, ref short quantidade);

    [DllImport("PGWebLib.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern short PW_iGetResult(short informacao, byte[] destino, uint tamanho);

    [DllImport("PGWebLib.dll", CallingConvention = CallingConvention.StdCall, CharSet = CharSet.Ansi)]
    private static extern short PW_iConfirmation(
        uint status,
        string numeroRequisicao,
        string referenciaLocal,
        string referenciaExterna,
        string estabelecimentoVirtual,
        string sistemaAutorizador);

    [DllImport("PGWebLib.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern short PW_iPPAbort();

    [DllImport("PGWebLib.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern short PW_iPPRemoveCard();

    [DllImport("PGWebLib.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern short PW_iPPGetCard(ushort indice);

    [DllImport("PGWebLib.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern short PW_iPPGoOnChip(ushort indice);

    [DllImport("PGWebLib.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern short PW_iPPFinishChip(ushort indice);

    [DllImport("PGWebLib.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern short PW_iPPConfirmData(ushort indice);

    [DllImport("PGWebLib.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern short PW_iPPPositiveConfirmation(ushort indice);

    [DllImport("PGWebLib.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern short PW_iPPGenericCMD(ushort indice);

    [DllImport("PGWebLib.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern short PW_iPPGetPIN(ushort indice);

    [DllImport("PGWebLib.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern short PW_iPPGetData(ushort indice);

    [DllImport("PGWebLib.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern short PW_iPPEventLoop(byte[] display, uint tamanho);

    [DllImport("PGWebLib.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern short PW_iPPCommTest(byte[] mensagem, ushort tamanho, ref byte porta);

    [DllImport("PGWebLib.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern void PW_End();
}
