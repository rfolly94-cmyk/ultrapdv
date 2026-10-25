namespace UltraPDV.TEF.Nucleo;

public sealed class CoordenadorSessao
{
    private readonly object _trava = new();
    private readonly Dictionary<string, OcupacaoPinPad> _pinpads = new(StringComparer.OrdinalIgnoreCase);
    private ContextoEmpresa? _sessao;

    public void Iniciar(ContextoEmpresa contexto, string pinPadId)
    {
        if (string.IsNullOrWhiteSpace(pinPadId))
        {
            throw new PinPadOcupadoException("O PinPad físico não foi identificado.");
        }

        lock (_trava)
        {
            if (_sessao is not null && _sessao.EmpresaId != contexto.EmpresaId)
            {
                throw new SessaoCruzadaException("Há sessão ativa de outra empresa. A troca foi recusada.");
            }

            if (_pinpads.TryGetValue(pinPadId, out var ocupacao)
                && (ocupacao.EmpresaId != contexto.EmpresaId || ocupacao.PendenciaFinanceira))
            {
                throw new PinPadOcupadoException("O PinPad está reservado por outra empresa ou por uma pendência financeira.");
            }

            _sessao = contexto;
            _pinpads[pinPadId] = new OcupacaoPinPad(contexto.EmpresaId, contexto.TerminalId, false);
        }
    }

    public void MarcarPendencia(string pinPadId, Guid empresaId)
    {
        lock (_trava)
        {
            if (!_pinpads.TryGetValue(pinPadId, out var ocupacao) || ocupacao.EmpresaId != empresaId)
            {
                throw new SessaoCruzadaException("A pendência não pertence à empresa que ocupa o PinPad.");
            }

            _pinpads[pinPadId] = ocupacao with { PendenciaFinanceira = true };
        }
    }

    public void Encerrar(Guid empresaId)
    {
        lock (_trava)
        {
            if (_sessao is not null && _sessao.EmpresaId != empresaId)
            {
                throw new SessaoCruzadaException("Outra empresa tentou encerrar a sessão ativa.");
            }

            _sessao = null;
            foreach (var item in _pinpads.Where(par => par.Value.EmpresaId == empresaId && !par.Value.PendenciaFinanceira).Select(par => par.Key).ToArray())
            {
                _pinpads.Remove(item);
            }
        }
    }

    private sealed record OcupacaoPinPad(Guid EmpresaId, Guid TerminalId, bool PendenciaFinanceira);
}
