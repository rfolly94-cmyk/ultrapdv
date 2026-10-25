import { exigirBibliotecaSimulada } from "./adaptador.mjs";
import { calcularPwinfoAutcap } from "../../print-agent/src/tef-autcap.mjs";
import {
  AMBIENTE,
  CAMPOS_CONFIRMACAO,
  CAPTURAS_SUGERIDAS,
  INICIO_PINPAD,
  PWCNF,
  PWCNF_POR_MOTIVO,
  PWINFO,
  PWOPER,
  PWRET,
  PWDAT,
  SELECAO_PRODUCAO,
  TAMANHO_DADO,
  TIPOS_SENSIVEIS,
  horarioIdle,
  nomeRetorno,
  textoLimite,
} from "./contrato.mjs";
import { contemSegredo, eventoEstruturado } from "./eventos.mjs";
import {
  bloqueiaNovaOperacao,
  gravarJournalAtomico,
  lerJournal,
  registroVazio,
} from "./journal.mjs";

function texto(valor) {
  return typeof valor === "string" ? valor.trim() : "";
}

export class AgenteTefFase1 {
  constructor({ biblioteca, arquivo, dispositivoId, agora = () => new Date() }) {
    exigirBibliotecaSimulada(biblioteca);
    if (SELECAO_PRODUCAO) {
      throw new Error("A fase 1 não pode ser selecionada em produção.");
    }
    this.biblioteca = biblioteca;
    this.arquivo = texto(arquivo);
    this.dispositivoId = texto(dispositivoId);
    this.agora = agora;
    this.estado = "desligada";
    this.inicializada = false;
    this.ocupado = false;
    this.journal = null;
    this.captura = null;
    this.idleEm = null;
    this.idleBruto = "";
    this.eventos = [];
    this.segredos = [];
    this.pago = false;
  }

  publicar(parcial) {
    const evento = eventoEstruturado({ ...parcial, estado: this.estado, pago: false });
    if (contemSegredo(evento, this.segredos)) {
      throw new Error("Evento TEF tentou publicar dado sensível.");
    }
    this.eventos.push(evento);
    if (this.eventos.length > 80) this.eventos.splice(0, this.eventos.length - 80);
    return evento;
  }

  exigirDispositivo(dispositivoId) {
    const pedido = texto(dispositivoId);
    if (!this.dispositivoId || pedido !== this.dispositivoId) {
      return this.falha("DISPOSITIVO", "O dispositivo do evento não é o deste agente.");
    }
    return null;
  }

  ocupada() {
    return {
      ok: false,
      pago: false,
      codigo: "OCUPADO",
      estado: this.estado,
      mensagem: `A sessão está em ${this.estado}. A operação nova foi recusada.`,
    };
  }

  falha(codigo, mensagem) {
    const numerico = Number.isInteger(codigo) ? codigo : null;
    this.publicar({
      tipo: "erro",
      codigo: numerico,
      nome: numerico === null ? String(codigo) : undefined,
      mensagem,
    });
    return {
      ok: false,
      pago: false,
      estado: this.estado,
      codigo: numerico ?? codigo,
      nome: numerico === null ? String(codigo) : nomeRetorno(numerico),
      mensagem,
    };
  }

  async persistir(status, retornoExec) {
    const registro = {
      ...registroVazio(),
      ...(this.journal ?? {}),
      versao: 1,
      status,
      retornoExec: Number.isInteger(retornoExec) ? retornoExec : null,
      idleProcTime: this.idleBruto,
      atualizadoEm: this.agora().toISOString(),
    };
    if (this.arquivo) {
      this.journal = gravarJournalAtomico(this.arquivo, registro);
    } else {
      this.journal = registro;
    }
    const serial = JSON.stringify(this.journal);
    if (this.segredos.some((segredo) => segredo && serial.includes(segredo))) {
      throw new Error("Journal TEF tentou gravar dado sensível.");
    }
    this.publicar({ tipo: "journal", codigo: retornoExec ?? null, mensagem: status });
    return this.journal;
  }

