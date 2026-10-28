export function modalidadeNativaPinpad(valor: unknown):
  | { ok: true; modalidade: "1" | "2" | "pix" }
  | { ok: false; erro: string } {
  const texto = String(valor ?? "").trim().toLowerCase();
  if (texto === "debito" || texto === "2") return { ok: true, modalidade: "2" };
  if (texto === "credito" || texto === "1") return { ok: true, modalidade: "1" };
  return texto === "pix"
    ? { ok: true, modalidade: "pix" }
    : { ok: false, erro: "A modalidade não está disponível para o PinPad. Nenhuma cobrança foi iniciada." };
}
