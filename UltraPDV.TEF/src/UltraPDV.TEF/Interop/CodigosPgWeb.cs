namespace UltraPDV.TEF.Interop;

/// <summary>
/// Valores conferidos em PGWebLib.h 4.1.50.924.
/// PWRET_INVPARAM inicia em -2499 e os seguintes são sequenciais.
/// PWRET_FROMHOSTPENDTRN inicia em -2599 e os seguintes são sequenciais.
/// ENVRMNT_PROD = 0 e ENVRMNT_TEST = 1.
/// </summary>
public static class CodigosPgWeb
{
    public const short Ok = 0;
    public const short FromHostPendTrn = -2599;
    public const short FromHost = -2596;
    public const short ConfigRequired = -2584;
    public const short InvParam = -2499;
    public const short NotInst = -2498;
    public const short MoreData = -2497;
    public const short NoData = -2496;
    public const short Display = -2495;
    public const short InvCall = -2494;
    public const short Nothing = -2493;
    public const short BufOvflw = -2492;
    public const short Cancel = -2491;
    public const short Timeout = -2490;
    public const short PpNotFound = -2489;
    public const short TrnNotInit = -2488;
    public const short DllNotInit = -2487;
    public const short Fallback = -2486;
    public const short WriteErr = -2485;
    public const short PpComErr = -2484;

    public const short AmbienteProducao = 0;
    public const short AmbienteTeste = 1;
}

public static class OperacaoPgWeb
{
    public const byte Instalacao = 0x01;
    public const byte Administracao = 0x20;
    public const byte Venda = 0x21;
    public const byte CancelamentoVenda = 0x22;
    public const byte Configuracao = 0xFD;
}

public static class ConfirmacaoPgWeb
{
    public const uint Automatica = 0x00000121;
    public const uint DesfazimentoAborto = 0x00043131;
    public const uint DesfazimentoEnergia = 0x00083131;
}

public static class InformacaoPgWeb
{
    public const ushort ValorTotal = 0x25;
    public const ushort Moeda = 0x26;
    public const ushort TipoCartao = 0x29;
    public const ushort NumeroRequisicao = 0x32;
    public const ushort SistemaAutorizador = 0x35;
    public const ushort EstabelecimentoVirtual = 0x36;
    public const ushort TipoFinanciamento = 0x3B;
    public const ushort Parcelas = 0x3C;
    public const ushort MensagemResultado = 0x42;
    public const ushort ConfirmacaoRequerida = 0x43;
    public const ushort ReferenciaLocal = 0x44;
    public const ushort ReferenciaExterna = 0x45;
    public const ushort CodigoAutorizacao = 0x46;
    public const ushort NomeCartao = 0x4B;
    public const ushort NomeCartaoPadrao = 0xC4;
    public const ushort CnpjRecebedor = 0x1C;
    public const ushort CnpjEntidadePagamento = 0x1FA0;
    public const ushort NomeEntidadePagamento = 0x1FA1;
    public const ushort NomeAutomacao = 0x15;
    public const ushort VersaoAutomacao = 0x16;
    public const ushort DesenvolvedorAutomacao = 0x17;
    public const ushort CapacidadeAutomacao = 0x24;
    public const ushort EnderecoAutorizador = 0x05;
    public const ushort PortaAutorizador = 0x07;
    public const ushort DestinoTcpIp = 0x1B;
    public const ushort UsuarioTecnico = 0xF6;
    public const ushort UsaPinPad = 0x7F01;
    public const ushort PortaPinPad = 0x7F02;

    public const string Credito = "1";
    public const string Debito = "2";
}

public static class TipoDadoPgWeb
{
    public const byte Menu = 1;
    public const byte Digitado = 2;
    public const byte Cartao = 3;
    public const byte DigitacaoPinPad = 5;
    public const byte SenhaPinPad = 6;
    public const byte ChipOffline = 9;
    public const byte ChipOnline = 10;
    public const byte ConfirmacaoPinPad = 11;
    public const byte CodigoBarras = 12;
    public const byte RemocaoCartao = 13;
    public const byte ComandoPinPad = 14;
    public const byte ConfirmacaoPositiva = 16;
    public const byte AutenticacaoUsuario = 17;
    public const byte MensagemCheckout = 18;
    public const byte QrCodeCheckout = 20;
}