  async lerConfirmacao() {
    const lido = {};
    for (const [campo, info] of CAMPOS_CONFIRMACAO) {
      const resposta = await this.biblioteca.getResult(info);
      const valor = resposta.codigo === PWRET.OK ? texto(resposta.valor) : "";
      lido[campo] = valor.length > TAMANHO_DADO[info] ? "" : valor;
    }
    return lido;
  }

  async atualizarIdle() {
    const lido = await this.biblioteca.getResult(PWINFO.IDLEPROCTIME);
    this.idleBruto = lido.codigo === PWRET.OK ? texto(lido.valor).slice(0, 12) : "";
    this.idleEm = horarioIdle(this.idleBruto);
  }

  async inicializar({ ambiente, diretorio, dispositivoId }) {
    const dispositivo = this.exigirDispositivo(dispositivoId);
    if (dispositivo) return dispositivo;
    if (this.ocupado) return this.ocupada();
    const codigoAmbiente = AMBIENTE[ambiente];
    if (codigoAmbiente === undefined || !texto(diretorio)) {
      return this.falha(PWRET.INVPARAM, "Ambiente ou diretório de trabalho ausente.");
    }
    this.ocupado = true;
    try {
      if (this.arquivo && !this.journal) {
        this.journal = lerJournal(this.arquivo);
      }
      const ambienteCodigo = await this.biblioteca.setEnvironment(codigoAmbiente);
      if (ambienteCodigo !== PWRET.OK && ambienteCodigo !== PWRET.INVCALL) {
        return this.falha(ambienteCodigo, "PW_iSetEnvironment recusou o ambiente.");
      }
      const init = await this.biblioteca.init(diretorio);
      if (init !== PWRET.OK) return this.falha(init, "PW_iInit recusou o diretório de trabalho.");
      this.inicializada = true;
      await this.atualizarIdle();
      if (bloqueiaNovaOperacao(this.journal)) {
        this.estado = this.journal.status === "aguardando_confirmacao"
          ? "aguardando_confirmacao"
          : this.journal.status;
      } else {
        this.estado = "ociosa";
      }
      return {
        ok: true,
        pago: false,
        estado: this.estado,
        codigo: PWRET.OK,
        selecaoProducao: SELECAO_PRODUCAO,
        pendencia: this.journal,
      };
    } finally {
      this.ocupado = false;
    }
  }

  async transacionar(pedido) {
    const dispositivo = this.exigirDispositivo(pedido.dispositivoId);
    if (dispositivo) return dispositivo;
    if (!this.inicializada) return this.falha(PWRET.DLLNOTINIT, "PW_iInit ainda não retornou PWRET_OK.");
    if (this.ocupado) return this.ocupada();
    if (bloqueiaNovaOperacao(this.journal)) {
      return this.falha("PENDENTE", "Há journal pendente. Confirme, desfaça ou recupere antes de outra operação.");
    }
    if (!texto(pedido.identificador) || !texto(pedido.moeda) || !texto(pedido.expoente)) {
      return this.falha(
        PWRET.NOMANDATORY,
        "Identificador, moeda ou expoente não foram informados."
      );
    }
    const valor = Number(pedido.valorCentavos);
    if (!Number.isInteger(valor) || valor <= 0) {
      return this.falha(PWRET.INVPARAM, "Valor inválido.");
    }
    this.ocupado = true;
    this.estado = "em_transacao";
    try {
      const nova = await this.biblioteca.newTransac(PWOPER.SALE);
      if (nova !== PWRET.OK) return this.falha(nova, "PW_iNewTransac recusou a operação.");
      const parametros = [
        [PWINFO.AUTNAME, "UltraPDV"],
        [PWINFO.AUTVER, "fase-1"],
        [PWINFO.AUTDEV, "UltraPDV"],
        [PWINFO.AUTCAP, calcularPwinfoAutcap()],
        [PWINFO.TOTAMNT, String(valor)],
        [PWINFO.CURRENCY, pedido.moeda],
        [PWINFO.CURREXP, pedido.expoente],
        [PWINFO.FISCALREF, pedido.identificador],
      ];
      for (const [info, item] of parametros) {
        const codigo = await this.biblioteca.addParam(info, item);
        if (codigo !== PWRET.OK) return this.falha(codigo, "PW_iAddParam recusou um parâmetro.");
      }
      this.journal = {
        ...registroVazio(),
        identificador: pedido.identificador,
        vendaId: texto(pedido.vendaId),
      };
      return await this.executarAteParar();
    } finally {
      this.ocupado = false;
    }
  }

