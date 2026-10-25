export function TefPerfilAutonomo() {
  const etapas = [
    "Verificar o Connector, o agente e a PGWebLib 4.1.50.924 ao lado do executável.",
    "Selecionar homologação ou produção. Cada ambiente usa a própria pasta em ProgramData.",
    "Credenciar o estabelecimento pelo fluxo oficial da biblioteca. CNPJ e senha, sozinhos, não ativam o TEF.",
    "Identificar o PinPad deste computador. A porta e o modelo não vêm fixos no instalador.",
    "Testar a comunicação sem pagamento, somente quando o operador autorizar.",
    "Ativar os pagamentos depois da biblioteca, do credenciamento, do ponto de captura, do terminal e do PinPad.",
  ];

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5">
      <h2 className="text-base font-semibold text-zinc-950">TEF instalado, ainda não configurado</h2>
      <p className="mt-2 text-sm leading-6 text-zinc-600">
        A instalação nova não traz ponto de captura, credencial nem servidor. Os pagamentos permanecem
        bloqueados até a ativação deste estabelecimento.
      </p>
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-6 text-zinc-800">
        {etapas.map((etapa) => (
          <li key={etapa}>{etapa}</li>
        ))}
      </ol>
    </section>
  );
}
