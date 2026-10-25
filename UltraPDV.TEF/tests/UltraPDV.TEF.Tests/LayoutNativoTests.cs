using System.Runtime.InteropServices;
using System.Text;
using UltraPDV.TEF.Interop;

namespace UltraPDV.TEF.Tests;

public class LayoutNativoTests
{
    private static readonly string Raiz = EncontrarRaiz();
    private static readonly string HeaderOficial = Path.Combine(
        @"C:\ultrapdv-backup-tef-20261023-093138\20260923-Integracao-PGWebLib_v4.1.50.924",
        "PGWebLib.h");

    [Fact]
    public void PwGetData_confere_com_a_hipotese_windows_em_todos_os_campos()
    {
        var medicao = Medicao.Ler(Path.Combine(Raiz, "native", "medicoes", "windows-natural.txt"));
        Assert.Equal(12500, medicao.Tamanho("PW_GetData"));
        Assert.Equal(4, medicao.Alinhamento("PW_GetData"));
        Assert.Equal(medicao.Tamanho("PW_GetData"), Marshal.SizeOf<PwGetData>());
        Assert.Equal(4, Alinhamento<PwGetData>());

        for (var indice = 0; indice < CamposGetData.Length; indice++)
        {
            var campo = CamposGetData[indice];
            var c = medicao.Campo("PW_GetData", campo.C);
            var offset = (int)Marshal.OffsetOf<PwGetData>(campo.Csharp);
            Assert.Equal(c.Offset, offset);
            var limite = indice == CamposGetData.Length - 1
                ? Marshal.SizeOf<PwGetData>()
                : (int)Marshal.OffsetOf<PwGetData>(CamposGetData[indice + 1].Csharp);
            Assert.True(limite >= offset + c.Tamanho);
            Assert.True(limite - (offset + c.Tamanho) < 4);
        }
    }

    [Fact]
    public void PwOperations_confere_com_as_tres_hipoteses()
    {
        Assert.Equal(43, Marshal.SizeOf<PwOperations>());
        Assert.Equal(0, (int)Marshal.OffsetOf<PwOperations>(nameof(PwOperations.TipoOperacao)));
        Assert.Equal(1, (int)Marshal.OffsetOf<PwOperations>(nameof(PwOperations.Texto)));
        Assert.Equal(22, (int)Marshal.OffsetOf<PwOperations>(nameof(PwOperations.Valor)));
        Assert.Equal(1, Alinhamento<PwOperations>());

        foreach (var arquivo in new[] { "windows-natural.txt", "windows-pack1.txt", "lp64-uint64.txt" })
        {
            var medicao = Medicao.Ler(Path.Combine(Raiz, "native", "medicoes", arquivo));
            Assert.Equal(43, medicao.Tamanho("PW_Operations"));
            Assert.Equal(1, medicao.Alinhamento("PW_Operations"));
            Assert.Equal(0, medicao.Campo("PW_Operations", "bOperType").Offset);
            Assert.Equal(1, medicao.Campo("PW_Operations", "szText").Offset);
            Assert.Equal(22, medicao.Campo("PW_Operations", "szValue").Offset);
        }
    }

    [Fact]
    public void Hipoteses_de_empacotamento_e_uint32_divergem_de_12500()
    {
        var natural = Medicao.Ler(Path.Combine(Raiz, "native", "medicoes", "windows-natural.txt"));
        var pack1 = Medicao.Ler(Path.Combine(Raiz, "native", "medicoes", "windows-pack1.txt"));
        var lp64 = Medicao.Ler(Path.Combine(Raiz, "native", "medicoes", "lp64-uint64.txt"));

        Assert.Equal(12497, pack1.Tamanho("PW_GetData"));
        Assert.Equal(1, pack1.Alinhamento("PW_GetData"));
        Assert.Equal(12402, pack1.Campo("PW_GetData", "ulTipoEntradaCartao").Offset);
        Assert.Equal(69, pack1.Tamanho("PW_OperationsEx"));

        Assert.Equal(8, lp64.Tipo("Uint32"));
        Assert.Equal(12520, lp64.Tamanho("PW_GetData"));
        Assert.Equal(8, lp64.Alinhamento("PW_GetData"));
        Assert.Equal(12016, lp64.Campo("PW_GetData", "ulValorMinimo").Offset);
        Assert.Equal(8, lp64.Campo("PW_GetData", "ulValorMinimo").Tamanho);
        Assert.Equal(12416, lp64.Campo("PW_GetData", "ulTipoEntradaCartao").Offset);

        Assert.NotEqual(natural.Tamanho("PW_GetData"), pack1.Tamanho("PW_GetData"));
        Assert.NotEqual(natural.Tamanho("PW_GetData"), lp64.Tamanho("PW_GetData"));
        Assert.Equal(72, natural.Tamanho("PW_OperationsEx"));
        Assert.Equal(4, natural.Campo("PW_OperationsEx", "fAuthPreferential").Tamanho);
        Assert.False(AssinaturasPgWeb.ComprovadoContraDll);
        Assert.False(AssinaturasPgWeb.PwlTypeBloqueiaExecucao);
    }