  async executarAteParar() {
    for (let volta = 0; volta < 12; volta += 1) {
      const execucao = await this.biblioteca.execTransac(CAPTURAS_SUGERIDAS);
      const campos = await this.lerConfirmacao();
      Object.assign(this.journal, campos);
      await this.atualizarIdle();
      if (execucao.codigo === PWRET.NOTHING) continue;
      if (execucao.codigo === PWRET.MOREDATA) {
        const item = (execucao.captura ?? [])[0] ?? {};
        const tipo = Number(item.bTipoDeDado);
        const sensivel = TIPOS_SENSIVEIS.has(tipo) || item.bOcultarDadosDigitados === 1;
        const pinpad = Object.prototype.hasOwnProperty.call(INICIO_PINPAD, tipo);
        this.estado = pinpad ? "aguardando_pinpad" : "aguardando_captura";
        this.captura = {
          solicitacaoId: `fase1-${this.eventos.length + 1}`,
          indice: 0,
          tipo,
          info: Number(item.wIdentificador),
          sensivel,
          opcoes: Array.isArray(item.vszTextoMenu) ? item.vszTextoMenu.slice(0, 40) : [],
          valores: Array.isArray(item.vszValorMenu) ? item.vszValorMenu.slice(0, 40) : [],
          prompt: textoLimite(item.szPrompt ?? "", 84),
        };
        await this.persistir(this.estado, PWRET.MOREDATA);
        this.publicar({
          tipo: pinpad ? "pinpad" : tipo === PWDAT.MENU ? "menu" : "campo",
          codigo: PWRET.MOREDATA,
          solicitacaoId: this.captura.solicitacaoId,
          identificador: this.journal.identificador,
          vendaId: this.journal.vendaId,
          mensagem: sensivel ? "" : this.captura.prompt,
          opcoes: sensivel ? [] : this.captura.opcoes,
          sensivel,
          tipoDado: tipo,
        });
        return {
          ok: true,
          pago: false,
          estado: this.estado,
          codigo: PWRET.MOREDATA,
          nome: "PWRET_MOREDATA",
          solicitacaoId: this.captura.solicitacaoId,
        };
      }
      if (execucao.codigo !== PWRET.OK) {
        this.captura = null;
        if (this.journal.cnfReq === "1") {
          this.estado = "aguardando_confirmacao";
          await this.persistir(this.estado, execucao.codigo);
        } else {
          this.estado = "ociosa";
          await this.persistir("ociosa", execucao.codigo);
          this.journal = null;
        }
        return this.falha(execucao.codigo, "PW_iExecTransac não concluiu a transação.");
      }
      const confirma = this.journal.cnfReq === "1";
      this.estado = confirma ? "aguardando_confirmacao" : "ociosa";
      this.captura = null;
      await this.persistir(this.estado, PWRET.OK);
      if (!confirma) this.journal = null;
      return {
        ok: true,
        pago: false,
        estado: this.estado,
        codigo: PWRET.OK,
        nome: "PWRET_OK",
        cnfReq: this.journal?.cnfReq === "1",
      };
    }
    return this.falha(PWRET.TIMEOUT, "PW_iExecTransac repetiu PWRET_NOTHING além do limite local.");
  }

