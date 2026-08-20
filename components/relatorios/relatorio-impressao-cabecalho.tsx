import { LogoEmpresa } from "@/components/empresa/logo-empresa";

export function RelatorioImpressaoCabecalho({
  logoUrl,
  empresaNome,
  titulo,
  periodo,
}: {
  logoUrl?: string | null;
  empresaNome: string;
  titulo: string;
  periodo: string;
}) {
  return (
    <header className="mb-6 hidden print:block">
      {logoUrl ? (
        <div className="mb-2">
          <LogoEmpresa src={logoUrl} nome={empresaNome} />
        </div>
      ) : null}
      <p className="text-sm font-semibold text-zinc-950">{empresaNome}</p>
      <h1 className="mt-2 text-lg font-semibold">Relatório de {titulo}</h1>
      <p className="text-sm text-zinc-600">Período: {periodo}</p>
    </header>
  );
}