    [Fact]
    public void OperationsEx_com_bool_int_nao_entra_na_camada_nativa()
    {
        var medicao = Medicao.Ler(Path.Combine(Raiz, "native", "medicoes", "windows-natural.txt"));
        Assert.Equal(medicao.Tamanho("PW_OperationsEx"), Marshal.SizeOf<HipoteseOperationsExBoolInt>());
        Assert.Equal(64, (int)Marshal.OffsetOf<HipoteseOperationsExBoolInt>(nameof(HipoteseOperationsExBoolInt.Preferencial)));
        Assert.Equal(68, (int)Marshal.OffsetOf<HipoteseOperationsExBoolInt>(nameof(HipoteseOperationsExBoolInt.ModoPagamento)));
        Assert.Equal(69, Marshal.SizeOf<HipoteseOperationsExPack1>());
        Assert.DoesNotContain("PwOperationsEx", Fonte("BibliotecaNativaPgWeb.cs"));
    }

    [Fact]
    public void Codigos_compilados_do_header_oficial_conferem()
    {
        var medicao = Medicao.Ler(Path.Combine(Raiz, "native", "medicoes", "windows-natural.txt"));
        Assert.Equal(0, medicao.Enum("PWRET_OK"));
        Assert.Equal(-2599, medicao.Enum("PWRET_FROMHOSTPENDTRN"));
        Assert.Equal(CodigosPgWeb.FromHost, (short)medicao.Enum("PWRET_FROMHOST"));
        Assert.Equal(CodigosPgWeb.InvParam, (short)medicao.Enum("PWRET_INVPARAM"));
        Assert.Equal(CodigosPgWeb.NotInst, (short)medicao.Enum("PWRET_NOTINST"));
        Assert.Equal(CodigosPgWeb.MoreData, (short)medicao.Enum("PWRET_MOREDATA"));
        Assert.Equal(CodigosPgWeb.NoData, (short)medicao.Enum("PWRET_NODATA"));
        Assert.Equal(CodigosPgWeb.Display, (short)medicao.Enum("PWRET_DISPLAY"));
        Assert.Equal(CodigosPgWeb.InvCall, (short)medicao.Enum("PWRET_INVCALL"));
        Assert.Equal(CodigosPgWeb.Nothing, (short)medicao.Enum("PWRET_NOTHING"));
        Assert.Equal(CodigosPgWeb.BufOvflw, (short)medicao.Enum("PWRET_BUFOVFLW"));
        Assert.Equal(CodigosPgWeb.Cancel, (short)medicao.Enum("PWRET_CANCEL"));
        Assert.Equal(CodigosPgWeb.Timeout, (short)medicao.Enum("PWRET_TIMEOUT"));
        Assert.Equal(CodigosPgWeb.PpNotFound, (short)medicao.Enum("PWRET_PPNOTFOUND"));
        Assert.Equal(CodigosPgWeb.TrnNotInit, (short)medicao.Enum("PWRET_TRNNOTINIT"));
        Assert.Equal(CodigosPgWeb.DllNotInit, (short)medicao.Enum("PWRET_DLLNOTINIT"));
        Assert.Equal(CodigosPgWeb.Fallback, (short)medicao.Enum("PWRET_FALLBACK"));
        Assert.Equal(CodigosPgWeb.WriteErr, (short)medicao.Enum("PWRET_WRITERR"));
        Assert.Equal(CodigosPgWeb.PpComErr, (short)medicao.Enum("PWRET_PPCOMERR"));
        Assert.Equal(CodigosPgWeb.AmbienteProducao, (short)medicao.Enum("ENVRMNT_PROD"));
        Assert.Equal(CodigosPgWeb.AmbienteTeste, (short)medicao.Enum("ENVRMNT_TEST"));
        Assert.Equal(40, medicao.Define("PWMENU_MAXINTENS"));
        Assert.Equal(OperacaoPgWeb.Instalacao, (byte)medicao.Define("PWOPER_INSTALL"));
        Assert.Equal(OperacaoPgWeb.Administracao, (byte)medicao.Define("PWOPER_ADMIN"));
        Assert.Equal(OperacaoPgWeb.Venda, (byte)medicao.Define("PWOPER_SALE"));
        Assert.Equal(OperacaoPgWeb.CancelamentoVenda, (byte)medicao.Define("PWOPER_SALEVOID"));
        Assert.Equal(InformacaoPgWeb.ValorTotal, (ushort)medicao.Define("PWINFO_TOTAMNT"));
        Assert.Equal(InformacaoPgWeb.Moeda, (ushort)medicao.Define("PWINFO_CURRENCY"));
        Assert.Equal(InformacaoPgWeb.TipoCartao, (ushort)medicao.Define("PWINFO_CARDTYPE"));
        Assert.Equal(InformacaoPgWeb.NumeroRequisicao, (ushort)medicao.Define("PWINFO_REQNUM"));
        Assert.Equal(InformacaoPgWeb.ConfirmacaoRequerida, (ushort)medicao.Define("PWINFO_CNFREQ"));
        Assert.Equal(InformacaoPgWeb.UsuarioTecnico, (ushort)medicao.Define("PWINFO_AUTHTECHUSER"));
        Assert.Equal(17, medicao.Define("PWDAT_USERAUTH"));
    }

