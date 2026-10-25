namespace UltraPDV.TEF.Interop;

public class OperacaoRealBloqueadaException : InvalidOperationException
{
    public OperacaoRealBloqueadaException()
        : this("A operação financeira não foi autorizada. Nenhuma instalação, cobrança, confirmação ou cancelamento foi enviado à DLL.")
    {
    }

    public OperacaoRealBloqueadaException(string mensagem)
        : base(mensagem)
    {
    }
}

public sealed class AutorizacaoAusenteException : OperacaoRealBloqueadaException
{
    public AutorizacaoAusenteException()
        : base("A operação financeira exige autorização explícita de homologação. Nenhuma cobrança, confirmação ou cancelamento foi enviado à DLL.")
    {
    }
}
