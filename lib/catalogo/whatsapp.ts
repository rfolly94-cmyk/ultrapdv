import { formatarMoeda } from "./regras";
import { montarTelefoneWhatsapp } from "./telefone";

export type ItemMensagemWhatsapp = {
  nome: string;
  quantidade: number;
  precoUnitario: number | null;
  mostrarPreco: boolean;
};

export function montarMensagemWhatsapp(input: {
  mensagemInicial?: string | null;
  itens: ItemMensagemWhatsapp[];
  nome: string;
  tipoEntrega: "retirada" | "entrega";
  observacao?: string | null;
}) {
  const linhas: string[] = [];
  const intro = (input.mensagemInicial ?? "").trim();

  linhas.push(intro || "Olá! Gostaria de fazer este pedido:");
  linhas.push("");

  let total = 0;
  let temPreco = true;

  for (const item of input.itens) {
    if (item.mostrarPreco && item.precoUnitario !== null) {
      const subtotal = item.precoUnitario * item.quantidade;
      total += subtotal;
      linhas.push(
        `${item.quantidade}x ${item.nome}`
      );
      linhas.push(
        `${formatarMoeda(item.precoUnitario)} cada`
      );
      if (item.quantidade > 1) {
        linhas.push(`Subtotal ${formatarMoeda(subtotal)}`);
      }
      linhas.push("");
    } else {
      temPreco = false;
      linhas.push(`${item.quantidade}x ${item.nome}`);
      linhas.push("Consultar preço");
      linhas.push("");
    }
  }

  if (temPreco) {
    linhas.push(`Total: ${formatarMoeda(total)}`);
  } else {
    linhas.push("Total: consultar");
  }

  linhas.push("");
  linhas.push(`Nome: ${input.nome}`);
  linhas.push(
    `Forma: ${input.tipoEntrega === "entrega" ? "Entrega" : "Retirada"}`
  );

  if (input.observacao?.trim()) {
    linhas.push(`Obs: ${input.observacao.trim()}`);
  }

  return linhas.join("\n").trim();
}

export function urlWhatsapp(numero: string, mensagem: string) {
  const whatsapp = montarTelefoneWhatsapp(numero);

  if (!whatsapp) {
    return "";
  }

  return `https://wa.me/${whatsapp}?text=${encodeURIComponent(mensagem)}`;
}