    [Fact]
    public void Header_oficial_nao_compila_sem_PWL_Type_e_os_prototipos_estao_nele()
    {
        Assert.False(File.Exists(Path.Combine(Path.GetDirectoryName(HeaderOficial)!, "PWL_Type.h")));
        var sonda = File.ReadAllText(Path.Combine(Raiz, "native", "medicoes", "header-oficial-sem-pwl.txt"));
        Assert.Contains("PWL_Type.h", sonda);
        Assert.Contains("file not found", sonda);

        var header = File.ReadAllText(HeaderOficial, Encoding.Latin1);
        Assert.Contains("#include \"PWL_Type.h\"", header);
        Assert.Contains("#define PW_EXPORT", header);
        Assert.DoesNotContain("__stdcall", header);
        Assert.DoesNotContain("#pragma pack", header);
        foreach (var prototipo in AssinaturasPgWeb.Prototipos)
        {
            Assert.Contains(prototipo, header);
        }
    }

    [Fact]
    public void Dll_x64_exporta_os_nomes_sem_ser_carregada()
    {
        var caminho = CaminhoDll();
        Assert.NotNull(caminho);
        var identidade = IdentidadeDllOficial.Verificar(caminho!);
        Assert.True(identidade.Confere);
        var leitura = LeitorExportacoesPe.Ler(caminho!);
        Assert.Equal(0x8664, leitura.Maquina);
        Assert.False(leitura.CarregouBiblioteca);
        foreach (var nome in AssinaturasPgWeb.Exportacoes)
        {
            Assert.Contains(nome, leitura.Nomes);
        }
    }

    private static int Alinhamento<T>() where T : struct
    {
        return (int)Marshal.OffsetOf<SondaAlinhamento<T>>(nameof(SondaAlinhamento<T>.Valor));
    }

    private static string Fonte(string arquivo)
    {
        return File.ReadAllText(Path.Combine(Raiz, "src", "UltraPDV.TEF", "Interop", arquivo));
    }

    private static string? CaminhoDll()
    {
        foreach (var candidato in new[]
        {
            Environment.GetEnvironmentVariable("ULTRAPDV_PGWEBLIB"),
            @"C:\ultrapdv-backup-tef-20261023-093138\20260923-Integracao-PGWebLib_v4.1.50.924\x64\PGWebLib.dll",
            @"C:\Program Files\UltraPDV Connector\bin\tef\PGWebLib.dll",
        })
        {
            if (!string.IsNullOrWhiteSpace(candidato) && File.Exists(candidato))
            {
                return candidato;
            }
        }

        return null;
    }