  async responder(pedido) {
    const dispositivo = this.exigirDispositivo(pedido.dispositivoId);
    if (dispositivo) return dispositivo;
    if (this.ocupado) return this.ocupada();
    if (!this.captura || this.captura.solicitacaoId !== pedido.solicitacaoId) {
      return this.falha("CAPTURA", "Não há captura pendente com este identificador.");
    }
    if (pedido.cancelar === true) return this.cancelarOperador();
    this.ocupado = true;
    this.estado = "em_transacao";
    try {
      if (Object.prototype.hasOwnProperty.call(INICIO_PINPAD, this.captura.tipo)) {
        return await this.bombearPinPad();
      }
      if (this.captura.sensivel) {
        const segredo = texto(pedido.valor);
        if (segredo) this.segredos.push(segredo);
        if (!segredo) return this.falha(PWRET.CANCEL, "A captura sensível foi cancelada.");
        const codigo = await this.biblioteca.addParam(this.captura.info, segredo);
        if (codigo !== PWRET.OK) return this.falha(codigo, "PW_iAddParam recusou o dado capturado.");
      } else if (this.captura.tipo === PWDAT.MENU) {
        const indice = pedido.indice;
        const valor = this.captura.valores[indice];
        if (!Number.isInteger(indice) || !valor) {
          return this.falha(PWRET.INVPARAM, "vszValorMenu não contém a opção escolhida.");
        }
        const codigo = await this.biblioteca.addParam(this.captura.info, valor);
        if (codigo !== PWRET.OK) return this.falha(codigo, "PW_iAddParam recusou o dado capturado.");
      } else {
        return this.falha(
          "BLOQUEADA",
          "O header não associa este PWDAT a uma função de captura. A função permanece bloqueada."
        );
      }
      this.captura = null;
      return await this.executarAteParar();
    } finally {
      this.ocupado = false;
    }
  }

  async bombearPinPad() {
    const nome = INICIO_PINPAD[this.captura.tipo];
    const iniciar = this.biblioteca[nome];
    if (typeof iniciar !== "function") {
      return this.falha("BLOQUEADA", `${nome} não está disponível no adaptador simulado.`);
    }
    const inicio = await iniciar.call(this.biblioteca, 0);
    if (inicio !== PWRET.OK) return this.falha(inicio, `${nome} não iniciou a captura.`);
    for (let volta = 0; volta < 8; volta += 1) {
      const evento = await this.biblioteca.ppEventLoop();
      if (evento.codigo === PWRET.NOTHING) continue;
      if (evento.codigo === PWRET.DISPLAY) {
        this.publicar({
          tipo: "mensagem",
          codigo: PWRET.DISPLAY,
          mensagem: textoLimite(evento.display ?? "", 100),
        });
        continue;
      }
      if (evento.codigo === PWRET.CANCEL) return this.cancelarOperador();
      if (evento.codigo !== PWRET.OK) return this.falha(evento.codigo, "PW_iPPEventLoop encerrou a captura.");
      this.captura = null;
      return await this.executarAteParar();
    }
    return this.falha(PWRET.TIMEOUT, "PW_iPPEventLoop não concluiu.");
  }

  async cancelarOperador() {
    this.publicar({ tipo: "cancelamento", codigo: PWRET.CANCEL, mensagem: "Operador cancelou a captura." });
    if (this.journal?.cnfReq === "1") {
      return this.fechar(PWCNF.REV_ABORT, "desfazer", true);
    }
    this.captura = null;
    this.estado = "ociosa";
    await this.persistir("ociosa", PWRET.CANCEL);
    this.journal = null;
    return { ok: true, pago: false, estado: "ociosa", codigo: PWRET.CANCEL, nome: "PWRET_CANCEL" };
  }

  async confirmar({ dispositivoId, motivo = "manual" }) {
    const dispositivo = this.exigirDispositivo(dispositivoId);
    if (dispositivo) return dispositivo;
    const status = motivo === "automatica" ? PWCNF.CNF_AUTO : PWCNF.CNF_MANU_AUT;
    return this.fechar(status, "confirmar");
  }

