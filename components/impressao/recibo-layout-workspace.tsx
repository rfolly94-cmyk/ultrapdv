"use client";

import { useMemo, useState, useTransition } from "react";

import {
  gerarPdfTesteReciboVendaAction,
  salvarLayoutReciboAction,
} from "@/app/configuracoes/impressao/recibo-actions";
import { ReciboTermico } from "@/components/impressao/recibo-termico";
import { PageAlert } from "@/components/ui/page-alert";
import { buscarConfiguracoesImpressaoAction } from "@/app/configuracoes/impressao/actions";
import { obterDispositivoId } from "@/lib/impressao/dispositivo";
import { imprimirPdfNaConfiguracao } from "@/lib/impressao/executar-cliente";
import {
  TEXTO_LIVRE_RECIBO_MAX,
  layoutReciboPreset,
  montarReciboVenda,
  reciboVendaExemplo,
  type ReciboLayoutConfig,
  type ReciboVendaCompleto,
  type PresetRecibo,
} from "@/lib/impressao/recibo-layout";
import { configDoTipo } from "@/lib/impressao/regras";

function SwitchLinha({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (valor: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1.5 text-[13px] text-zinc-800">
      <span>{label}</span>
      <input
        type="checkbox"
        className="h-4 w-4 accent-zinc-950"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

function Grupo({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="text-[13px] font-semibold text-zinc-950">{titulo}</h2>
      <div className="mt-2 divide-y divide-zinc-100">{children}</div>
    </section>
  );
}

export function ReciboLayoutWorkspace({
  layoutInicial,
  empresa,
}: {
  layoutInicial: ReciboLayoutConfig;
  empresa: ReciboVendaCompleto["empresa"];
}) {
  const [layout, setLayout] = useState(layoutInicial);
  const [pending, start] = useTransition();
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const dados = useMemo(() => reciboVendaExemplo(empresa), [empresa]);
  const montado = useMemo(
    () => montarReciboVenda(dados, layout, { papel: layout.papel }),
    [dados, layout]
  );

  function patch<K extends keyof ReciboLayoutConfig>(
    secao: K,
    parcial: Partial<ReciboLayoutConfig[K]>
  ) {
    setLayout((atual) => ({
      ...atual,
      [secao]: { ...(atual[secao] as object), ...parcial },
    }));
  }

  function aplicarPreset(nome: PresetRecibo) {
    setLayout(layoutReciboPreset(nome));
    setMensagem(`Preset ${nome} aplicado. Salve para persistir.`);
    setErro(null);
  }

  function salvar() {
    start(async () => {
      const saida = await salvarLayoutReciboAction(layout);
      if (!saida.ok) {
        setErro(saida.erro);
        setMensagem(null);
        return;
      }
      setLayout(saida.layout);
      setErro(null);
      setMensagem("Configuração do recibo salva.");
    });
  }

  function imprimirTeste() {
    start(async () => {
      setErro(null);
      setMensagem(null);
      const dispositivoId = obterDispositivoId();
      const configs = await buscarConfiguracoesImpressaoAction(dispositivoId);
      if (!configs.ok) {
        setErro(configs.erro);
        return;
      }
      const config = configDoTipo(configs.configs, "recibo");
      if (!config.impressoraNome) {
        setErro("Selecione a impressora do recibo em Impressão.");
        return;
      }
      const pdf = await gerarPdfTesteReciboVendaAction({
        layout,
        papel: config.papel,
      });
      if (!pdf.ok) {
        setErro(pdf.erro);
        return;
      }
      const resultado = await imprimirPdfNaConfiguracao(config, pdf.pdfBase64);
      if (!resultado.ok) {
        setErro(resultado.erro);
        return;
      }
      setMensagem(resultado.mensagem || "Enviado para impressão");
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {(["compacto", "padrao", "completo"] as const).map((preset) => (
            <button
              key={preset}
              type="button"
              className="updv-btn updv-btn-ghost capitalize"
              onClick={() => aplicarPreset(preset)}
            >
              {preset === "padrao" ? "Padrão" : preset}
            </button>
          ))}
        </div>

        {erro ? (
          <PageAlert type="erro" className="mx-0">
            {erro}
          </PageAlert>
        ) : null}
        {mensagem ? (
          <PageAlert type="sucesso" className="mx-0">
            {mensagem}
          </PageAlert>
        ) : null}

        <Grupo titulo="Cabeçalho">
          <SwitchLinha
            label="Logo da empresa"
            checked={layout.cabecalho.logo}
            onChange={(logo) => patch("cabecalho", { logo })}
          />
          <SwitchLinha
            label="Nome fantasia"
            checked={layout.cabecalho.nomeFantasia}
            onChange={(nomeFantasia) => patch("cabecalho", { nomeFantasia })}
          />
          <SwitchLinha
            label="Razão social"
            checked={layout.cabecalho.razaoSocial}
            onChange={(razaoSocial) => patch("cabecalho", { razaoSocial })}
          />
          <SwitchLinha
            label="CNPJ/CPF"
            checked={layout.cabecalho.documento}
            onChange={(documento) => patch("cabecalho", { documento })}
          />
          <SwitchLinha
            label="Inscrição estadual"
            checked={layout.cabecalho.inscricaoEstadual}
            onChange={(inscricaoEstadual) =>
              patch("cabecalho", { inscricaoEstadual })
            }
          />
          <SwitchLinha
            label="Endereço"
            checked={layout.cabecalho.endereco}
            onChange={(endereco) => patch("cabecalho", { endereco })}
          />
          <SwitchLinha
            label="Telefone"
            checked={layout.cabecalho.telefone}
            onChange={(telefone) => patch("cabecalho", { telefone })}
          />
          <SwitchLinha
            label="WhatsApp"
            checked={layout.cabecalho.whatsapp}
            onChange={(whatsapp) => patch("cabecalho", { whatsapp })}
          />
          <SwitchLinha
            label="E-mail"
            checked={layout.cabecalho.email}
            onChange={(email) => patch("cabecalho", { email })}
          />
          <label className="block py-2 text-[13px] text-zinc-800">
            Texto acima do recibo
            <textarea
              className="updv-input mt-1 min-h-[64px] w-full"
              maxLength={240}
              value={layout.cabecalho.textoAcima}
              onChange={(event) =>
                patch("cabecalho", { textoAcima: event.target.value })
              }
            />
          </label>
          <label className="flex items-center justify-between gap-3 py-2 text-[13px]">
            Alinhamento do cabeçalho
            <select
              className="updv-input w-40"
              value={layout.cabecalho.alinhamento}
              onChange={(event) =>
                patch("cabecalho", {
                  alinhamento: event.target.value === "esquerda" ? "esquerda" : "centro",
                })
              }
            >
              <option value="centro">Centralizado</option>
              <option value="esquerda">Esquerda</option>
            </select>
          </label>
        </Grupo>

        <Grupo titulo="Venda">
          <SwitchLinha
            label="Número da venda"
            checked={layout.venda.numero}
            onChange={(numero) => patch("venda", { numero })}
          />
          <SwitchLinha
            label="Data"
            checked={layout.venda.data}
            onChange={(data) => patch("venda", { data })}
          />
          <SwitchLinha
            label="Hora"
            checked={layout.venda.hora}
            onChange={(hora) => patch("venda", { hora })}
          />
          <SwitchLinha
            label="Vendedor"
            checked={layout.venda.vendedor}
            onChange={(vendedor) => patch("venda", { vendedor })}
          />
          <SwitchLinha
            label="Cliente"
            checked={layout.venda.cliente}
            onChange={(cliente) => patch("venda", { cliente })}
          />
          <SwitchLinha
            label="CPF/CNPJ do cliente"
            checked={layout.venda.documentoCliente}
            onChange={(documentoCliente) => patch("venda", { documentoCliente })}
          />
          <SwitchLinha
            label="Telefone do cliente"
            checked={layout.venda.telefoneCliente}
            onChange={(telefoneCliente) => patch("venda", { telefoneCliente })}
          />
          <SwitchLinha
            label="Observação da venda"
            checked={layout.venda.observacao}
            onChange={(observacao) => patch("venda", { observacao })}
          />
        </Grupo>

        <Grupo titulo="Produtos">
          <SwitchLinha
            label="Mostrar código"
            checked={layout.itens.codigo}
            onChange={(codigo) => patch("itens", { codigo })}
          />
          <SwitchLinha
            label="Quantidade"
            checked={layout.itens.quantidade}
            onChange={(quantidade) => patch("itens", { quantidade })}
          />
          <SwitchLinha
            label="Valor unitário"
            checked={layout.itens.valorUnitario}
            onChange={(valorUnitario) => patch("itens", { valorUnitario })}
          />
          <SwitchLinha
            label="Desconto do item"
            checked={layout.itens.descontoItem}
            onChange={(descontoItem) => patch("itens", { descontoItem })}
          />
          <SwitchLinha
            label="Total do item"
            checked={layout.itens.totalItem}
            onChange={(totalItem) => patch("itens", { totalItem })}
          />
        </Grupo>

        <Grupo titulo="Totais">
          <SwitchLinha
            label="Subtotal"
            checked={layout.totais.subtotal}
            onChange={(subtotal) => patch("totais", { subtotal })}
          />
          <SwitchLinha
            label="Desconto"
            checked={layout.totais.desconto}
            onChange={(desconto) => patch("totais", { desconto })}
          />
          <SwitchLinha
            label="Acréscimo"
            checked={layout.totais.acrescimo}
            onChange={(acrescimo) => patch("totais", { acrescimo })}
          />
          <SwitchLinha
            label="Total final"
            checked={layout.totais.totalFinal}
            onChange={(totalFinal) => patch("totais", { totalFinal })}
          />
        </Grupo>

        <Grupo titulo="Pagamentos">
          <SwitchLinha
            label="Formas de pagamento"
            checked={layout.pagamentos.formas}
            onChange={(formas) => patch("pagamentos", { formas })}
          />
          <SwitchLinha
            label="Valor de cada forma"
            checked={layout.pagamentos.valorForma}
            onChange={(valorForma) => patch("pagamentos", { valorForma })}
          />
          <SwitchLinha
            label="Valor recebido"
            checked={layout.pagamentos.valorRecebido}
            onChange={(valorRecebido) => patch("pagamentos", { valorRecebido })}
          />
          <SwitchLinha
            label="Troco"
            checked={layout.pagamentos.troco}
            onChange={(troco) => patch("pagamentos", { troco })}
          />
          <SwitchLinha
            label="Parcelas / cartão"
            checked={layout.pagamentos.parcelas}
            onChange={(parcelas) => patch("pagamentos", { parcelas })}
          />
          <SwitchLinha
            label="PIX quando utilizado"
            checked={layout.pagamentos.pix}
            onChange={(pix) => patch("pagamentos", { pix })}
          />
        </Grupo>

        <Grupo titulo="Carteira / Fiado">
          <SwitchLinha
            label="Mostrar Carteira/Fiado"
            checked={layout.carteira.mostrar}
            onChange={(mostrar) => patch("carteira", { mostrar })}
          />
          <SwitchLinha
            label="Valor fiado desta venda"
            checked={layout.carteira.valorFiado}
            onChange={(valorFiado) => patch("carteira", { valorFiado })}
          />
          <SwitchLinha
            label="Vencimento"
            checked={layout.carteira.vencimento}
            onChange={(vencimento) => patch("carteira", { vencimento })}
          />
          <SwitchLinha
            label="Saldo anterior"
            checked={layout.carteira.saldoAnterior}
            onChange={(saldoAnterior) => patch("carteira", { saldoAnterior })}
          />
          <SwitchLinha
            label="Novo saldo devedor"
            checked={layout.carteira.novoSaldo}
            onChange={(novoSaldo) => patch("carteira", { novoSaldo })}
          />
          <SwitchLinha
            label="Limite/crédito disponível"
            checked={layout.carteira.limite}
            onChange={(limite) => patch("carteira", { limite })}
          />
        </Grupo>

        <Grupo titulo="Rodapé">
          <SwitchLinha
            label="Mostrar texto personalizado"
            checked={layout.rodape.mostrarTextoPersonalizado}
            onChange={(mostrarTextoPersonalizado) =>
              patch("rodape", { mostrarTextoPersonalizado })
            }
          />
          <label className="block py-2 text-[13px] text-zinc-800">
            Texto personalizado do rodapé
            <textarea
              className="updv-input mt-1 min-h-[96px] w-full"
              maxLength={TEXTO_LIVRE_RECIBO_MAX}
              value={layout.rodape.textoPersonalizado}
              onChange={(event) =>
                patch("rodape", { textoPersonalizado: event.target.value })
              }
              placeholder="Obrigado pela preferência!"
            />
            <span className="mt-1 block text-[12px] text-zinc-500">
              {layout.rodape.textoPersonalizado.length}/{TEXTO_LIVRE_RECIBO_MAX}
            </span>
          </label>
          <label className="flex items-center justify-between gap-3 py-2 text-[13px]">
            Alinhamento do texto
            <select
              className="updv-input w-40"
              value={layout.rodape.alinhamentoTexto}
              onChange={(event) =>
                patch("rodape", {
                  alinhamentoTexto:
                    event.target.value === "esquerda" ? "esquerda" : "centro",
                })
              }
            >
              <option value="centro">Centralizado</option>
              <option value="esquerda">Esquerda</option>
            </select>
          </label>
          <label className="block py-2 text-[13px]">
            Política de troca
            <input
              className="updv-input mt-1 w-full"
              value={layout.rodape.politicaTroca}
              onChange={(event) =>
                patch("rodape", { politicaTroca: event.target.value })
              }
            />
          </label>
          <label className="block py-2 text-[13px]">
            Garantia
            <input
              className="updv-input mt-1 w-full"
              value={layout.rodape.garantia}
              onChange={(event) =>
                patch("rodape", { garantia: event.target.value })
              }
            />
          </label>
          <SwitchLinha
            label="Telefone no rodapé"
            checked={layout.rodape.telefone}
            onChange={(telefone) => patch("rodape", { telefone })}
          />
          <SwitchLinha
            label="WhatsApp no rodapé"
            checked={layout.rodape.whatsapp}
            onChange={(whatsapp) => patch("rodape", { whatsapp })}
          />
          <label className="block py-2 text-[13px]">
            Instagram
            <input
              className="updv-input mt-1 w-full"
              value={layout.rodape.instagram}
              onChange={(event) =>
                patch("rodape", { instagram: event.target.value })
              }
              placeholder="@minhaloja"
            />
          </label>
          <label className="block py-2 text-[13px]">
            Site
            <input
              className="updv-input mt-1 w-full"
              value={layout.rodape.site}
              onChange={(event) => patch("rodape", { site: event.target.value })}
              placeholder="https://"
            />
          </label>
          <SwitchLinha
            label="QR Code (somente com URL válida)"
            checked={layout.rodape.mostrarQr}
            onChange={(mostrarQr) => patch("rodape", { mostrarQr })}
          />
          <label className="block py-2 text-[13px]">
            URL do QR Code
            <input
              className="updv-input mt-1 w-full"
              value={layout.rodape.qrUrl}
              onChange={(event) => patch("rodape", { qrUrl: event.target.value })}
              placeholder="https://..."
            />
          </label>
          <SwitchLinha
            label={'Mostrar "Emitido pelo UltraPDV"'}
            checked={layout.rodape.emitidoUltraPdv}
            onChange={(emitidoUltraPdv) => patch("rodape", { emitidoUltraPdv })}
          />
          <SwitchLinha
            label="Data/hora da impressão"
            checked={layout.rodape.dataHoraImpressao}
            onChange={(dataHoraImpressao) =>
              patch("rodape", { dataHoraImpressao })
            }
          />
        </Grupo>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="updv-btn updv-btn-primary"
            disabled={pending}
            onClick={() => salvar()}
          >
            {pending ? "Salvando..." : "Salvar"}
          </button>
          <button
            type="button"
            className="updv-btn updv-btn-ghost"
            disabled={pending}
            onClick={() => imprimirTeste()}
          >
            Imprimir teste
          </button>
        </div>
      </div>

      <aside className="lg:sticky lg:top-20 h-fit space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] font-medium text-zinc-700">Preview</p>
          <select
            className="updv-input w-28"
            value={layout.papel}
            onChange={(event) =>
              setLayout((atual) => ({
                ...atual,
                papel: event.target.value === "58mm" ? "58mm" : "80mm",
              }))
            }
          >
            <option value="80mm">80 mm</option>
            <option value="58mm">58 mm</option>
          </select>
        </div>
        <ReciboTermico
          blocos={montado.blocos}
          papel={layout.papel}
          logoUrl={empresa.logoUrl}
        />
        <p className="text-[12px] text-zinc-500">
          O preview usa dados de exemplo com o cadastro real da empresa. A
          impressão de teste usa a impressora já selecionada para o recibo.
        </p>
      </aside>
    </div>
  );
}
