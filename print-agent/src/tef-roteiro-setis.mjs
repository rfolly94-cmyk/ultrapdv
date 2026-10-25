export const RESULTADO_APROVADO_DLL = "aprovado_dll";

const passos = [
  [1, "Instalação", "SIM", "PWOPER_INSTALL", "tef-instalacao-homologacao.mjs", "tef-instalacao-homologacao.test.mjs", true, "ponto_instalado_em_execucao_anterior", "Não reinstalar nem chamar PW_iSetEnvironment de novo."],
  [2, "Venda valor máximo", "SIM", "PWOPER_SALE", "tef-venda-nativa.mjs", "tef-venda-nativa.test.mjs", true, "pendente_execucao_fisica", "Valor máximo ainda não foi enviado à DLL."],
  [3, "Venda pré-seleção", "SIM", "PWOPER_SALEPRE", "tef-venda-nativa.mjs", null, true, "pendente_execucao_fisica", "0x2F no header desta versão é PWOPER_SALEPRE, não um parâmetro de venda."],
  [4, "Venda negada", "SIM", "PWOPER_SALE", "tef-venda-nativa.mjs", "tef-venda-nativa.test.mjs", true, "pendente_execucao_fisica", "Negativa simulada não aprova o cenário na DLL."],
  [5, "Menu adquirente", "SIM", "PWRET_MOREDATA", "tef-pgweb.mjs", "tef-pgweb.test.mjs", true, "pendente_execucao_fisica", "Menu só pode ser respondido quando a DLL solicitar."],
  [6, "Venda crédito", "SIM", "PWOPER_SALE", "tef-venda-nativa.mjs", "tef-venda-nativa.test.mjs", true, "pendente_execucao_fisica", "A única tentativa nativa parou em PW_iAddParam -2499 e não chegou a PW_iExecTransac."],
  [7, "Venda débito", "SIM", "PWOPER_SALE", "tef-venda-nativa.mjs", "tef-venda-nativa.test.mjs", true, "pendente_execucao_fisica", "Mesma tentativa incompleta, valor de 1 centavo, sem autorização."],
  [8, "Venda financiamento", "SIM", "PWOPER_SALE", "tef-venda-nativa.mjs", null, true, "pendente_execucao_fisica", "Parcelamento ainda não foi exercido na DLL."],
  [9, "Recibos diferenciados", "OPCIONAL", "comprovante", "tef-pgweb.mjs", null, true, "pendente_execucao_fisica", "Opcional e sem via impressa desta versão."],
  [10, "Recibos diferenciados", "SIM", "comprovante", "tef-pgweb.mjs", null, true, "pendente_execucao_fisica", "Comprovante real depende de autorização que ainda não existe."],
  [11, "QR Code", "SIM", "captura", "tef-pgweb.mjs", null, true, "pendente_execucao_fisica", "QR só entra se a DLL o solicitar."],
  [12, "Teste de comunicação", "SIM", "PW_iPPCommTest", "tef-diagnostico-homologacao.mjs", "tef-diagnostico-homologacao.test.mjs", true, "comunicacao_confirmada_em_execucao_anterior", "COM7 já respondeu; esta revisão não repetiu o teste."],
  [13, "Relatório sintético", "OPCIONAL", "PWOPER_ADMIN", "tef-pgweb.mjs", null, true, "pendente_execucao_fisica", "Relatório administrativo não foi executado."],
  [14, "Relatório detalhado", "OPCIONAL", "PWOPER_ADMIN", "tef-pgweb.mjs", null, true, "pendente_execucao_fisica", "Relatório administrativo não foi executado."],
  [15, "Relatório resumido", "OPCIONAL", "PWOPER_ADMIN", "tef-pgweb.mjs", null, true, "pendente_execucao_fisica", "Relatório administrativo não foi executado."],
  [16, "Menu administrativo", "SIM", "PWOPER_ADMIN", "tef-pgweb.mjs", null, true, "pendente_execucao_fisica", "Área administrativa preparada sem ação financeira automática."],
  [17, "Manutenção", "SIM", "PW_iIdleProc", "tef-pgweb.mjs", "tef-pgweb.test.mjs", true, "pendente_execucao_fisica", "O agendamento existe; a DLL real não foi chamada nesta revisão."],
  [18, "Reinstalação", "SIM", "PWOPER_INSTALL", "tef-instalacao-homologacao.mjs", "tef-instalacao-homologacao.test.mjs", true, "bloqueado", "O ponto já instalado não recebe PW_iSetEnvironment de novo."],
  [19, "Vendas para cancelamento", "OPCIONAL", "PWOPER_SALE", "tef-venda-nativa.mjs", null, true, "pendente_execucao_fisica", "Sem venda autorizada para cancelar."],
  [20, "Passo 20", "OPCIONAL", "roteiro", null, null, true, "descricao_ausente_na_planilha", "A planilha não traz observação para este passo. O texto fica no PDF."],
  [21, "Passo 21", "SIM", "roteiro", null, null, true, "descricao_ausente_na_planilha", "A planilha não traz observação para este passo. O texto fica no PDF."],
  [22, "Cancelamento", "OPCIONAL", "cancelamento", "tef-pgweb.mjs", null, true, "pendente_execucao_fisica", "Cancelamento real não foi executado."],
  [23, "Passo 23", "SIM", "roteiro", null, null, true, "descricao_ausente_na_planilha", "A planilha não traz observação para este passo. O texto fica no PDF."],
  [24, "Passo 24", "OPCIONAL", "roteiro", null, null, true, "descricao_ausente_na_planilha", "A planilha não traz observação para este passo. O texto fica no PDF."],
  [25, "Passo 25", "OPCIONAL", "roteiro", null, null, true, "descricao_ausente_na_planilha", "A planilha não traz observação para este passo. O texto fica no PDF."],
  [26, "Queda de energia", "SIM", "journal", "tef-pendencia.mjs", "tef-sessao-tecnica.test.mjs", true, "pendente_execucao_fisica", "A queda real não foi provocada. O journal técnico incompleto foi preservado."],
  [27, "Queda de energia no menu administrativo", "SIM", "journal", "tef-pendencia.mjs", "tef-sessao-tecnica.test.mjs", true, "pendente_execucao_fisica", "Sem queda física durante menu administrativo."],
  [28, "Dado genérico digitado", "SIM", "captura", "tef-pgweb.mjs", "tef-pgweb.test.mjs", true, "pendente_execucao_fisica", "A máquina responde ao que a DLL pedir. Não houve captura real."],
  [29, "Passo 29", "SIM", "captura", "tef-pgweb.mjs", null, true, "descricao_ausente_na_planilha", "A planilha não traz observação. O procedimento permanece no PDF."],
  [30, "Dado genérico seleção", "SIM", "captura", "tef-pgweb.mjs", "tef-pgweb.test.mjs", true, "pendente_execucao_fisica", "Seleção simulada não aprova o cenário na DLL."],
  [31, "Passo 31", "SIM", "captura", "tef-pgweb.mjs", null, true, "descricao_ausente_na_planilha", "A planilha não traz observação. O procedimento permanece no PDF."],
  [32, "Mensagem de tamanho máximo", "SIM", "captura", "tef-pgweb.mjs", null, true, "pendente_execucao_fisica", "Buffer de resultado é 4096. O tamanho máximo da DLL não foi exercido."],
  [33, "Transação pendente", "SIM", "PWINFO_SERVERPND", "tef-venda-nativa.mjs", "tef-venda-nativa.test.mjs", true, "serverpnd_0_lido", "Leitura anterior retornou 0. Pendência remota simulada continua bloqueando."],
  [34, "Passo 34", "SIM", "roteiro", null, null, true, "descricao_ausente_na_planilha", "A planilha não traz observação para este passo. O texto fica no PDF."],
  [35, "Passo 35", "SIM", "roteiro", null, null, true, "descricao_ausente_na_planilha", "A planilha não traz observação para este passo. O texto fica no PDF."],
  [36, "Passo 36", "SIM", "roteiro", null, null, true, "descricao_ausente_na_planilha", "A planilha não traz observação para este passo. O texto fica no PDF."],
  [37, "Confirmação manual", "SIM", "PW_iConfirmation", "tef-venda-nativa.mjs", "tef-venda-nativa.test.mjs", true, "pendente_execucao_fisica", "Confirmação não é chamada só porque uma função retornou 0."],
  [38, "Passo 38", "OPCIONAL", "roteiro", null, null, true, "descricao_ausente_na_planilha", "A planilha não traz observação para este passo. O texto fica no PDF."],
  [39, "Desfazimento", "SIM", "PW_iConfirmation", "tef-venda-nativa.mjs", "tef-venda-nativa.test.mjs", true, "pendente_execucao_fisica", "Desfazimento real não foi executado e não há autorização identificada."],
  [40, "Passo 40", "OPCIONAL", "roteiro", null, null, true, "descricao_ausente_na_planilha", "A planilha não traz observação para este passo. O texto fica no PDF."],
  [41, "Autoatendimento", "SIM PARA AUTO-ATENDIMENTO", "fora_do_caixa", null, null, true, "fora_do_escopo_atual", "O caixa atual é atendido por operador."],
  [42, "Passo 42", "SIM PARA AUTO-ATENDIMENTO", "fora_do_caixa", null, null, true, "fora_do_escopo_atual", "O caixa atual é atendido por operador."],
  [43, "Cancelamento para subadquirentes", "SIM", "cancelamento", "tef-pgweb.mjs", null, true, "pendente_execucao_fisica", "Sem transação autorizada para cancelar."],
  [44, "Passo 44", "SIM", "roteiro", null, null, true, "descricao_ausente_na_planilha", "A planilha não traz observação para este passo. O texto fica no PDF."],
  [45, "Cancelamento para adquirentes", "SIM", "cancelamento", "tef-pgweb.mjs", null, true, "pendente_execucao_fisica", "Sem transação autorizada para cancelar."],
  [46, "Passo 46", "SIM", "roteiro", null, null, true, "descricao_ausente_na_planilha", "A planilha não traz observação para este passo. O texto fica no PDF."],
  [47, "Venda por aproximação", "SIM", "PWOPER_SALE", "tef-venda-nativa.mjs", null, true, "pendente_execucao_fisica", "Aproximação não foi exercida na DLL."],
  [48, "Passo 48", "SIM", "roteiro", null, null, true, "descricao_ausente_na_planilha", "A planilha não traz observação para este passo. O texto fica no PDF."],
  [49, "ControlPay", "SIM PARA CONTROLPAY", "controlpay", null, null, false, "fora_do_escopo_atual", "A integração atual é PGWebLib Windows, não ControlPay."],
  [50, "ControlPay", "SIM PARA CONTROLPAY", "controlpay", null, null, false, "fora_do_escopo_atual", "A integração atual é PGWebLib Windows, não ControlPay."],
  [51, "ControlPay", "SIM PARA CONTROLPAY", "controlpay", null, null, false, "fora_do_escopo_atual", "A integração atual é PGWebLib Windows, não ControlPay."],
  [52, "ControlPay", "SIM PARA CONTROLPAY", "controlpay", null, null, false, "fora_do_escopo_atual", "A integração atual é PGWebLib Windows, não ControlPay."],
  [53, "ControlPay", "SIM PARA CONTROLPAY", "controlpay", null, null, false, "fora_do_escopo_atual", "A integração atual é PGWebLib Windows, não ControlPay."],
  [54, "Queda de energia após a aprovação", "SIM", "journal", "tef-pendencia.mjs", "tef-sessao-tecnica.test.mjs", true, "pendente_execucao_fisica", "Não houve aprovação financeira para interromper."],
  [55, "QR Code", "SIM", "captura", "tef-pgweb.mjs", null, true, "pendente_execucao_fisica", "QR só entra se a DLL o solicitar."],
  [56, "Passo 56", "SIM", "roteiro", null, null, true, "descricao_ausente_na_planilha", "A planilha não traz observação para este passo. O texto fica no PDF."],
  [57, "Passo 57", "SIM", "roteiro", null, null, true, "descricao_ausente_na_planilha", "A planilha não traz observação para este passo. O texto fica no PDF."],
  [58, "Comprovante gráfico", "SIM PARA C6PAY ANDROID", "android", null, null, false, "fora_do_escopo_atual", "O conector atual é Windows x64."],
];

export const ROTEIRO_SETIS = Object.freeze(passos.map((passo) => Object.freeze({
  passo: passo[0],
  nome: passo[1],
  obrigatoriedade: passo[2],
  fluxo: passo[3],
  implementacao: passo[4],
  teste: passo[5],
  exigeFisico: passo[6],
  resultado: passo[7],
  pendencia: passo[8],
})));

export function matrizSetis() {
  return ROTEIRO_SETIS.map((passo) => {
    if (passo.resultado === RESULTADO_APROVADO_DLL) {
      throw new Error("Cenário SETIS não pode ser marcado como aprovado na DLL por esta revisão.");
    }
    return passo;
  });
}
