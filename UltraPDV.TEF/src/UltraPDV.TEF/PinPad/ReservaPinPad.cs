using UltraPDV.TEF.Nucleo;

namespace UltraPDV.TEF.PinPad;

public sealed class ReservaPinPad
{
    private readonly CoordenadorSessao _coordenador;

    public ReservaPinPad(CoordenadorSessao coordenador)
    {
        _coordenador = coordenador;
    }

    public void Reservar(ContextoEmpresa contexto, string pinPadId) => _coordenador.Iniciar(contexto, pinPadId);

    public void RegistrarPendencia(Guid empresaId, string pinPadId) => _coordenador.MarcarPendencia(pinPadId, empresaId);

    public void Liberar(Guid empresaId) => _coordenador.Encerrar(empresaId);
}
