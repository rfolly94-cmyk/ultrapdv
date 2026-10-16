export const MENSAGEM_INICIALIZACAO_GRAVACAO =
  "A PGWebLib não conseguiu gravar na pasta de produção. Os arquivos existentes permanecem intactos. A inicialização não instalou, não cobrou e não confirmou transação.";

export function corpoInicializacaoExplicita() {
  return { acao: "inicializar" as const };
}

export function mensagemInicializacaoBiblioteca(input: {
  ok?: boolean;
  erro?: string | null;
  inicializado?: boolean;
  diretorioSelecionado?: string;
}) {
  const erro = String(input.erro ?? "");
  if (/validação do Connector|Código\s+-?\d+|PWRET_/i.test(erro)) {
    return erro.trim();
  }
  if (/grava|TEF_INICIALIZACAO_FALHOU/i.test(erro)) {
    return /grava/i.test(erro)
      ? MENSAGEM_INICIALIZACAO_GRAVACAO
      : "A PGWebLib não confirmou a inicialização. Nenhum pagamento, instalação ou manutenção foi iniciado.";
  }
  if (
    input.ok === true &&
    input.inicializado === true &&
    input.diretorioSelecionado === "producao"
  ) {
    return "PGWebLib inicializada na pasta de produção. Nenhum pagamento, instalação ou manutenção foi iniciado.";
  }
  if (erro.trim()) {
    return erro.trim();
  }
  return "A PGWebLib não confirmou a inicialização. Nenhum pagamento foi iniciado.";
}