    private static string EncontrarRaiz()
    {
        var diretorio = new DirectoryInfo(AppContext.BaseDirectory);
        while (diretorio is not null)
        {
            if (File.Exists(Path.Combine(diretorio.FullName, "UltraPDV.TEF.sln")))
            {
                return diretorio.FullName;
            }

            diretorio = diretorio.Parent;
        }

        throw new DirectoryNotFoundException("Solucao UltraPDV.TEF nao encontrada.");
    }

    private static readonly (string C, string Csharp)[] CamposGetData =
    [
        ("wIdentificador", nameof(PwGetData.Identificador)),
        ("bTipoDeDado", nameof(PwGetData.TipoDeDado)),
        ("szPrompt", nameof(PwGetData.Prompt)),
        ("bNumOpcoesMenu", nameof(PwGetData.NumeroOpcoesMenu)),
        ("vszTextoMenu", nameof(PwGetData.TextoMenu)),
        ("vszValorMenu", nameof(PwGetData.ValorMenu)),
        ("szMascaraDeCaptura", nameof(PwGetData.MascaraCaptura)),
        ("bTiposEntradaPermitidos", nameof(PwGetData.TiposEntradaPermitidos)),
        ("bTamanhoMinimo", nameof(PwGetData.TamanhoMinimo)),
        ("bTamanhoMaximo", nameof(PwGetData.TamanhoMaximo)),
        ("ulValorMinimo", nameof(PwGetData.ValorMinimo)),
        ("ulValorMaximo", nameof(PwGetData.ValorMaximo)),
        ("bOcultarDadosDigitados", nameof(PwGetData.OcultarDadosDigitados)),
        ("bValidacaoDado", nameof(PwGetData.ValidacaoDado)),
        ("bAceitaNulo", nameof(PwGetData.AceitaNulo)),
        ("szValorInicial", nameof(PwGetData.ValorInicial)),
        ("bTeclasDeAtalho", nameof(PwGetData.TeclasAtalho)),
        ("szMsgValidacao", nameof(PwGetData.MensagemValidacao)),
        ("szMsgConfirmacao", nameof(PwGetData.MensagemConfirmacao)),
        ("szMsgDadoMaior", nameof(PwGetData.MensagemDadoMaior)),
        ("szMsgDadoMenor", nameof(PwGetData.MensagemDadoMenor)),
        ("bCapturarDataVencCartao", nameof(PwGetData.CapturarDataVencimentoCartao)),
        ("ulTipoEntradaCartao", nameof(PwGetData.TipoEntradaCartao)),
        ("bItemInicial", nameof(PwGetData.ItemInicial)),
        ("bNumeroCapturas", nameof(PwGetData.NumeroCapturas)),
        ("szMsgPrevia", nameof(PwGetData.MensagemPrevia)),
        ("bTipoEntradaCodigoBarras", nameof(PwGetData.TipoEntradaCodigoBarras)),
        ("bOmiteMsgAlerta", nameof(PwGetData.OmiteMensagemAlerta)),
        ("bIniciaPelaEsquerda", nameof(PwGetData.IniciaPelaEsquerda)),
        ("bNotificarCancelamento", nameof(PwGetData.NotificarCancelamento)),
        ("bAlinhaPelaDireita", nameof(PwGetData.AlinhaPelaDireita)),
    ];

    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    private struct SondaAlinhamento<T> where T : struct
    {
        public byte Inicio;
        public T Valor;
    }

    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    private unsafe struct HipoteseOperationsExBoolInt
    {
        public byte Tipo;
        public fixed byte Nome[21];
        public fixed byte Autorizador[21];
        public fixed byte Valor[21];
        public int Preferencial;
        public byte ModoPagamento;
    }

    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    private unsafe struct HipoteseOperationsExPack1
    {
        public byte Tipo;
        public fixed byte Nome[21];
        public fixed byte Autorizador[21];
        public fixed byte Valor[21];
        public int Preferencial;
        public byte ModoPagamento;
    }
}

internal sealed class Medicao
{
    private readonly Dictionary<string, int> _tamanhos = new();
    private readonly Dictionary<string, int> _alinhamentos = new();
    private readonly Dictionary<string, int> _tipos = new();
    private readonly Dictionary<string, (int Offset, int Tamanho)> _campos = new();
    private readonly Dictionary<string, int> _enums = new();
    private readonly Dictionary<string, int> _defines = new();

