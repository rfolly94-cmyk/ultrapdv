import { validarServidorPayGo } from "@/lib/pdv/tef/servidor-paygo";

const HOMOLOGACAO = /tpgweb\.io|pos-transac-sb|sandbox|homolog/i;

export function classificarServidorComercial(valor: unknown):
  | { ok: true; servidor: string }
  | { ok: false; motivo: string } {
  const validado = validarServidorPayGo(valor);
  if (!validado.ok) return validado;
  if (validado.servidor.length > 50) {
    return { ok: false, motivo: "O servidor comercial precisa estar em host:porta e caber no campo da biblioteca." };
  }
  const host = validado.servidor.slice(0, validado.servidor.lastIndexOf(":"));
  if (HOMOLOGACAO.test(host)) {
    return {
      ok: false,
      motivo: "Este endereço é de homologação. Informe o servidor comercial de produção fornecido pela PayGo.",
    };
  }
  return { ok: true, servidor: validado.servidor };
}

export function declaracaoRepeteServidorConfirmado(atual: string, informado: string, validado: boolean) {
  if (!validado) return false;
  const gravado = classificarServidorComercial(atual);
  const novo = classificarServidorComercial(informado);
  if (!gravado.ok || !novo.ok) return false;
  return gravado.servidor.toLowerCase() === novo.servidor.toLowerCase();
}

export function leituraConfirmaServidor(declarado: string, lido: string) {
  const esperado = classificarServidorComercial(declarado);
  const recebido = classificarServidorComercial(lido);
  if (!esperado.ok || !recebido.ok) return false;
  return esperado.servidor.toLowerCase() === recebido.servidor.toLowerCase();
}
