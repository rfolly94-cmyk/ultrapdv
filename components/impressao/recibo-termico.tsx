"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

import { logoUrlUtilizavel } from "@/lib/empresa/logo-url";
import type { AlinhamentoRecibo, BlocoRecibo, PapelRecibo } from "@/lib/impressao/recibo-layout";

function LogoReciboTermico({
  src,
  alinhamento,
  papel,
}: {
  src?: string | null;
  alinhamento: AlinhamentoRecibo;
  papel: PapelRecibo;
}) {
  const url = logoUrlUtilizavel(src);
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    setFalhou(false);
  }, [url]);

  if (!url || falhou) {
    return null;
  }

  return (
    <div
      className={`mb-2 flex ${alinhamento === "esquerda" ? "justify-start" : "justify-center"}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={url}
        src={url}
        alt=""
        className={`w-auto object-contain ${
          papel === "58mm" ? "max-h-10 max-w-[70%]" : "max-h-14 max-w-[70%]"
        }`}
        onError={() => setFalhou(true)}
      />
    </div>
  );
}

export function ReciboTermico({
  blocos,
  papel,
  logoUrl,
}: {
  blocos: BlocoRecibo[];
  papel: PapelRecibo;
  logoUrl?: string | null;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const qrBloco = blocos.find(
    (bloco): bloco is Extract<BlocoRecibo, { tipo: "qr" }> => bloco.tipo === "qr"
  );
  const qrUrl = qrBloco?.url ?? "";

  useEffect(() => {
    if (!qrUrl) {
      setQr(null);
      return;
    }
    let ativo = true;
    void QRCode.toDataURL(qrUrl, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 160,
      color: { dark: "#111111", light: "#ffffff" },
    }).then((dataUrl) => {
      if (ativo) {
        setQr(dataUrl);
      }
    });
    return () => {
      ativo = false;
    };
  }, [qrUrl]);

  const largura = papel === "58mm" ? "58mm" : "80mm";

  return (
    <div
      className="mx-auto overflow-hidden rounded-sm bg-[#f7f4ea] text-[#111] shadow-[0_12px_40px_rgba(0,0,0,0.18)]"
      style={{ width: largura, maxWidth: "100%" }}
    >
      <div className="border-x border-[#d6d0c2] bg-white px-3 py-4 font-mono text-[11px] leading-4">
        {blocos.map((bloco, indice) => {
          if (bloco.tipo === "sep") {
            return (
              <div
                key={indice}
                className="my-2 border-t border-dashed border-zinc-400"
              />
            );
          }
          if (bloco.tipo === "logo") {
            return (
              <LogoReciboTermico
                key={indice}
                src={logoUrl}
                alinhamento={bloco.alinhamento}
                papel={papel}
              />
            );
          }
          if (bloco.tipo === "qr") {
            if (!qr) {
              return null;
            }
            return (
              <div key={indice} className="my-2 flex justify-center">
                <img src={qr} alt="" className="h-28 w-28 bg-white" />
              </div>
            );
          }
          return (
            <p
              key={indice}
              className={`whitespace-pre-wrap break-words ${
                bloco.alinhamento === "centro" ? "text-center" : "text-left"
              } ${bloco.destaque ? "font-bold" : ""}`}
            >
              {bloco.texto || "\u00a0"}
            </p>
          );
        })}
      </div>
    </div>
  );
}
