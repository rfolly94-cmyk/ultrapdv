export function formatarDataHoraGeranet(
  data: Date,
  fusoHorario: string
) {
  const fuso =
    String(
      fusoHorario ?? ""
    ).trim();

  if (!fuso) {
    throw new Error(
      "Fuso horário fiscal da empresa não está configurado."
    );
  }

  if (
    Number.isNaN(
      data.getTime()
    )
  ) {
    throw new Error(
      "Data fiscal inválida."
    );
  }

  let partes:
    Intl.DateTimeFormatPart[];

  try {
    partes =
      new Intl.DateTimeFormat(
        "en-CA",
        {
          timeZone: fuso,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hourCycle: "h23",
        }
      ).formatToParts(data);
  } catch {
    throw new Error(
      `Fuso horário fiscal inválido: ${fuso}`
    );
  }

  const valor = (
    tipo:
      Intl.DateTimeFormatPartTypes
  ) =>
    partes.find(
      (p) => p.type === tipo
    )?.value ?? "";

  const ano = valor("year");
  const mes = valor("month");
  const dia = valor("day");
  const hora = valor("hour");
  const minuto = valor("minute");
  const segundo = valor("second");

  if (
    !ano ||
    !mes ||
    !dia ||
    !hora ||
    !minuto ||
    !segundo
  ) {
    throw new Error(
      "Não foi possível formatar a data fiscal."
    );
  }

  return `${ano}-${mes}-${dia} ${hora}:${minuto}:${segundo}`;
}

export function fusoFiscalPadrao(uf?: string | null, fusoEmpresa?: string | null) {
  const informado = String(fusoEmpresa ?? "").trim();
  if (informado) {
    return informado;
  }

  if (String(uf ?? "").trim().toUpperCase() === "MT") {
    return "America/Cuiaba";
  }

  return informado || "UTC";
}

export const MENSAGEM_FUSO_CONTRATO_AUSENTE =
  "Fuso horário fiscal não configurado.";

function instanteParaOffset(
  timezoneIana: string,
  dataEmissao: Date | string
) {
  if (dataEmissao instanceof Date) {
    if (Number.isNaN(dataEmissao.getTime())) {
      throw new Error("Data fiscal inválida.");
    }
    return dataEmissao;
  }

  const textoData = String(dataEmissao ?? "").trim();
  const parede = textoData.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/
  );

  if (parede) {
    const utc = Date.UTC(
      Number(parede[1]),
      Number(parede[2]) - 1,
      Number(parede[3]),
      Number(parede[4] ?? 12),
      Number(parede[5] ?? 0),
      Number(parede[6] ?? 0)
    );
    const tentativa = new Date(utc);
    if (!Number.isNaN(tentativa.getTime())) {
      return tentativa;
    }
  }

  const parsed = parseDataFiscal(textoData);
  if (!parsed) {
    throw new Error("Data fiscal inválida.");
  }
  void timezoneIana;
  return parsed;
}

export function resolverOffsetFiscal(
  timezoneIana: unknown,
  dataEmissao: Date | string
) {
  const iana = String(timezoneIana ?? "").trim();

  if (!iana) {
    throw new Error(MENSAGEM_FUSO_CONTRATO_AUSENTE);
  }

  if (/^[+-]\d{2}:\d{2}$/.test(iana)) {
    throw new Error(
      "Fuso horário fiscal deve ser um timezone IANA, não um offset."
    );
  }

  const data = instanteParaOffset(iana, dataEmissao);

  let partes: Intl.DateTimeFormatPart[];

  try {
    partes = new Intl.DateTimeFormat("en-US", {
      timeZone: iana,
      timeZoneName: "longOffset",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(data);
  } catch {
    throw new Error(`Fuso horário fiscal inválido: ${iana}`);
  }

  const nome = partes.find((parte) => parte.type === "timeZoneName")?.value ?? "";
  const match = nome.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/i);

  if (!match) {
    throw new Error("Não foi possível resolver o offset fiscal.");
  }

  return `${match[1]}${String(match[2]).padStart(2, "0")}:${(match[3] ?? "00").padStart(2, "0")}`;
}

export function parseDataFiscal(valor: string | Date | null | undefined) {
  if (!valor) {
    return null;
  }

  const data = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(data.getTime()) ? null : data;
}

export function formatarDataHoraFiscalPtBr(
  data: Date,
  fusoHorario: string
) {
  const bruto = formatarDataHoraGeranet(data, fusoHorario);
  const [diaIso, hora] = bruto.split(" ");
  const [ano, mes, dia] = (diaIso ?? "").split("-");
  const horaMinuto = (hora ?? "").slice(0, 5);

  if (!ano || !mes || !dia || !horaMinuto) {
    return bruto;
  }

  return `${dia}/${mes}/${ano} às ${horaMinuto}`;
}
