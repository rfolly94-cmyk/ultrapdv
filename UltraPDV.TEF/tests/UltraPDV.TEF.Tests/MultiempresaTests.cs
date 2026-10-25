using UltraPDV.TEF.Interop;
using UltraPDV.TEF.Nucleo;
using UltraPDV.TEF.Persistencia;
using UltraPDV.TEF.PinPad;
using UltraPDV.TEF.Transacoes;

namespace UltraPDV.TEF.Tests;

public class MultiempresaTests : IDisposable
{
    private readonly string _raiz = Path.Combine(Path.GetTempPath(), "ultrapdv-tef-" + Guid.NewGuid().ToString("N"));
    private readonly Guid _empresaA = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private readonly Guid _empresaB = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private readonly Guid _terminalA1 = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private readonly Guid _terminalA2 = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private readonly Guid _terminalB1 = Guid.Parse("33333333-3333-3333-3333-333333333333");

    [Fact]
    public void Empresa_do_navegador_nao_substitui_a_sessao()
    {
        var resolvedor = CriarResolvedor();
        var sessao = new SessaoAutenticada("usuario-a", new[]
        {
            new VinculoEmpresa(_empresaA, Ativo: true, Principal: true)
        });

        var contexto = resolvedor.Resolver(sessao, null, _terminalA1);
        Assert.Equal(_empresaA, contexto.EmpresaId);
        Assert.Equal("cnpj-a", contexto.Cnpj);

        var negado = Assert.Throws<AcessoEmpresaNegadoException>(() => resolvedor.Resolver(sessao, _empresaB, _terminalB1));
        Assert.Contains("sessão", negado.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Diretorios_credenciais_e_journals_ficam_isolados()
    {
        var resolvedor = CriarResolvedor();
        var sessaoA = new SessaoAutenticada("usuario-a", new[] { new VinculoEmpresa(_empresaA, true, true) });
        var sessaoB = new SessaoAutenticada("usuario-b", new[] { new VinculoEmpresa(_empresaB, true, true) });
        var contextoA1 = resolvedor.Resolver(sessaoA, null, _terminalA1);
        var contextoA2 = resolvedor.Resolver(sessaoA, null, _terminalA2);
        var contextoB = resolvedor.Resolver(sessaoB, null, _terminalB1);

        Assert.NotEqual(contextoA1.DiretorioDados, contextoA2.DiretorioDados);
        Assert.NotEqual(contextoA1.DiretorioDados, contextoB.DiretorioDados);
        Assert.NotEqual(contextoA1.Cnpj, contextoB.Cnpj);
        Assert.NotEqual(contextoA1.PontoCaptura, contextoB.PontoCaptura);
        Assert.DoesNotContain(contextoB.Cnpj, contextoA1.DiretorioDados, StringComparison.Ordinal);

        var repositorio = new RepositorioJournal(_raiz);
        var servico = new ServicoTransacao(repositorio);
        var gravado = servico.RegistrarIntencao(new PedidoTransacao(contextoA1, Guid.NewGuid(), "venda-1", 1000));
        var repetido = servico.RegistrarIntencao(new PedidoTransacao(contextoA1, Guid.NewGuid(), "venda-1", 1000));

        Assert.Equal(gravado.Identificador, repetido.Identificador);
        Assert.Single(repositorio.Listar(_empresaA, _terminalA1));
        Assert.Empty(repositorio.Listar(_empresaA, _terminalA2));
        Assert.Empty(repositorio.Listar(_empresaB, _terminalB1));
    }

    [Fact]
    public void Pendencia_de_uma_empresa_nao_libera_o_pinpad_para_outra()
    {
        var resolvedor = CriarResolvedor();
        var contextoA = resolvedor.Resolver(Sessao(_empresaA), null, _terminalA1);
        var contextoB = resolvedor.Resolver(Sessao(_empresaB), null, _terminalB1);
        var reserva = new ReservaPinPad(new CoordenadorSessao());

        reserva.Reservar(contextoA, "pinpad-1");
        reserva.RegistrarPendencia(_empresaA, "pinpad-1");
        reserva.Liberar(_empresaA);

        Assert.Throws<PinPadOcupadoException>(() => reserva.Reservar(contextoB, "pinpad-1"));
        Assert.Empty(new RepositorioJournal(_raiz).Listar(_empresaB, _terminalB1));
    }

    [Fact]
    public void Sessao_ativa_recusa_troca_de_empresa()
    {
        var resolvedor = CriarResolvedor();
        var reserva = new ReservaPinPad(new CoordenadorSessao());
        reserva.Reservar(resolvedor.Resolver(Sessao(_empresaA), null, _terminalA1), "pinpad-2");

        Assert.Throws<SessaoCruzadaException>(() =>
            reserva.Reservar(resolvedor.Resolver(Sessao(_empresaB), null, _terminalB1), "pinpad-3"));
    }

    [Fact]
    public void Cobranca_confirmacao_e_cancelamento_nao_chamam_a_biblioteca()
    {
        var biblioteca = new BibliotecaSimulada();
        var servico = new ServicoTransacao(new RepositorioJournal(_raiz));

        Assert.Throws<OperacaoRealBloqueadaException>(() => servico.Cobrar(biblioteca));
        Assert.Throws<OperacaoRealBloqueadaException>(() => servico.Confirmar(biblioteca));
        Assert.Throws<OperacaoRealBloqueadaException>(() => servico.Cancelar(biblioteca));
        Assert.Empty(biblioteca.Chamadas);
    }

    [Fact]
    public void Vinculo_inativo_nao_resolve_empresa()
    {
        var resolvedor = CriarResolvedor();
        var sessao = new SessaoAutenticada("usuario-a", new[] { new VinculoEmpresa(_empresaA, Ativo: false, Principal: true) });
        Assert.Throws<AcessoEmpresaNegadoException>(() => resolvedor.Resolver(sessao, null, _terminalA1));
    }

    public void Dispose()
    {
        if (Directory.Exists(_raiz))
        {
            Directory.Delete(_raiz, true);
        }
    }

    private ResolvedorEmpresa CriarResolvedor()
    {
        var catalogo = new CatalogoMemoria();
        catalogo.Adicionar(new ConfiguracaoEmpresa(_empresaA, _terminalA1, "cnpj-a", CodigosPgWeb.AmbienteTeste, "ponto-a1", "lab-a.exemplo:1"));
        catalogo.Adicionar(new ConfiguracaoEmpresa(_empresaA, _terminalA2, "cnpj-a", CodigosPgWeb.AmbienteTeste, "ponto-a2", "lab-a.exemplo:1"));
        catalogo.Adicionar(new ConfiguracaoEmpresa(_empresaB, _terminalB1, "cnpj-b", CodigosPgWeb.AmbienteProducao, "ponto-b1", "lab-b.exemplo:1"));
        return new ResolvedorEmpresa(catalogo, _raiz);
    }

    private SessaoAutenticada Sessao(Guid empresa)
    {
        return new SessaoAutenticada("usuario-" + empresa.ToString("N"), new[]
        {
            new VinculoEmpresa(empresa, Ativo: true, Principal: true)
        });
    }
}
