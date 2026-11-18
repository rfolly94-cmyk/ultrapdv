using UltraPDV.TEF.Interop;

namespace UltraPDV.TEF.Nucleo;

/// <summary>
/// Classifica o bOperType devolvido por PW_iGetOperationsEx.
/// O rótulo da interface não escolhe o código. O código vem do header PWOPER_*.
/// </summary>
public static class CatalogoAdministrativo
{
    /// <summary>PWOPTYPE_ADMIN. É o filtro da listagem, não o código de uma operação.</summary>
    public const byte TipoLista = 1;

    public static bool Financeira(byte operacao) => operacao is
        0x21 or 0x22 or 0x23 or 0x29 or 0x2A or 0x2B or 0x2F or 0x30 or 0x31 or 0x32 or 0x33
        or 0x34 or 0x39 or 0x41 or 0x44 or 0x45 or 0x4E;

    public static bool AlteraTerminal(byte operacao) => operacao is
        0x01 or 0x02 or 0x27 or 0x52 or 0xFD or 0xFE;

    public readonly record struct OpcaoInterface(string Rotulo, string Define, byte Codigo, string Classe, byte Captura);

    public static readonly OpcaoInterface[] Interface =
    [
        new("CANCELAMENTO", "PWOPER_SALEVOID", 0x22, "financeira", TipoDadoPgWeb.Digitado),
        new("PRÉ-AUTORIZAÇÃO", "PWOPER_PREAUTH", 0x29, "financeira", TipoDadoPgWeb.Cartao),
        new("CANC. PRÉ-AUTORIZAÇÃO", "PWOPER_PREAUTVOID", 0x2A, "financeira", TipoDadoPgWeb.Digitado),
        new("PAGAMENTO DE CONTA", "PWOPER_BILLPAYMENT", 0x34, "financeira", TipoDadoPgWeb.CodigoBarras),
        new("RELAT. CERT.", "PWOPER_RPTCERT", 0x50, "consulta", TipoDadoPgWeb.Menu),
        new("RELAT. CERT. DET.", "PWOPER_RPTCERTDETAIL", 0x51, "consulta", TipoDadoPgWeb.Menu),
        new("REIMPRESSÃO", "PWOPER_REPRINT", 0x10, "consulta", TipoDadoPgWeb.Digitado),
        new("RELATÓRIO SINTÉTICO", "PWOPER_RPTTRUNC", 0x11, "consulta", TipoDadoPgWeb.Menu),
        new("RELATÓRIO DETALHADO", "PWOPER_RPTDETAIL", 0x12, "consulta", TipoDadoPgWeb.Menu),
        new("RELATÓRIO RESUMIDO", "PWOPER_RPTSUMMARY", 0x15, "consulta", TipoDadoPgWeb.Menu),
        new("TESTE COMUNICAÇÃO", "PWOPER_COMMTEST", 0x14, "consulta", TipoDadoPgWeb.Menu),
        new("INSTALAÇÃO", "PWOPER_INSTALL", 0x01, "terminal", TipoDadoPgWeb.Menu),
        new("CONFIGURAÇÃO", "PWOPER_CONFIG", 0xFD, "terminal", TipoDadoPgWeb.Digitado),
        new("MANUTENÇÃO", "PWOPER_MAINTENANCE", 0xFE, "terminal", TipoDadoPgWeb.Menu),
        new("VERSÃO", "PWOPER_VERSION", 0xFC, "consulta", TipoDadoPgWeb.Menu),
        new("TESTE DE CHAVES", "PWOPER_TSTKEY", 0xF0, "consulta", TipoDadoPgWeb.DigitacaoPinPad),
        new("DADOS TERMINAL", "PWOPER_COMMONDATA", 0xFA, "consulta", TipoDadoPgWeb.Menu),
        new("EXPORTAR LOGS", "PWOPER_EXPORTLOGS", 0xF1, "consulta", TipoDadoPgWeb.Digitado),
    ];
}
