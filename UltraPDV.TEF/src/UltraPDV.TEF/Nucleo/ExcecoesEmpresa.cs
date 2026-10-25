namespace UltraPDV.TEF.Nucleo;

public sealed class AcessoEmpresaNegadoException : InvalidOperationException
{
    public AcessoEmpresaNegadoException(string mensagem) : base(mensagem) { }
}

public sealed class SessaoCruzadaException : InvalidOperationException
{
    public SessaoCruzadaException(string mensagem) : base(mensagem) { }
}

public sealed class IsolamentoEmpresaException : InvalidOperationException
{
    public IsolamentoEmpresaException(string mensagem) : base(mensagem) { }
}

public sealed class PinPadOcupadoException : InvalidOperationException
{
    public PinPadOcupadoException(string mensagem) : base(mensagem) { }
}
