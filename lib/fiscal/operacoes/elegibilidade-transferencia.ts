import { registroPertenceAEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";
import { MENSAGEM_TRANSFERENCIA_DESTINO_INELEGIVEL } from "@/lib/fiscal/operacoes/catalogo";

export type EstabelecimentoTransferencia = {
  id: string;
  empresa_id: string;
  razao_social?: string | null;
  nome_fantasia?: string | null;
  cnpj?: string | null;
};

export type VinculoTransferencia = {
  id: string;
  empresa_origem_id: string;
  empresa_destino_id: string;
  ativo?: boolean | null;
};

export function somenteDigitosCnpj(valor: unknown) {
  return String(valor ?? "").replace(/\D/g, "");
}

export function destinoTransferenciaElegivel(params: {
  empresaOrigemId: string;
  destinoEmpresaId: string;
  vinculos: VinculoTransferencia[];
}) {
  const origem = String(params.empresaOrigemId ?? "");
  const destino = String(params.destinoEmpresaId ?? "");
  if (!origem || !destino || origem === destino) {
    return false;
  }
  return params.vinculos.some(
    (vinculo) =>
      vinculo.ativo !== false &&
      String(vinculo.empresa_origem_id) === origem &&
      String(vinculo.empresa_destino_id) === destino
  );
}

export function listarDestinosTransferenciaElegiveis(params: {
  empresaOrigemId: string;
  vinculos: VinculoTransferencia[];
  estabelecimentos: EstabelecimentoTransferencia[];
}) {
  const origem = String(params.empresaOrigemId ?? "");
  const idsPermitidos = new Set(
    params.vinculos
      .filter(
        (vinculo) =>
          vinculo.ativo !== false &&
          String(vinculo.empresa_origem_id) === origem
      )
      .map((vinculo) => String(vinculo.empresa_destino_id))
  );

  return params.estabelecimentos.filter((estabelecimento) => {
    const id = String(estabelecimento.id);
    return (
      id !== origem &&
      idsPermitidos.has(id) &&
      registroPertenceAEmpresaAtiva(
        { empresa_id: estabelecimento.empresa_id || id },
        id
      )
    );
  });
}

export function mensagemDestinoTransferenciaInelegivel() {
  return MENSAGEM_TRANSFERENCIA_DESTINO_INELEGIVEL;
}

export function validarDestinoNaoEhClienteComum(destinatarioTipo: string) {
  return String(destinatarioTipo ?? "") === "estabelecimento";
}