  async desfazer({ dispositivoId, motivo = "desfazer_manual" }) {
    const dispositivo = this.exigirDispositivo(dispositivoId);
    if (dispositivo) return dispositivo;
    if (motivo === "impressao") {
      return this.falha(
        "PWCNF",
        "O header de PWCNF_REV_PRN_AUT pede reimpressão. A falha de impressão não desfaz a transação."
      );
    }
    const status = PWCNF_POR_MOTIVO[motivo];
    if (!Number.isInteger(status) || status === PWCNF.CNF_AUTO || status === PWCNF.CNF_MANU_AUT) {
      return this.falha("PWCNF", "Motivo de desfazimento sem código PWCNF correspondente.");
    }
    return this.fechar(status, "desfazer");
  }

  async fechar(status, acao, interno = false) {
    if (this.ocupado && !interno) return this.ocupada();
    const jaOcupado = this.ocupado;
    if (!this.journal || this.journal.cnfReq !== "1") {
      return this.falha("SEM_PENDENCIA", "Não há PWINFO_CNFREQ = 1 pendente de confirmação.");
    }
    this.ocupado = true;
    this.estado = acao === "confirmar" ? "confirmando" : "desfazendo";
    try {
      const codigo = await this.biblioteca.confirmation(status, {
        reqNum: this.journal.reqNum,
        locRef: this.journal.locRef,
        extRef: this.journal.extRef,
        virtMerch: this.journal.virtMerch,
        authSyst: this.journal.authSyst,
      });
      if (codigo !== PWRET.OK) {
        this.estado = "aguardando_confirmacao";
        return this.falha(codigo, "PW_iConfirmation não atualizou o status.");
      }
      const espera = await this.biblioteca.waitConfirmation();
      if (espera !== PWRET.OK) {
        this.estado = "aguardando_confirmacao";
        return this.falha(espera, "PW_iWaitConfirmation não terminou.");
      }
      await this.atualizarIdle();
      const confirmada = acao === "confirmar";
      this.pago = false;
      this.captura = null;
      this.estado = "ociosa";
      await this.persistir(confirmada ? "confirmada" : "desfeita", PWRET.OK);
      this.journal = null;
      this.publicar({
        tipo: "confirmacao",
        codigo: PWRET.OK,
        mensagem: confirmada ? "confirmada" : "desfeita",
      });
      return {
        ok: true,
        pago: false,
        confirmada,
        desfeita: !confirmada,
        estado: "ociosa",
        codigo: PWRET.OK,
        status,
      };
    } finally {
      if (!jaOcupado) this.ocupado = false;
    }
  }

  async ocioso() {
    if (this.ocupado || this.estado !== "ociosa") {
      return { ok: true, executou: false, pago: false, estado: this.estado };
    }
    if (!this.idleEm || this.agora() < this.idleEm) {
      return { ok: true, executou: false, pago: false };
    }
    this.ocupado = true;
    try {
      const codigo = await this.biblioteca.idleProc();
      await this.atualizarIdle();
      this.publicar({ tipo: "ociosidade", codigo });
      return { ok: codigo === PWRET.OK, executou: true, pago: false, codigo };
    } finally {
      this.ocupado = false;
    }
  }

  async pinpad({ dispositivoId }) {
    const dispositivo = this.exigirDispositivo(dispositivoId);
    if (dispositivo) return dispositivo;
    if (!this.inicializada || this.ocupado || this.estado !== "ociosa") return this.ocupada();
    const teste = await this.biblioteca.ppCommTest();
    let evento = null;
    if (teste.codigo === PWRET.OK) evento = await this.biblioteca.ppEventLoop();
    return {
      ok: teste.codigo === PWRET.OK,
      pago: false,
      cobranca: false,
      codigo: teste.codigo,
      nome: nomeRetorno(teste.codigo),
      porta: Number.isInteger(teste.porta) ? teste.porta : null,
      evento: evento ? nomeRetorno(evento.codigo) : null,
    };
  }
}
