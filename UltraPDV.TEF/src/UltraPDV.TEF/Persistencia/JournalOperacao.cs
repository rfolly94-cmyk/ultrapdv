using System.Text.Json.Serialization;

namespace UltraPDV.TEF.Persistencia;

public sealed record JournalOperacao(
    Guid EmpresaId,
    Guid TerminalId,
    Guid? VendaId,
    string Identificador,
    string ChaveIdempotencia,
    string Status,
    int ValorCentavos,
    bool ConfirmacaoChamada,
    bool PagamentoRecebido,
    DateTimeOffset AtualizadoEm,
    string? NumeroRequisicao = null,
    string? ReferenciaLocal = null,
    string? ReferenciaExterna = null,
    string? EstabelecimentoVirtual = null,
    string? SistemaAutorizador = null,
    string? ConfirmacaoExigida = null,
    string? Operacao = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? AutorizacaoFiscal = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? BandeiraNome = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? InstituicaoPagamento = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? CnpjCredenciadora = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? CnpjRecebedor = null);