    public int Tamanho(string estrutura) => _tamanhos[estrutura];
    public int Alinhamento(string estrutura) => _alinhamentos[estrutura];
    public int Tipo(string nome) => _tipos[nome];
    public (int Offset, int Tamanho) Campo(string estrutura, string nome) => _campos[$"{estrutura}.{nome}"];
    public int Enum(string nome) => _enums[nome];
    public int Define(string nome) => _defines[nome];

    public static Medicao Ler(string caminho)
    {
        var medicao = new Medicao();
        foreach (var bruta in File.ReadAllLines(caminho))
        {
            var linha = bruta.Trim().TrimStart('\uFEFF');
            if (linha.Length == 0)
            {
                continue;
            }

            var partes = linha.Split(' ');
            switch (partes[0])
            {
                case "sizeof" when partes.Length == 3 && !EhEstrutura(partes[1]):
                    medicao._tipos[partes[1]] = int.Parse(partes[2]);
                    break;
                case "sizeof":
                    medicao._tamanhos[string.Join(' ', partes[1..^1])] = int.Parse(partes[^1]);
                    break;
                case "alignof":
                    medicao._alinhamentos[string.Join(' ', partes[1..^1])] = int.Parse(partes[^1]);
                    break;
                case "offset":
                    medicao._campos[$"{partes[1]}.{partes[2]}"] = (int.Parse(partes[3]), int.Parse(partes[4]));
                    break;
                case "enum":
                    medicao._enums[partes[1]] = int.Parse(partes[2]);
                    break;
                case "define":
                    medicao._defines[partes[1]] = int.Parse(partes[2]);
                    break;
            }
        }

        return medicao;
    }

    private static bool EhEstrutura(string nome) => nome is "PW_GetData" or "PW_Operations" or "PW_OperationsEx";
}

internal sealed record LeituraPe(ushort Maquina, IReadOnlyList<string> Nomes, bool CarregouBiblioteca);

internal static class LeitorExportacoesPe
{
    public static LeituraPe Ler(string caminho)
    {
        var bytes = File.ReadAllBytes(caminho);
        if (bytes.Length < 0x40 || bytes[0] != (byte)'M' || bytes[1] != (byte)'Z')
        {
            throw new InvalidDataException("Arquivo sem cabecalho MZ.");
        }

        var pe = BitConverter.ToInt32(bytes, 0x3C);
        if (bytes[pe] != (byte)'P' || bytes[pe + 1] != (byte)'E')
        {
            throw new InvalidDataException("Arquivo sem cabecalho PE.");
        }

        var maquina = BitConverter.ToUInt16(bytes, pe + 4);
        var secoes = BitConverter.ToUInt16(bytes, pe + 6);
        var tamanhoOpcional = BitConverter.ToUInt16(bytes, pe + 20);
        var opcional = pe + 24;
        var magia = BitConverter.ToUInt16(bytes, opcional);
        var diretorio = opcional + (magia == 0x20B ? 112 : 96);
        var exportacaoRva = BitConverter.ToInt32(bytes, diretorio);
        var tabela = opcional + tamanhoOpcional;

        int ParaOffset(int rva)
        {
            for (var indice = 0; indice < secoes; indice++)
            {
                var secao = tabela + indice * 40;
                var virtualAddress = BitConverter.ToInt32(bytes, secao + 12);
                var tamanhoVirtual = BitConverter.ToInt32(bytes, secao + 8);
                var tamanhoBruto = BitConverter.ToInt32(bytes, secao + 16);
                var bruto = BitConverter.ToInt32(bytes, secao + 20);
                var alcance = Math.Max(tamanhoVirtual, tamanhoBruto);
                if (rva >= virtualAddress && rva < virtualAddress + alcance)
                {
                    return bruto + (rva - virtualAddress);
                }
            }

            throw new InvalidDataException($"RVA {rva} fora das secoes.");
        }

        var exportacao = ParaOffset(exportacaoRva);
        var quantidade = BitConverter.ToInt32(bytes, exportacao + 24);
        var nomes = ParaOffset(BitConverter.ToInt32(bytes, exportacao + 32));
        var lista = new List<string>(quantidade);
        for (var indice = 0; indice < quantidade; indice++)
        {
            var inicio = ParaOffset(BitConverter.ToInt32(bytes, nomes + indice * 4));
            var fim = inicio;
            while (bytes[fim] != 0)
            {
                fim++;
            }

            lista.Add(Encoding.ASCII.GetString(bytes, inicio, fim - inicio));
        }

        return new LeituraPe(maquina, lista, false);
    }
}
