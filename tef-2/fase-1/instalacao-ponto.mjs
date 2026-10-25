import { descricaoRetorno, nomeRetorno, PWOPER, PWRET } from "./contrato.mjs";

const DESCRICAO_NOTINST = "É necessário efetuar uma transação de Instalação.";

export function classificarDiagnosticoPinPad({ init, commTest, porta, evento }) {
  const comunicacaoEstabelecida = Number(init) === PWRET.OK && Number(commTest) === PWRET.OK && Number(porta) !== 0xff;
  const pontoNaoInstalado = Number(evento) === PWRET.NOTINST;
  return {
    comunicacaoFisica: comunicacaoEstabelecida ? "estabelecida" : "nao-estabelecida",
    pontoCaptura: pontoNaoInstalado ? "nao-instalado" : "desconhecido",
    pagamento: "indisponivel",
    retornoNome: nomeRetorno(evento),
    retornoDescricao: descricaoRetorno(evento),
  };
}

export function prepararInstalacaoPonto() {
  return {
    executar: false,
    operacao: PWOPER.INSTALL,
    operacaoNome: "PWOPER_INSTALL",
    alternativa: PWOPER.ADMIN,
    alternativaNome: "PWOPER_ADMIN",
    vendaBloqueada: PWOPER.SALE,
    copiaPerfilProducao: false,
    credencialProducao: false,
    senhaTecnicaArmazenada: false,
    abiComprovado: false,
    layoutHomologado: false,
    etapas: [
      "PW_iInit no diretorio exclusivo de ensaio, ate PWRET_OK.",
      "PW_iNewTransac com PWOPER_INSTALL (0x01). O comentario antigo do header que chama o valor 1 de pagamento diverge do define e das instrucoes de uso.",
      "PW_iExecTransac com ate 9 capturas. Em PWRET_MOREDATA, informar somente o dado pedido pela biblioteca e repetir.",
      "PW_iPPEventLoop enquanto o retorno for PWRET_NOTHING ou PWRET_DISPLAY.",
      "Em PWRET_OK, obter o comprovante por PW_iGetResult e confirmar ou desfazer antes de outra transacao.",
      "PWOPER_SALE permanece bloqueado. A instalacao nao libera pagamento.",
    ],
    bloqueio: "INSTALACAO_BLOQUEADA",
  };
}

export function executarInstalacaoPonto() {
  return {
    ok: false,
    executado: false,
    motivo: "INSTALACAO_BLOQUEADA",
  };
}

export { DESCRICAO_NOTINST };
